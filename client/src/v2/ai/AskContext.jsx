// AI CFO panel state (designs/AskPanel.dc.html, AskSheetMobile.dc.html).
// Opened by every "Ask AI CFO", "Why?" and question chip. It passes the current page
// and period as context ("Looking at: …"): pages declare it with useAskContext(); a page
// that does not gets its sidebar name. The context travels inside the question text
// (no backend change — PROPOSALS P-02). The panel only answers and links to screens;
// it never approves or pays anything.
// The thread belongs to ONE workspace (review 8.2 #2): it is cleared when the active
// business or scope changes, and an answer that arrives after a switch is dropped.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { askCfo } from '../lib/ask'
import { activeNavKey, allNavItems } from '../nav'
import { useT } from '../i18n'

const Ctx = createContext(null)

export function buildQuestion(question, looking) {
  const q = String(question || '').trim()
  return looking ? `[Looking at: ${looking}] ${q}` : q
}

export function AskProvider({ children }) {
  const t = useT()
  const { token } = useAuth()
  const loc = useLocation()
  const [open, setOpen] = useState(false)
  const [thread, setThread] = useState([])
  const [pageCtx, setPageCtx] = useState(null)
  const { active, scopeKey } = useWorkspace()
  const wsKey = `${active?.id ?? ''}|${scopeKey ?? ''}`
  const wsRef = useRef(wsKey)
  useEffect(() => { wsRef.current = wsKey; setThread([]) }, [wsKey])

  // A page's declared context only applies while that page is shown.
  const navKey = activeNavKey(loc.pathname)
  const navLabel = allNavItems().find((i) => i.key === navKey)?.labelKey
  const looking = pageCtx && pageCtx.path === loc.pathname
    ? [pageCtx.page, pageCtx.period].filter(Boolean).join(' · ')
    : navLabel ? t(navLabel) : null

  const send = useCallback(async (question) => {
    const q = String(question || '').trim()
    if (!q) return
    const id = Date.now() + Math.random()
    const asked = wsRef.current
    setThread((th) => [...th, { id, q, looking, loading: true, ws: asked }])
    // A late answer for a workspace that is no longer active is dropped.
    const settle = (patch) => { if (wsRef.current !== asked) return; setThread((th) => th.map((m) => (m.id === id ? { ...m, loading: false, ...patch } : m))) }
    try {
      settle({ answer: await askCfo(token, buildQuestion(q, looking)) })
    } catch (e) {
      settle({ error: e?.status === 403 ? 'forbidden' : (e?.message || 'failed') })
    }
  }, [token, looking])

  const openAsk = useCallback((question) => { setOpen(true); if (question) send(question) }, [send])
  const close = useCallback(() => setOpen(false), [])
  const value = useMemo(() => ({ open, thread, looking, openAsk, close, send, setPageCtx, clear: () => setThread([]) }), [open, thread, looking, openAsk, close, send])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useAsk = () => useContext(Ctx) || { openAsk: () => {}, open: false, thread: [], looking: null }

/** Declare what this page is looking at, e.g. { page: 'Radar', period: 'next 30 days' }. */
export function useAskContext(page, period) {
  const ctx = useContext(Ctx)
  const loc = useLocation()
  const set = ctx?.setPageCtx
  useEffect(() => {
    if (!set || !page) return
    set({ path: loc.pathname, page, period })
  }, [set, page, period, loc.pathname])
}
