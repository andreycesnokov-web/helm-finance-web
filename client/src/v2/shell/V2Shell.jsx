// Design v2 app frame (designs/Sidebar.dc.html, PulseMobile.dc.html, MobileMore.dc.html).
//
// Desktop (≥1024px): resizable sidebar (220–320 px, default 264) — workspace card, + Add, four groups, then Settings,
// Platform admin (platform owner only) and Switch to Personal at the bottom.
// Phone (<1024px): sticky top bar (company → More, bell → Approvals) and a sticky bottom
// tab bar: Pulse · Radar · + Add · AI CFO · More.
//
// Workspace boundary: this shell only ever renders for a BUSINESS workspace. Switching to
// Personal goes through the existing WorkspaceProvider.switchTo and leaves the business
// area (same behaviour as LiveShell); no personal data is read here.
import { useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import WorkspaceSwitcher from '../../shell/WorkspaceSwitcher'
import I from '../icons'
import { NAV_GROUPS, SETTINGS_ITEM, TABS, activeNavKey, activeTabKey } from '../nav'
import { useT } from '../i18n'
import { useApi } from '../data'
import { shellCounts } from '../lib/shellCounts'
import AskPanel from '../ai/AskPanel'
import ErrorBoundary from '../components/ErrorBoundary'

const SYMBOL = '/brand/symbol_navy_transparent.svg'

export function usePlatformAdmin() {
  // Existing admin check (GET /api/admin/status → { is_admin }). The server is the gate
  // for every admin route; this only decides whether the link is shown.
  const r = useApi('/admin/status')
  return r.data?.is_admin === true
}

export function useShellCounts() {
  const r = useApi('/pulse')
  return shellCounts(r.data)
}

export function useSwitchWorkspace() {
  const { switchTo } = useWorkspace()
  const navigate = useNavigate()
  const location = useLocation()
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
    // If staying in business section, preserve current business route path (e.g. /business/accounts or /business/accountant)
    if (location.pathname && location.pathname.startsWith('/business/')) {
      navigate(location.pathname)
      return
    }
    navigate('/business/pulse')
  }
}

function Badge({ kind, counts, t }) {
  const n = counts?.[kind]
  if (n == null || n <= 0) return null
  // A compact counter; the full phrase ("13 overdue") is the accessible name and the tooltip,
  // so the label next to it never wraps.
  if (kind === 'late') {
    const full = t('badge.lateFull', { n })
    return <span className="v2-navbadge v2-tone-crit" role="img" aria-label={full} title={full}>{n}</span>
  }
  if (kind === 'approvals') return <span className="v2-navbadge v2-tone-info">{n}</span>
  return <span className="v2-navbadge v2-tone-warn">{n}</span>
}

function NavItem({ it, activeKey, counts, t }) {
  const Ic = I[it.icon]
  const on = activeKey === it.key
  return (
    <Link to={it.to} className={`v2-nav${on ? ' is-active' : ''}`} aria-current={on ? 'page' : undefined}>
      <Ic />
      <span className="v2-nav-label" title={t(it.labelKey)}>{t(it.labelKey)}</span>
      {it.badge && <Badge kind={it.badge} counts={counts} t={t} />}
    </Link>
  )
}

// Desktop sidebar width: dragged on its right edge (220–320 px, default 264), double-click
// resets, arrow keys step 8 px. Remembered per browser; without storage it is 264.
export const SIDEBAR_MIN = 220
export const SIDEBAR_MAX = 320
export const SIDEBAR_DEFAULT = 264
const SIDEBAR_KEY = 'v2.sidebarWidth'
export const clampSidebar = (w) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(Number(w) || SIDEBAR_DEFAULT)))
function readSidebarWidth() {
  try {
    const v = Number(localStorage.getItem(SIDEBAR_KEY))
    return v > 0 ? clampSidebar(v) : SIDEBAR_DEFAULT
  } catch { return SIDEBAR_DEFAULT }
}
function saveSidebarWidth(w) {
  try { localStorage.setItem(SIDEBAR_KEY, String(w)) } catch { /* private mode */ }
}

