// Magic-link email sender. Provider-pluggable (EMAIL_PROVIDER); only 'resend' is wired.
// Pure/testable: caller injects provider/apiKey/from + optionally fetch/log. NEVER logs
// the API key or the token-bearing link (the magic link is logged ONLY by the caller in
// dev). Returns a small status object that never contains the API key.

function magicLinkHtml(url) {
  // No financial data. Single primary action + expiry note + plain URL fallback.
  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#111">',
    '<h2 style="font-size:18px;margin:0 0 12px">Sign in to CFO AI</h2>',
    '<p style="font-size:14px;color:#555;margin:0 0 18px">Click the button below to sign in. This link expires in 10 minutes and can be used once.</p>',
    `<p style="margin:0 0 18px"><a href="${url}" style="display:inline-block;padding:11px 20px;border-radius:8px;background:#3399FF;color:#fff;text-decoration:none;font-weight:600">Sign in</a></p>`,
    `<p style="font-size:12px;color:#888;margin:0 0 6px">Or paste this link into your browser:</p>`,
    `<p style="font-size:12px;color:#888;word-break:break-all;margin:0">${url}</p>`,
    '<p style="font-size:12px;color:#aaa;margin:18px 0 0">If you did not request this, you can safely ignore this email.</p>',
    '</div>',
  ].join('');
}

function magicLinkText(url) {
  return [
    'Sign in to CFO AI',
    '',
    'Use this link to sign in (expires in 10 minutes, single use):',
    url,
    '',
    'If you did not request this, you can safely ignore this email.',
  ].join('\n');
}

// Send the magic link. Failures are NON-FATAL (caller keeps anti-enumeration). Returns
// { ok } / { ok:false, skipped|status|error }. No secrets in the return value or logs.
async function sendMagicLinkEmail({ provider, apiKey, from, toEmail, magicLinkUrl, fetchImpl, log }) {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const logger = log || console;
  if (provider !== 'resend') return { ok: false, skipped: 'no_provider' };
  if (!apiKey || !from) { logger.warn('[email-send] resend not configured (missing RESEND_API_KEY/EMAIL_FROM)'); return { ok: false, skipped: 'not_configured' }; }
  if (!f) { logger.warn('[email-send] no fetch available'); return { ok: false, skipped: 'no_fetch' }; }
  try {
    const res = await f('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: toEmail, subject: 'Sign in to CFO AI',
        html: magicLinkHtml(magicLinkUrl), text: magicLinkText(magicLinkUrl),
      }),
    });
    if (!res.ok) { logger.warn(`[email-send] resend failed (status ${res.status})`); return { ok: false, status: res.status }; }
    return { ok: true };
  } catch (e) {
    logger.warn(`[email-send] resend error: ${e.message}`);   // message only; no key, no link
    return { ok: false, error: 'send_error' };
  }
}

module.exports = { sendMagicLinkEmail, magicLinkHtml, magicLinkText };
