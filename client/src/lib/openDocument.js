// Popup-safe opening of a document that needs an async signed URL first.
//
// The obvious code — `const url = await getSignedUrl(); window.open(url)` — is blocked by
// Safari and some mobile Chrome configurations, because by the time `window.open` runs the
// call is no longer attached to the user's click. The tab simply never appears, and the user
// is told nothing.
//
// The fix: open a blank tab SYNCHRONOUSLY inside the click handler (which browsers allow),
// then navigate that already-granted tab once the URL arrives.
//
// Note on `noopener`: passing it to `window.open` makes the return value null in several
// browsers, which would leave nothing to navigate. So we keep the handle and sever the link
// ourselves by setting `opener = null` before navigating — same end state, and we can still
// point the tab at the document.
//
// Every failure path is visible: a blocked popup returns the URL for an inline fallback link,
// and a failed request reports an error instead of leaving a blank tab.

const PLACEHOLDER_HTML =
  '<!doctype html><meta charset="utf-8"><title>Opening document…</title>' +
  '<body style="font:14px system-ui,sans-serif;padding:24px;color:#334155">Opening document…</body>';

const ERROR_HTML =
  '<!doctype html><meta charset="utf-8"><title>Could not open</title>' +
  '<body style="font:14px system-ui,sans-serif;padding:24px;color:#b91c1c">' +
  'Could not open the document. Close this tab and try again.</body>';

/**
 * @param {object} deps
 *   @param {() => Promise<string>} deps.fetchUrl   resolves the short-lived signed URL
 *   @param {(url:string,target:string)=>any} [deps.openWindow]  injectable for tests
 * @returns {Promise<{status:'opened'|'blocked'|'error', url?:string, error?:Error}>}
 *   - `opened`  the tab was granted and navigated
 *   - `blocked` the browser refused the tab; `url` is returned so the caller can render an
 *               inline link the user can click directly (that click IS a fresh gesture)
 *   - `error`   the URL could not be obtained; nothing is left hanging silently
 */
export async function openDocumentSafely({ fetchUrl, openWindow } = {}) {
  const opener = openWindow || ((u, t) => window.open(u, t));

  // 1. Claim the tab synchronously, while the user's gesture is still in scope.
  let win = null;
  try { win = opener('', '_blank'); } catch { win = null; }

  // 2. Sever the link to this window immediately, and say what is happening.
  if (win) {
    try { win.opener = null; } catch { /* cross-origin or restricted; not fatal */ }
    try { win.document.write(PLACEHOLDER_HTML); win.document.close(); } catch { /* ditto */ }
  }

  // 3. Now do the slow part.
  let url;
  try {
    url = await fetchUrl();
    if (!url) throw new Error('No document URL was returned');
  } catch (error) {
    if (win) {
      // Prefer an explanation in the tab we opened; close it if we cannot write.
      try { win.document.write(ERROR_HTML); win.document.close(); }
      catch { try { win.close(); } catch { /* ignore */ } }
    }
    return { status: 'error', error };
  }

  // 4. Navigate the tab we already hold. `replace` keeps the blank placeholder out of history.
  if (win && !win.closed) {
    try {
      try { win.opener = null; } catch { /* ignore */ }
      if (win.location && typeof win.location.replace === 'function') win.location.replace(url);
      else win.location = url;
      return { status: 'opened', url };
    } catch { /* fall through to the inline fallback */ }
  }

  // 5. No usable tab: hand the URL back so the row can offer a real link to click.
  return { status: 'blocked', url };
}

export const POPUP_BLOCKED_MESSAGE = 'Popup blocked.';
export const OPEN_FAILED_MESSAGE = 'Could not open document. Please try again.';
