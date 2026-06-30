// Live workspace context — single source of truth for the active workspace across
// Personal + Business. Fetches GET /api/workspaces, persists the active selection via
// PATCH /api/workspace-preferences, and stamps x-business-id (setActiveBusinessId) so
// every apiFetch is scoped to the active workspace. Switching clears workspace-scoped
// state via a bumped `scopeKey` (pages key their fetches off it) and routes home.
import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { apiFetch, setActiveBusinessId } from '../lib/api'
import { useAuth } from '../hooks/useAuth'

const Ctx = createContext(null)
export const useWorkspace = () => useContext(Ctx)

const LS_ACTIVE = 'activeWorkspaceId'
const LS_LAST = 'last_active_workspace_id'

function pickActive(ws, storedId) {
  const all = [...(ws.personal || []), ...(ws.business || [])]
  if (!all.length) return null
  return all.find(w => String(w.id) === String(storedId))
    || all.find(w => w.is_last_active)
    || (ws.personal || []).find(w => w.is_primary)
    || (ws.business || []).find(w => w.is_default)
    || all[0]
}

export function WorkspaceProvider({ children }) {
  const { token } = useAuth()
  const [workspaces, setWorkspaces] = useState({ personal: [], business: [] })
  const [active, setActive] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [scopeKey, setScopeKey] = useState(0)   // bump = clear workspace-scoped caches

  const applyActive = useCallback((w) => {
    setActive(w)
    if (w) {
      if (w.type === 'personal') setActiveBusinessId(null)
      else setActiveBusinessId(w.id)
      try {
        localStorage.setItem(LS_ACTIVE, w.id)
        localStorage.setItem(LS_LAST, w.id)
      } catch {}
    }
  }, [])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true); setError(null)
    try {
      const data = await apiFetch('/workspaces', token)
      const ws = { personal: data.personal || [], business: data.business || [] }
      setWorkspaces(ws)
      let stored = null; try { stored = localStorage.getItem(LS_LAST) || localStorage.getItem(LS_ACTIVE) } catch {}
      applyActive(pickActive(ws, stored))
    } catch (e) { setError(e.message || 'Failed to load workspaces') }
    finally { setLoading(false) }
  }, [token, applyActive])

  useEffect(() => { load() }, [load])

  const switchTo = useCallback(async (w) => {
    if (!w || (active && String(w.id) === String(active.id))) return
    applyActive(w)
    setScopeKey(k => k + 1)                                   // invalidate scoped data
    try { await apiFetch('/workspace-preferences', token, { method: 'PATCH', body: { last_active_workspace_id: w.id } }) } catch {}
  }, [active, applyActive, token])

  return (
    <Ctx.Provider value={{ workspaces, active, loading, error, scopeKey, switchTo, refresh: load, applyActive }}>
      {children}
    </Ctx.Provider>
  )
}
