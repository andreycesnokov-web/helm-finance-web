// Live Personal Workspace section (Phase 2). Real endpoints, no synthetic data.
// Scoped to the active personal workspace via x-business-id (set by WorkspaceProvider).
// Reuses /api/wallets, /api/transactions, /api/workspaces, /api/personal-workspaces,
// /api/funding/summary — NO backend logic changed.
import { useState, useEffect, useCallback } from 'react'
import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../hooks/useAuth'
import { formatAmount, add, sum } from '../../lib/money'
import { WorkspaceProvider, useWorkspace } from '../../shell/WorkspaceProvider'
import LiveShell from '../../shell/LiveShell'
import {
  PageHeader, SummaryCard, MoneyCard, Card, Stat, DataList, Btn, StatusBadge,
  EmptyState, ErrorState, LoadingSkeleton, ResponsiveTable, Icon,
} from '../../shell/ui'

const SYMBOL = '/brand/symbol_navy_blue_dot_transparent.svg'
const SYMBOL_WHITE = '/brand/symbol_white_transparent.svg'
const idr = (v) => 'Rp ' + formatAmount(String(v ?? 0), 'IDR')
const ASSET_OF = (w) => w.asset_code || w.currency || 'IDR'

// ── scoped fetch hook (refetches on workspace switch via scopeKey) ────────────
function useScoped(path, deps = []) {
  const { token } = useAuth()
  const { scopeKey, active } = useWorkspace()
  const [s, setS] = useState({ loading: true, error: null, data: null })
  useEffect(() => {
    if (!token || !active) return
    let on = true; setS({ loading: true, error: null, data: null })
    apiFetch(path, token)
      .then(d => on && setS({ loading: false, error: null, data: d }))
      .catch(e => on && setS({ loading: false, error: e.message || 'Request failed', data: null }))
    return () => { on = false }
  }, [path, token, scopeKey, active?.id, ...deps]) // eslint-disable-line
  return s
}

// ── Layout: provider + auth gate (children via <Outlet/>) ────────────────────
export function PersonalLayout() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return <WorkspaceProvider><Outlet /></WorkspaceProvider>
}

// Wraps a personal PAGE: ensures a personal workspace is active, else routes to
// onboarding; renders inside the LiveShell.
export function PersonalShell({ children }) {
  const { workspaces, active, loading, error, applyActive, refresh } = useWorkspace()
  useEffect(() => {
    if (!loading && active && active.type !== 'personal' && workspaces.personal?.[0]) applyActive(workspaces.personal[0])
  }, [loading, active, workspaces, applyActive])
  if (loading && !active) return <div style={{ padding: 40 }}><LoadingSkeleton rows={4} /></div>
  if (error && !active) return <div style={{ padding: 40 }}><ErrorState title="Couldn’t load your workspaces" description={error} onRetry={refresh} /></div>
  if (!loading && (workspaces.personal?.length || 0) === 0) return <Navigate to="/personal/onboarding" replace />
  if (!active) return null
  return <LiveShell>{children}</LiveShell>
}

