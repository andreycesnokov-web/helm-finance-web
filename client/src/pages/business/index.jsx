// Live Business Workspace section (Phase 3, presentation-first). Renders the SAME
// real endpoints/data/KPIs (/api/pulse, /api/wallets) in the premium shell — NO change
// to Pulse formulas, wallet-balance logic, classification, access, ledger or contracts.
// Mounted at /business/* so the legacy /,/accounts routes stay untouched during migration.
import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../hooks/useAuth'
import { formatAmount } from '../../lib/money'
import { WorkspaceProvider, useWorkspace } from '../../shell/WorkspaceProvider'
import LiveShell from '../../shell/LiveShell'
import {
  PageHeader, SummaryCard, MoneyCard, Card, Stat, DataList, StatusBadge, Btn,
  EmptyState, ErrorState, LoadingSkeleton, ResponsiveTable, Icon,
} from '../../shell/ui'
import DebtPaymentModal from '../../components/DebtPaymentModal' // reused VERBATIM — Pay Now / Mark Received logic unchanged

const SYMBOL = '/brand/symbol_navy_blue_dot_transparent.svg'
const SYMBOL_WHITE = '/brand/symbol_white_transparent.svg'
const idr = (v) => 'Rp ' + formatAmount(String(v ?? 0), 'IDR')

function useScoped(path, deps = []) {
  const { token } = useAuth()
  const { scopeKey, active } = useWorkspace()
  const [s, setS] = useState({ loading: true, error: null, data: null })
  useEffect(() => {
    if (!token || !active) return
    let on = true; setS({ loading: true, error: null, data: null })
    apiFetch(path, token).then(d => on && setS({ loading: false, error: null, data: d }))
      .catch(e => on && setS({ loading: false, error: e.message || 'Request failed', data: null }))
    return () => { on = false }
  }, [path, token, scopeKey, active?.id, ...deps]) // eslint-disable-line
  return s
}

export function BusinessLayout() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return <WorkspaceProvider><Outlet /></WorkspaceProvider>
}

export function BusinessShell({ children }) {
  const { workspaces, active, loading, error, applyActive, refresh } = useWorkspace()
  useEffect(() => {
    if (!loading && active && active.type === 'personal' && workspaces.business?.[0]) applyActive(workspaces.business[0])
  }, [loading, active, workspaces, applyActive])
  if (loading && !active) return <div style={{ padding: 40 }}><LoadingSkeleton rows={4} /></div>
  if (error && !active) return <div style={{ padding: 40 }}><ErrorState title="Couldn’t load your workspaces" description={error} onRetry={refresh} /></div>
  if (!active) return null
  return <LiveShell>{children}</LiveShell>
}

