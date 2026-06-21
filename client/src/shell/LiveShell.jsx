// LiveShell — WorkspaceShell wired to the live WorkspaceProvider + react-router.
// Workspace-aware nav, route-derived active item, switching that routes home and
// clears scoped state. Used by the live Personal (and future Business) sections.
import { useLocation, useNavigate } from 'react-router-dom'
import { useWorkspace } from './WorkspaceProvider'
import WorkspaceShell, { PERSONAL_NAV, BUSINESS_NAV } from './WorkspaceShell'
import { ErrorState, LoadingSkeleton } from './ui'

export default function LiveShell({ children }) {
  const { workspaces, active, loading, error, switchTo, refresh } = useWorkspace()
  const location = useLocation()
  const navigate = useNavigate()

  if (loading && !active) {
    return <div style={{ padding: 40 }}><LoadingSkeleton rows={4} height={20} width={(i) => ['40%', '90%', '90%', '70%'][i]} /></div>
  }
  if (error && !active) {
    return <div style={{ padding: 40 }}><ErrorState title="Couldn’t load your workspaces" description={error} onRetry={refresh} /></div>
  }
  if (!active) return null

  const isPersonal = active.type === 'personal'
  const nav = isPersonal ? PERSONAL_NAV : BUSINESS_NAV
  const activeKey = nav.flatMap(g => g.items).find(it => it.to === location.pathname)?.key
    || nav[0].items[0].key

  const onSelectWorkspace = async (w) => {
    await switchTo(w)
    navigate(w.type === 'personal' ? '/personal' : '/business/pulse')
  }

  return (
    <WorkspaceShell
      workspaces={workspaces} activeId={active.id} onSelectWorkspace={onSelectWorkspace}
      nav={nav} activeKey={activeKey} onNavigate={(it) => navigate(it.to)}
    >
      {children}
    </WorkspaceShell>
  )
}
