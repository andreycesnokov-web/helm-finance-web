// Live Business Workspace section (Phase 3, presentation-first). Renders the SAME
// real endpoints/data/KPIs (/api/pulse, /api/wallets) in the premium shell — NO change
// to Pulse formulas, wallet-balance logic, classification, access, ledger or contracts.
// Mounted at /business/* so the legacy /,/accounts routes stay untouched during migration.
import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import { useState, useEffect, useCallback } from 'react'
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
import DebtFormModal from '../../components/DebtFormModal'       // create payable/receivable (business-scope locked)
import { upcomingDeadlines } from './AccountantPremium'          // static statutory schedule (premium P1)

const SYMBOL = '/brand/symbol_navy_blue_dot_transparent.svg'
const SYMBOL_WHITE = '/brand/symbol_white_transparent.svg'
const idr = (v) => 'Rp ' + formatAmount(String(v ?? 0), 'IDR')

// Premium P1 additions (Radar strip, Decision Engine, Compliance snapshot, Accounts
// hero/share%). Flag OFF ⇒ pages render byte-identically to today.
const BUSINESS_PREMIUM = import.meta.env.VITE_BUSINESS_PREMIUM_UI === 'true'

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
  const navigate = useNavigate()
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
  const emptyBusiness = Number(d.totalBalance || 0) === 0
    && Number(d.income || 0) === 0
    && Number(d.expenses || 0) === 0
    && Number(d.receivables || 0) === 0
    && Number(d.payables || 0) === 0
    && !(d.recentTxs || []).length
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
      {BUSINESS_PREMIUM && <RadarStrip d={d} navigate={navigate} />}
      <div className="cfo-grid cfo-grid-4" style={{ marginBottom: 26 }}>
        <Card title="Receivables"><div className="cfo-stat-v cfo-mono" style={{ fontSize: 20 }}>{idr(d.receivables)}</div>{!!d.pendingReceivables && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>+{idr(d.pendingReceivables)} pending</div>}</Card>
        <Card title="Payables"><div className="cfo-stat-v cfo-mono" style={{ fontSize: 20 }}>{idr(d.payables)}</div>{!!d.pendingPayables && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>+{idr(d.pendingPayables)} pending</div>}</Card>
        <Card title="Burn rate"><div className="cfo-stat-v cfo-mono" style={{ fontSize: 20 }}>{idr(d.burnRate)}</div><div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>per day · {d.burnWindowDays || 30}d window</div></Card>
        <Card title="Runway"><div className="cfo-stat-v cfo-mono" style={{ fontSize: 20 }}>{d.runway === 999 ? '—' : `${d.runway} days`}</div><div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>at current burn</div></Card>
      </div>
      {emptyBusiness && <BusinessStarterActions navigate={navigate} />}
      {BUSINESS_PREMIUM && (
        <div className="cfo-grid cfo-grid-2" style={{ marginBottom: 26 }}>
          <DecisionEngineCard d={d} />
          <ComplianceSnapshotCard navigate={navigate} />
        </div>
      )}
      <div className="cfo-grid cfo-grid-2">
        <Card title="AI CFO summary" action={<span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <StatusBadge tone="info"><Icon.cfo width="13" height="13" /> Live</StatusBadge>
          {BUSINESS_PREMIUM && <Btn sm variant="ghost" onClick={() => navigate('/business/ai-cfo')}>Ask AI CFO</Btn>}
        </span>}>
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

// ── Premium P1: Radar strip — REAL signals only (pulse data + statutory calendar) ──
function RadarStrip({ d, navigate }) {
  const chips = []
  const pendingAmt = Number(d.pendingPayables || 0) + Number(d.pendingReceivables || 0)
  if (pendingAmt > 0) chips.push({ tone: 'warning', icon: <Icon.warn width="13" height="13" />, text: `Pending approvals · ${idr(pendingAmt)}`, go: '/business/approvals' })
  if (d.runway !== 999 && d.runway != null) {
    const r = Number(d.runway)
    chips.push(r < 30
      ? { tone: 'danger', icon: <Icon.warn width="13" height="13" />, text: `Low runway · ${r} days` }
      : r < 60
        ? { tone: 'warning', icon: <Icon.warn width="13" height="13" />, text: `Runway · ${r} days` }
        : { tone: 'success', icon: <Icon.check width="13" height="13" />, text: `Runway healthy · ${r} days` })
  }
  const next = upcomingDeadlines(1)[0]
  if (next) chips.push({ tone: 'info', icon: <Icon.doc width="13" height="13" />, text: `Next tax: ${next.title} · ${next.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`, go: '/business/accountant' })
  if (!chips.length) return null
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18, alignItems: 'center' }}>
      <span style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-muted)' }}>Alerts</span>
      {chips.map((c, i) => (
        <span key={i} onClick={c.go ? () => navigate(c.go) : undefined} style={c.go ? { cursor: 'pointer' } : undefined}>
          <StatusBadge tone={c.tone}>{c.icon} {c.text}</StatusBadge>
        </span>
      ))}
    </div>
  )
}