// ── Business Pulse (premium presentation of /api/pulse — data unchanged) ──────
export function BusinessPulse() {
  const { active } = useWorkspace()
  const p = useScoped('/pulse')
  const head = (
    <PageHeader eyebrow="Business Workspace" title={active?.name || 'Business'}
      actions={<>
        <StatusBadge tone="shared" icon={<Icon.users />}>Shared business workspace</StatusBadge>
        {active?.role && <StatusBadge tone="neutral">Role: {active.role}</StatusBadge>}
        {active?.business_code && <StatusBadge tone="info">{active.business_code}</StatusBadge>}
      </>} />
  )
  if (p.loading) return <>{head}<PulseSkeleton /></>
  if (p.error) return <>{head}<ErrorState title="We couldn’t load Pulse" description={p.error} onRetry={() => location.reload()} /></>
  const d = p.data || {}
  const recent = (d.recentTxs || []).slice(0, 6).map(t => ({
    id: t.id, label: t.description || t.type, sub: `${(t.currency_original || 'IDR')} · ${(t.transaction_date || t.created_at || '').slice(0, 10)}`,
    dir: t.type === 'income' ? 'in' : ['expense', 'payroll'].includes(t.type) ? 'out' : 'neutral',
    amount: `${formatAmount(String(t.amount_original ?? t.amount_idr ?? 0), t.currency_original || 'IDR')} ${t.currency_original || 'IDR'}`,
    amountTone: t.type === 'income' ? 'cfo-pos' : ['expense', 'payroll'].includes(t.type) ? 'cfo-neg' : '',
  }))
  return (
    <>{head}
      <div style={{ marginBottom: 26 }}>
        <SummaryCard symbol={SYMBOL_WHITE} label="Total Cash · IDR" value={idr(d.totalBalance)}
          meta={<><span className="dot"><Icon.dot width="9" height="9" /></span> Runway {d.runway === 999 ? '—' : `${d.runway} days`} · burn {idr(d.burnRate)}/day</>}
          metrics={[
            { k: 'Revenue (this month)', v: '+ ' + idr(d.income), tone: 'pos' },
            { k: 'Operating expenses', v: '− ' + idr(d.expenses), tone: 'neg' },
            { k: 'Net position', v: idr(d.netPosition), tone: Number(d.netPosition) >= 0 ? 'pos' : 'neg' },
          ]} />
      </div>
      <div className="cfo-grid cfo-grid-4" style={{ marginBottom: 26 }}>
        <Card title="Receivables"><div className="cfo-stat-v cfo-mono" style={{ fontSize: 20 }}>{idr(d.receivables)}</div>{!!d.pendingReceivables && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>+{idr(d.pendingReceivables)} pending</div>}</Card>
        <Card title="Payables"><div className="cfo-stat-v cfo-mono" style={{ fontSize: 20 }}>{idr(d.payables)}</div>{!!d.pendingPayables && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>+{idr(d.pendingPayables)} pending</div>}</Card>
        <Card title="Burn rate"><div className="cfo-stat-v cfo-mono" style={{ fontSize: 20 }}>{idr(d.burnRate)}</div><div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>per day · {d.burnWindowDays || 30}d window</div></Card>
        <Card title="Runway"><div className="cfo-stat-v cfo-mono" style={{ fontSize: 20 }}>{d.runway === 999 ? '—' : `${d.runway} days`}</div><div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>at current burn</div></Card>
      </div>
      <div className="cfo-grid cfo-grid-2">
        <Card title="AI CFO summary" action={<StatusBadge tone="info"><Icon.cfo width="13" height="13" /> Live</StatusBadge>}>
          <div style={{ display: 'flex', gap: 12 }}>
            <span className="cfo-state-ic" style={{ background: 'var(--info-soft)', color: 'var(--brand-navy)', width: 40, height: 40, borderRadius: 11, flexShrink: 0 }}><Icon.cfo width="20" height="20" /></span>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{d.aiText || 'No urgent actions detected.'}</div>
          </div>
        </Card>
        <Card title="Recent activity">
          {recent.length === 0 ? <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>No recent transactions.</div> : <DataList items={recent} />}
        </Card>
      </div>
    </>
  )
}

// ── Business Accounts (premium presentation of /api/wallets — balances unchanged) ──
export function BusinessAccounts() {
  const w = useScoped('/wallets')
  const head = <PageHeader eyebrow="Business Workspace" title="Accounts" />
  if (w.loading) return <>{head}<div className="cfo-grid cfo-grid-4">{[0, 1, 2, 3].map(i => <div key={i} className="cfo-money"><LoadingSkeleton rows={3} /></div>)}</div></>
  if (w.error) return <>{head}<ErrorState description={w.error} onRetry={() => location.reload()} /></>
  const wallets = w.data?.wallets || []
  if (!wallets.length) return <>{head}<EmptyState symbol={SYMBOL} title="No accounts yet" description="Business accounts and balances will appear here." /></>
  return <>{head}
    <div className="cfo-grid cfo-grid-4">
      {wallets.map(x => (
        <MoneyCard key={x.id} asset={x.asset_code || x.currency || 'IDR'} kind={x.asset_type === 'crypto' ? 'Crypto' : 'Fiat'} sub={x.name} native={idr(x.balance)} />
      ))}
    </div>
  </>
}

