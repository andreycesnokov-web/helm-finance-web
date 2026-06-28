// Personal Account v1 — FINAL Personal Workspace UI (per _specs/personal-account-final-
// structure.md). Same product shell as Business (WorkspaceShell + cfo-* primitives).
// Personal is primary; Business is secondary. Single /account route, in-shell sections:
//   PERSONAL: Overview · Wallets · Transactions · Categories · AI CFO Lite · Business Links · Profile
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
import { Icon, PageHeader, Card, SummaryCard, Stat, DataList, EmptyState, Btn, PageTabs } from '../shell/ui'

const SYMBOL = '/brand/symbol_navy_blue_dot_transparent.svg'
const WALLET_TYPES = [['cash', 'Cash'], ['bank', 'Bank account'], ['card', 'Card'], ['wise_paypal', 'Wise / Revolut / PayPal'], ['ewallet', 'E-wallet'], ['other', 'Other']]
const COMMON_TZ = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Singapore', 'Asia/Bangkok', 'Europe/Moscow', 'UTC']
const LOCALES = ['en', 'ru', 'id']

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
    { key: 'categories', label: 'Categories', icon: <Icon.doc /> },
    { key: 'cfo', label: 'AI CFO Lite', icon: <Icon.cfo /> },
    { key: 'businesses', label: 'Business Links', icon: <Icon.link /> },
    { key: 'profile', label: 'Profile', icon: <Icon.cog /> },
  ] },
]

