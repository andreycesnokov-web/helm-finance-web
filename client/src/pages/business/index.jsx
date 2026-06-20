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
  PageHeader, SummaryCard, MoneyCard, Card, Stat, DataList, StatusBadge,
  EmptyState, ErrorState, LoadingSkeleton, Icon,
} from '../../shell/ui'

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
