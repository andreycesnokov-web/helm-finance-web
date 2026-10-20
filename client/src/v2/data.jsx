// Workspace-scoped read cache for the v2 screens.
//
// The shell (sidebar badges) and the pages read some of the same endpoints. This
// shares one in-flight request per path and keys every entry by the ACTIVE
// workspace id, so a response from a previously active business can never be read
// after a switch: the cache is dropped whenever WorkspaceProvider bumps scopeKey or
// the active id changes, and entries are additionally namespaced by that id.
//
// Freshness: an entry is reused only while it is in flight or younger than FRESH_MS, which
// dedupes the shell and the page asking for the same path in one render. A page mounted later
// fetches again, so a write made on a legacy page (which never calls invalidate) is not
// served stale when the user comes back to a v2 screen.
//
// Reads only. Nothing here mutates.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { useWorkspace } from '../shell/WorkspaceProvider'
import { scrubMarkers } from './lib/markers'
import { appendTransactionPage } from './lib/transactionPages'

const Ctx = createContext(null)
export const FRESH_MS = 2000

export function V2DataProvider({ children }) {
  const { token } = useAuth()
  const { active, scopeKey } = useWorkspace()
  const cache = useRef(new Map())
  const [gen, setGen] = useState(0)
  const wsId = active?.id ?? null
  const lastScope = useRef({ scopeKey, wsId })

  useEffect(() => {
    if (lastScope.current.scopeKey === scopeKey && lastScope.current.wsId === wsId) return
    lastScope.current = { scopeKey, wsId }
    cache.current = new Map(); setGen((g) => g + 1)
  }, [scopeKey, wsId])

  const get = useCallback((path, { force = false } = {}) => {
    const key = `${wsId}|${path}`
    const hit = cache.current.get(key)
    if (!force && hit && (hit.at == null || Date.now() - hit.at < FRESH_MS)) return hit.p
    // Technical tags such as "[CFO_AI_DEMO_PACK_V1]" are hidden from every screen (lib/markers.js).
    const p = apiFetch(path, { token, businessId: wsId, isCurrent: () => true }).then(scrubMarkers)
    const entry = { p, at: null }
    cache.current.set(key, entry)
    p.then(() => { entry.at = Date.now() },
      // A failed read must not stay cached: the next mount retries.
      () => { if (cache.current.get(key) === entry) cache.current.delete(key) })
    return p
  }, [token, wsId])

  // After a write: drop every cached read so badges, Pulse and lists refetch.
  const invalidate = useCallback(() => { cache.current = new Map(); setGen((g) => g + 1) }, [])

  const value = useMemo(() => ({ get, gen, wsId, invalidate }), [get, gen, wsId, invalidate])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * Read `path` for the active business. Pass `null` to skip.
 * Returns { loading, error, data, reload }.
 */
export function useApi(path) {
  const ctx = useContext(Ctx)
  const [st, setSt] = useState({ loading: !!path, error: null, data: null })
  const [nonce, setNonce] = useState(0)
  const forceRef = useRef(false)
  useEffect(() => {
    if (!ctx || !path || ctx.wsId == null) { setSt({ loading: false, error: null, data: null }); return }
    let on = true
    // Never keep the previous data while loading: it may belong to another workspace.
    setSt({ loading: true, error: null, data: null })
    const force = forceRef.current; forceRef.current = false
    ctx.get(path, { force })
      .then((d) => { if (on) setSt({ loading: false, error: null, data: d }) })
      .catch((e) => { if (on) setSt({ loading: false, error: e, data: null }) })
    return () => { on = false }
  }, [ctx?.get, ctx?.gen, path, nonce]) // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => { forceRef.current = true; setNonce((n) => n + 1) }, [])
  return { ...st, reload }
}

/** Read the Business ledger in bounded pages for document matching. A fresh
 * workspace or invalidation discards every page before any old row can render.
 * Each batch stops after 5,000 rows; the user can request the next batch. */
export function usePagedBusinessTransactions() {
  const ctx = useContext(Ctx)
  const [nonce, setNonce] = useState(0)
  const [pageBudget, setPageBudget] = useState(10)
  const key = `${ctx?.wsId}|${ctx?.gen}|${nonce}|${pageBudget}`
  const [st, setSt] = useState({ key: null, getRef: null, data: [], loading: true, error: null, hasMore: false })
  useEffect(() => {
    if (!ctx?.get || ctx.wsId == null) { setSt({ key, getRef: ctx?.get, data: [], loading: false, error: null, hasMore: false }); return }
    let current = true
    setSt({ key, getRef: ctx.get, data: [], loading: true, error: null, hasMore: false })
    const read = async () => {
      let rows = []
      const size = 500
      let beforeId = null
      try {
        for (let page = 0; page < pageBudget; page++) {
          const cursor = beforeId == null ? '' : `&before_id=${beforeId}`
          const result = await ctx.get(`/transactions?period=all&limit=${size}${cursor}`, { force: nonce > 0 })
          if (!current) return
          const pageResult = appendTransactionPage(rows, result, beforeId, size)
          rows = pageResult.rows
          beforeId = pageResult.beforeId
          const hasMore = pageResult.hasMore
          const loading = hasMore && page + 1 < pageBudget
          setSt({ key, getRef: ctx.get, data: [...rows], loading, error: null, hasMore })
          if (!hasMore) return
        }
      } catch (error) {
        if (current) setSt({ key, getRef: ctx.get, data: [...rows], loading: false, error, hasMore: rows.length > 0 })
      }
    }
    read()
    return () => { current = false }
  }, [ctx?.get, ctx?.gen, ctx?.wsId, key, nonce, pageBudget]) // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => setNonce(n => n + 1), [])
  const loadMore = useCallback(() => setPageBudget(n => n + 10), [])
  return st.key === key && st.getRef === ctx?.get ? { ...st, reload, loadMore }
    : { data: [], loading: !!ctx?.wsId, error: null, hasMore: false, reload, loadMore }
}

/** Drop the whole workspace read cache (call after a successful write). */
export function useInvalidate() {
  return useContext(Ctx)?.invalidate || (() => {})
}

/**
 * Platform-admin reads (not workspace-scoped). The server is the gate: every
 * /api/admin route runs requireAdmin, so a non-admin gets 403 and the screen says so.
 * GET only — admin screens in v2 never write.
 */
export function useAdminApi(path) {
  const { token } = useAuth()
  const [st, setSt] = useState({ loading: !!path, error: null, data: null })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!path || !token) { setSt({ loading: false, error: null, data: null }); return }
    let on = true
    setSt({ loading: true, error: null, data: null })
    apiFetch(path, token)
      .then((d) => { if (on) setSt({ loading: false, error: null, data: d }) })
      .catch((e) => { if (on) setSt({ loading: false, error: e, data: null }) })
    return () => { on = false }
  }, [path, token, nonce])
  return { ...st, reload: () => setNonce((n) => n + 1) }
}
