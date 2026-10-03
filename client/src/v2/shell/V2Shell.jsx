// Design v2 app frame (designs/Sidebar.dc.html, PulseMobile.dc.html, MobileMore.dc.html).
//
// Desktop (≥1024px): 248px sidebar — workspace card, + Add, four groups, then Settings,
// Platform admin (platform owner only) and Switch to Personal at the bottom.
// Phone (<1024px): sticky top bar (company → More, bell → Approvals) and a sticky bottom
// tab bar: Pulse · Radar · + Add · AI CFO · More.
//
// Workspace boundary: this shell only ever renders for a BUSINESS workspace. Switching to
// Personal goes through the existing WorkspaceProvider.switchTo and leaves the business
// area (same behaviour as LiveShell); no personal data is read here.
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import WorkspaceSwitcher from '../../shell/WorkspaceSwitcher'
import I from '../icons'
import { NAV_GROUPS, SETTINGS_ITEM, TABS, activeNavKey, activeTabKey } from '../nav'
import { useT } from '../i18n'
import { useApi } from '../data'
import { shellCounts } from '../lib/shellCounts'
import AskPanel from '../ai/AskPanel'

const SYMBOL = '/brand/symbol_navy_transparent.svg'

export function usePlatformAdmin() {
  // Existing admin check (GET /api/admin/status → { is_admin }). The server is the gate
  // for every admin route; this only decides whether the link is shown.
  const r = useApi('/admin/status')
  return r.data?.is_admin === true
}

export function useShellCounts() {
  const r = useApi('/pulse?scope=business')
  return shellCounts(r.data)
}

export function useSwitchWorkspace() {
  const { switchTo } = useWorkspace()
  const navigate = useNavigate()
  return async (w) => {
    await switchTo(w)
    if (w.type === 'personal') {
      try {
        localStorage.setItem('activeWorkspaceId', 'personal')
        localStorage.setItem('last_active_workspace_id', 'personal')
      } catch { /* private mode */ }
      navigate('/account')
      return
    }
    navigate('/business/pulse')
  }
}

function Badge({ kind, counts, t }) {
  const n = counts?.[kind]
  if (n == null || n <= 0) return null
  if (kind === 'late') return <span className="v2-navbadge v2-tone-crit">{t('badge.late', { n })}</span>
  if (kind === 'approvals') return <span className="v2-navbadge v2-tone-info">{n}</span>
  return <span className="v2-navbadge v2-tone-warn">{n}</span>
}

function NavItem({ it, activeKey, counts, t }) {
  const Ic = I[it.icon]
  const on = activeKey === it.key
  return (
    <Link to={it.to} className={`v2-nav${on ? ' is-active' : ''}`} aria-current={on ? 'page' : undefined}>
      <Ic />
      <span className="v2-nav-label">{t(it.labelKey)}</span>
      {it.badge && <Badge kind={it.badge} counts={counts} t={t} />}
    </Link>
  )
}

export default function V2Shell({ children }) {
  const t = useT()
  const loc = useLocation()
  const { workspaces, active } = useWorkspace()
  const select = useSwitchWorkspace()
  const counts = useShellCounts()
  const isAdmin = usePlatformAdmin()
  const activeKey = activeNavKey(loc.pathname)
  const tabKey = activeTabKey(loc.pathname)
  const personal = (workspaces?.personal || [])[0]

  return (
    <div className="v2-root v2-shell" data-v2="shell">
      <a className="v2-skip" href="#v2-main">Skip to content</a>

      <aside className="v2-sidebar" aria-label={t('nav.main')}>
        <div className="v2-brand">
          <img src={SYMBOL} alt="" aria-hidden="true" width="32" height="32" />
          <span className="v2-brand-name">{t('shell.brand')}</span>
        </div>
        <div className="v2-switcher">
          <WorkspaceSwitcher workspaces={workspaces} activeId={active?.id} onSelect={select} />
        </div>
        <Link to="/business/add" className="v2-addbtn">
          <span className="v2-addbtn-main"><I.plus />{t('nav.add')}</span>
          <span className="v2-addbtn-hint">{t('nav.addHint')}</span>
        </Link>
        <nav className="v2-navgroups">
          {NAV_GROUPS.map((g) => (
            <div key={g.key} className="v2-navgroup">
              <p className="v2-navgroup-title">{t(g.labelKey)}</p>
              {g.items.map((it) => <NavItem key={it.key} it={it} activeKey={activeKey} counts={counts} t={t} />)}
            </div>
          ))}
        </nav>
        <div className="v2-sidefoot">
          <NavItem it={SETTINGS_ITEM} activeKey={activeKey} counts={counts} t={t} />
          {isAdmin && (
            <Link to="/admin/dashboard" className="v2-nav v2-nav-admin">
              <I.admin />
              <span className="v2-nav-label">{t('nav.admin')}</span>
              <span className="v2-navbadge v2-tone-warn">{t('nav.adminBadge')}</span>
            </Link>
          )}
          {personal && (
            <button type="button" className="v2-nav v2-nav-muted" onClick={() => select(personal)}>
              <I.person />
              <span className="v2-nav-label">{t('nav.switchPersonal')}</span>
            </button>
          )}
        </div>
      </aside>

      <header className="v2-topbar">
        <Link to="/business/more" className="v2-topbar-ws" aria-label={`${active?.name || ''} — ${t('shell.openMore')}`}>
          <img src={SYMBOL} alt="" aria-hidden="true" width="28" height="28" />
          <span className="v2-topbar-name">{active?.name}</span>
          <I.chevDown size={16} />
        </Link>
        <Link to="/business/approvals" className="v2-iconbtn" aria-label={t('shell.notifications')}>
          <I.bell size={20} />
          {counts.approvals > 0 && <span className="v2-dotbadge" aria-hidden="true" />}
        </Link>
      </header>

      <main id="v2-main" className="v2-main cfo-main" tabIndex={-1}>
        <div className="v2-main-inner">{children}</div>
      </main>

      <AskPanel />

      <nav className="v2-tabbar" aria-label={t('nav.tabs')}>
        {TABS.map((tb) => {
          const Ic = I[tb.icon]
          const on = tabKey === tb.key
          return (
            <Link key={tb.key} to={tb.to} className={`v2-tab${on ? ' is-active' : ''}${tb.primary ? ' v2-tab-add' : ''}`}
              aria-current={on ? 'page' : undefined}>
              {tb.primary
                ? <span className="v2-tab-addicon"><Ic size={24} /></span>
                : <Ic size={20} />}
              <span>{t(tb.labelKey)}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