function money(n, cur = 'IDR') {
  const v = Number(n || 0)
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(v) }
  catch { return `${cur} ${v.toLocaleString('en-US')}` }
}
const labelFor = (t) => (WALLET_TYPES.find(x => x[0] === t) || [, t])[1]
const isXfer = (tx) => typeof tx.source === 'string' && tx.source.startsWith('xfer:')

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
    personal: [{ id: 'personal', name: 'Personal Account', type: 'personal', role: 'owner', business_code: subline }],
    business: businesses,
  }
  const onSelectWorkspace = (w) => { if (w?.type !== 'personal') { try { setActiveBusinessId(w.id); localStorage.setItem('activeWorkspaceId', w.id) } catch { /* */ } navigate('/business/pulse') } }

  const txItems = (rows) => rows.map(tx => ({
    id: tx.id,
    dir: isXfer(tx) ? null : (tx.type === 'income' ? 'in' : 'out'),
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
  else if (section === 'overview') body = <Overview {...{ baseCur, hasWallet, wallets, t, insight, savingsRate, summary, txItems, recommendation, setModal, setSection, businesses, navigate, onSelectWorkspace }} />
  else if (section === 'wallets') body = <WalletsPage {...{ wallets, hasWallet, baseCur, setModal }} />
  else if (section === 'transactions') body = <TransactionsPage {...{ txs, txItems, hasWallet, setModal }} />
  else if (section === 'categories') body = <CategoriesPage />
  else if (section === 'cfo') body = <CfoPage {...{ baseCur, t, insight, enoughData, recommendation }} />
  else if (section === 'businesses') body = <BusinessLinks {...{ businesses, navigate, onSelect: onSelectWorkspace }} />
  else if (section === 'profile') body = <ProfileSection token={token} user={user} logout={logout} navigate={navigate} />

  return (
    <WorkspaceShell workspaces={shellWorkspaces} activeId="personal" onSelectWorkspace={onSelectWorkspace}
      nav={PERSONAL_NAV} activeKey={section} onNavigate={(it) => setSection(it.key)}>
      {body}
      {modal === 'wallet' && <AccountModal pf={pf} baseCur={baseCur} onClose={closeModal} onSaved={reload} />}
      {modal?.tx && <TxModal pf={pf} wallets={wallets} cats={cats} initialKind={modal.tx} onClose={closeModal} onSaved={reload} />}
    </WorkspaceShell>
  )
}

// ── Overview ─────────────────────────────────────────────────────────────────
function Overview({ baseCur, hasWallet, wallets, t, insight, savingsRate, summary, txItems, recommendation, setModal, setSection, businesses, navigate, onSelectWorkspace }) {
  return (
    <>
      <PageHeader eyebrow="Personal Workspace" title="Personal Account"
        actions={<><Btn variant="ghost" icon={<Icon.wallet width="16" height="16" />} onClick={() => setModal('wallet')}>Add account</Btn>
          <Btn icon={<Icon.plus width="16" height="16" />} onClick={() => setModal({ tx: 'expense' })} disabled={!hasWallet}>Add transaction</Btn></>} />
      <p style={{ margin: '-8px 0 18px', color: 'var(--text-muted)', fontSize: 14 }}>Personal cashflow and owner finances</p>

      {/* A. Personal Balance */}
      <SummaryCard symbol={SYMBOL} label="Total Personal Balance" value={money(t.balance, baseCur)}
        meta={<><Icon.dot className="dot" width="12" height="12" /> Safe to spend this month: <b style={{ fontWeight: 700 }}>{money(insight.safe_to_spend, baseCur)}</b></>}
        metrics={[
          { k: 'Monthly Income', v: money(t.income_mtd, baseCur), tone: 'pos' },
          { k: 'Monthly Expenses', v: money(t.expense_mtd, baseCur), tone: 'neg' },
          { k: 'Net Saved', v: money(t.net_saved, baseCur) },
        ]} />

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
          ? <DataList items={wallets.map(w => ({ id: w.id, label: w.name, sub: labelFor(w.type), amount: money(w.balance, w.currency) }))} />
          : <EmptyState title="Create your first personal account" description="Cash, bank, card, Wise/PayPal, e-wallet — track each balance." actions={<Btn onClick={() => setModal('wallet')}>+ Add account</Btn>} />}
      </Card>

      {/* E. Recent Transactions */}
      <Card title="Recent transactions" className="cfo-mt" action={<Btn variant="ghost" sm onClick={() => setSection('transactions')}>View all</Btn>}>
        {(summary?.recent || []).length
          ? <DataList items={txItems(summary.recent)} />
          : <EmptyState title="Your personal transactions will appear here" description="Add income, expenses, or transfers between your accounts." actions={<Btn onClick={() => setModal({ tx: 'expense' })} disabled={!hasWallet}>+ Add transaction</Btn>} />}
      </Card>

      {/* F. CFO AI Lite */}
      <Card title="AI CFO · Lite" className="cfo-mt">
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          {recommendation}{insight.vs_last_month_pct != null && ` (${insight.vs_last_month_pct > 0 ? '+' : ''}${insight.vs_last_month_pct}% vs last month)`}
        </p>
      </Card>

      {/* G. Business Connections (secondary) */}
      <BusinessLinks businesses={businesses} navigate={navigate} onSelect={onSelectWorkspace} compact />
    </>
  )
}
// ── Wallets page ─────────────────────────────────────────────────────────────
function WalletsPage({ wallets, hasWallet, baseCur, setModal }) {
  return (
    <>
      <PageHeader eyebrow="Personal" title="Wallets" actions={<Btn icon={<Icon.plus width="16" height="16" />} onClick={() => setModal('wallet')}>Add account</Btn>} />
      <Card>
        {hasWallet
          ? <DataList items={wallets.map(w => ({ id: w.id, label: w.name, sub: labelFor(w.type) + ' · ' + w.currency, amount: money(w.balance, w.currency) }))} />
          : <EmptyState symbol={SYMBOL} title="Create your first personal account" description="Cash, bank, card, Wise/Revolut/PayPal, e-wallet. Crypto comes later." actions={<Btn onClick={() => setModal('wallet')}>+ Add account</Btn>} />}
      </Card>
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
          : rows.length ? <DataList items={txItems(rows)} /> : <EmptyState title="No matching transactions" description="Try a different filter or search." />}
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
        Human categories used when you add a transaction. Business-related personal categories
        tag your personal records only — they do not create business records.
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

// ── AI CFO Lite page ─────────────────────────────────────────────────────────
function CfoPage({ baseCur, t, insight, enoughData, recommendation }) {
  if (!enoughData) return (
    <>
      <PageHeader eyebrow="Personal" title="AI CFO · Lite" />
      <EmptyState symbol={SYMBOL} title="Not enough data yet" description="Add 5–10 transactions and your personal insights — spending trend, safe-to-spend, and top categories — will appear here." />
    </>
  )
  return (
    <>
      <PageHeader eyebrow="Personal" title="AI CFO · Lite" />
      <Card title="This month">
        <div className="cfo-grid cfo-grid-3">
          <Stat k="Income" v={money(t.income_mtd, baseCur)} tone="pos" />
          <Stat k="Expenses" v={money(t.expense_mtd, baseCur)} tone="neg" />
          <Stat k="Net saved" v={money(t.net_saved, baseCur)} />
        </div>
        <p style={{ marginTop: 16, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          {recommendation}{insight.vs_last_month_pct != null && ` (${insight.vs_last_month_pct > 0 ? '+' : ''}${insight.vs_last_month_pct}% vs last month)`}
          {' '}Safe to spend: <b>{money(insight.safe_to_spend, baseCur)}</b>.
        </p>
      </Card>
      {Array.isArray(insight.top_categories) && insight.top_categories.length > 0 && (
        <Card title="Top spending categories" className="cfo-mt">
          <DataList items={insight.top_categories.map((c, i) => ({ id: i, label: c.name, amount: money(c.amount, baseCur) }))} />
        </Card>
      )}
    </>
  )
}

// ── Business Links (secondary) ───────────────────────────────────────────────
function BusinessLinks({ businesses, navigate, onSelect, compact }) {
  return (
    <>
      {!compact && <PageHeader eyebrow="Personal" title="Business Links" />}
      <Card title="Business workspaces" className={compact ? 'cfo-mt' : ''}
        action={<Btn variant="ghost" sm onClick={() => navigate('/business/new')}>+ Create business</Btn>}>
        {businesses.length === 0 ? (
          <EmptyState title="No business workspaces yet"
            description="Business workspaces are optional. Create one to invite a team, or open an invite link from your email to join one."
            actions={<><Btn onClick={() => navigate('/business/new')}>Create business</Btn>
              <Btn variant="ghost" onClick={() => navigate('/business/new')}>Join by invite</Btn></>} />
        ) : (
          <DataList items={businesses.map(b => ({ id: b.id, label: b.name, sub: `${b.business_code ? b.business_code + ' · ' : ''}${b.role || ''}`, amount: 'Open →' }))} />
        )}
        {!compact && businesses.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {businesses.map(b => <Btn key={b.id} variant="ghost" onClick={() => onSelect(b)}>{`Open ${b.name}`}</Btn>)}
          </div>
        )}
      </Card>
      {!compact && (
        <Card title="Funding & bridge" className="cfo-mt">
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55 }}>
            Fund a business, owner loan, equity contribution and reimbursement — <b>coming later</b>.
            These will move personal money into a business only through an explicit bridge.
          </p>
        </Card>
      )}
    </>
  )
}

// ── Profile (avatar upload + identity) ───────────────────────────────────────
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          {form.avatar_url
            ? <img src={form.avatar_url} alt="Your avatar" style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border-default)' }} />
            : <div style={{ width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand-navy)', color: '#fff', fontSize: 22, fontWeight: 700 }}>{initials}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label className="cfo-btn cfo-btn-ghost cfo-btn-sm" style={{ cursor: 'pointer' }}>
              {avatarBusy ? 'Uploading…' : 'Upload photo'}
              <input type="file" accept="image/*" onChange={pickAvatar} style={{ display: 'none' }} />
            </label>
            {form.avatar_url && !avatarBusy && <button type="button" onClick={removeAvatar} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 13, cursor: 'pointer', textAlign: 'left', padding: 0, fontFamily: 'inherit' }}>Remove photo</button>}
          </div>
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
        {user?.id != null && <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-muted)' }}>Account type: Personal · {user?.email || `id ${user.id}`}</div>}
      </Card>
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
function AccountModal({ pf, baseCur, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', type: 'cash', currency: baseCur })
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      const r = await pf('/wallets', { method: 'POST', body: { name: form.name, type: form.type, currency: form.currency } })
      const d = await r.json().catch(() => ({})); if (!r.ok) { setErr(d.message || d.error || 'Could not add account.'); return } onSaved()
    } catch { setErr('Network error.') } finally { setBusy(false) }
  }
  return <ModalFrame title="Add account" onClose={onClose}><form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <Field label="Account name"><input className="cfo-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Cash, BCA, Wise" autoFocus /></Field>
    <Field label="Type"><select className="cfo-input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>{WALLET_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
    <Field label="Currency"><input className="cfo-input" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value.toUpperCase() })} maxLength={5} /></Field>
    {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
    <div className="cfo-modal-actions"><Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn><Btn type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add account'}</Btn></div>
  </form></ModalFrame>
}
function TxModal({ pf, wallets, cats, initialKind = 'expense', onClose, onSaved }) {
  const [kind, setKind] = useState(initialKind)
  const [form, setForm] = useState({ amount: '', wallet_id: wallets[0]?.id || '', to_wallet_id: '', category: '', date: new Date().toISOString().slice(0, 10), note: '' })
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const catList = kind === 'income' ? cats.income : [...cats.expense, ...(cats.business_related || [])]
  const canTransfer = wallets.length >= 2
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
    {kind === 'transfer' && !canTransfer && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Add a second account to transfer between accounts.</div>}
    <Field label="Amount"><input className="cfo-input" type="number" min="0" step="any" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0" autoFocus /></Field>
    <Field label={kind === 'transfer' ? 'From account' : 'Account'}><select className="cfo-input" value={form.wallet_id} onChange={e => setForm({ ...form, wallet_id: e.target.value })}>{wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
    {kind === 'transfer'
      ? <Field label="To account"><select className="cfo-input" value={form.to_wallet_id} onChange={e => setForm({ ...form, to_wallet_id: e.target.value })}><option value="">—</option>{wallets.filter(w => w.id !== form.wallet_id).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
      : <Field label="Category"><select className="cfo-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}><option value="">—</option>{catList.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select></Field>}
    <Field label="Date"><input className="cfo-input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
    <Field label="Note"><input className="cfo-input" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Optional" /></Field>
    {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
    <div className="cfo-modal-actions"><Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn><Btn type="submit" disabled={busy || (kind === 'transfer' && !canTransfer)}>{busy ? 'Saving…' : 'Add transaction'}</Btn></div>
  </form></ModalFrame>
}