function PulseSkeleton() {
  return <>
    <div className="cfo-card" style={{ marginBottom: 26, boxShadow: 'none' }}><LoadingSkeleton rows={3} height={18} width={(i) => ['180px', '320px', '240px'][i]} /></div>
    <div className="cfo-grid cfo-grid-4">{[0, 1, 2, 3].map(i => <div key={i} className="cfo-money"><LoadingSkeleton rows={3} /></div>)}</div>
  </>
}

const ccyOf = (t) => t.currency_original || 'IDR'

// ── Business Transactions (premium presentation of /api/transactions — read-only,
//    filters preserved; no CRUD/classification change) ─────────────────────────
export function BusinessTransactions() {
  const [period, setPeriod] = useState('month')
  const [type, setType] = useState('all')
  const q = type === 'all' ? `/transactions?period=${period}` : `/transactions?period=${period}&type=${type}`
  const tx = useScoped(q, [period, type])
  const head = <PageHeader eyebrow="Business Workspace" title="Transactions"
    actions={<>
      {['month', 'week', 'all'].map(p => <Btn key={p} variant={period === p ? 'secondary' : 'ghost'} sm onClick={() => setPeriod(p)}>{p === 'all' ? 'All time' : p === 'week' ? 'Week' : 'Month'}</Btn>)}
    </>} />
  const TYPES = ['all', 'income', 'expense', 'payroll', 'transfer']
  const filters = (
    <div className="cfo-tabs" role="tablist" style={{ marginBottom: 16 }}>
      {TYPES.map(ty => <button key={ty} className={`cfo-tab${type === ty ? ' is-active' : ''}`} onClick={() => setType(ty)} style={{ textTransform: 'capitalize' }}>{ty}</button>)}
    </div>
  )
  if (tx.loading) return <>{head}{filters}<Card><LoadingSkeleton rows={6} height={18} /></Card></>
  if (tx.error) return <>{head}{filters}<ErrorState description={tx.error} onRetry={() => location.reload()} /></>
  const rows = Array.isArray(tx.data) ? tx.data : []
  if (!rows.length) return <>{head}{filters}<EmptyState symbol={SYMBOL} title="No transactions" description="Transactions in this period will appear here." /></>
  const amtTone = (r) => r.type === 'income' ? 'cfo-pos' : ['expense', 'payroll'].includes(r.type) ? 'cfo-neg' : ''
  const sign = (r) => r.type === 'income' ? '+' : ['expense', 'payroll'].includes(r.type) ? '−' : ''
  return <>{head}{filters}
    {/* desktop table */}
    <Card className="cfo-rtable">
      <ResponsiveTable
        columns={[
          { key: 'date', label: 'Date', render: r => <span className="cfo-mono">{(r.transaction_date || r.created_at || '').slice(0, 10)}</span> },
          { key: 'description', label: 'Description', render: r => r.description || r.type },
          { key: 'type', label: 'Type', render: r => <StatusBadge tone="neutral">{r.type}</StatusBadge> },
          { key: 'doc', label: 'Doc', render: r => (r.document_id || r.has_documents) ? <Icon.doc width="15" height="15" /> : '' },
          { key: 'amount', label: 'Amount', num: true, render: r => <span className={amtTone(r)}>{formatAmount(String(r.amount_original ?? r.amount_idr ?? 0), ccyOf(r))} {ccyOf(r)}</span> },
        ]}
        rows={rows} rowKey={r => r.id} />
    </Card>
    {/* mobile cards */}
    <div className="cfo-mcards">
      {rows.map(r => (
        <div className="cfo-dcard" key={r.id}>
          <div className="cfo-dcard-top">
            <div className="cfo-dcard-name">{r.description || r.type}</div>
            <div className={`cfo-dcard-amt ${amtTone(r)}`}>{sign(r)}{formatAmount(String(r.amount_original ?? r.amount_idr ?? 0), ccyOf(r))} {ccyOf(r)}</div>
          </div>
          <div className="cfo-dcard-meta">
            <StatusBadge tone="neutral">{r.type}</StatusBadge>
            <span className="cfo-mono">{(r.transaction_date || r.created_at || '').slice(0, 10)}</span>
            {(r.source || r.wallet_name) && <span>{r.source || r.wallet_name}</span>}
            {(r.document_id || r.has_documents) && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon.doc width="13" height="13" /> doc</span>}
          </div>
        </div>
      ))}
    </div>
  </>
}

