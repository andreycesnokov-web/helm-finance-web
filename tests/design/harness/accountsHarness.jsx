// A test harness that mounts the REAL Accounts page against a scriptable mock API.
//
// Why a harness and not a unit test: the questions being asked are about timing
// and about what is on screen at a given moment — a late response from a company
// the user has left, a list that must not carry over, a form whose values must
// survive a failed save. None of that is visible in a dependency array, and none
// of it can be checked without running the actual component, its effects, its
// state and its React commit order.
//
// This file is NEVER part of the application bundle. It is built into a throwaway
// directory by accountsMockApi.test.mjs and loaded from there, so nothing here
// can reach production. It imports the production Accounts component unmodified —
// no fork, no re-implementation — so what the test drives is what ships.
//
// Everything the page touches goes through window.fetch (apiFetch, useAuth and
// WorkspaceProvider all use it), so one stub covers the whole surface. The stub
// records every request and lets the test decide WHEN each one resolves, which is
// what makes the out-of-order case reproducible rather than a race against a timer.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../../../client/src/hooks/useAuth'
import { WorkspaceProvider, useWorkspace } from '../../../client/src/shell/WorkspaceProvider'
import Accounts from '../../../client/src/pages/Accounts'

/* ── the mock API ──────────────────────────────────────────────────────────
   Requests land in __calls. A request whose path is "held" returns a promise the
   test settles by hand; everything else answers immediately from __routes. */
const held = new Map()      // key -> { resolve, reject, rec }
let heldSeq = 0

window.__calls = []
window.__routes = {}        // 'GET /api/wallets' -> payload | fn(rec)
window.__hold = []          // path substrings to hold, e.g. ['/api/wallets']

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

window.fetch = (url, opts = {}) => {
  const method = (opts.method || 'GET').toUpperCase()
  const path = String(url)
  const rec = {
    key: `${method} ${path}`,
    method,
    path,
    businessId: (opts.headers || {})['x-business-id'] ?? null,
    body: opts.body ? JSON.parse(opts.body) : null,
    at: window.__calls.length,
  }
  window.__calls.push(rec)

  const answer = () => {
    const route = window.__routes[rec.key]
      ?? window.__routes[`${method} ${path.split('?')[0]}`]
    const payload = typeof route === 'function' ? route(rec) : route
    if (payload && payload.__status && payload.__status >= 400) {
      return json({ error: payload.error || 'Request failed' }, payload.__status)
    }
    return json(payload ?? {})
  }

  if (window.__hold.some((h) => path.includes(h))) {
    const id = `h${++heldSeq}`
    rec.heldAs = id
    return new Promise((resolve, reject) => {
      held.set(id, { resolve, reject, rec, answer })
    })
  }
  return Promise.resolve(answer())
}

/** Settle a held request. `which` picks by held id or by business id. */
window.__settle = (which, override) => {
  const entry = [...held.entries()].find(([id, h]) =>
    id === which || h.rec.businessId === which)
  if (!entry) return `no held request for ${which}`
  const [id, h] = entry
  held.delete(id)
  if (override && override.__status >= 400) {
    h.resolve(json({ error: override.error || 'Request failed' }, override.__status))
  } else if (override) {
    h.resolve(json(override))
  } else {
    h.resolve(h.answer())
  }
  return id
}
/**
 * Settle EVERY held request matching `which`.
 *
 * A mount issues two wallet requests, not one: the first before
 * WorkspaceProvider has resolved /api/workspaces (so `active` is still null),
 * the second once it has. Settling only the first leaves the live one hanging
 * and the list empty — which looks exactly like a page that failed to load.
 */
window.__settleAll = (which, override) => {
  const ids = [];
  for (const [id, h] of [...held.entries()]) {
    if (id === which || h.rec.businessId === which) { ids.push(id); window.__settle(id, override); }
  }
  return ids;
};
window.__heldIds = () => [...held.entries()].map(([id, h]) => ({ id, key: h.rec.key, businessId: h.rec.businessId }))

/* ── the app under test ────────────────────────────────────────────────────
   MemoryRouter for useNavigate, AuthProvider for the token, WorkspaceProvider
   for the active workspace and scopeKey. All three are the production modules. */
function Switcher() {
  const { workspaces, active, switchTo } = useWorkspace()
  // The real switchTo, exposed so a test can drive a workspace change the way the
  // sidebar switcher does — bumping scopeKey without remounting the page.
  window.__switchTo = (id) => {
    const all = [...(workspaces.personal || []), ...(workspaces.business || [])]
    const target = all.find((w) => String(w.id) === String(id))
    return target ? switchTo(target) : `no workspace ${id}`
  }
  window.__activeId = () => (active ? active.id : null)
  return null
}

function Harness() {
  const [mounted] = useState(true)
  return (
    <MemoryRouter initialEntries={['/business/accounts']}>
      <AuthProvider>
        <WorkspaceProvider>
          <Switcher />
          {mounted && <Accounts />}
        </WorkspaceProvider>
      </AuthProvider>
    </MemoryRouter>
  )
}

window.__boot = () => {
  const el = document.getElementById('root')
  // Deliberately NOT StrictMode: its double-invoked effects would fire each load
  // twice and make request ordering ambiguous, which is the one thing this
  // harness exists to observe precisely.
  createRoot(el).render(<Harness />)
}

/* ── what the page is showing, right now ──────────────────────────────────── */
window.__view = () => {
  const q = (sel) => document.querySelector(sel)
  const rows = [...document.querySelectorAll('.acct-row')].map((li) => ({
    name: (li.querySelector('.acct-row-name') || {}).textContent?.trim() || '',
    balance: (li.querySelector('.acct-row-balance') || {}).textContent?.trim() || null,
  }))
  return {
    rows,
    names: rows.map((r) => r.name),
    total: (q('.cfo-summary-value') || {}).textContent?.trim() || null,
    meta: (q('.cfo-summary-meta') || {}).textContent?.trim() || null,
    loading: !!q('.acct-loading'),
    errorState: !!q('.cfo-state-ic.danger'),
    zeroState: !!q('.cfo-state-sym'),
    summaryShown: !!q('.cfo-summary'),
    formOpen: !!q('.modal-sheet'),
    formName: (q('#acct-wallet-name') || {}).value ?? null,
    formOpening: (q('#acct-wallet-opening') || {}).value ?? null,
    saveDisabled: (() => {
      const b = [...document.querySelectorAll('.acct-form-actions .cfo-btn')][0]
      return b ? b.disabled : null
    })(),
  }
}

/* ── driving the real controls ────────────────────────────────────────────── */
const click = (el) => {
  if (!el) return false
  el.click()
  return true
}
window.__openAdd = () => click(document.querySelector('.cfo-pagehead-actions .cfo-btn'))
window.__openEdit = (i = 0) => click([...document.querySelectorAll('.acct-row-actions .acct-iconbtn')][i * 2 + 1])
window.__type = (sel, value) => {
  const input = document.querySelector(sel)
  if (!input) return false
  // React listens to the input event via its own value setter.
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}
window.__save = () => click([...document.querySelectorAll('.acct-form-actions .cfo-btn')][0])
window.__cancel = () => click([...document.querySelectorAll('.acct-form-actions .cfo-btn')][1])
window.__tick = (ms = 60) => new Promise((r) => setTimeout(r, ms))
