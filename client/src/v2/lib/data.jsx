// Scoped, de-duplicated reads for v2.
//
// Every request goes through the existing apiFetch, so it carries the active
// workspace's x-business-id exactly like every other page. Responses are cached
// per workspace (keyed on the provider's scopeKey + active id) so the shell
// badges, Pulse and Radar share one GET /api/pulse instead of three. Switching
// workspace drops the whole cache — nothing from one company can render in
// another. Reads only: nothing here writes.
import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../hooks/useAuth'
import { useWorkspace } from '../../shell/WorkspaceProvider'

const Ctx = createContext(null)

export function V2DataProvider({ children }) {
  const { scopeKey, active } = useWorkspace() || {}
  const store = useRef({ scope: null, map: new Map() })
  const scope = `${scopeKey}:${active?.id ?? ''}`
  if (store.current.scope !== scope) store.current = { scope, map: new Map() }
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

/**
 * useV2Data('/pulse?scope=business') → { loading, error, data, reload }.
 * `path` null → idle (no request). `opts.silent` swallows errors into data:null
 * (for optional decorations such as badges).
 */
export function useV2Data(path, opts = {}) {
  const store = useContext(Ctx)
  const { token } = useAuth()
  const { active } = useWorkspace() || {}
  const [tick, setTick] = useState(0)
  const [s, setS] = useState({ loading: !!path, error: null, data: null })

  useEffect(() => {
    if (!path || !token || !active || !store) { setS({ loading: false, error: null, data: null }); return }
    let on = true
    const map = store.current.map
    let entry = map.get(path)
    if (!entry || tick > 0) {
      entry = { promise: apiFetch(path, token) }
      map.set(path, entry)
      entry.promise.catch(() => { if (map.get(path) === entry) map.delete(path) })
    }
    if ('value' in entry) { setS({ loading: false, error: null, data: entry.value }); return () => { on = false } }
    setS((p) => ({ loading: true, error: null, data: p.data && tick > 0 ? p.data : null }))
    entry.promise
      .then((v) => { entry.value = v; if (on) setS({ loading: false, error: null, data: v }) })
      .catch((e) => {
        if (!on) return
        if (opts.silent) setS({ loading: false, error: null, data: null })
        else setS({ loading: false, error: e, data: null })
      })
    return () => { on = false }
  }, [path, token, active?.id, store?.current.scope, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { ...s, reload }
}

/** Drop cached entries whose path starts with a prefix (after an existing action). */
export function useV2Invalidate() {
  const store = useContext(Ctx)
  return useCallback((prefix) => {
    if (!store) return
    for (const k of [...store.current.map.keys()]) if (!prefix || k.startsWith(prefix)) store.current.map.delete(k)
  }, [store])
}

export const PULSE_PATH = '/pulse?scope=business'