// ── Premium P1: Decision Engine — honest CLIENT-SIDE projection from live pulse
//    numbers (cash, burn). No AI, no backend: newRunway = (cash − X) / burn. ─────
function DecisionEngineCard({ d }) {
  const [amount, setAmount] = useState('')
  const cash = Number(d.totalBalance || 0)
  const burn = Number(d.burnRate || 0)
  const x = Number(amount)
  const valid = Number.isFinite(x) && x > 0
  const current = burn > 0 ? Math.floor(cash / burn) : null
  const projected = valid && burn > 0 ? Math.max(0, Math.floor((cash - x) / burn)) : null
  return (
    <Card title="Decision engine" action={<StatusBadge tone="info">Projection</StatusBadge>}>
      <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 10 }}>What happens to runway if I pay this today?</div>
      <input className="cfo-input" type="number" min="0" step="any" placeholder="Amount (IDR)" value={amount} onChange={e => setAmount(e.target.value)} />
      {valid && (burn > 0 ? (
        <div style={{ marginTop: 12, display: 'flex', gap: 22 }}>
          <Stat k="Runway now" v={current === null ? '—' : `${current} days`} />
          <Stat k="After payment" v={`${projected} days`} tone={projected < 30 ? 'neg' : undefined} />
          <Stat k="Change" v={`−${current - projected} days`} tone="neg" />
        </div>
      ) : (
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>No burn detected yet — runway is not limited by spending.</div>
      ))}
      <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--text-muted)' }}>Deterministic projection from your live cash & burn — not financial advice.</div>
    </Card>
  )
}

// ── Premium P1: Compliance snapshot — statutory deadlines + link to the module ──
function ComplianceSnapshotCard({ navigate }) {
  const next = upcomingDeadlines(2)
  return (
    <Card title="Tax & compliance" action={<Btn sm variant="ghost" onClick={() => navigate('/business/accountant')}>Open AI Accountant</Btn>}>
      {next.length === 0
        ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No statutory deadlines in the next weeks.</div>
        : <DataList items={next.map(x => ({ id: x.key + x.date.toISOString(), label: x.title, sub: x.sub, amount: x.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }), amountTone: '' }))} />}
      <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-muted)' }}>Statutory schedule — amounts arrive with the tax engine.</div>
    </Card>
  )
}

