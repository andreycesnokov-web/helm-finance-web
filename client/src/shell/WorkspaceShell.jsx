// WorkspaceShell — single app frame for BOTH Personal and Business workspaces.
// Official logo, desktop sidebar, mobile header + drawer, Workspace Switcher,
// workspace-aware nav and a private/shared footer badge. Content via children.
//
// Differences between Personal and Business are CONTENT/ACCESS only (the `nav`
// config + `workspace.type`), never component identity.
import { useState } from 'react'
import WorkspaceSwitcher from './WorkspaceSwitcher'
import { Icon } from './ui'

const LOGO_WORDMARK = '/brand/logo_main_navy_transparent_2400.png'
const SYMBOL = '/brand/symbol_navy_blue_dot_transparent.svg'
const FUNDING_UI_ENABLED = import.meta.env.VITE_PERSONAL_FUNDING_UI_ENABLED === 'true'

// Nav configs — labels are i18n keys at call sites; here plain for V1.
export const PERSONAL_NAV = [
  { items: [
    { key: 'overview', label: 'Overview', to: '/personal', icon: <Icon.pulse /> },
    { key: 'accounts', label: 'Accounts', to: '/personal/accounts', icon: <Icon.wallet /> },
    { key: 'transactions', label: 'Transactions', to: '/personal/transactions', icon: <Icon.list /> },
  ] },
  { title: 'Funding', items: [
    { key: 'funding', label: 'Business Funding', to: '/personal/funding', icon: <Icon.fund /> },
    { key: 'connections', label: 'Connections', to: '/personal/connections', icon: <Icon.link /> },
  ] },
  { title: 'More', items: [
    { key: 'documents', label: 'Documents', to: '/personal/documents', icon: <Icon.doc /> },
    { key: 'cfo', label: 'Personal AI CFO', to: '/personal/cfo', icon: <Icon.cfo /> },
    { key: 'settings', label: 'Settings', to: '/personal/settings', icon: <Icon.cog /> },
  ] },
]

// Labels are stable EN strings here (consistent across the shell); "AI Accountant"
// matches the legacy label. Non-migrated items point at legacy routes so access is
// never lost during the migration (Pulse/Accounts use the new premium routes).
export const BUSINESS_NAV = [
  { title: 'Overview', items: [
    { key: 'pulse', label: 'Pulse', to: '/business/pulse', icon: <Icon.pulse /> },
    { key: 'radar', label: 'Radar', to: '/business/radar', icon: <Icon.radar /> },
    { key: 'cfo', label: 'AI CFO', to: '/business/ai-cfo', icon: <Icon.cfo /> },
    { key: 'accountant', label: 'AI Accountant', to: '/business/accountant', icon: <Icon.acct /> },
  ] },
  { title: 'Finance', items: [
    { key: 'transactions', label: 'Transactions', to: '/business/transactions', icon: <Icon.list /> },
    { key: 'accounts', label: 'Accounts', to: '/business/accounts', icon: <Icon.wallet /> },
    { key: 'invoices', label: 'Invoices', to: '/business/invoices', icon: <Icon.doc /> },
    { key: 'receivables', label: 'Receivables', to: '/business/receivables', icon: <Icon.down /> },
    { key: 'payables', label: 'Payables', to: '/business/payables', icon: <Icon.up /> },
    // Funding & Investors depends on migrations 037–039; hidden when the gate is off
    // so production shows no dead link.
    ...(FUNDING_UI_ENABLED ? [{ key: 'funding', label: 'Funding & Investors', to: '/business/funding-investors', icon: <Icon.fund /> }] : []),
    { key: 'bankimport', label: 'Bank Import', to: '/business/bank-import', icon: <Icon.bank /> },
  ] },
  { title: 'Operations', items: [
    { key: 'payroll', label: 'Payroll', to: '/business/payroll', icon: <Icon.team /> },
    { key: 'approvals', label: 'Approvals', to: '/business/approvals', icon: <Icon.check /> },
    { key: 'team', label: 'Team', to: '/business/team', icon: <Icon.users /> },
    { key: 'documents', label: 'Documents', to: '/business/documents', icon: <Icon.doc /> },
    { key: 'settings', label: 'Settings', to: '/business/settings', icon: <Icon.cog /> },
  ] },
]

function Nav({ groups, activeKey, onNavigate }) {
  return (
    <nav className="cfo-nav">
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.title && <div className="cfo-navgroup-title">{g.title}</div>}
          {g.items.map(it => (
            <button key={it.key} className={`cfo-navitem${activeKey === it.key ? ' is-active' : ''}`}
              onClick={() => onNavigate?.(it)} disabled={it.disabled}>
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}

export default function WorkspaceShell({ workspaces, activeId, onSelectWorkspace, nav, activeKey, onNavigate, children }) {
  const [drawer, setDrawer] = useState(false)
  const all = [...(workspaces?.personal || []), ...(workspaces?.business || [])]
  const active = all.find(w => String(w.id) === String(activeId)) || all[0]
  const isPersonal = active?.type === 'personal'
  const footer = isPersonal
    ? <span className="cfo-badge cfo-badge-private"><Icon.lock /> Private workspace</span>
    : <span className="cfo-badge cfo-badge-shared"><Icon.users /> Shared team workspace</span>

  const SwitcherEl = <WorkspaceSwitcher workspaces={workspaces} activeId={activeId} onSelect={onSelectWorkspace} />
  const go = (it) => { setDrawer(false); onNavigate?.(it) }

  return (
    <div className="cfo-shell">
      {/* desktop sidebar */}
      <aside className="cfo-sidebar">
        <div className="cfo-brand"><img src={LOGO_WORDMARK} alt="CFO AI — Financial OS" /></div>
        {SwitcherEl}
        <Nav groups={nav} activeKey={activeKey} onNavigate={onNavigate} />
        <div className="cfo-side-foot">{footer}</div>
      </aside>

      {/* mobile header */}
      <header className="cfo-mobilehead">
        <img className="cfo-mobilesym" src={SYMBOL} alt="CFO AI" />
        {isPersonal
          ? <span className="cfo-badge cfo-badge-private"><Icon.lock /> Private</span>
          : <span className="cfo-badge cfo-badge-shared"><Icon.users /> {active?.role || 'Team'}</span>}
        <button className="cfo-burger" aria-label="Menu" onClick={() => setDrawer(true)}><span /><span /><span /></button>
      </header>

      {/* mobile drawer */}
      <div className={`cfo-drawer-scrim${drawer ? ' is-open' : ''}`} onClick={() => setDrawer(false)} />
      <div className={`cfo-drawer${drawer ? ' is-open' : ''}`}>
        <div className="cfo-brand"><img src={LOGO_WORDMARK} alt="CFO AI" /></div>
        {SwitcherEl}
        <Nav groups={nav} activeKey={activeKey} onNavigate={go} />
        <div className="cfo-side-foot">{footer}</div>
      </div>

      <main className="cfo-main"><div className="cfo-main-inner">{children}</div></main>
    </div>
  )
}
