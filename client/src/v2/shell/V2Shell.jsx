// Design v2 app frame: desktop sidebar (≥1024px), phone top bar + bottom tab
// bar below that. Business workspace only — a Personal selection leaves this
// shell through the same switch logic LiveShell uses (navigate to /account), so
// nothing Personal ever renders against business APIs.
import { useEffect, useState, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { useAuth } from '../../hooks/useAuth'
import { apiFetch } from '../../lib/api'
import { NAV_GROUPS, TABS, P, activeNavKey, activeTabKey } from '../routes'
import { useV2T } from '../lib/i18n'
import { useV2Data, PULSE_PATH } from '../lib/data'
import { shellCounts } from '../lib/counts'
import { canViewFinance } from '../lib/roles'
import { initial } from '../lib/format'
import { Ico, Count, Loading, ErrorBox } from '../ui'

const SYMBOL = '/brand/symbol_navy_transparent.svg'

/** Platform-owner check: the existing GET /api/admin/status (user-level, not workspace). */
function useIsPlatformAdmin() {
  const { token } = useAuth()
  const [admin, setAdmin] = useState(false)
  useEffect(() => {
    if (!token) return
    let on = true
    apiFetch('/admin/status', token).then((d) => on && setAdmin(d?.is_admin === true)).catch(() => {})
    return () => { on = false }
  }, [token])
  return admin
}

export function useShellCounts() {
  const { active } = useWorkspace() || {}
  const allowed = active && active.type !== 'personal' && canViewFinance(active.role)
  const pulse = useV2Data(allowed ? PULSE_PATH : null, { silent: true })
  return shellCounts(pulse.data)
}

/** Workspace switch: same behaviour as LiveShell.onSelectWorkspace. */
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
      navigate(P.personal)
      return
    }
    navigate(P.pulse)
  }
}

export function WorkspaceMenu({ variant = 'sidebar' }) {
  const { t } = useV2T()
  const { workspaces, active } = useWorkspace()
  const switchWs = useSwitchWorkspace()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const k = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [open])
  const businesses = workspaces?.business || []
  const personal = workspaces?.personal || []
  const sub = variant === 'more' ? t('shell.switchHint')
    : active?.role ? t('shell.companyRole', { role: cap(active.role) }) : t('shell.company')
  return (
    <div className={`v2-ws v2-ws-${variant}`} ref={ref}>
      <button type="button" className="v2-ws-btn" aria-haspopup="menu" aria-expanded={open}
        aria-label={`${active?.name || ''} — ${t('shell.switchWorkspace')}`} onClick={() => setOpen((o) => !o)}>
        <span className="v2-ws-mark" aria-hidden="true">{initial(active?.name)}</span>
        <span className="v2-ws-text">
          <span className="v2-ws-name">{active?.name}</span>
          <span className="v2-ws-sub">{sub}</span>
        </span>
        <Ico name={variant === 'more' ? 'chevRight' : 'chevDown'} size={16} />
      </button>
      {open && (
        <div className="v2-ws-menu" role="menu">
          {businesses.map((w) => (
            <button key={w.id} type="button" role="menuitemradio" aria-checked={String(w.id) === String(active?.id)}
              className="v2-ws-item" onClick={() => { setOpen(false); switchWs(w) }}>
              <span className="v2-ws-mark sm" aria-hidden="true">{initial(w.name)}</span>
              <span className="v2-ws-text"><span className="v2-ws-name">{w.name}</span>
                <span className="v2-ws-sub">{w.role ? t('shell.companyRole', { role: cap(w.role) }) : t('shell.company')}</span></span>
              {String(w.id) === String(active?.id) && <Ico name="checkCircle" size={16} />}
            </button>
          ))}
          {personal.map((w) => (
            <button key={w.id} type="button" role="menuitem" className="v2-ws-item" onClick={() => { setOpen(false); switchWs(w) }}>
              <span className="v2-ws-mark sm personal" aria-hidden="true"><Ico name="person" size={14} /></span>
              <span className="v2-ws-text"><span className="v2-ws-name">{t('shell.personalWorkspace')}</span></span>
            </button>
          ))}
          <Link role="menuitem" className="v2-ws-item" to={P.newBusiness} onClick={() => setOpen(false)}>
            <span className="v2-ws-mark sm ghost" aria-hidden="true"><Ico name="plus" size={14} /></span>
            <span className="v2-ws-text"><span className="v2-ws-name">{t('shell.newBusiness')}</span></span>
          </Link>
        </div>
      )}
    </div>
  )
}

const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1)

function badgeFor(item, counts, t) {
  if (!item.badge) return null
  const n = counts[item.badge] || 0
  if (!n) return null
  if (item.badge === 'lateBills') return <Count tone="danger">{t('nav.late', { n })}</Count>
  if (item.badge === 'approvals') return <Count tone="info">{n}</Count>
  return <Count tone="warning">{n}</Count>
}

