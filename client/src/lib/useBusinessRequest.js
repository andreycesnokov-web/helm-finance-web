import { useEffect, useMemo, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useWorkspace } from '../shell/WorkspaceProvider'

// An action receives this immutable request identity instead of a bare auth token.
// apiFetch pins every step (including upload-complete/retry) to this business and
// rejects stale completions before callers can invalidate, navigate or show success.
export function useBusinessRequest() {
  const { token } = useAuth()
  const { active, scopeKey, selectionRef } = useWorkspace()
  const businessId = active?.type === 'business' ? String(active.id) : null
  const selection = selectionRef.current
  const current = useRef({ businessId, scopeKey })
  current.current = { businessId, scopeKey }
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  return useMemo(() => ({
    token, businessId,
    isCurrent: () => mounted.current && current.current.businessId === businessId
      && current.current.scopeKey === scopeKey && selectionRef.current === selection,
  }), [token, businessId, scopeKey, selection, selectionRef])
}