// ── Personal Overview ────────────────────────────────────────────────────────
export function PersonalOverview() {
  const { active } = useWorkspace()
  const w = useScoped('/wallets')
  const tx = useScoped('/transactions?period=month')
  const fund = useScoped('/funding/summary')
  const navigate = useNavigate()

  const head = (
    <PageHeader eyebrow="Personal Workspace" title={active?.name || 'Personal'}
      actions={<>
        <StatusBadge tone="private" icon={<Icon.lock />}>Private · only you can view these finances</StatusBadge>
        <Btn icon={<Icon.plus />} onClick={() => navigate('/personal/funding')}>Fund a Business</Btn>
      </>} />
  )

  if (w.loading) return <>{head}<OverviewSkeleton /></>
  if (w.error) return <>{head}<ErrorState title="We couldn’t load your overview" description={w.error} onRetry={() => location.reload()} /></>

  const wallets = w.data?.wallets || []
  if (wallets.length === 0) {
    return <>{head}<EmptyState symbol={SYMBOL} title="Your workspace is ready"
      description="Add your first account to start tracking cash across currencies and crypto. Everything here stays private to you."
      actions={<Btn icon={<Icon.plus />} onClick={() => navigate('/personal/accounts')}>Add an account</Btn>} /></>
  }

  // balances are reporting-currency (IDR) values from /api/wallets
  const total = sum(wallets.map(x => String(x.balance ?? 0)))
  const txs = Array.isArray(tx.data) ? tx.data : []
  const income = txs.filter(t => t.type === 'income').reduce((a, t) => add(a, String(t.amount_idr || 0)), '0')
  const spend = txs.filter(t => ['expense', 'payroll'].includes(t.type)).reduce((a, t) => add(a, String(t.amount_idr || 0)), '0')
  const recent = txs.slice(0, 6).map(t => ({
    id: t.id, label: t.description || t.type, sub: `${(t.currency_original || 'IDR')} · ${(t.transaction_date || '').slice(0, 10)}`,
    dir: t.type === 'income' ? 'in' : ['expense', 'payroll'].includes(t.type) ? 'out' : 'neutral',
    amount: `${formatAmount(String(t.amount_original ?? t.amount_idr ?? 0), ASSET_OF({ asset_code: t.currency_original }))} ${t.currency_original || 'IDR'}`,
    amountTone: t.type === 'income' ? 'cfo-pos' : ['expense', 'payroll'].includes(t.type) ? 'cfo-neg' : '',
  }))
  const bal = fund.data?.balances || []
  const fOutstanding = bal.reduce((a, b) => add(a, String(b.outstanding_principal_native || 0)), '0')
  const fCapital = bal.reduce((a, b) => add(a, String(b.capital_contributed || 0)), '0')

  return (
    <>{head}
      <div style={{ marginBottom: 26 }}>
        <SummaryCard symbol={SYMBOL_WHITE} label="Total Cash · reporting currency IDR" value={idr(total)}
          meta={<><span className="dot"><Icon.dot width="9" height="9" /></span> {wallets.length} account{wallets.length > 1 ? 's' : ''}</>}
          metrics={[
            { k: 'Income this month', v: '+ ' + idr(income), tone: 'pos' },
            { k: 'Spending this month', v: '− ' + idr(spend), tone: 'neg' },
          ]} />
      </div>
      <h2 className="cfo-card-title" style={{ margin: '0 0 12px' }}>Accounts</h2>
      <div className="cfo-grid cfo-grid-4" style={{ marginBottom: 26 }}>
        {wallets.map(x => (
          <MoneyCard key={x.id} asset={ASSET_OF(x)} kind={x.asset_type === 'crypto' ? 'Crypto' : 'Fiat'} sub={x.name}
            native={idr(x.balance)} reporting={x.currency && x.currency !== 'IDR' ? `native ${x.currency}` : null} />
        ))}
      </div>
      <div className="cfo-grid cfo-grid-2">
        <Card title="Business funding">
          {bal.length === 0
            ? <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>No active funding yet.</div>
            : <div className="cfo-grid cfo-grid-2" style={{ gap: '14px 18px' }}>
                <Stat k="Outstanding receivable" v={idr(fOutstanding)} />
                <Stat k="Capital contributed" v={idr(fCapital)} />
              </div>}
        </Card>
        <Card title="Recent activity">
          {recent.length === 0 ? <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>No transactions this month.</div> : <DataList items={recent} />}
        </Card>
      </div>
    </>
  )
}

// ── Personal Accounts ────────────────────────────────────────────────────────
export function PersonalAccounts() {
  const w = useScoped('/wallets')
  const navigate = useNavigate()
  const head = <PageHeader eyebrow="Personal Workspace" title="Accounts"
    actions={<Btn icon={<Icon.plus />} onClick={() => navigate('/personal/accounts')}>Add account</Btn>} />
  if (w.loading) return <>{head}<div className="cfo-grid cfo-grid-4">{[0, 1, 2, 3].map(i => <div key={i} className="cfo-money"><LoadingSkeleton rows={3} /></div>)}</div></>
  if (w.error) return <>{head}<ErrorState description={w.error} onRetry={() => location.reload()} /></>
  const wallets = w.data?.wallets || []
  if (!wallets.length) return <>{head}<EmptyState symbol={SYMBOL} title="No accounts yet" description="Add a fiat or crypto account to start tracking balances." actions={<Btn icon={<Icon.plus />}>Add account</Btn>} /></>
  return <>{head}
    <div className="cfo-grid cfo-grid-4">
      {wallets.map(x => (
        <MoneyCard key={x.id} asset={ASSET_OF(x)} kind={x.asset_type === 'crypto' ? 'Crypto' : 'Fiat'} sub={x.name} native={idr(x.balance)} />
      ))}
    </div>
  </>
}