// ── Shared debts list (Payables / Receivables). Reuses /api/debts + DebtPaymentModal
//    so Pay Now / Mark Received / partial logic is UNCHANGED. ────────────────────
function DebtsView({ kind }) {
  const { token } = useAuth()
  const { active, scopeKey } = useWorkspace()
  const isPayable = kind === 'payable'
  const [data, setData] = useState({ loading: true, error: null, debts: null, wallets: [] })
  const [payDebt, setPayDebt] = useState(null)
  const reload = () => {
    if (!token || !active) return
    setData(d => ({ ...d, loading: true, error: null }))
    Promise.all([apiFetch('/debts', token), apiFetch('/wallets', token).catch(() => ({ wallets: [] }))])
      .then(([debts, w]) => setData({ loading: false, error: null, debts, wallets: w.wallets || [] }))
      .catch(e => setData({ loading: false, error: e.message || 'Request failed', debts: null, wallets: [] }))
  }
  useEffect(() => { let on = true; if (token && active) { setData(d => ({ ...d, loading: true })); Promise.all([apiFetch('/debts', token), apiFetch('/wallets', token).catch(() => ({ wallets: [] }))]).then(([debts, w]) => on && setData({ loading: false, error: null, debts, wallets: w.wallets || [] })).catch(e => on && setData({ loading: false, error: e.message, debts: null, wallets: [] })) } return () => { on = false } }, [token, active?.id, scopeKey]) // eslint-disable-line

  const title = isPayable ? 'Payables' : 'Receivables'
  const head = <PageHeader eyebrow="Business Workspace" title={title} />
  if (data.loading) return <>{head}<Card><LoadingSkeleton rows={5} height={18} /></Card></>
  if (data.error) return <>{head}<ErrorState description={data.error} onRetry={reload} /></>
  const debts = (data.debts || []).filter(d => d.type === kind && d.status !== 'cancelled')
  if (!debts.length) return <>{head}<EmptyState symbol={SYMBOL} title={isPayable ? 'No payables' : 'No receivables'} description={isPayable ? 'Bills you owe will appear here.' : 'Money owed to you will appear here.'} /></>

  const toneFor = (s) => s === 'paid' ? 'success' : s === 'overdue' ? 'danger' : s === 'partial' ? 'warning' : 'neutral'
  const total = debts.reduce((s, d) => s + Number(d.remaining_amount ?? d.amount ?? 0), 0)
  return <>{head}
    <div style={{ marginBottom: 16 }}>
      <Stat k={isPayable ? 'Total outstanding (you owe)' : 'Total outstanding (owed to you)'} v={idr(total)} />
    </div>
    {/* desktop table */}
    <Card className="cfo-rtable">
      <ResponsiveTable
        columns={[
          { key: 'cp', label: isPayable ? 'Payee' : 'Payer', render: d => d.counterparty || d.description || '—' },
          { key: 'due', label: 'Due', render: d => <span className="cfo-mono">{(d.due_date || '').slice(0, 10) || '—'}</span> },
          { key: 'status', label: 'Status', render: d => <StatusBadge tone={toneFor(d.status)}>{d.status}{d.days_overdue > 0 ? ` · ${d.days_overdue}d` : ''}</StatusBadge> },
          { key: 'progress', label: 'Paid', render: d => <span className="cfo-mono">{idr(d.paid_amount || 0)} / {idr(d.original_amount || d.amount)}</span> },
          { key: 'doc', label: 'Doc', render: d => (d.document_id || d.has_documents) ? <Icon.doc width="15" height="15" /> : '' },
          { key: 'amount', label: 'Remaining', num: true, render: d => <span className={isPayable ? 'cfo-neg' : 'cfo-pos'}>{isPayable ? '−' : '+'}{idr(d.remaining_amount ?? d.amount)}</span> },
          { key: 'act', label: '', render: d => d.status !== 'paid' ? <Btn sm variant="ghost" onClick={() => setPayDebt(d)}>{isPayable ? 'Pay Now' : (d.status === 'partial' ? 'More' : 'Mark received')}</Btn> : null },
        ]}
        rows={debts} rowKey={d => d.id} />
    </Card>
    {/* mobile cards */}
    <div className="cfo-mcards">
      {debts.map(d => (
        <div className="cfo-dcard" key={d.id}>
          <div className="cfo-dcard-top">
            <div className="cfo-dcard-name">{d.counterparty || d.description || '—'}</div>
            <div className={`cfo-dcard-amt ${isPayable ? 'neg' : 'pos'}`}>{isPayable ? '−' : '+'}{idr(d.remaining_amount ?? d.amount)}</div>
          </div>
          <div className="cfo-dcard-meta">
            <StatusBadge tone={toneFor(d.status)}>{d.status}{d.days_overdue > 0 ? ` · ${d.days_overdue}d` : ''}</StatusBadge>
            <span className="cfo-mono">Due {(d.due_date || '').slice(0, 10) || '—'}</span>
            <span className="cfo-mono">Paid {idr(d.paid_amount || 0)} / {idr(d.original_amount || d.amount)}</span>
            {(d.document_id || d.has_documents) && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon.doc width="13" height="13" /> doc</span>}
          </div>
          {d.status !== 'paid' && <div className="cfo-dcard-foot"><Btn sm onClick={() => setPayDebt(d)}>{isPayable ? 'Pay Now' : (d.status === 'partial' ? 'More' : 'Mark received')}</Btn></div>}
        </div>
      ))}
    </div>
    {payDebt && (
      <DebtPaymentModal debt={payDebt} accounts={data.wallets} token={token}
        onClose={() => setPayDebt(null)} onSuccess={() => { setPayDebt(null); reload() }} />
    )}
  </>
}

