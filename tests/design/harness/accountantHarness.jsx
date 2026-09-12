// A test harness that mounts the REAL AI Accountant page against a mock API.
//
// The questions it exists to answer are about TIMING and about which company a
// message belongs to: an answer that arrives after the user switched company, a
// thread that must not survive a switch, a provider failure and the retry after
// it. None of that is visible in source, and none of it can be checked without
// running the actual component, its effects, its state and React's commit order.
//
// This file is NEVER part of the application bundle. accountantMockApi.test.mjs
// builds it into a throwaway directory and loads it from there. It imports the
// production BusinessAccountantHub unmodified — no fork, no re-implementation —
// so what the test drives is what ships.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../../../client/src/hooks/useAuth'
import { WorkspaceProvider, useWorkspace } from '../../../client/src/shell/WorkspaceProvider'
import { BusinessAccountantHub } from '../../../client/src/pages/business/AccountantPremium'

/* ── the mock API ──────────────────────────────────────────────────────────
   Requests land in __calls. A held path returns a promise the test settles by
   hand, which is what makes the out-of-order case reproducible rather than a
   race against a timer. */
const held = new Map()
let heldSeq = 0

window.__calls = []
window.__routes = {}        // 'POST /api/accountant/ask' -> payload | fn(rec)
window.__hold = []          // path substrings to hold

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
      return json({ error: payload.error || 'Request failed', code: payload.code }, payload.__status)
    }
    return json(payload ?? {})
  }

  if (window.__hold.some((h) => path.includes(h))) {
    const id = `h${++heldSeq}`
    rec.heldAs = id
    return new Promise((resolve, reject) => { held.set(id, { resolve, reject, rec, answer }) })
  }
  return Promise.resolve(answer())
}

/** Settle one held request, by held id or by the business id it carried. */
window.__settle = (which, override) => {
  const entry = [...held.entries()].find(([id, h]) => id === which || h.rec.businessId === which)
  if (!entry) return `no held request for ${which}`
  const [id, h] = entry
  held.delete(id)
  if (override && override.__status >= 400) h.resolve(json({ error: override.error || 'failed', code: override.code }, override.__status))
  else if (override) h.resolve(json(override))
  else h.resolve(h.answer())
  return id
}
window.__settleAll = (which, override) => {
  const ids = []
  for (const [id, h] of [...held.entries()]) {
    if (id === which || h.rec.businessId === which) { ids.push(id); window.__settle(id, override) }
  }
  return ids
}
window.__heldIds = () => [...held.entries()].map(([id, h]) => ({ id, key: h.rec.key, businessId: h.rec.businessId }))
window.__asks = () => window.__calls.filter((c) => c.path.includes('/accountant/ask'))

/* ── the app under test ────────────────────────────────────────────────── */
function Switcher() {
  const { workspaces, active, switchTo } = useWorkspace()
  // The real switchTo, so a test drives a company change exactly as the sidebar
  // does — bumping scopeKey without remounting the page.
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
    <MemoryRouter initialEntries={['/business/accountant']}>
      <AuthProvider>
        <WorkspaceProvider>
          <Switcher />
          {mounted && <BusinessAccountantHub />}
        </WorkspaceProvider>
      </AuthProvider>
    </MemoryRouter>
  )
}

window.__boot = () => {
  // Deliberately NOT StrictMode: double-invoked effects would fire each load
  // twice and make request ordering ambiguous, which is the one thing this
  // harness exists to observe precisely.
  createRoot(document.getElementById('root')).render(<Harness />)
}

/* ── what the chat is showing, right now ───────────────────────────────── */
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null)

window.__chat = () => {
  const q = (sel) => document.querySelector(sel)
  const msgs = [...document.querySelectorAll('.acct-msg')].map((el) => ({
    role: el.classList.contains('is-user') ? 'user' : 'assistant',
    pending: el.classList.contains('is-pending'),
    text: txt(el.querySelector('.acct-msg-text')),
    kinds: [...el.querySelectorAll('.acct-kind')].map((k) => txt(k)),
    grounded: [...el.querySelectorAll('.acct-src-grounded .acct-src-t')].map((s) => txt(s)),
    forReview: [...el.querySelectorAll('.acct-src-review .acct-src-t')].map((s) => txt(s)),
    hasReviewWarning: !!el.querySelector('.acct-src-warn'),
    missing: [...el.querySelectorAll('.acct-ask-missing-list li')].map((s) => txt(s)),
    nextStep: txt(el.querySelector('.acct-ask-next-v')),
    injection: !!el.querySelector('.acct-ask-injection'),
    degraded: !!el.querySelector('.acct-ask-degraded'),
    noGrounded: !!el.querySelector('.acct-ask-nogrounded'),
  }))
  return {
    present: !!q('.acct-ask'),
    // The page the user is on. The whole point is that it never changed.
    pageTitle: txt(q('.cfo-h1')),
    onAccountantPage: !!q('.acct-wb'),
    messages: msgs,
    userMessages: msgs.filter((m) => m.role === 'user').map((m) => m.text),
    answers: msgs.filter((m) => m.role === 'assistant' && !m.pending).map((m) => m.text),
    pending: msgs.some((m) => m.pending),
    error: txt(q('.acct-ask-error-t')),
    hasRetry: !!q('.acct-ask-error .cfo-btn'),
    limit: txt(q('.acct-ask-limit')),
    usageBadge: txt(q('.acct-ask .cfo-badge')),
    suggestions: [...document.querySelectorAll('.acct-ask-suggestion')].map((b) => txt(b)),
    inputValue: (q('#acct-ask-input') || {}).value ?? null,
    sendDisabled: (() => {
      const b = q('.acct-ask-form .cfo-btn')
      return b ? b.disabled : null
    })(),
    // Proof the hand-off is gone.
    askCfoButtons: [...document.querySelectorAll('.cfo-btn')]
      .filter((b) => /ai cfo/i.test(b.textContent || '')).length,
  }
}

/* ── driving the real controls ─────────────────────────────────────────── */
const setValue = (el, value) => {
  const proto = el instanceof window.HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

window.__type = (value) => {
  const el = document.querySelector('#acct-ask-input')
  if (!el) return false
  setValue(el, value)
  return true
}
window.__send = () => {
  const b = document.querySelector('.acct-ask-form .cfo-btn')
  if (!b || b.disabled) return false
  b.click()
  return true
}
window.__ask = (text) => (window.__type(text) ? window.__send() : false)
window.__clickSuggestion = (i = 0) => {
  const b = [...document.querySelectorAll('.acct-ask-suggestion')][i]
  if (!b) return false
  b.click()
  return true
}
window.__retry = () => {
  const b = document.querySelector('.acct-ask-error .cfo-btn')
  if (!b) return false
  b.click()
  return true
}
window.__tick = (ms = 60) => new Promise((r) => setTimeout(r, ms))
