// PERSONAL OVERVIEW — now built on the shared premium system (Phase 1 proof).
// Standalone demo route /demo/personal-overview (no auth, synthetic data) that
// exercises WorkspaceShell + the shared ui primitives. ?state=loading|empty|error.
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { formatAmount, sum } from '../lib/money'
import WorkspaceShell, { PERSONAL_NAV } from '../shell/WorkspaceShell'
import { PageHeader, SummaryCard, MoneyCard, Card, Stat, DataList, Btn, StatusBadge, EmptyState, ErrorState, LoadingSkeleton, Icon } from '../shell/ui'

const SYMBOL_WHITE = '/brand/symbol_white_transparent.svg'
const SYMBOL = '/brand/symbol_navy_blue_dot_transparent.svg'
const RATE_TS = '20 Jun 2026, 15:42', STALE_TS = '18 Jun 2026, 09:10'

// synthetic, decimal strings, reporting currency = IDR
const WALLETS = [
  { asset: 'IDR',  kind: 'Fiat',   native: '48500000',    reporting: '48500000',  ts: RATE_TS,  stale: false },
  { asset: 'USD',  kind: 'Fiat',   native: '12500.50',    reporting: '203758150', ts: RATE_TS,  stale: false },
  { asset: 'USDT', kind: 'Crypto', native: '8200.000000', reporting: '133579800', ts: STALE_TS, stale: true,  net: 'TRC-20' },
  { asset: 'BTC',  kind: 'Crypto', native: '0.42500000',  reporting: '442000000', ts: RATE_TS,  stale: false, net: 'Bitcoin' },
]
const total = sum(WALLETS.map(w => w.reporting))
const fmtIDR = (v) => 'Rp ' + formatAmount(v, 'IDR')
const TX = [
  { id: 'TX-90412', label: 'Salary — October',        sub: 'TX-90412 · 18 Jun', amount: '+ 37 500 000 IDR', dir: 'in',  amountTone: 'cfo-pos' },
  { id: 'TX-90410', label: 'Funding → Helm Care',     sub: 'TX-90410 · 17 Jun', amount: '− 10 000.00 USD',  dir: 'out', amountTone: 'cfo-neg', tag: 'Funding' },
  { id: 'TX-90408', label: 'Loan repayment received', sub: 'TX-90408 · 15 Jun', amount: '+ 48 900 000 IDR', dir: 'in',  amountTone: 'cfo-pos', tag: 'Repayment' },
  { id: 'TX-90405', label: 'BTC top-up',              sub: 'TX-90405 · 12 Jun', amount: '+ 0.05000000 BTC', dir: 'in',  amountTone: 'cfo-pos' },
  { id: 'TX-90401', label: 'Apartment rent',          sub: 'TX-90401 · 05 Jun', amount: '− 15 000 000 IDR', dir: 'out', amountTone: 'cfo-neg' },
]

// synthetic workspaces for the switcher (two personal + one business — no balances)
const WORKSPACES = {
  personal: [
    { id: 'p1', name: 'Andrey Personal', type: 'personal', business_code: 'PRIV-001' },
    { id: 'p2', name: 'Investment Portfolio', type: 'personal', business_code: 'PRIV-002' },
  ],
  business: [
    { id: 'b1', name: 'Helm Care Indonesia', type: 'business', role: 'owner', business_code: 'HELM-01' },
  ],
}

export default function PersonalOverviewDemo() {
  const [params] = useSearchParams()
  const state = params.get('state') || 'ready'
  const [activeId, setActiveId] = useState('p1')

  return (
    <WorkspaceShell
      workspaces={WORKSPACES} activeId={activeId} onSelectWorkspace={(w) => setActiveId(w.id)}
      nav={PERSONAL_NAV} activeKey="overview" onNavigate={() => {}}
    >
      <PageHeader
        eyebrow="Personal Workspace" title="Andrey Personal"
        actions={<>
          <StatusBadge tone="private" icon={<Icon.lock />}>Private · only you can view these finances</StatusBadge>
          <Btn icon={<Icon.plus />}>Fund a Business</Btn>
        </>}
      />

      {state === 'loading' && <LoadingView />}
      {state === 'error' && <ErrorState title="We couldn’t load your overview"
        description="Something went wrong while fetching your accounts. Your data is safe — this is only a display issue." onRetry={() => {}} />}
      {state === 'empty' && <EmptyState symbol={SYMBOL} title="Your workspace is ready"
        description="Add your first account to start tracking cash across currencies and crypto. Everything here stays private to you."
        actions={<><Btn icon={<Icon.plus />}>Add an account</Btn><Btn variant="ghost">Import wallet</Btn></>} />}

      {state === 'ready' && <>
        <div style={{ marginBottom: 26 }}>
          <SummaryCard
            symbol={SYMBOL_WHITE}
            label="Total Cash · reporting currency IDR"
            value={fmtIDR(total)}
            meta={<><span className="dot"><Icon.dot width="9" height="9" /></span> Valued {RATE_TS} <span style={{ opacity: .5 }}>·</span> 4 accounts · 2 currencies · 2 crypto</>}
            metrics={[
              { k: 'Income this month', v: '+ ' + fmtIDR('37500000'), tone: 'pos' },
              { k: 'Spending this month', v: '− ' + fmtIDR('21900000'), tone: 'neg' },
            ]}
          />
        </div>

        <h2 className="cfo-card-title" style={{ margin: '0 0 12px' }}>Accounts <span style={{ fontWeight: 500, color: 'var(--text-muted)', fontSize: 12 }}>— native balances, not summed across assets</span></h2>
        <div className="cfo-grid cfo-grid-4" style={{ marginBottom: 26 }}>
          {WALLETS.map(w => (
            <MoneyCard key={w.asset} asset={w.asset} kind={w.kind} sub={w.net ? `${w.kind} · ${w.net}` : w.kind}
              native={formatAmount(w.native, w.asset)} unit={w.asset} reporting={'≈ ' + fmtIDR(w.reporting)}
              ts={w.stale ? `Rate may be stale · ${w.ts}` : `Valued ${w.ts}`} stale={w.stale} />
          ))}
        </div>

        <div className="cfo-grid cfo-grid-2">
          <Card title="Business funding">
            <div className="cfo-grid cfo-grid-2" style={{ gap: '14px 18px', marginBottom: 18 }}>
              <Stat k="Invested (loans)" v={fmtIDR('250000000')} />
              <Stat k="Outstanding receivable" v={fmtIDR('163000000')} />
              <Stat k="Capital contributed" v={fmtIDR('50000000')} />
              <Stat k="Repayments received" v={fmtIDR('48900000')} tone="pos" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 14, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--surface-card-muted)' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Helm Care Indonesia</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>Shareholder loan · <span className="cfo-mono">USD → IDR</span> · booked <span className="cfo-mono">16,300</span></div>
              </div>
              <StatusBadge tone="warning">Outstanding</StatusBadge>
            </div>
          </Card>

          <Card title="Recent activity"><DataList items={TX} /></Card>
        </div>
      </>}
    </WorkspaceShell>
  )
}

function LoadingView() {
  return (
    <>
      <div className="cfo-card" style={{ marginBottom: 26, boxShadow: 'none' }}>
        <LoadingSkeleton rows={3} height={18} width={(i) => ['180px', '320px', '240px'][i]} />
      </div>
      <div className="cfo-grid cfo-grid-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="cfo-money"><LoadingSkeleton rows={3} height={16} width={(r) => ['60px', '80%', '50%'][r]} /></div>
        ))}
      </div>
    </>
  )
}
