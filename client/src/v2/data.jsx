// Workspace-scoped read cache for the v2 screens.
//
// The shell (sidebar badges) and the pages read some of the same endpoints. This
// shares one in-flight request per path and keys every entry by the ACTIVE
// workspace id, so a response from a previously active business can never be read
// after a switch: the cache is dropped whenever WorkspaceProvider bumps scopeKey or
// the active id changes, and entries are additionally namespaced by that id.
//
// Reads only. Nothing here mutates.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { useWorkspace } from '../shell/WorkspaceProvider'

const Ctx = createContext(null)

export function V2DataProvider({ children }) {
  const { token } = useAuth()
  const { active, scopeKey } = useWorkspace()
  const cache = useRef(new Map())
  const [gen, setGen] = useState(0)
  const wsId = active?.id ?? null

  useEffect(() => { cache.current = new Map(); setGen((g) => g + 1) }, [scopeKey, wsId])

  const get = useCallback((path, { force = false } = {}) => {
    const key = `${wsId}|${path}`
    if (!force && cache.current.has(key)) return cache.current.get(key)
    const p = apiFetch(path, token)
    cache.current.set(key, p)
    // A failed read must not stay cached: the next mount retries.
    p.catch(() => { if (cache.current.get(key) === p) cache.current.delete(key) })
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
