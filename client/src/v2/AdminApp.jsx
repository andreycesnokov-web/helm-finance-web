// Design v2 — Platform admin (designs/AdminOverview, AdminCompanies, AdminSystem).
// Loaded lazily by App.jsx ONLY when VITE_DESIGN_V2=true, for /admin/dashboard,
// /admin/businesses(/:id) and the new /admin/system. Every other /admin route is the
// existing page, unchanged. Workspace: Platform admin.
//
// Privacy (DESIGN_SPEC rule 7): these screens read counts, plans, statuses and health
// from the existing admin endpoints only. Client balances, transactions and documents
// are never requested. The server enforces requireAdmin on every route; a 403 renders
// "Platform admin only". Nothing here writes — plan/trial/archive tools stay on the
// existing company tools page.
import { Navigate, NavLink, useParams } from 'react-router-dom'
import './v2.css'
import { useAuth } from '../hooks/useAuth'
import I from './icons'
import { useT } from './i18n'
import AdminOverview from './admin/AdminOverview'
import AdminCompanies from './admin/AdminCompanies'
import AdminSystem from './admin/AdminSystem'

const SYMBOL = '/brand/symbol_navy_transparent.svg'

function AdminShell({ children }) {
  const t = useT()
  const link = (to, label) => <NavLink to={to} className={({ isActive }) => `v2-nav${isActive ? ' is-active' : ''}`}>{label}</NavLink>
  return (
    <div className="v2-root v2-shell v2-admin" data-v2="admin">
      <a className="v2-skip" href="#v2-main">Skip to content</a>
      <aside className="v2-sidebar v2-admin-side" aria-label={t('admin.nav')}>
        <div className="v2-brand"><img src={SYMBOL} alt="" aria-hidden="true" width="32" height="32" /><span className="v2-brand-name">{t('shell.brand')}</span></div>
        <span className="v2-admin-tag">{t('admin.tag')}</span>
        <nav className="v2-navgroup">
          {link('/admin/dashboard', t('admin.overview'))}
          {link('/admin/businesses', t('admin.companies'))}
          {link('/admin/system', t('admin.system'))}
        </nav>
        <p className="v2-muted v2-small v2-admin-privacy"><I.admin size={14} /> {t('admin.privacy')}</p>
        <div className="v2-sidefoot">
          <NavLink to="/admin" className="v2-nav v2-nav-muted">{t('admin.users')}</NavLink>
          <NavLink to="/business/pulse" className="v2-nav v2-nav-muted"><I.chevLeft />{t('admin.back')}</NavLink>
        </div>
      </aside>
      <header className="v2-topbar">
        <span className="v2-topbar-ws"><img src={SYMBOL} alt="" aria-hidden="true" width="28" height="28" /><span className="v2-topbar-name">{t('admin.tag')}</span></span>
        <NavLink to="/business/pulse" className="v2-iconbtn" aria-label={t('admin.back')}><I.close size={20} /></NavLink>
      </header>
      <main id="v2-main" className="v2-main" tabIndex={-1}>
        <div className="v2-main-inner v2-admin-inner">
          <nav className="v2-tabs v2-phone" aria-label={t('admin.nav')}>
            {[['/admin/dashboard', 'admin.overview'], ['/admin/businesses', 'admin.companies'], ['/admin/system', 'admin.system']].map(([to, k]) => (
              <NavLink key={to} to={to} className={({ isActive }) => `v2-tab-link${isActive ? ' is-on' : ''}`}>{t(k)}</NavLink>
            ))}
          </nav>
          {children}
        </div>
      </main>
    </div>
  )
}

export default function AdminApp({ page }) {
  const { user, loading } = useAuth()
  const params = useParams()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return (
    <AdminShell>
      {page === 'overview' && <AdminOverview />}
      {page === 'companies' && <AdminCompanies selectedId={params.businessId || null} />}
      {page === 'system' && <AdminSystem />}
    </AdminShell>
  )
}
