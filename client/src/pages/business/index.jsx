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
  return <>{head}{filters}
    <Card>
      <ResponsiveTable
        columns={[
          { key: 'date', label: 'Date', render: r => <span className="cfo-mono">{(r.transaction_date || r.created_at || '').slice(0, 10)}</span> },
          { key: 'description', label: 'Description', render: r => r.description || r.type },
          { key: 'type', label: 'Type', render: r => <StatusBadge tone="neutral">{r.type}</StatusBadge> },
          { key: 'doc', label: 'Doc', render: r => (r.document_id || r.has_documents) ? <Icon.doc width="15" height="15" /> : '' },
          { key: 'amount', label: 'Amount', num: true, render: r => <span className={r.type === 'income' ? 'cfo-pos' : ['expense', 'payroll'].includes(r.type) ? 'cfo-neg' : ''}>{formatAmount(String(r.amount_original ?? r.amount_idr ?? 0), ccyOf(r))} {ccyOf(r)}</span> },
        ]}
        rows={rows} rowKey={r => r.id} />
    </Card>
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
