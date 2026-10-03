// AI CFO panel state (designs/AskPanel.dc.html, AskSheetMobile.dc.html).
// Opened by every "Ask AI CFO", "Why?" and question chip. It passes the current page
// and period as context ("Looking at: …"): pages declare it with useAskContext(); a page
// that does not gets its sidebar name. The context travels inside the question text
// (no backend change — PROPOSALS P-02). The panel only answers and links to screens;
// it never approves or pays anything.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
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
    setThread((th) => [...th, { id, q, looking, loading: true }])
    try {
      const r = await askCfo(token, buildQuestion(q, looking))
      setThread((th) => th.map((m) => (m.id === id ? { ...m, loading: false, answer: r } : m)))
    } catch (e) {
      setThread((th) => th.map((m) => (m.id === id ? { ...m, loading: false, error: e?.status === 403 ? 'forbidden' : (e?.message || 'failed') } : m)))
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