function Sidebar({ counts, isAdmin }) {
  const { t } = useV2T()
  const location = useLocation()
  const { workspaces } = useWorkspace()
  const switchWs = useSwitchWorkspace()
  const activeKey = activeNavKey(location.pathname)
  const personal = (workspaces?.personal || [])[0]
  const item = (it) => (
    <Link key={it.key} to={it.to} className={`v2-nav${activeKey === it.key ? ' is-on' : ''}`}
      aria-current={activeKey === it.key ? 'page' : undefined}>
      <Ico name={it.icon} /><span className="v2-nav-label">{t(it.labelKey)}</span>{badgeFor(it, counts, t)}
    </Link>
  )
  return (
    <aside className="v2-sidebar">
      <Link to={P.pulse} className="v2-brand" aria-label="CFO AI">
        <img src={SYMBOL} alt="" aria-hidden="true" width="32" height="32" />
        <span className="v2-brand-word">CFO AI</span>
      </Link>
      <WorkspaceMenu />
      <Link to={P.add} className="v2-addbtn">
        <span className="v2-addbtn-main"><Ico name="plus" />{t('nav.add')}</span>
        <span className="v2-addbtn-hint">{t('nav.addHint')}</span>
      </Link>
      <nav className="v2-navgroups" aria-label={t('nav.mainNav')}>
        {NAV_GROUPS.map((g) => (
          <div key={g.key} className="v2-navgroup">
            <p className="v2-navgroup-title">{t(g.labelKey)}</p>
            {g.items.map(item)}
          </div>
        ))}
      </nav>
      <div className="v2-sidefoot">
        <Link to={P.settings} className={`v2-nav${activeKey === 'settings' ? ' is-on' : ''}`}
          aria-current={activeKey === 'settings' ? 'page' : undefined}>
          <Ico name="cog" /><span className="v2-nav-label">{t('nav.settings')}</span>
        </Link>
        {isAdmin && (
          <Link to={P.adminOverview} className="v2-nav v2-nav-admin">
            <Ico name="shield" /><span className="v2-nav-label">{t('nav.admin')}</span>
            <Count tone="warning">{t('nav.adminOnlyYou')}</Count>
          </Link>
        )}
        {personal && (
          <button type="button" className="v2-nav v2-nav-quiet" onClick={() => switchWs(personal)}>
            <Ico name="person" /><span className="v2-nav-label">{t('nav.switchPersonal')}</span>
          </button>
        )}
      </div>
    </aside>
  )
}

function PhoneTopBar({ counts }) {
  const { t } = useV2T()
  const { active } = useWorkspace()
  return (
    <header className="v2-topbar">
      <Link to={P.more} className="v2-topbar-ws" aria-label={`${active?.name || ''} — ${t('shell.openMore')}`}>
        <img src={SYMBOL} alt="" aria-hidden="true" width="28" height="28" />
        <span className="v2-topbar-name">{active?.name}</span>
        <Ico name="chevDown" size={16} />
      </Link>
      <Link to={P.approvals} className="v2-iconbtn" aria-label={counts.approvals
        ? `${t('shell.approvalsBell')}: ${counts.approvals}` : t('nav.approvals')}>
        <Ico name="bell" size={20} />
        {counts.approvals > 0 && <span className="v2-iconbtn-dot" aria-hidden="true" />}
      </Link>
    </header>
  )
}

function TabBar() {
  const { t } = useV2T()
  const location = useLocation()
  const on = activeTabKey(location.pathname)
  return (
    <nav className="v2-tabbar" aria-label={t('nav.tabBar')}>
      {TABS.map((tab) => (
        <Link key={tab.key} to={tab.to} className={`v2-tabbar-item${tab.primary ? ' is-primary' : ''}${on === tab.key ? ' is-on' : ''}`}
          aria-current={on === tab.key ? 'page' : undefined}>
          <span className="v2-tabbar-ic"><Ico name={tab.icon} size={tab.primary ? 24 : 20} /></span>
          <span className="v2-tabbar-label">{t(tab.labelKey)}</span>
        </Link>
      ))}
    </nav>
  )
}

export default function V2Shell({ children }) {
  const { t } = useV2T()
  const { workspaces, active, loading, error, applyActive, refresh } = useWorkspace()
  const counts = useShellCounts()
  const isAdmin = useIsPlatformAdmin()
  const location = useLocation()

  // Same guard as BusinessShell: a business route never runs in a personal context.
  useEffect(() => {
    if (!loading && active && active.type === 'personal' && workspaces.business?.[0]) applyActive(workspaces.business[0])
  }, [loading, active, workspaces, applyActive])
  useEffect(() => { window.scrollTo?.(0, 0) }, [location.pathname])

  if (loading && !active) return <div className="v2-root v2-boot"><Loading rows={4} /></div>
  if (error && !active) return <div className="v2-root v2-boot"><ErrorBox error={{ message: t('shell.loadFailed') }} onRetry={refresh} /></div>
  if (!active || active.type === 'personal') return null

  return (
    <div className="v2-root">
      <a href="#v2-main" className="v2-skip">{t('shell.skip')}</a>
      <Sidebar counts={counts} isAdmin={isAdmin} />
      <PhoneTopBar counts={counts} />
      <main id="v2-main" className="v2-main" tabIndex={-1}>{children}</main>
      <TabBar />
    </div>
  )
}