export function BusinessPayables() { return <DebtsView kind="payable" /> }
export function BusinessReceivables() { return <DebtsView kind="receivable" /> }

// ── Business Invoices — premium PLACEHOLDER (no invoice backend/table yet).
//    Shows real receivable/payable/overdue counts derived from /api/debts (NOT fake
//    invoice records) + routes to Receivables/Payables. No debt-logic change. ──────
export function BusinessInvoices() {
  const w = useScoped('/debts')
  const navigate = useNavigate()
  const head = <PageHeader eyebrow="Business Workspace" title="Invoices"
    actions={<StatusBadge tone="info">Coming next</StatusBadge>} />
  const debts = Array.isArray(w.data) ? w.data : []
  const recv = debts.filter(d => d.type === 'receivable' && d.status !== 'cancelled')
  const pay = debts.filter(d => d.type === 'payable' && d.status !== 'cancelled')
  const overdue = debts.filter(d => d.status === 'overdue')
  const cards = [
    { k: 'Receivable invoices', v: recv.length, sub: 'from Receivables', icon: <Icon.down /> },
    { k: 'Payable invoices', v: pay.length, sub: 'from Payables', icon: <Icon.up /> },
    { k: 'Overdue invoices', v: overdue.length, sub: 'past due date', icon: <Icon.warn /> },
    { k: 'Draft invoices', v: 0, sub: 'not yet issued', icon: <Icon.doc /> },
  ]
  return <>{head}
    <div style={{ marginBottom: 18, color: 'var(--text-secondary)', fontSize: 14 }}>
      Invoices module is coming next. Receivables and Payables are already available below.
    </div>
    <div className="cfo-grid cfo-grid-4" style={{ marginBottom: 18 }}>
      {cards.map(c => (
        <Card key={c.k} title={c.k}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="cfo-state-ic" style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface-card-muted)', color: 'var(--text-secondary)' }}>{c.icon}</span>
            <div><div className="cfo-stat-v cfo-mono" style={{ fontSize: 22 }}>{w.loading ? '—' : c.v}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.sub}</div></div>
          </div>
        </Card>
      ))}
    </div>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
      <Btn onClick={() => navigate('/business/receivables')}>View Receivables</Btn>
      <Btn variant="ghost" onClick={() => navigate('/business/payables')}>View Payables</Btn>
    </div>
    <Card title="Invoice views" action={<StatusBadge tone="neutral">Preview</StatusBadge>}>
      <div className="cfo-tabs" style={{ marginBottom: 0, opacity: .55, pointerEvents: 'none' }}>
        {['Cards', 'List', 'Kanban'].map((v, i) => <button key={v} className={`cfo-tab${i === 0 ? ' is-active' : ''}`} disabled>{v}</button>)}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>Cards / List / Kanban views arrive with the Invoices module. No invoice records are created yet.</div>
    </Card>
  </>
}

