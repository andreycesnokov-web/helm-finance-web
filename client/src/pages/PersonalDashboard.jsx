// Personal Account v1 — FINAL Personal Workspace UI (per _specs/personal-account-final-
// structure.md). Same product shell as Business (WorkspaceShell + cfo-* primitives).
// Personal is primary; Business is secondary. Single /account route, in-shell sections:
//   PERSONAL: Overview · Wallets · Transactions · AI CFO · Workspaces · Profile
//
// Gated by VITE_PERSONAL_ACCOUNT_V1_ENABLED (caller renders this only when on). RAW fetch
// with Authorization only (never apiFetch → no x-business-id; backend rejects business ids
// on personal routes). Personal finance hits ONLY /api/personal/*; Business Links uses
// /api/workspaces for listing/opening. No backend/migration/auth changes.
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { setActiveBusinessId } from '../lib/api'
import WorkspaceShell from '../shell/WorkspaceShell'
import { Icon, PageHeader, Card, SummaryCard, Stat, DataList, EmptyState, Btn, PageTabs, ActionMenu } from '../shell/ui'

const SYMBOL = '/brand/symbol_navy_blue_dot_transparent.svg'
const WALLET_TYPES = [['cash', 'Cash'], ['bank', 'Bank account'], ['card', 'Card'], ['wise_paypal', 'Wise / Revolut / PayPal'], ['ewallet', 'E-wallet'], ['other', 'Other']]
const CURRENCIES = ['IDR', 'USD', 'EUR', 'SGD', 'MYR', 'THB', 'CNY', 'RUB', 'GBP', 'AUD', 'JPY']
const COMMON_TZ = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Singapore', 'Asia/Bangkok', 'Europe/Moscow', 'UTC']
const LOCALES = ['en', 'ru', 'id']
const BUSINESS_TYPES = [['pt', 'PT'], ['pt_pma', 'PT PMA'], ['cv', 'CV'], ['sole_owner', 'Sole owner'], ['other', 'Other']]
const BUSINESS_ROLES = ['Owner', 'Director', 'Finance', 'Accountant', 'Staff']

// Full human category taxonomy (spec §5). Used for the Categories page + as the transaction
// dropdown fallback when the backend returns none. Business-related Personal categories tag
// the personal record only — they NEVER create business records in v1.
const CATEGORY_GROUPS = [
  { group: 'Income', kind: 'income', items: ['Salary', 'Owner draw', 'Dividends', 'Freelance', 'Investment income', 'Gift', 'Refund', 'Other income'] },
  { group: 'Daily Expenses', kind: 'expense', items: ['Groceries', 'Restaurants & cafes', 'Transport', 'Fuel', 'Taxi / ride-hailing', 'Shopping', 'Mobile & internet', 'Subscriptions', 'Entertainment'] },
  { group: 'Home & Life', kind: 'expense', items: ['Rent', 'Utilities', 'Home supplies', 'Repairs', 'Family', 'Pets', 'Health', 'Insurance', 'Education'] },
  { group: 'Travel', kind: 'expense', items: ['Flights', 'Hotels', 'Visa / immigration', 'Travel food', 'Local transport'] },
  { group: 'Finance', kind: 'expense', items: ['Bank fees', 'Loan payment', 'Credit card payment', 'Savings', 'Investments', 'Crypto', 'Taxes'] },
  { group: 'Business-related Personal', kind: 'expense', items: ['Paid for business', 'Reimbursable expense', 'Owner loan to business', 'Owner equity contribution', 'Business paid me back'] },
]
const FALLBACK_INCOME = CATEGORY_GROUPS.find(g => g.group === 'Income').items.map(name => ({ id: name, name }))
const FALLBACK_EXPENSE = CATEGORY_GROUPS.filter(g => g.kind === 'expense').flatMap(g => g.items).map(name => ({ id: name, name }))

const PERSONAL_NAV = [
  { title: 'Personal', items: [
    { key: 'overview', label: 'Overview', icon: <Icon.pulse /> },
    { key: 'wallets', label: 'Wallets', icon: <Icon.wallet /> },
    { key: 'transactions', label: 'Transactions', icon: <Icon.list /> },
    { key: 'categories', label: 'Categories', icon: <Icon.acct /> },
    { key: 'cfo', label: 'AI CFO', icon: <Icon.cfo /> },
    { key: 'businesses', label: 'Company Workspaces', icon: <Icon.link /> },
    { key: 'profile', label: 'Profile', icon: <Icon.cog /> },
  ] },
]
const PERSONAL_SECONDARY_NAV = [
  { title: 'Menu', items: [
    { key: 'businesses', label: 'Company Workspaces', icon: <Icon.link /> },
    { key: 'billing', label: 'Billing', icon: <Icon.fund /> },
    { key: 'profile', label: 'Settings', icon: <Icon.cog /> },
    { key: 'help', label: 'Help', icon: <Icon.doc /> },
    { key: 'logout', label: 'Logout', icon: <Icon.warn /> },
  ] },
]