function BusinessStarterActions({ navigate }) {
  const actions = [
    ['Add business wallet', '/business/accounts'],
    ['Add transaction', '/business/transactions'],
    ['Invite team', '/business/team'],
    ['Upload document', '/business/documents'],
    ['Ask AI CFO', '/business/ai-cfo'],
  ]
  return (
    <Card title="Start your company workspace" className="cfo-mt">
      <p style={{ margin: '0 0 14px', color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
        This company workspace is separate from your personal wallets. Add business data here when you are ready.
      </p>
      <div className="cfo-grid cfo-grid-3" style={{ gap: 10 }}>
        {actions.map(([label, path]) => <Btn key={path} variant="ghost" onClick={() => navigate(path)}>{label}</Btn>)}
      </div>
    </Card>
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

  // Premium P1: navy hero total + per-wallet share bars. Same MoneyCard rule as ever:
  // NEVER sum across currencies — the hero totals IDR wallets only; other currencies
  // stay native in their own cards.
  if (BUSINESS_PREMIUM) {
    const idrWallets = wallets.filter(x => (x.currency || 'IDR').toUpperCase() === 'IDR')
    const otherWallets = wallets.filter(x => (x.currency || 'IDR').toUpperCase() !== 'IDR')
    const total = idrWallets.reduce((s, x) => s + Number(x.balance || 0), 0)
    return <>{head}
      <div style={{ marginBottom: 22 }}>
        <SummaryCard symbol={SYMBOL_WHITE} label={otherWallets.length ? 'Total balance · IDR wallets' : 'Total balance · all wallets'}
          value={idr(total)}
          meta={<>{idrWallets.length} active wallet{idrWallets.length === 1 ? '' : 's'}{otherWallets.length ? ` · ${otherWallets.length} in other currencies (kept separate)` : ''}</>} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: otherWallets.length ? 22 : 0 }}>
        {idrWallets.map(x => {
          const share = total > 0 ? Math.round((Number(x.balance || 0) / total) * 100) : 0
          return (
            <Card key={x.id}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{x.name}</span>
                <span className="cfo-mono" style={{ fontWeight: 800, fontSize: 14 }}>{idr(x.balance)} <span style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: 11.5 }}>· {share}%</span></span>
              </div>
              <div style={{ height: 6, borderRadius: 4, background: 'var(--surface-page)', marginTop: 9 }}>
                <div style={{ height: 6, width: `${share}%`, borderRadius: 4, background: 'var(--brand-electric-blue)' }} />
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>{x.asset_type === 'crypto' ? 'Crypto' : 'Fiat'} · {(x.currency || 'IDR').toUpperCase()}</div>
            </Card>
          )
        })}
      </div>
      {otherWallets.length > 0 && (
        <div className="cfo-grid cfo-grid-4">
          {otherWallets.map(x => (
            <MoneyCard key={x.id} asset={x.asset_code || x.currency || 'IDR'} kind={x.asset_type === 'crypto' ? 'Crypto' : 'Fiat'} sub={x.name} native={formatAmount(String(x.balance ?? 0), x.currency || 'IDR') + ' ' + (x.currency || 'IDR')} />
          ))}
        </div>
      )}
    </>
  }

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
  const [showCreate, setShowCreate] = useState(false)
  const reload = () => {
    if (!token || !active) return
    setData(d => ({ ...d, loading: true, error: null }))
    Promise.all([apiFetch('/debts', token), apiFetch('/wallets', token).catch(() => ({ wallets: [] }))])
      .then(([debts, w]) => setData({ loading: false, error: null, debts, wallets: w.wallets || [] }))
      .catch(e => setData({ loading: false, error: e.message || 'Request failed', debts: null, wallets: [] }))
  }
  useEffect(() => { let on = true; if (token && active) { setData(d => ({ ...d, loading: true })); Promise.all([apiFetch('/debts', token), apiFetch('/wallets', token).catch(() => ({ wallets: [] }))]).then(([debts, w]) => on && setData({ loading: false, error: null, debts, wallets: w.wallets || [] })).catch(e => on && setData({ loading: false, error: e.message, debts: null, wallets: [] })) } return () => { on = false } }, [token, active?.id, scopeKey]) // eslint-disable-line

  const title = isPayable ? 'Payables' : 'Receivables'
  const newLabel = isPayable ? '+ New payable' : '+ New receivable'
  const newBtn = <Btn onClick={() => setShowCreate(true)}>{newLabel}</Btn>
  // Create modal is business-scope LOCKED — every payable/receivable created here
  // belongs to the active business (apiFetch carries x-business-id); refetch on success.
  const createModal = showCreate && (
    <DebtFormModal mode={kind} token={token} lockBusinessScope
      onClose={() => setShowCreate(false)} onSuccess={() => { setShowCreate(false); reload() }} />
  )
  const head = <PageHeader eyebrow="Business Workspace" title={title} actions={newBtn} />
  if (data.loading) return <>{head}<Card><LoadingSkeleton rows={5} height={18} /></Card></>
  if (data.error) return <>{head}<ErrorState description={data.error} onRetry={reload} /></>
  const debts = (data.debts || []).filter(d => d.type === kind && d.status !== 'cancelled')
  if (!debts.length) return <>{head}
    <EmptyState symbol={SYMBOL} title={isPayable ? 'No payables' : 'No receivables'}
      description={isPayable ? 'Bills you owe will appear here.' : 'Money owed to you will appear here.'} />
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>{newBtn}</div>
    {createModal}
  </>

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
    {createModal}
  </>
}