// ── Funding & Investors — premium placeholder (no backend calls; full module gated
//    until Personal/Funding is enabled). Renders inside WorkspaceShell. ───────────
export function BusinessFunding() {
  // Premium LOCKED page — no Personal/Funding backend calls, no migrations required.
  const cards = [
    { k: 'Owner funding', sub: 'founder advances & temporary funding', icon: <Icon.fund /> },
    { k: 'Shareholder loans', sub: 'repayable investor loans', icon: <Icon.down /> },
    { k: 'Capital contributions', sub: 'equity, not repayable', icon: <Icon.up /> },
    { k: 'Intercompany transfers', sub: 'between your businesses', icon: <Icon.link /> },
    { k: 'Repayments', sub: 'principal reductions & schedules', icon: <Icon.check /> },
    { k: 'FX quotes', sub: 'booked rates & conversions', icon: <Icon.list /> },
  ]
  return <>
    <PageHeader eyebrow="Business Workspace" title="Funding & Investors"
      actions={<StatusBadge tone="warning">Not enabled</StatusBadge>} />
    <div style={{ marginBottom: 18, color: 'var(--text-secondary)', fontSize: 14, maxWidth: 680 }}>
      Manage owner funding, shareholder loans, capital contributions and intercompany funding.
      <br /><br />
      This module is not enabled yet. Personal / Funding migrations are required before activation.
    </div>
    <div className="cfo-grid cfo-grid-4" style={{ marginBottom: 18 }}>
      {cards.map(c => (
        <Card key={c.k} title={c.k}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="cfo-state-ic" style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface-card-muted)', color: 'var(--text-secondary)' }}>{c.icon}</span>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.sub}</div>
          </div>
        </Card>
      ))}
    </div>
    <Btn disabled title="Requires Personal/Funding migrations">Enable after migration</Btn>
  </>
}