// ── Personal Transactions ────────────────────────────────────────────────────
export function PersonalTransactions() {
  const [period, setPeriod] = useState('month')
  const tx = useScoped(`/transactions?period=${period}`, [period])
  const head = <PageHeader eyebrow="Personal Workspace" title="Transactions"
    actions={['month', 'week', 'all'].map(p => (
      <Btn key={p} variant={period === p ? 'secondary' : 'ghost'} sm onClick={() => setPeriod(p)}>{p === 'all' ? 'All' : p === 'week' ? 'Week' : 'Month'}</Btn>
    ))} />
  if (tx.loading) return <>{head}<Card><LoadingSkeleton rows={6} height={18} /></Card></>
  if (tx.error) return <>{head}<ErrorState description={tx.error} onRetry={() => location.reload()} /></>
  const rows = Array.isArray(tx.data) ? tx.data : []
  if (!rows.length) return <>{head}<EmptyState symbol={SYMBOL} title="No transactions" description="Transactions in this period will appear here." /></>
  return <>{head}
    <Card>
      <ResponsiveTable
        columns={[
          { key: 'date', label: 'Date', render: r => <span className="cfo-mono">{(r.transaction_date || '').slice(0, 10)}</span> },
          { key: 'description', label: 'Description', render: r => r.description || r.type },
          { key: 'type', label: 'Type', render: r => <StatusBadge tone="neutral">{r.type}</StatusBadge> },
          { key: 'amount', label: 'Amount', num: true, render: r => <span className={r.type === 'income' ? 'cfo-pos' : ['expense', 'payroll'].includes(r.type) ? 'cfo-neg' : ''}>{formatAmount(String(r.amount_original ?? r.amount_idr ?? 0), r.currency_original || 'IDR')} {r.currency_original || 'IDR'}</span> },
        ]}
        rows={rows} rowKey={r => r.id} />
    </Card>
  </>
}

// ── Personal onboarding (POST /api/personal-workspaces; entitlement-aware) ────
export function PersonalOnboarding() {
  const { token } = useAuth()
  const { refresh, applyActive } = useWorkspace() || {}
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('IDR')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [locked, setLocked] = useState(false)

  const submit = useCallback(async () => {
    setBusy(true); setErr(null)
    try {
      const ws = await apiFetch('/personal-workspaces', token, { method: 'POST', body: { name: name.trim() || 'Personal', base_currency: currency } })
      await refresh?.()
      applyActive?.({ id: ws.id, name: ws.name, type: 'personal' })
      navigate('/personal')
    } catch (e) {
      if (/not enabled|entitlement|upgrade/i.test(e.message)) setLocked(true)
      else setErr(e.message)
    } finally { setBusy(false) }
  }, [name, currency, token, refresh, applyActive, navigate])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface-page)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'var(--font-ui)' }}>
      <div style={{ maxWidth: 460, width: '100%' }}>
        {locked ? (
          <EmptyState symbol={SYMBOL} title="Personal Finance is a separate add-on"
            description="Personal Workspaces are not included with your Business plan. Personal access is enabled separately — contact us to turn it on for your account."
            actions={<Btn variant="ghost" onClick={() => navigate('/')}>Back to Business</Btn>} />
        ) : (
          <Card>
            <h1 className="cfo-h1" style={{ fontSize: 24, marginBottom: 6 }}>New Personal Workspace</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 18 }}>A private space for your own finances. Business members cannot see your balances or transactions.</p>
            <label style={LBL}>Workspace name</label>
            <input style={INP} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Andrey Personal" />
            <label style={LBL}>Reporting currency</label>
            <select style={INP} value={currency} onChange={e => setCurrency(e.target.value)}>
              {['IDR', 'USD', 'EUR', 'SGD', 'AUD'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 16px', fontSize: 12.5, color: 'var(--text-muted)' }}>
              <Icon.lock width="14" height="14" /> Owner-only privacy is applied automatically.
            </div>
            {err && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create workspace'}</Btn>
              <Btn variant="ghost" onClick={() => navigate('/')}>Cancel</Btn>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
const LBL = { display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', margin: '12px 0 6px' }
const INP = { width: '100%', padding: '11px 12px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-ui)', fontSize: 14, background: 'var(--surface-card)', color: 'var(--text-primary)' }

function OverviewSkeleton() {
  return <>
    <div className="cfo-card" style={{ marginBottom: 26, boxShadow: 'none' }}><LoadingSkeleton rows={3} height={18} width={(i) => ['180px', '320px', '240px'][i]} /></div>
    <div className="cfo-grid cfo-grid-4">{[0, 1, 2, 3].map(i => <div key={i} className="cfo-money"><LoadingSkeleton rows={3} /></div>)}</div>
  </>
}