export function BusinessPayables() { return <DebtsView kind="payable" /> }
export function BusinessReceivables() { return <DebtsView kind="receivable" /> }

// ── Payment Connections — provider routing config (migration 051) ────────────
//    Records WHICH provider a business receives money through and where it should be
//    routed for accounting. No credential field exists on this page, because the API
//    accepts none: a request carrying one is refused, not stored. Nothing here syncs,
//    calls a provider, creates an incoming payment, or touches the ledger.
const PC_PROVIDERS = [
  { id: 'midtrans', label: 'Midtrans' }, { id: 'xendit', label: 'Xendit' },
  { id: 'doku', label: 'DOKU' }, { id: 'hitpay', label: 'HitPay' },
  { id: 'duitku', label: 'Duitku' }, { id: 'ipaymu', label: 'iPaymu' },
  { id: 'manual', label: 'Manual' }, { id: 'bank', label: 'Bank' },
]
const PC_STATUS_TONE = { connected: 'success', error: 'danger', disabled: 'neutral', disconnected: 'info' }

function PaymentConnectionModal({ token, wallets, onClose, onSuccess }) {
  const [f, setF] = useState({ provider: 'midtrans', environment: 'sandbox', display_name: '',
                               provider_account_id: '', linked_wallet_id: '', status: 'disconnected' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }))

  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      await apiFetch('/payment-connections', token, { method: 'POST', body: {
        provider: f.provider,
        environment: f.environment,
        status: f.status,
        display_name: f.display_name || null,
        provider_account_id: f.provider_account_id || null,
        linked_wallet_id: f.linked_wallet_id || null,
      } })
      onSuccess()
    } catch (e) { setErr(e.message || 'Could not save the connection') }
    finally { setBusy(false) }
  }

  const field = { width: '100%', padding: '9px 11px', borderRadius: 9, fontSize: 14,
                  border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)' }
  const label = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 }

  return (
    <div className="cfo-modal-scrim" onClick={onClose}>
      <div className="cfo-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 800 }}>Add payment connection</h3>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
          Credentials and webhooks are not enabled yet. This connection only prepares
          accounting routing — no keys are requested and none are stored.
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <div><span style={label}>Provider</span>
            <select style={field} value={f.provider} onChange={set('provider')}>
              {PC_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select></div>

          <div><span style={label}>Environment</span>
            <select style={field} value={f.environment} onChange={set('environment')}>
              <option value="sandbox">Sandbox</option>
              <option value="production">Production</option>
            </select></div>

          <div><span style={label}>Display name</span>
            <input style={field} value={f.display_name} onChange={set('display_name')}
              placeholder="e.g. Midtrans — main account" /></div>

          <div><span style={label}>Provider account ID</span>
            <input style={field} value={f.provider_account_id} onChange={set('provider_account_id')}
              placeholder="Public merchant / account id" />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Public identifier only. Never paste a secret or API key here.
            </div></div>

          <div><span style={label}>Linked wallet</span>
            <select style={field} value={f.linked_wallet_id} onChange={set('linked_wallet_id')}>
              <option value="">— none —</option>
              {wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></div>

          <div><span style={label}>Status</span>
            <select style={field} value={f.status} onChange={set('status')}>
              <option value="disconnected">Disconnected</option>
              <option value="connected">Connected</option>
              <option value="disabled">Disabled</option>
            </select></div>
        </div>

        {err && <div style={{ marginTop: 12, fontSize: 13, color: 'var(--danger, #B91C1C)' }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Add connection'}</Btn>
        </div>
      </div>
    </div>
  )
}

export function BusinessPaymentConnections() {
  const { token } = useAuth()
  const { active, scopeKey } = useWorkspace()
  const [s, setS] = useState({ loading: true, error: null, connections: [], wallets: [] })
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(() => {
    if (!token || !active) return
    setS(x => ({ ...x, loading: true, error: null }))
    Promise.all([
      apiFetch('/payment-connections', token),
      apiFetch('/wallets', token).catch(() => ({ wallets: [] })),
    ])
      .then(([c, w]) => setS({ loading: false, error: null, connections: c.connections || [], wallets: w.wallets || [] }))
      .catch(e => setS({ loading: false, error: e.message || 'Request failed', connections: [], wallets: [] }))
  }, [token, active?.id, scopeKey])
  useEffect(load, [token, active?.id, scopeKey]) // eslint-disable-line

  const addBtn = <Btn onClick={() => setShowAdd(true)}>+ Add connection</Btn>
  const head = <PageHeader eyebrow="Business Workspace" title="Payment Connections" actions={addBtn} />
  const modal = showAdd && (
    <PaymentConnectionModal token={token} wallets={s.wallets}
      onClose={() => setShowAdd(false)} onSuccess={() => { setShowAdd(false); load() }} />
  )

  if (s.loading) return <>{head}<Card><LoadingSkeleton rows={4} height={18} /></Card></>

  // With the backend flag off every route 404s before touching the database, so a
  // "not found" means the feature is disabled here — not a fault.
  if (s.error) {
    const disabled = /not_found|404/i.test(s.error)
    return <>{head}{disabled
      ? <EmptyState symbol={SYMBOL} title="Payment Connections is not enabled"
          description="Provider connections are not turned on for this deployment yet." />
      : <ErrorState title="We couldn’t load payment connections" description={s.error} onRetry={load} />}</>
  }

  const note = (
    <div style={{ marginBottom: 18, padding: '11px 14px', borderRadius: 10,
      background: 'var(--info-soft, #EFF6FF)', color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }}>
      <b>Credentials and webhooks are not enabled yet.</b> This connection only prepares
      accounting routing — it stores no API keys, calls no provider, and creates no payments
      or ledger entries on its own.
    </div>
  )

  const walletName = (id) => s.wallets.find(w => w.id === id)?.name || '—'
  const providerLabel = (id) => PC_PROVIDERS.find(p => p.id === id)?.label || id

  if (!s.connections.length) return <>{head}{note}
    <EmptyState symbol={SYMBOL} title="No payment connections yet"
      description="Connect Midtrans, Xendit, DOKU, HitPay, Duitku, iPaymu, a bank, or manual entry to prepare where incoming money is routed." />
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>{addBtn}</div>
    {modal}
  </>

  return <>{head}{note}
    <Card className="cfo-rtable">
      <ResponsiveTable
        columns={[
          { key: 'provider', label: 'Provider', render: r => <b>{providerLabel(r.provider)}</b> },
          { key: 'display_name', label: 'Name', render: r => r.display_name || <span style={{ color: 'var(--text-muted)' }}>—</span> },
          { key: 'environment', label: 'Environment', render: r => <StatusBadge tone={r.environment === 'production' ? 'warning' : 'neutral'}>{r.environment}</StatusBadge> },
          { key: 'status', label: 'Status', render: r => <StatusBadge tone={PC_STATUS_TONE[r.status] || 'neutral'}>{r.status}</StatusBadge> },
          { key: 'provider_account_id', label: 'Account ID', render: r => <span className="cfo-mono">{r.provider_account_id || '—'}</span> },
          { key: 'linked_wallet_id', label: 'Linked wallet', render: r => walletName(r.linked_wallet_id) },
          { key: 'last_sync_at', label: 'Last sync', render: r => <span className="cfo-mono">{r.last_sync_at ? String(r.last_sync_at).slice(0, 10) : '—'}</span> },
        ]}
        rows={s.connections} rowKey={r => r.id} />
    </Card>

    <div className="cfo-mcards">
      {s.connections.map(r => (
        <div className="cfo-dcard" key={r.id}>
          <div className="cfo-dcard-top">
            <div className="cfo-dcard-name">{providerLabel(r.provider)}{r.display_name ? ` · ${r.display_name}` : ''}</div>
            <StatusBadge tone={PC_STATUS_TONE[r.status] || 'neutral'}>{r.status}</StatusBadge>
          </div>
          <div className="cfo-dcard-meta">
            <StatusBadge tone={r.environment === 'production' ? 'warning' : 'neutral'}>{r.environment}</StatusBadge>
            {r.provider_account_id && <span className="cfo-mono">{r.provider_account_id}</span>}
            {r.linked_wallet_id && <span>{walletName(r.linked_wallet_id)}</span>}
          </div>
        </div>
      ))}
    </div>
    {modal}
  </>
}

// ── Incoming Payments — READ-ONLY view of /api/incoming-payments ─────────────
//    Money that arrived (gateway settlements, bank statement credits, manual entry)
//    staged as accounting EVIDENCE. This layer books nothing: no transaction, no
//    wallet movement, no revenue. This page therefore only reads — there is no
//    create, edit, delete or matching action anywhere in it, by design.
//
//    Gross / fee / withholding / net are shown as four SEPARATE columns because
//    collapsing them is the accounting error this whole feature exists to prevent
//    (decision D22). A NULL fee means "not known yet" and renders as an em dash,
//    which is deliberately NOT the same as a confirmed zero.
export function BusinessIncomingPayments() {
  const w = useScoped('/incoming-payments')
  const head = <PageHeader eyebrow="Business Workspace" title="Incoming Payments"
    actions={<StatusBadge tone="info">Read-only</StatusBadge>} />

  if (w.loading) return <>{head}<Card><LoadingSkeleton rows={5} height={18} /></Card></>

  // With the backend flag off every route 404s before touching the database, so a
  // "not found" here means the feature is disabled for this deployment — not a fault.
  if (w.error) {
    const disabled = /not_found|404/i.test(w.error)
    return <>{head}{disabled
      ? <EmptyState symbol={SYMBOL} title="Incoming Payments is not enabled"
          description="This workspace does not have incoming payment ingestion turned on yet." />
      : <ErrorState title="We couldn’t load incoming payments" description={w.error}
          onRetry={() => location.reload()} />}</>
  }

  const payments = Array.isArray(w.data?.payments) ? w.data.payments : []

  if (!payments.length) return <>{head}
    <EmptyState symbol={SYMBOL} title="No incoming payments yet"
      description="Money received through a payment gateway or bank account will appear here once it is ingested." />
  </>

  const ccy = (r) => r.currency || 'IDR'
  // An unknown amount is NOT zero. NULL renders as a dash so nobody reads a missing
  // gateway fee as a confirmed absence of one.
  const amt = (v, r) => (v === null || v === undefined)
    ? <span style={{ color: 'var(--text-muted)' }}>—</span>
    : <span className="cfo-mono">{formatAmount(String(v), ccy(r))}</span>
  const statusTone = (s) => s === 'reviewed' ? 'success' : s === 'rejected' ? 'danger' : 'neutral'
  const reconTone = (s) => s === 'matched' ? 'success' : s === 'candidate' ? 'warning'
    : s === 'ignored' ? 'neutral' : 'info'

  return <>{head}
    <div style={{ marginBottom: 16, color: 'var(--text-secondary)', fontSize: 14 }}>
      Cash evidence awaiting review. Recording a payment here does not book revenue or create
      a transaction — gross, fees and the net that actually landed are kept separate.
    </div>

    {/* desktop table */}
    <Card className="cfo-rtable">
      <ResponsiveTable
        columns={[
          { key: 'created_at', label: 'Received', render: r => <span className="cfo-mono">{(r.created_at || '').slice(0, 10)}</span> },
          { key: 'source_type', label: 'Source', render: r => <StatusBadge tone="neutral">{r.source_type}</StatusBadge> },
          { key: 'payer_name', label: 'Payer', render: r => r.payer_name || <span style={{ color: 'var(--text-muted)' }}>—</span> },
          { key: 'gross_amount', label: 'Gross', num: true, render: r => amt(r.gross_amount, r) },
          { key: 'fee_amount', label: 'Fee', num: true, render: r => amt(r.fee_amount, r) },
          { key: 'tax_or_withholding_amount', label: 'Withholding', num: true, render: r => amt(r.tax_or_withholding_amount, r) },
          { key: 'net_amount', label: 'Net', num: true, render: r => amt(r.net_amount, r) },
          { key: 'currency', label: 'Currency', render: r => <span className="cfo-mono">{ccy(r)}</span> },
          { key: 'status', label: 'Status', render: r => <StatusBadge tone={statusTone(r.status)}>{r.status}</StatusBadge> },
          { key: 'reconciliation_status', label: 'Reconciliation', render: r => <StatusBadge tone={reconTone(r.reconciliation_status)}>{r.reconciliation_status}</StatusBadge> },
        ]}
        rows={payments} rowKey={r => r.id} />
    </Card>

    {/* mobile cards */}
    <div className="cfo-mcards">
      {payments.map(r => (
        <div className="cfo-dcard" key={r.id}>
          <div className="cfo-dcard-top">
            <div className="cfo-dcard-name">{r.payer_name || r.source_type}</div>
            <div className="cfo-dcard-amt cfo-mono">{formatAmount(String(r.net_amount ?? 0), ccy(r))} {ccy(r)}</div>
          </div>
          <div className="cfo-dcard-meta">
            <StatusBadge tone={statusTone(r.status)}>{r.status}</StatusBadge>
            <StatusBadge tone={reconTone(r.reconciliation_status)}>{r.reconciliation_status}</StatusBadge>
            <span className="cfo-mono">{(r.created_at || '').slice(0, 10)}</span>
            <span>gross {formatAmount(String(r.gross_amount ?? 0), ccy(r))}</span>
            {(r.fee_amount !== null && r.fee_amount !== undefined) && <span>fee {formatAmount(String(r.fee_amount), ccy(r))}</span>}
          </div>
        </div>
      ))}
    </div>
  </>
}

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
// Legal entity forms (Indonesia-first) — matches the flag-ON Personal Dashboard chooser.
const BIZ_TYPES = [
  { v: 'pt', label: 'PT' },
  { v: 'pt_pma', label: 'PT PMA' },
  { v: 'cv', label: 'CV' },
  { v: 'sole_owner', label: 'Sole owner' },
  { v: 'other', label: 'Other' },
]
// Countries offered in the creation form (default Indonesia). Free-form otherwise.
const BIZ_COUNTRIES = ['Indonesia', 'Singapore', 'Thailand', 'Malaysia', 'Other']
// The creator is always the workspace owner; this captures their stated function so
// onboarding/roles can use it later. It does NOT change the owner membership created
// server-side (POST /api/businesses always makes the creator the owner).
const BIZ_ROLES = ['Owner', 'Director', 'Finance', 'Accountant', 'Staff']
// Common zones surfaced first; the rest come from the browser's full IANA list so
// the field is a real select (searchable via the native datalist), not free text.
const COMMON_TZ = [
  'Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Singapore', 'Asia/Bangkok',
  'Asia/Kuala_Lumpur', 'Asia/Manila', 'Asia/Ho_Chi_Minh', 'Asia/Hong_Kong', 'Asia/Tokyo',
  'Asia/Shanghai', 'Asia/Dubai', 'Asia/Kolkata', 'Europe/Moscow', 'Europe/London',
  'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC',
]
function allTimezones() {
  try { const all = Intl.supportedValuesOf?.('timeZone'); if (all?.length) return all } catch { /* old browser */ }
  return COMMON_TZ
}
// Best-effort country from the browser locale (e.g. "en-ID" → "ID"); user can edit.
function detectCountry() {
  try {
    const loc = (navigator.languages?.[0] || navigator.language || '')
    const m = /[-_]([A-Za-z]{2})$/.exec(loc)
    return m ? m[1].toUpperCase() : ''
  } catch { return '' }
}
function detectTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}
export function BusinessNew() {
  const { token } = useAuth()
  const { applyActive, refresh } = useWorkspace()
  const navigate = useNavigate()
  const detectedTz = detectTimezone()
  // Ordered options: detected zone, then common zones, then the rest — de-duplicated.
  const tzOptions = [...new Set([detectedTz, ...COMMON_TZ, ...allTimezones()])]
  const [f, setF] = useState({
    name: '', base_currency: 'IDR',
    country: 'Indonesia',
    timezone: detectedTz,
    business_type: 'pt',
    user_role: 'Owner',   // captured for onboarding; server always makes creator the owner
  })
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
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, padding: '10px 12px', borderRadius: 10, background: 'var(--info-soft, #eef4fb)' }}>
            Your personal wallets and business wallets are separate. Money only moves between
            them through an explicit owner loan, capital contribution, reimbursement, or dividend flow.
          </div>
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
              <select style={inp} value={f.country} onChange={set('country')}>
                {BIZ_COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Timezone</label>
              <input style={inp} value={f.timezone} onChange={set('timezone')} list="biz-tz-list"
                placeholder="Asia/Jakarta" autoComplete="off" />
              <datalist id="biz-tz-list">
                {tzOptions.map(tz => <option key={tz} value={tz} />)}
              </datalist>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>Auto-detected: {detectedTz} · type to search</div>
            </div>
          </div>
          <div>
            <label style={lbl}>Your role</label>
            <select style={inp} value={f.user_role} onChange={set('user_role')}>
              {BIZ_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>As the creator you are the workspace owner. You can invite others and assign roles after setup.</div>
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