function SidebarResizer({ width, onChange, label }) {
  const dragging = useRef(false)
  const [active, setActive] = useState(false)
  const stop = (e, persist) => {
    if (!dragging.current) return
    dragging.current = false
    setActive(false)
    onChange(clampSidebar(e.clientX), persist)
  }
  return (
    <div
      className={`v2-sidebar-resizer${active ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      aria-label={label}
      title={label}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* old browsers */ }
        dragging.current = true
        setActive(true)
      }}
      onPointerMove={(e) => { if (dragging.current) onChange(clampSidebar(e.clientX), false) }}
      onPointerUp={(e) => stop(e, true)}
      onPointerCancel={(e) => stop(e, true)}
      onDoubleClick={() => onChange(SIDEBAR_DEFAULT, true)}
      onKeyDown={(e) => {
        const step = { ArrowLeft: -8, ArrowRight: 8 }[e.key]
        if (step) { e.preventDefault(); onChange(clampSidebar(width + step), true) }
        else if (e.key === 'Home') { e.preventDefault(); onChange(SIDEBAR_MIN, true) }
        else if (e.key === 'End') { e.preventDefault(); onChange(SIDEBAR_MAX, true) }
      }}
    />
  )
}

const MEMBER_NAV = [{ key: 'home', labelKey: 'nav.home', to: '/business/home', icon: 'pulse' }]

export default function V2Shell({ children, member = false }) {
  const t = useT()
  const loc = useLocation()
  const { workspaces, active } = useWorkspace()
  const select = useSwitchWorkspace()
  const counts = useShellCounts()
  const isAdmin = usePlatformAdmin()
  const activeKey = member && loc.pathname.startsWith('/business/home') ? 'home' : activeNavKey(loc.pathname)
  const tabKey = activeTabKey(loc.pathname)
  const personal = (workspaces?.personal || [])[0]
  const [sideW, setSideW] = useState(readSidebarWidth)
  const setSidebar = (w, persist) => { setSideW(w); if (persist) saveSidebarWidth(w) }

  return (
    <div className="v2-root v2-shell" data-v2="shell" style={{ '--v2-sidebar-width': `${sideW}px` }}>
      <a className="v2-skip" href="#v2-main">{t('shell.skip')}</a>

      <aside className="v2-sidebar" aria-label={t('nav.main')}>
        <div className="v2-brand">
          <img src={SYMBOL} alt="" aria-hidden="true" width="32" height="32" />
          <span className="v2-brand-name">{t('shell.brand')}</span>
        </div>
        <div className="v2-switcher">
          <WorkspaceSwitcher workspaces={workspaces} activeId={active?.id} onSelect={select} labels={{
            personal: t('shell.personal'), company: t('shell.company'), groupPersonal: t('shell.personal'), groupCompany: t('shell.wsGroupCompany'),
            create: t('shell.wsCreate'), createHint: t('shell.wsCreateHint'),
            role: (r) => (r && ['owner', 'admin', 'ceo', 'cfo', 'accountant', 'manager', 'employee', 'auditor'].includes(r) ? t(`set.role.${r}`) : t('shell.wsMember')),
          }} />
        </div>
        {/* v2 Add page: business scope always (review 8.2 #3). */}
        {!member && <Link to="/business/add" className="v2-addbtn">
          <span className="v2-addbtn-main"><I.plus />{t('nav.add')}</span>
        </Link>}
        <nav className="v2-navgroups">
          {member && <div className="v2-navgroup">{MEMBER_NAV.map((it) => <NavItem key={it.key} it={it} activeKey={activeKey} counts={counts} t={t} />)}</div>}
          {!member && NAV_GROUPS.map((g) => (
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
              <span className="v2-nav-label" title={t('nav.admin')}>{t('nav.admin')}</span>
              <span className="v2-nav-lock" role="img" aria-label={t('nav.adminOnlyYou')} title={t('nav.adminOnlyYou')}><I.lock size={16} /></span>
            </Link>
          )}
          {personal && (
            <button type="button" className="v2-nav v2-nav-muted" onClick={() => select(personal)}>
              <I.person />
              <span className="v2-nav-label" title={t('nav.switchPersonal')}>{t('nav.switchPersonal')}</span>
            </button>
          )}
        </div>
      </aside>
      <SidebarResizer width={sideW} onChange={setSidebar} label={t('nav.resize')} />

      <header className="v2-topbar">
        <Link to="/business/more" className="v2-topbar-ws" aria-label={`${active?.name || ''} — ${t('shell.openMore')}`}>
          <img src={SYMBOL} alt="" aria-hidden="true" width="28" height="28" />
          <span className="v2-topbar-name">{active?.name}</span>
          <I.chevDown size={16} />
        </Link>
        <Link to={member ? '/business/home' : '/business/approvals'} className="v2-iconbtn" aria-label={t('shell.notifications')}>
          <I.bell size={20} />
          {counts.approvals > 0 && <span className="v2-dotbadge" aria-hidden="true" />}
        </Link>
      </header>

      <main id="v2-main" className="v2-main cfo-main" tabIndex={-1}>
        <div className="v2-main-inner"><ErrorBoundary>{children}</ErrorBoundary></div>
      </main>

      <ErrorBoundary compact><AskPanel /></ErrorBoundary>

      <nav className="v2-tabbar" aria-label={t('nav.tabs')}>
        {(member ? [{ key: 'home', labelKey: 'nav.home', to: '/business/home', icon: 'pulse' }, { key: 'settings', labelKey: 'nav.settings', to: '/business/settings', icon: 'settings' }] : TABS).map((tb) => {
          const Ic = I[tb.icon]
          const on = tabKey === tb.key
          if (tb.disabled) {
            return (
              <button key={tb.key} type="button" className={`v2-tab${tb.primary ? ' v2-tab-add' : ''}`} disabled aria-disabled="true" title={t('nav.addSoon')}>
                {tb.primary ? <span className="v2-tab-addicon"><Ic size={24} /></span> : <Ic size={20} />}
                <span>{t(tb.labelKey)}</span>
              </button>
            )
          }
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