// ── Create a new Business — additional company for the same owner. Does not touch the
//    existing business. POST /api/businesses; caller becomes Owner; switches on success.
const BIZ_CURRENCIES = ['IDR', 'USD', 'EUR', 'SGD', 'MYR', 'AUD', 'GBP', 'JPY', 'CNY']
const BIZ_TYPES = [
  { v: 'operating', label: 'Operating company' },
  { v: 'holding', label: 'Holding company' },
  { v: 'project', label: 'Project / SPV' },
  { v: 'other', label: 'Other' },
]
export function BusinessNew() {
  const { token } = useAuth()
  const { applyActive, refresh } = useWorkspace()
  const navigate = useNavigate()
  const [f, setF] = useState({ name: '', base_currency: 'IDR', country: 'ID', timezone: 'Asia/Jakarta', business_type: 'operating' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }))

  const submit = async (e) => {
    e?.preventDefault?.()
    if (!f.name.trim()) { setErr('Business name is required.'); return }
    setBusy(true); setErr('')
    try {
      const { business } = await apiFetch('/businesses', token, { method: 'POST', body: f })
      applyActive({ id: business.id, name: business.name, type: 'business', role: 'owner' })
      refresh()
      navigate('/business/pulse')
    } catch (e2) {
      setErr(e2.message || 'Could not create the business.')
    } finally { setBusy(false) }
  }

  const inp = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-card)', color: 'var(--text-primary)', fontSize: 14 }
  const lbl = { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }

  return <>
    <PageHeader eyebrow="Business Workspace" title="Create new business"
      actions={<StatusBadge tone="info">Owner</StatusBadge>} />
    <form onSubmit={submit} style={{ maxWidth: 560 }}>
      <Card title="Company details">
        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <label style={lbl}>Business name *</label>
            <input style={inp} value={f.name} onChange={set('name')} placeholder="e.g. Helm Holdings" autoFocus />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>A business code is generated automatically.</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Base currency</label>
              <select style={inp} value={f.base_currency} onChange={set('base_currency')}>
                {BIZ_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Business type</label>
              <select style={inp} value={f.business_type} onChange={set('business_type')}>
                {BIZ_TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Country</label>
              <input style={inp} value={f.country} onChange={set('country')} placeholder="ID" />
            </div>
            <div>
              <label style={lbl}>Timezone</label>
              <input style={inp} value={f.timezone} onChange={set('timezone')} placeholder="Asia/Jakarta" />
            </div>
          </div>
          {err && <div style={{ color: 'var(--danger, #c0392b)', fontSize: 13 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create business'}</Btn>
            <Btn variant="ghost" type="button" onClick={() => navigate(-1)}>Cancel</Btn>
          </div>
        </div>
      </Card>
    </form>
  </>
}

// ── Holding / Intercompany Transfers — premium placeholder + implementation plan.
//    Intercompany transfers create MIRRORED records in two businesses and are NOT
//    automatically revenue/expense. Ledger logic is intentionally not shipped until
//    the schema is ready (see plan below). No backend calls here.
export function BusinessIntercompany() {
  const types = [
    { k: 'Intercompany loan', sub: 'A: receivable + cash-out · B: liability + cash-in' },
    { k: 'Capital contribution', sub: 'A: investment + cash-out · B: equity + cash-in' },
    { k: 'Owner funding', sub: 'founder advance routed between entities' },
    { k: 'Expense reimbursement', sub: 'one entity settles another’s cost' },
    { k: 'Management fee / recharge', sub: 'service recharge between entities' },
    { k: 'Other', sub: 'manually classified' },
  ]
  return <>
    <PageHeader eyebrow="Holding Workspace" title="Intercompany Transfers"
      actions={<StatusBadge tone="warning">Foundation</StatusBadge>} />
    <div style={{ marginBottom: 18, color: 'var(--text-secondary)', fontSize: 14, maxWidth: 720 }}>
      Move money between your own businesses with correct double-sided accounting. An
      intercompany transfer is <strong>not</strong> automatically revenue or expense — each
      type books a mirrored pair of records in both entities. Ledger posting is enabled once
      the intercompany schema is applied.
    </div>
    <div className="cfo-grid cfo-grid-3" style={{ marginBottom: 18 }}>
      {types.map(t => (
        <Card key={t.k} title={t.k}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.sub}</div>
        </Card>
      ))}
    </div>
    <Card title="Implementation plan">
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        <strong>DB:</strong> intercompany_transfers (id, type, from_business_id, to_business_id,
        amount, currency, fx_rate, booked_at, status, memo) + two mirrored ledger rows linked by
        transfer_id (additive migration; no change to existing tables).<br />
        <strong>API:</strong> POST /api/intercompany/transfers (owner/admin in BOTH entities),
        atomic RPC writing both sides in one transaction; GET list per business.<br />
        <strong>Accounting:</strong> loan → A receivable/cash-out, B liability/cash-in; capital →
        A investment/cash-out, B equity/cash-in; repayment reduces principal (not opex); never
        post a transfer as revenue.
      </div>
    </Card>
  </>
}