function money(n, cur = 'IDR') {
  const v = Number(n || 0)
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(v) }
  catch { return `${cur} ${v.toLocaleString('en-US')}` }
}
const labelFor = (t) => (WALLET_TYPES.find(x => x[0] === t) || [, t])[1]
const isXfer = (tx) => typeof tx.source === 'string' && tx.source.startsWith('xfer:')
const groupAmounts = (rows, valueKey = 'balance', currencyKey = 'currency') => rows.reduce((acc, row) => {
  const cur = row?.[currencyKey] || 'IDR'
  acc[cur] = (acc[cur] || 0) + Number(row?.[valueKey] || 0)
  return acc
}, {})
const parseInviteCode = (raw) => {
  const s = String(raw || '').trim()
  if (!s) return ''
  const m = s.match(/\/invite\/([^/?#]+)/i)
  return decodeURIComponent((m?.[1] || s).replace(/^#/, '')).trim()
}
const walletIcon = (w) => {
  const type = (w?.type || '').toLowerCase()
  const name = (w?.name || '').toLowerCase()
  if (type === 'bank' || /bca|mandiri|bri|bank/.test(name)) return <Icon.bank width="16" height="16" />
  if (type === 'card' || /card|revolut/.test(name)) return <Icon.card width="16" height="16" />
  if (type === 'ewallet' || /gopay|ovo|wallet/.test(name)) return <Icon.phone width="16" height="16" />
  if (type === 'wise_paypal' || /wise|paypal/.test(name)) return <Icon.globe width="16" height="16" />
  return <Icon.wallet width="16" height="16" />
}
const categoryIcon = (name = '', type) => {
  const s = String(name).toLowerCase()
  if (type === 'income' || /salary|income|dividend|refund|payout/.test(s)) return <Icon.arrowDown width="16" height="16" />
  if (/transfer/.test(s)) return <Icon.transfer width="16" height="16" />
  if (/food|coffee|restaurant|cafe|dining/.test(s)) return <Icon.coffee width="16" height="16" />
  if (/transport|taxi|fuel|uber|car/.test(s)) return <Icon.car width="16" height="16" />
  if (/shop|store|apple|bag/.test(s)) return <Icon.bag width="16" height="16" />
  if (/subscription|saas|cloud|internet|mobile|aws|gcp/.test(s)) return <Icon.cloud width="16" height="16" />
  if (/education|book/.test(s)) return <Icon.book width="16" height="16" />
  if (/entertainment|netflix|spotify/.test(s)) return <Icon.play width="16" height="16" />
  return <Icon.acct width="16" height="16" />
}
const dailyTotals = (rows) => rows.reduce((acc, tx) => {
  const key = tx.transaction_date || 'Undated'
  const cur = tx.currency_original || 'IDR'
  acc[key] ||= {}
  acc[key][cur] = (acc[key][cur] || 0) + (tx.type === 'income' ? Number(tx.amount_original || 0) : -Number(tx.amount_original || 0))
  return acc
}, {})
const formatSignedMoney = (v, cur) => `${v >= 0 ? '+' : '−'}${money(Math.abs(v), cur)}`

export default function PersonalWorkspace() {
  const { token, user, logout } = useAuth()
  const navigate = useNavigate()
  const [section, setSection] = useState('overview')
  const [summary, setSummary] = useState(null)
  const [wallets, setWallets] = useState([])
  const [txs, setTxs] = useState([])
  const [cats, setCats] = useState({ income: [], expense: [], business_related: [] })
  const [businesses, setBusinesses] = useState([])
  const [loading, setLoading] = useState(true)
  const [disabled, setDisabled] = useState(false)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null) // null | 'wallet' | {tx: kind}
  const [upgrade, setUpgrade] = useState('')

  const pf = (path, opts = {}) => fetch(`/api/personal${path}`, {
    ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })

  const load = async () => {
    setLoading(true); setError('')
    try {
      const sRes = await pf('/summary') // first call provisions the personal workspace
      if (sRes.status === 404) { setDisabled(true); return }
      const s = await sRes.json()
      const [w, tx, c, ws] = await Promise.all([
        pf('/wallets').then(r => r.json()).catch(() => ({})),
        pf('/transactions?limit=100').then(r => r.json()).catch(() => ({})),
        pf('/categories').then(r => r.json()).catch(() => ({})),
        fetch('/api/workspaces', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => ({})),
      ])
      setSummary(s)
      setWallets(Array.isArray(w.wallets) ? w.wallets : [])
      setTxs(Array.isArray(tx.transactions) ? tx.transactions : [])
      setCats({
        income: (c.income && c.income.length) ? c.income : FALLBACK_INCOME,
        expense: (c.expense && c.expense.length) ? c.expense : FALLBACK_EXPENSE,
        business_related: c.business_related || [],
      })
      setBusinesses(Array.isArray(ws.business) ? ws.business : [])
    } catch { setError('Could not load personal finance.') } finally { setLoading(false) }
  }
  useEffect(() => { if (token) load() }, [token]) // eslint-disable-line
  useEffect(() => {
    try {
      setActiveBusinessId(null)
      localStorage.setItem('activeWorkspaceId', 'personal')
      localStorage.setItem('last_active_workspace_id', 'personal')
    } catch { /* noop */ }
  }, [])

  const baseCur = summary?.workspace?.base_currency || 'IDR'
  const hasWallet = wallets.length > 0
  const t = summary?.totals || {}
  const insight = summary?.insight || {}
  const savingsRate = t.income_mtd > 0 ? Math.round((Number(t.net_saved || 0) / Number(t.income_mtd)) * 100) : null
  const enoughData = txs.length >= 5
  const closeModal = () => setModal(null)
  const reload = () => { setModal(null); load() }

  const subline = user?.email || (user?.id != null ? `id ${user.id}` : '')
  const shellWorkspaces = {
    personal: [{ id: 'personal', name: 'Personal Finance', type: 'personal', role: 'owner', business_code: subline }],
    business: businesses,
  }
  const openBusiness = (w) => {
    if (!w?.id) return
    try {
      setActiveBusinessId(w.id)
      localStorage.setItem('activeWorkspaceId', w.id)
      localStorage.setItem('last_active_workspace_id', w.id)
    } catch { /* noop */ }
    navigate('/business/pulse')
  }
  const onSelectWorkspace = (w) => { if (w?.type !== 'personal') openBusiness(w) }

  const txItems = (rows) => rows.map(tx => ({
    id: tx.id,
    dir: isXfer(tx) ? null : (tx.type === 'income' ? 'in' : 'out'),
    icon: categoryIcon(isXfer(tx) ? 'Transfer' : (tx.category || tx.description), tx.type),
    iconTone: isXfer(tx) ? 'neutral' : (tx.type === 'income' ? 'in' : 'out'),
    label: isXfer(tx) ? 'Transfer' : (tx.category || tx.description || '—'),
    sub: tx.transaction_date || '',
    amount: `${tx.type === 'income' ? '+' : '−'}${money(tx.amount_original, tx.currency_original || baseCur)}`,
    amountTone: tx.type === 'income' ? 'pos' : '',
  }))

  const recommendation = !enoughData
    ? 'Not enough data yet — add 5–10 transactions to unlock personal insights.'
    : insight.spending_faster
      ? 'You are spending faster than last month — ease off discretionary categories to protect your savings.'
      : 'Your spending is on track. Keep directing the surplus into savings.'

  let body
  if (loading) body = <Card><div className="cfo-skel" style={{ height: 140 }} /></Card>
  else if (disabled) body = <EmptyState symbol={SYMBOL} title="Personal finance isn’t enabled yet" description="This workspace lights up once Personal Account v1 is enabled." />
  else if (error) body = <EmptyState symbol={SYMBOL} title="Couldn’t load personal finance" description={error} actions={<Btn onClick={load}>Try again</Btn>} />
  else if (section === 'overview') body = <Overview {...{ baseCur, hasWallet, wallets, t, insight, savingsRate, summary, txItems, recommendation, setModal, setSection, businesses, navigate, onSelectWorkspace, user, upgrade, setUpgrade }} />
  else if (section === 'wallets') body = <WalletsPage {...{ pf, reload, wallets, hasWallet, baseCur, setModal }} />
  else if (section === 'transactions') body = <TransactionsPage {...{ txs, txItems, hasWallet, setModal }} />
  else if (section === 'categories') body = <CategoriesPage />
  else if (section === 'cfo') body = <CfoPage {...{ baseCur, t, insight, enoughData, recommendation }} />
  else if (section === 'businesses') body = <BusinessLinks {...{ businesses, navigate, onSelect: onSelectWorkspace, setModal, upgrade, setUpgrade }} />
  else if (section === 'profile') body = <ProfileSection token={token} user={user} logout={logout} navigate={navigate} />
  else if (section === 'billing') body = <BillingPage />
  else if (section === 'help') body = <HelpPage />

  return (
    <WorkspaceShell workspaces={shellWorkspaces} activeId="personal" onSelectWorkspace={onSelectWorkspace}
      nav={PERSONAL_NAV} mobileNav={PERSONAL_SECONDARY_NAV} activeKey={section} onNavigate={(it) => it.key === 'logout' ? (logout(), navigate('/login')) : setSection(it.key)}>
      <div className="personal-app">
        {body}
        <PersonalMobileNav active={section} onNav={setSection} onAdd={() => setModal(hasWallet ? { tx: 'expense' } : 'wallet')} />
      </div>
      {modal === 'wallet' && <AccountModal pf={pf} baseCur={baseCur} onClose={closeModal} onSaved={reload} />}
      {modal?.editWallet && <AccountModal pf={pf} baseCur={baseCur} wallet={modal.editWallet} onClose={closeModal} onSaved={reload} />}
      {modal?.adjustWallet && <AdjustBalanceModal pf={pf} wallet={modal.adjustWallet} onClose={closeModal} onSaved={reload} />}
      {modal?.tx && <TxModal pf={pf} wallets={wallets} cats={cats} initialKind={modal.tx} onClose={closeModal} onSaved={reload} />}
      {modal === 'business' && <BusinessCreateModal token={token} onClose={closeModal} onUpgrade={setUpgrade} onCreated={openBusiness} />}
    </WorkspaceShell>
  )
}

function PersonalMobileNav({ active, onNav, onAdd }) {
  const items = [
    ['overview', 'Home', <Icon.pulse />],
    ['wallets', 'Wallets', <Icon.wallet />],
    ['add', 'Add', <Icon.plus />],
    ['cfo', 'AI CFO', <Icon.cfo />],
    ['profile', 'Profile', <Icon.users />],
  ]
  return (
    <>
      <nav className="personal-bottom-nav" aria-label="Personal mobile navigation">
        {items.map(([key, label, icon]) => (
          <button key={key} type="button" className={active === key ? 'is-active' : ''} onClick={() => key === 'add' ? onAdd() : onNav(key)}>
            <span>{icon}</span><b>{label}</b>
          </button>
        ))}
      </nav>
      <button type="button" className="personal-fab" aria-label="Add personal transaction" onClick={onAdd}><Icon.plus /></button>
    </>
  )
}

// ── Overview ─────────────────────────────────────────────────────────────────
function Overview({ baseCur, hasWallet, wallets, t, insight, savingsRate, summary, txItems, recommendation, setModal, setSection, businesses, navigate, onSelectWorkspace, user, upgrade, setUpgrade }) {
  const accountRef = user?.email || (user?.id != null ? `id ${user.id}` : 'Personal')
  const walletTotals = groupAmounts(wallets)
  const walletCurrencies = Object.keys(walletTotals)
  const hasMixedWallets = walletCurrencies.length > 1
  // Backend totals are base-currency only (never summed across currencies), so the
  // headline number is always honest; the by-currency card lists the other currencies.
  const primaryBalance = money(t.balance, baseCur)
  const txCurrencyTotals = groupAmounts(summary?.recent || [], 'amount_original', 'currency_original')
  const needsOnboarding = !hasWallet && businesses.length === 0
  return (
    <div className="personal-overview">
      <PageHeader eyebrow="Personal Workspace" title="My Finances"
        actions={<><Btn variant="ghost" icon={<Icon.wallet width="16" height="16" />} onClick={() => setModal('wallet')}>Add account</Btn>
          <Btn icon={<Icon.plus width="16" height="16" />} onClick={() => setModal({ tx: 'expense' })} disabled={!hasWallet}>Add transaction</Btn></>} />
      <p className="personal-overview-subtitle">Your personal money, wallets and transactions. Business wallets stay separate.</p>
      <div className="personal-mobile-meta">
        <span><Icon.lock width="15" height="15" /> Personal workspace</span>
        <span>{accountRef}</span>
      </div>

      {upgrade && <UpgradePrompt message={upgrade} onDismiss={() => setUpgrade('')} />}
      {needsOnboarding && <OnboardingChoices onPersonal={() => setModal('wallet')} onBusiness={() => setModal('business')} onInvite={(code) => navigate(`/invite/${code}`)} />}

      {/* A. Personal Balance */}
      <SummaryCard symbol={SYMBOL} label={hasMixedWallets ? `Total balance · ${baseCur}` : 'Total balance'} value={primaryBalance}
        meta={<><Icon.dot className="dot" width="12" height="12" /> Safe to spend this month: <b style={{ fontWeight: 700 }}>{money(insight.safe_to_spend, baseCur)}</b></>}
        metrics={[
          { k: 'Income', v: money(t.income_mtd, baseCur), tone: 'pos' },
          { k: 'Expenses', v: money(t.expense_mtd, baseCur), tone: 'neg' },
          { k: 'Saved this month', v: money(t.net_saved, baseCur) },
        ]} />
      {hasMixedWallets && <Card className="cfo-mt personal-currency-note" title="Balances by currency">
        <DataList items={walletCurrencies.map(cur => ({ id: cur, label: cur, sub: 'Kept separate until conversion is available', amount: money(walletTotals[cur], cur) }))} />
      </Card>}

      {/* B. Monthly Snapshot + D. Quick Add */}
      <div className="cfo-grid cfo-grid-2 cfo-mt">
        <Card title="Monthly snapshot">
          <div className="cfo-grid cfo-grid-2" style={{ gap: 14 }}>
            <Stat k="Income" v={money(t.income_mtd, baseCur)} tone="pos" />
            <Stat k="Expenses" v={money(t.expense_mtd, baseCur)} tone="neg" />
            <Stat k="Net saved" v={money(t.net_saved, baseCur)} />
            <Stat k="Savings rate" v={savingsRate != null ? `${savingsRate}%` : '—'} />
          </div>
          {Array.isArray(insight.top_categories) && insight.top_categories.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>Top: {insight.top_categories.map(c => `${c.name} (${money(c.amount, baseCur)})`).join(' · ')}</div>
          )}
        </Card>
        <Card title="Quick add">
          <div className="cfo-grid cfo-grid-2" style={{ gap: 10 }}>
            <Btn variant="ghost" onClick={() => setModal({ tx: 'expense' })} disabled={!hasWallet}>+ Expense</Btn>
            <Btn variant="ghost" onClick={() => setModal({ tx: 'income' })} disabled={!hasWallet}>+ Income</Btn>
            <Btn variant="ghost" onClick={() => setModal({ tx: 'transfer' })} disabled={!hasWallet}>Transfer</Btn>
            <Btn variant="ghost" disabled title="Receipt scanning — coming soon">Receipt (soon)</Btn>
          </div>
          {!hasWallet && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>Add an account to start recording transactions.</div>}
        </Card>
      </div>

      {/* C. Wallets */}
      <Card title="Accounts" className="cfo-mt" action={<Btn variant="ghost" sm onClick={() => setModal('wallet')}>+ Add account</Btn>}>
          {hasWallet
          ? <DataList items={wallets.map(w => ({ id: w.id, icon: walletIcon(w), label: w.name, sub: labelFor(w.type), amount: money(w.balance, w.currency) }))} />
          : <EmptyState title="Create your first personal wallet" description="Cash, bank, card, Wise/PayPal, e-wallet — personal only, never shown as a business wallet." actions={<Btn onClick={() => setModal('wallet')}>+ Add account</Btn>} />}
      </Card>

      {/* E. Recent Transactions */}
      <Card title="Recent transactions" className="cfo-mt" action={<Btn variant="ghost" sm onClick={() => setSection('transactions')}>View all</Btn>}>
        {(summary?.recent || []).length
          ? <DataList items={txItems(summary.recent)} />
          : <EmptyState title="Your personal transactions will appear here" description="Add income, expenses, or transfers between your accounts." actions={<Btn onClick={() => setModal({ tx: 'expense' })} disabled={!hasWallet}>+ Add transaction</Btn>} />}
      </Card>
      {Object.keys(txCurrencyTotals).length > 1 && <div className="personal-small-note">Multi-currency transactions are displayed in their original currency. We do not combine IDR and USD until conversion is available.</div>}

      {/* F. CFO AI Lite */}
      <Card title="AI Alert" className="cfo-mt personal-ai-card" action={<span className="cfo-chip cfo-chip-soft">Free plan</span>}>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          {recommendation}{insight.vs_last_month_pct != null && ` (${insight.vs_last_month_pct > 0 ? '+' : ''}${insight.vs_last_month_pct}% vs last month)`}
        </p>
        <UpgradeGates compact />
      </Card>

      {/* G. Business Connections (secondary) */}
      <BusinessLinks businesses={businesses} navigate={navigate} onSelect={onSelectWorkspace} setModal={setModal} upgrade={upgrade} setUpgrade={setUpgrade} compact />
    </div>
  )
}

function OnboardingChoices({ onPersonal, onBusiness, onInvite }) {
  const [invite, setInvite] = useState('')
  const submitInvite = () => {
    const code = parseInviteCode(invite)
    if (code) onInvite(code)
  }
  return (
    <Card title="What do you want to do first?" className="personal-onboarding">
      <div className="personal-choice-grid">
        <button type="button" onClick={onPersonal}><b>Manage personal finances</b><span>Add your first wallet and track personal spending.</span></button>
        <button type="button" onClick={onBusiness}><b>Create company workspace</b><span>Start a separate team workspace for company money.</span></button>
        <div className="personal-invite-choice">
          <b>Join business by invite</b>
          <span>Paste an invite link or code from your email.</span>
          <div><input className="cfo-input" value={invite} onChange={e => setInvite(e.target.value)} placeholder="Invite link or code" /><Btn type="button" onClick={submitInvite} disabled={!invite.trim()}>Join</Btn></div>
        </div>
      </div>
    </Card>
  )
}

function UpgradePrompt({ message, onDismiss }) {
  return (
    <Card className="personal-upgrade-prompt">
      <div>
        <b>Upgrade needed</b>
        <p>{message}</p>
      </div>
      <Btn variant="ghost" sm onClick={onDismiss}>Dismiss</Btn>
    </Card>
  )
}

function UpgradeGates({ compact }) {
  const plans = [
    ['Free', 'Limited AI insights · Telegram locked'],
    ['CFO AI Lite · $9', 'Telegram access · limited AI usage'],
    ['Personal Pro · $39', 'Full personal features · fair usage'],
  ]
  return (
    <div className={compact ? 'personal-plan-row compact' : 'personal-plan-row'}>
      {plans.map(([name, desc]) => <div key={name} className="personal-plan-pill"><b>{name}</b><span>{desc}</span></div>)}
    </div>
  )
}
// ── Wallets page ─────────────────────────────────────────────────────────────
function WalletsPage({ pf, reload, wallets, hasWallet, baseCur, setModal }) {
  const totals = groupAmounts(wallets)
  const currencies = Object.keys(totals)
  const archiveWallet = async (w) => {
    if (!window.confirm(`Archive "${w.name}"? The account will be hidden. Transactions stay intact.`)) return
    const r = await pf(`/wallets/${w.id}`, { method: 'PATCH', body: { is_active: false } })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      alert(d.message || d.error || 'Could not archive account.')
      return
    }
    reload()
  }
  const deleteWallet = async (w) => {
    if (!window.confirm(`Delete "${w.name}"? This only works for empty accounts.`)) return
    const r = await pf(`/wallets/${w.id}`, { method: 'DELETE' })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      alert(d.message || d.error || 'Delete is available only for empty accounts. Archive this account instead.')
      return
    }
    reload()
  }
  return (
    <>
      <PageHeader eyebrow="Personal" title="Wallets" actions={<Btn icon={<Icon.plus width="16" height="16" />} onClick={() => setModal('wallet')}>Add account</Btn>} />
      {currencies.length > 1 && <Card title="Liquidity by currency" className="cfo-mt">
        <DataList items={currencies.map(cur => ({ id: cur, label: cur, sub: 'Not combined without conversion', amount: money(totals[cur], cur) }))} />
      </Card>}
      <Card>
        {hasWallet ? (
          <ul className="cfo-list personal-wallet-list">
            {wallets.map(w => (
              <li key={w.id} className="cfo-list-item">
                <span className="cfo-list-ic neutral">{walletIcon(w)}</span>
                <span className="cfo-list-main">
                  <span className="cfo-list-label">{w.name}</span>
                  <span className="cfo-list-sub">{labelFor(w.type)} · {w.currency} · personal only</span>
                </span>
                <div className="personal-wallet-right">
                  <span className="cfo-list-amt">{money(w.balance, w.currency)}</span>
                  <ActionMenu items={[
                    { label: 'Adjust balance', onClick: () => setModal({ adjustWallet: w }) },
                    { label: 'Edit account', onClick: () => setModal({ editWallet: w }) },
                    { label: 'Archive account', danger: true, onClick: () => archiveWallet(w) },
                    { label: 'Delete empty account', danger: true, onClick: () => deleteWallet(w) },
                  ]} />
                </div>
              </li>
            ))}
          </ul>
        ) : <EmptyState symbol={SYMBOL} title="Create your first personal account" description="Cash, bank, card, Wise/Revolut/PayPal, e-wallet. Crypto comes later." actions={<Btn onClick={() => setModal('wallet')}>+ Add account</Btn>} />}
      </Card>
      <Card title="Recurring payments" className="cfo-mt" action={<Btn variant="ghost" sm disabled>+ Add subscription · Coming soon</Btn>}>
        <div className="personal-recurring-note">
          <span className="cfo-list-ic neutral"><Icon.cloud width="16" height="16" /></span>
          <div>
            <b>Subscriptions and rent tracking are next</b>
            <p>Total recurring will stay separate from transactions until the feature is enabled.</p>
          </div>
          <span className="personal-monthly-badge">MONTHLY</span>
        </div>
      </Card>
      <div className="personal-small-note">Personal accounts never appear as company accounts. Company accounts stay inside company workspaces.</div>
    </>
  )
}

// ── Transactions page (filters + search) ─────────────────────────────────────
function TransactionsPage({ txs, txItems, hasWallet, setModal }) {
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const rows = useMemo(() => txs.filter(tx => {
    const kind = isXfer(tx) ? 'transfer' : tx.type
    if (filter !== 'all' && kind !== filter) return false
    if (q && !((tx.category || '') + ' ' + (tx.description || '')).toLowerCase().includes(q.toLowerCase())) return false
    return true
  }), [txs, filter, q])
  const totals = dailyTotals(rows)
  const grouped = rows.reduce((acc, tx) => {
    const key = tx.transaction_date || 'Undated'
    acc[key] ||= []
    acc[key].push(tx)
    return acc
  }, {})
  return (
    <>
      <PageHeader eyebrow="Personal" title="Transactions" actions={<Btn icon={<Icon.plus width="16" height="16" />} onClick={() => setModal({ tx: 'expense' })} disabled={!hasWallet}>Add transaction</Btn>} />
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <PageTabs tabs={[{ key: 'all', label: 'All' }, { key: 'income', label: 'Income' }, { key: 'expense', label: 'Expense' }, { key: 'transfer', label: 'Transfer' }]} active={filter} onChange={setFilter} />
          <input className="cfo-input" style={{ maxWidth: 220, marginLeft: 'auto' }} placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {!txs.length
          ? <EmptyState symbol={SYMBOL} title="Your personal transactions will appear here" description="Add income, expenses, or transfers between your accounts." actions={<Btn onClick={() => setModal({ tx: 'expense' })} disabled={!hasWallet}>+ Add transaction</Btn>} />
          : rows.length ? <div className="personal-tx-groups">
              {Object.entries(grouped).map(([date, groupRows]) => (
                <section key={date} className="personal-tx-day">
                  <div className="personal-tx-day-head"><span>{date}</span><span>{Object.entries(totals[date] || {}).map(([cur, total]) => formatSignedMoney(total, cur)).join(' · ')}</span></div>
                  <DataList items={txItems(groupRows)} />
                </section>
              ))}
            </div> : <EmptyState title="No matching transactions" description="Try a different filter or search." />}
      </Card>
    </>
  )
}

// ── Categories page (reference taxonomy) ─────────────────────────────────────
function CategoriesPage() {
  return (
    <>
      <PageHeader eyebrow="Personal" title="Categories" />
      <p style={{ margin: '-8px 0 16px', color: 'var(--text-muted)', fontSize: 14 }}>
        Choose the category that best explains your personal transaction. Business-related categories stay personal until you explicitly connect them to a business later.
      </p>
      <div className="cfo-grid cfo-grid-2">
        {CATEGORY_GROUPS.map(g => (
          <Card key={g.group} title={g.group}>
            <DataList items={g.items.map((name, i) => ({ id: i, label: name, tag: g.group === 'Business-related Personal' ? 'personal only' : (g.kind === 'income' ? 'income' : 'expense') }))} />
          </Card>
        ))}
      </div>
    </>
  )
}

// ── AI CFO page ──────────────────────────────────────────────────────────────
function CfoPage({ baseCur, t, insight, enoughData, recommendation }) {
  const monthlyExpense = Math.max(Number(t.expense_mtd || 0), 0)
  const dailyBurn = monthlyExpense > 0 ? monthlyExpense / 30 : 0
  const runwayDays = dailyBurn > 0 ? Math.floor(Number(t.balance || 0) / dailyBurn) : null
  const top = Array.isArray(insight.top_categories) ? insight.top_categories : []
  const maxTop = Math.max(...top.map(c => Number(c.amount || 0)), 1)
  if (!enoughData) return (
    <>
      <PageHeader eyebrow="Personal" title="AI CFO" />
      <Card title="Plan level"><UpgradeGates /></Card>
      <EmptyState symbol={SYMBOL} title="Not enough data yet" description="Add 5–10 transactions and your personal insights — spending trend, safe-to-spend, and top categories — will appear here." />
    </>
  )
  return (
    <>
      <PageHeader eyebrow="Personal" title="AI CFO" />
      <Card title="Plan level"><UpgradeGates /></Card>
      <Card title="This month">
        <div className="cfo-grid cfo-grid-3">
          <Stat k="Income" v={money(t.income_mtd, baseCur)} tone="pos" />
          <Stat k="Expenses" v={money(t.expense_mtd, baseCur)} tone="neg" />
          <Stat k="Net saved" v={money(t.net_saved, baseCur)} />
        </div>
        <div className="personal-cfo-runway">
          <span>Personal runway</span>
          <b>{runwayDays == null ? '—' : runwayDays}</b>
          <small>{dailyBurn ? `Based on average burn of ${money(dailyBurn, baseCur)}/day` : 'Add expenses to calculate runway'}</small>
        </div>
        <p style={{ marginTop: 16, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          {recommendation}{insight.vs_last_month_pct != null && ` (${insight.vs_last_month_pct > 0 ? '+' : ''}${insight.vs_last_month_pct}% vs last month)`}
          {' '}Safe to spend: <b>{money(insight.safe_to_spend, baseCur)}</b>.
        </p>
        <div className="personal-prompt-row">
          <button type="button">How much did I spend on food?</button>
          <button type="button">Can I afford this purchase?</button>
        </div>
      </Card>
      {top.length > 0 && (
        <Card title="Top spending categories" className="cfo-mt">
          <div className="personal-category-bars">
            {top.map((c, i) => (
              <div key={i} className="personal-category-bar">
                <span className="cfo-list-ic neutral">{categoryIcon(c.name)}</span>
                <div>
                  <div><b>{c.name}</b><span>{money(c.amount, baseCur)}</span></div>
                  <em><i style={{ width: `${Math.max(8, (Number(c.amount || 0) / maxTop) * 100)}%` }} /></em>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  )
}

// ── Workspaces (secondary) ───────────────────────────────────────────────────
function BusinessLinks({ businesses, navigate, onSelect, setModal, upgrade, setUpgrade, compact }) {
  const [invite, setInvite] = useState('')
  const join = () => {
    const code = parseInviteCode(invite)
    if (code) navigate(`/invite/${code}`)
  }
  return (
    <>
      {!compact && <PageHeader eyebrow="Personal" title="Company Workspaces" />}
      {upgrade && !compact && <UpgradePrompt message={upgrade} onDismiss={() => setUpgrade?.('')} />}
      <Card title="Company Workspaces" className={compact ? 'cfo-mt' : ''}
        action={<Btn variant="ghost" sm onClick={() => setModal?.('business')}>+ Create company</Btn>}>
        {businesses.length === 0 ? (
          <EmptyState title="No company workspaces yet"
            description="Company workspaces are optional and separate from your personal wallets. Create one for company money, or open an invite link from your email."
            actions={<Btn onClick={() => setModal?.('business')}>Create company workspace</Btn>} />
        ) : (
          <DataList items={businesses.map(b => ({ id: b.id, label: b.name, sub: `${b.business_code ? b.business_code + ' · ' : ''}${b.role || ''}`, amount: 'Open company →' }))} />
        )}
        <div className="personal-inline-invite">
          <input className="cfo-input" value={invite} onChange={e => setInvite(e.target.value)} placeholder="Invite link or code" />
          <Btn variant="ghost" type="button" onClick={join} disabled={!invite.trim()}>Join</Btn>
        </div>
        {businesses.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {businesses.map(b => <Btn key={b.id} variant="ghost" onClick={() => onSelect(b)}>{`Open company: ${b.name}`}</Btn>)}
          </div>
        )}
      </Card>
    </>
  )
}

function BillingPage() {
  return (
    <>
      <PageHeader eyebrow="Personal" title="Billing" />
      <Card title="Personal plans"><UpgradeGates /></Card>
    </>
  )
}

function HelpPage() {
  return (
    <>
      <PageHeader eyebrow="Personal" title="Help" />
      <Card title="Personal vs Business">
        <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          Personal wallets are yours. Company wallets belong to a workspace and team. They stay separate. Money moves between them only through explicit transfers that you control.
        </p>
      </Card>
    </>
  )
}

// ── Profile (avatar upload + identity) ───────────────────────────────────────
function BusinessCreateModal({ token, onClose, onCreated, onUpgrade }) {
  const [form, setForm] = useState({
    name: '',
    country: 'Indonesia',
    base_currency: 'IDR',
    business_type: 'pt',
    user_role: 'Owner',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => { setForm(f => ({ ...f, [k]: e.target.value })); setErr('') }

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setErr('Company name is required.'); return }
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/businesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: form.name.trim(),
          country: form.country,
          base_currency: form.base_currency,
          business_type: form.business_type,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = data.message || data.error || 'Could not create company workspace.'
        if (res.status === 402 || /limit|plan|upgrade/i.test(msg)) {
          onUpgrade?.('Upgrade to Starter to add another company workspace.')
          onClose()
          return
        }
        setErr(msg)
        return
      }
      onCreated?.(data.business)
    } catch {
      setErr('Network error.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalFrame title="Create company workspace" onClose={onClose}>
      <form onSubmit={submit} className="personal-business-form">
        <div className="personal-separation-copy">
          Your personal wallets and company wallets are separate. Money moves between them only through explicit transfers that you control.
        </div>
        <Field label="Company name"><input className="cfo-input" value={form.name} onChange={set('name')} placeholder="e.g. Helm Care Indonesia" autoFocus /></Field>
        <div className="personal-form-grid">
          <Field label="Country"><select className="cfo-input" value={form.country} onChange={set('country')}><option>Indonesia</option><option>Singapore</option><option>Thailand</option><option>Malaysia</option><option>Other</option></select></Field>
          <Field label="Base currency"><select className="cfo-input" value={form.base_currency} onChange={set('base_currency')}>{CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select></Field>
        </div>
        <Field label="Business type"><select className="cfo-input" value={form.business_type} onChange={set('business_type')}>{BUSINESS_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Your role"><select className="cfo-input" value={form.user_role} onChange={set('user_role')}>{BUSINESS_ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select></Field>
        {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
        <div className="cfo-modal-actions"><Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn><Btn type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create company'}</Btn></div>
      </form>
    </ModalFrame>
  )
}

function ProfileSection({ token, user, logout, navigate }) {
  const [form, setForm] = useState({ display_name: '', locale: '', timezone: '', avatar_url: '' })
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const [avatarBusy, setAvatarBusy] = useState(false)
  useEffect(() => {
    fetch('/api/me/profile', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).then(d => {
      const p = d.profile || {}; setForm({ display_name: p.display_name || '', locale: p.locale || '', timezone: p.timezone || '', avatar_url: p.avatar_url || '' })
    }).catch(() => {})
  }, [token])
  const initials = (form.display_name || user?.firstName || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'
  const set = (k) => (e) => { setForm(f => ({ ...f, [k]: e.target.value })); setMsg(''); setErr('') }
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setMsg(''); setErr('')
    try {
      const r = await fetch('/api/me/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(form) })
      if (!r.ok) { setErr('Could not save.'); return } setMsg('Saved.')
    } catch { setErr('Network error.') } finally { setBusy(false) }
  }
  const pickAvatar = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { setErr('Please choose an image file.'); return }
    if (file.size > 5 * 1024 * 1024) { setErr('Image must be 5 MB or smaller.'); return }
    setAvatarBusy(true); setErr('')
    try {
      const fd = new FormData(); fd.append('avatar', file)
      const r = await fetch('/api/me/avatar', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d.message || 'Upload failed.'); return } setForm(f => ({ ...f, avatar_url: d.avatar_url }))
    } catch { setErr('Network error.') } finally { setAvatarBusy(false) }
  }
  const removeAvatar = async () => {
    setAvatarBusy(true); setErr('')
    try { await fetch('/api/me/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ avatar_url: '' }) }); setForm(f => ({ ...f, avatar_url: '' })) }
    catch { setErr('Network error.') } finally { setAvatarBusy(false) }
  }
  return (
    <>
      <PageHeader eyebrow="Personal" title="Profile" actions={<Btn variant="ghost" onClick={() => { logout(); navigate('/login') }}>Sign out</Btn>} />
      <Card>
        <div className="personal-profile-head">
          {form.avatar_url
            ? <img src={form.avatar_url} alt="Your avatar" style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border-default)' }} />
            : <div style={{ width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-navy)', color: '#fff', fontSize: 22, fontWeight: 700 }}>{initials}</div>}
          <div className="personal-profile-copy">
            <b>{form.display_name || user?.firstName || 'Personal member'}</b>
            <span>{user?.email || 'Email sign-in'}</span>
            <em>Free Plan</em>
          </div>
          <div className="personal-profile-actions">
            <label className="cfo-btn cfo-btn-ghost cfo-btn-sm" style={{ cursor: 'pointer' }}>
              {avatarBusy ? 'Uploading…' : 'Upload photo'}
              <input type="file" accept="image/*" onChange={pickAvatar} style={{ display: 'none' }} />
            </label>
            {form.avatar_url && !avatarBusy && <button type="button" onClick={removeAvatar} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 13, cursor: 'pointer', textAlign: 'left', padding: 0, fontFamily: 'inherit' }}>Remove photo</button>}
          </div>
        </div>
        <div className="personal-profile-metrics">
          <Stat k="Profile trust" v="98.4%" />
          <Stat k="Workspaces" v="Personal" />
        </div>
        <form onSubmit={save} className="cfo-form2">
          <Field label="Display name"><input className="cfo-input" value={form.display_name} onChange={set('display_name')} placeholder="Your name" /></Field>
          <Field label="Language"><select className="cfo-input" value={form.locale} onChange={set('locale')}><option value="">—</option>{LOCALES.map(l => <option key={l} value={l}>{l}</option>)}</select></Field>
          <Field label="Timezone"><input className="cfo-input" value={form.timezone} onChange={set('timezone')} list="ptz" placeholder="Asia/Jakarta" autoComplete="off" /><datalist id="ptz">{COMMON_TZ.map(z => <option key={z} value={z} />)}</datalist></Field>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
            <Btn type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</Btn>
            {msg && <span style={{ color: 'var(--success)', fontSize: 13 }}>{msg}</span>}
            {err && <span style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</span>}
          </div>
        </form>
      </Card>
      <Card title="Account management" className="cfo-mt">
        <DataList items={[
          { id: 'plan', icon: <Icon.card width="16" height="16" />, label: 'Subscription', sub: 'Free Plan · upgrade gates apply', amount: 'Manage →' },
          { id: 'categories', icon: <Icon.acct width="16" height="16" />, label: 'Categories', sub: 'Personal income, expenses, and reimbursable tags', amount: 'Open →' },
          { id: 'businesses', icon: <Icon.link width="16" height="16" />, label: 'Connected workspaces', sub: 'Personal and company finances stay separate', amount: 'Open →' },
          { id: 'notify', icon: <Icon.warn width="16" height="16" />, label: 'Notifications', sub: 'Coming soon', amount: 'Soon' },
        ]} />
      </Card>
      <Card title="Integrations" className="cfo-mt">
        <DataList items={[
          { id: 'telegram', icon: <Icon.link width="16" height="16" />, label: 'Telegram', sub: 'Locked on Free · available in CFO AI Lite', tag: 'locked' },
        ]} />
      </Card>
      <div className="personal-version">CFO AI · FINANCIAL OS · v3.0.0</div>
    </>
  )
}

// ── Shared form + modal primitives ───────────────────────────────────────────
function Field({ label, children }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>{children}</label>
}
function ModalFrame({ title, onClose, children }) {
  return (
    <div className="cfo-modal-scrim" onClick={onClose}>
      <div className="cfo-modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <h3 className="cfo-modal-title">{title}</h3>
        <div className="cfo-modal-body">{children}</div>
      </div>
    </div>
  )
}
function AccountModal({ pf, baseCur, wallet, onClose, onSaved }) {
  const editing = !!wallet
  const [form, setForm] = useState({ name: wallet?.name || '', type: wallet?.type || 'cash', currency: wallet?.currency || baseCur })
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      const path = editing ? `/wallets/${wallet.id}` : '/wallets'
      const method = editing ? 'PATCH' : 'POST'
      const body = editing ? { name: form.name } : { name: form.name, type: form.type, currency: form.currency }
      const r = await pf(path, { method, body })
      const d = await r.json().catch(() => ({})); if (!r.ok) { setErr(d.message || d.error || 'Could not save account.'); return } onSaved()
    } catch { setErr('Network error.') } finally { setBusy(false) }
  }
  return <ModalFrame title={editing ? 'Edit account' : 'Add account'} onClose={onClose}><form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <Field label="Account name"><input className="cfo-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Cash, BCA, Wise" autoFocus /></Field>
    <Field label="Type"><select className="cfo-input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} disabled={editing}>{WALLET_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
    <Field label="Currency"><select className="cfo-input" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} disabled={editing}>{CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select></Field>
    {editing && <div className="personal-small-note">Currency and type are locked after creation so old transactions stay correct.</div>}
    {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
    <div className="cfo-modal-actions">
      <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
      <Btn type="submit" disabled={busy}>{busy ? 'Saving…' : (editing ? 'Save account' : 'Add account')}</Btn>
    </div>
  </form></ModalFrame>
}
function AdjustBalanceModal({ pf, wallet, onClose, onSaved }) {
  const [target, setTarget] = useState(String(wallet?.balance ?? 0))
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    const next = Number(target)
    const current = Number(wallet?.balance || 0)
    const delta = next - current
    if (!Number.isFinite(next)) { setErr('Enter a valid balance.'); setBusy(false); return }
    if (delta === 0) { onClose(); return }
    try {
      const r = await pf('/transactions', { method: 'POST', body: {
        kind: delta > 0 ? 'income' : 'expense',
        amount: Math.abs(delta),
        wallet_id: wallet.id,
        category: 'Balance Correction',
        date,
        note: `Balance correction to ${money(next, wallet.currency)}`,
      } })
      const d = await r.json().catch(() => ({})); if (!r.ok) { setErr(d.message || d.error || 'Could not adjust balance.'); return } onSaved()
    } catch { setErr('Network error.') } finally { setBusy(false) }
  }
  return <ModalFrame title="Adjust balance" onClose={onClose}><form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div className="personal-small-note">This creates a personal Balance Correction transaction in {wallet.name}. It never touches company wallets.</div>
    <Field label={`New balance (${wallet.currency})`}><input className="cfo-input" type="number" step="any" value={target} onChange={e => setTarget(e.target.value)} autoFocus /></Field>
    <Field label="Date"><input className="cfo-input" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
    {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
    <div className="cfo-modal-actions"><Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn><Btn type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save adjustment'}</Btn></div>
  </form></ModalFrame>
}
function TxModal({ pf, wallets, cats, initialKind = 'expense', onClose, onSaved }) {
  const [kind, setKind] = useState(initialKind)
  const [form, setForm] = useState({ amount: '', wallet_id: wallets[0]?.id || '', to_wallet_id: '', category: '', date: new Date().toISOString().slice(0, 10), note: '' })
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const catList = kind === 'income' ? cats.income : [...cats.expense, ...(cats.business_related || [])]
  // Transfers are same-currency only in v1 (no silent 1:1 FX) — mirror the backend rule.
  const fromWallet = wallets.find(w => w.id === form.wallet_id)
  const sameCurrencyTargets = wallets.filter(w => w.id !== form.wallet_id && (w.currency || '').toUpperCase() === (fromWallet?.currency || '').toUpperCase())
  const canTransfer = wallets.length >= 2 && (kind !== 'transfer' || sameCurrencyTargets.length > 0)
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      const body = { kind, amount: Number(form.amount), wallet_id: form.wallet_id, date: form.date, note: form.note || undefined }
      if (kind === 'transfer') body.to_wallet_id = form.to_wallet_id; else body.category = form.category || undefined
      const r = await pf('/transactions', { method: 'POST', body })
      const d = await r.json().catch(() => ({})); if (!r.ok) { setErr(d.message || d.error || 'Could not add transaction.'); return } onSaved()
    } catch { setErr('Network error.') } finally { setBusy(false) }
  }
  const seg = (v, l) => <button type="button" onClick={() => setKind(v)} className={`cfo-tab${kind === v ? ' is-active' : ''}`} style={{ flex: 1 }}>{l}</button>
  return <ModalFrame title="Add transaction" onClose={onClose}><form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div className="cfo-tabs" role="tablist">{seg('expense', 'Expense')}{seg('income', 'Income')}{seg('transfer', 'Transfer')}</div>
    {kind === 'transfer' && wallets.length < 2 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Add a second account to transfer between accounts.</div>}
    {kind === 'transfer' && wallets.length >= 2 && sameCurrencyTargets.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Transfers work between accounts of the same currency ({fromWallet?.currency}). Multi-currency transfers are coming later.</div>}
    <Field label="Amount"><input className="cfo-input" type="number" min="0" step="any" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0" autoFocus /></Field>
    <Field label={kind === 'transfer' ? 'From account' : 'Account'}><select className="cfo-input" value={form.wallet_id} onChange={e => setForm({ ...form, wallet_id: e.target.value })}>{wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
    {kind === 'transfer'
      ? <Field label="To account"><select className="cfo-input" value={form.to_wallet_id} onChange={e => setForm({ ...form, to_wallet_id: e.target.value })}><option value="">—</option>{sameCurrencyTargets.map(w => <option key={w.id} value={w.id}>{w.name} · {w.currency}</option>)}</select></Field>
      : <Field label="Category"><select className="cfo-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}><option value="">—</option>{catList.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select></Field>}
    <Field label="Date"><input className="cfo-input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
    <Field label="Note"><input className="cfo-input" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Optional" /></Field>
    {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
    <div className="cfo-modal-actions"><Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn><Btn type="submit" disabled={busy || (kind === 'transfer' && !canTransfer)}>{busy ? 'Saving…' : 'Add transaction'}</Btn></div>
  </form></ModalFrame>
}
