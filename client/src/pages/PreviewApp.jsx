// PREMIUM UI PREVIEW — gated, synthetic-only showcase of the shared premium system.
// Route /demo/personal-overview. Renders a 404 unless VITE_PREMIUM_UI_PREVIEW === 'true'
// (Vite exposes only VITE_-prefixed env to the client bundle; the preview service sets it).
// Safety: visible "UI PREVIEW · SYNTHETIC DATA" badge, noindex,nofollow, NO real write
// actions (all CTAs are disabled "Coming next"), NO backend/Supabase calls, NO real data.
import { useEffect, useState } from 'react'
import { formatAmount, sum } from '../lib/money'
import WorkspaceShell, { PERSONAL_NAV, BUSINESS_NAV } from '../shell/WorkspaceShell'
import {
  PageHeader, SummaryCard, MoneyCard, Card, Stat, DataList, Btn, StatusBadge,
  EmptyState, ErrorState, LoadingSkeleton, Icon,
} from '../shell/ui'

const PREVIEW_ON = import.meta.env.VITE_PREMIUM_UI_PREVIEW === 'true'
const SYMBOL = '/brand/symbol_navy_blue_dot_transparent.svg'
const SYMBOL_WHITE = '/brand/symbol_white_transparent.svg'
const RATE_TS = '20 Jun 2026, 15:42', STALE_TS = '18 Jun 2026, 09:10'
const fmtIDR = (v) => 'Rp ' + formatAmount(v, 'IDR')

// ── synthetic workspaces (no balances in the switcher) ───────────────────────
const WORKSPACES = {
  personal: [
    { id: 'p1', name: 'Andrey Personal', type: 'personal', business_code: 'PRIV-001' },
    { id: 'p2', name: 'Investment Portfolio', type: 'personal', business_code: 'PRIV-002' },
  ],
  business: [
    { id: 'b1', name: 'Helm Care Indonesia', type: 'business', role: 'owner', business_code: 'HF-BIZ-000001', plan: 'Founder' },
  ],
}

// A disabled, clearly "Coming next" CTA — no real write actions in preview.
const SoonBtn = ({ children, icon, variant = 'primary' }) => (
  <span title="Coming next" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
    <Btn variant={variant} icon={icon} disabled>{children}</Btn>
    <span className="cfo-badge cfo-badge-neutral" style={{ fontSize: 10.5, padding: '3px 7px' }}>Coming next</span>
  </span>
)

// ── Personal overview content ────────────────────────────────────────────────
const P_WALLETS = [
  { asset: 'IDR',  kind: 'Fiat',   native: '48500000',    reporting: '48500000',  ts: RATE_TS,  stale: false },
  { asset: 'USD',  kind: 'Fiat',   native: '12500.50',    reporting: '203758150', ts: RATE_TS,  stale: false },
  { asset: 'USDT', kind: 'Crypto', native: '8200.000000', reporting: '133579800', ts: STALE_TS, stale: true,  net: 'TRC-20' },
  { asset: 'BTC',  kind: 'Crypto', native: '0.42500000',  reporting: '442000000', ts: RATE_TS,  stale: false, net: 'Bitcoin' },
]
const P_TOTAL = sum(P_WALLETS.map(w => w.reporting))
const P_TX = [
  { id: 't1', label: 'Salary — October',        sub: 'TX-90412 · 18 Jun', amount: '+ 37 500 000 IDR', dir: 'in',  amountTone: 'cfo-pos' },
  { id: 't2', label: 'Funding → Helm Care',     sub: 'TX-90410 · 17 Jun', amount: '− 10 000.00 USD',  dir: 'out', amountTone: 'cfo-neg', tag: 'Funding' },
  { id: 't3', label: 'Loan repayment received', sub: 'TX-90408 · 15 Jun', amount: '+ 48 900 000 IDR', dir: 'in',  amountTone: 'cfo-pos', tag: 'Repayment' },
  { id: 't4', label: 'BTC top-up',              sub: 'TX-90405 · 12 Jun', amount: '+ 0.05000000 BTC', dir: 'in',  amountTone: 'cfo-pos' },
  { id: 't5', label: 'Apartment rent',          sub: 'TX-90401 · 05 Jun', amount: '− 15 000 000 IDR', dir: 'out', amountTone: 'cfo-neg' },
]

function PersonalOverview({ state }) {
  return (
    <>
      <PageHeader eyebrow="Personal Workspace" title="Andrey Personal"
        actions={<>
          <StatusBadge tone="private" icon={<Icon.lock />}>Private · only you can view these finances</StatusBadge>
          <SoonBtn icon={<Icon.plus />}>Fund a Business</SoonBtn>
        </>} />
      {state === 'loading' && <LoadingView />}
      {state === 'error' && <ErrorState title="We couldn’t load your overview"
        description="Something went wrong while fetching your accounts. Your data is safe — this is only a display issue." onRetry={() => {}} />}
      {state === 'empty' && <EmptyState symbol={SYMBOL} title="Your workspace is ready"
        description="Add your first account to start tracking cash across currencies and crypto. Everything here stays private to you."
        actions={<><SoonBtn icon={<Icon.plus />}>Add an account</SoonBtn></>} />}
      {state === 'normal' && <>
        <div style={{ marginBottom: 26 }}>
          <SummaryCard symbol={SYMBOL_WHITE} label="Total Cash · reporting currency IDR" value={fmtIDR(P_TOTAL)}
            meta={<><span className="dot"><Icon.dot width="9" height="9" /></span> Valued {RATE_TS} <span style={{ opacity: .5 }}>·</span> 4 accounts · 2 currencies · 2 crypto</>}
            metrics={[
              { k: 'Income this month', v: '+ ' + fmtIDR('37500000'), tone: 'pos' },
              { k: 'Spending this month', v: '− ' + fmtIDR('21900000'), tone: 'neg' },
            ]} />
        </div>
        <h2 className="cfo-card-title" style={{ margin: '0 0 12px' }}>Accounts <span style={{ fontWeight: 500, color: 'var(--text-muted)', fontSize: 12 }}>— native balances, not summed across assets</span></h2>
        <div className="cfo-grid cfo-grid-4" style={{ marginBottom: 26 }}>
          {P_WALLETS.map(w => (
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
              <div><div style={{ fontWeight: 700, fontSize: 14 }}>Helm Care Indonesia</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>Shareholder loan · <span className="cfo-mono">USD → IDR</span> · booked <span className="cfo-mono">16,300</span></div></div>
              <StatusBadge tone="warning">Outstanding</StatusBadge>
            </div>
          </Card>
          <Card title="Recent activity"><DataList items={P_TX} /></Card>
        </div>
      </>}
    </>
  )
}

// ── Business overview content (presentation-only example) ────────────────────
const B_FINANCING = [
  { id: 'f1', label: 'Founder funding — Andrey', sub: 'Shareholder loan · USD→IDR', amount: '163 000 000 IDR', dir: 'in', tag: 'Liability' },
  { id: 'f2', label: 'Capital contribution', sub: 'Andrey · equity', amount: '50 000 000 IDR', dir: 'in', tag: 'Capital' },
  { id: 'f3', label: 'Loan repayment', sub: 'to investor · IDR', amount: '48 900 000 IDR', dir: 'out', tag: 'Repayment' },
]

function BusinessOverview({ state }) {
  return (
    <>
      <PageHeader eyebrow="Business Workspace" title="Helm Care Indonesia"
        actions={<>
          <StatusBadge tone="shared" icon={<Icon.users />}>Shared business workspace</StatusBadge>
          <StatusBadge tone="neutral">Role: Owner</StatusBadge>
          <StatusBadge tone="info">Plan: Founder</StatusBadge>
          <SoonBtn icon={<Icon.plus />}>New transaction</SoonBtn>
        </>} />
      {state === 'loading' && <LoadingView />}
      {state === 'error' && <ErrorState title="We couldn’t load this workspace"
        description="Something went wrong while loading the business dashboard. This is a display issue only." onRetry={() => {}} />}
      {state === 'empty' && <EmptyState symbol={SYMBOL} title="No activity yet"
        description="Once transactions are recorded, Pulse, revenue and obligations appear here."
        actions={<><SoonBtn icon={<Icon.plus />}>Add a transaction</SoonBtn></>} />}
      {state === 'normal' && <>
        <div style={{ marginBottom: 14, fontSize: 12, color: 'var(--text-muted)' }} className="cfo-mono">Business code: HF-BIZ-000001 · base currency IDR</div>
        <div style={{ marginBottom: 26 }}>
          <SummaryCard symbol={SYMBOL_WHITE} label="Total Cash · IDR" value={fmtIDR('1284500000')}
            meta={<><span className="dot"><Icon.dot width="9" height="9" /></span> Updated {RATE_TS} <span style={{ opacity: .5 }}>·</span> 3 wallets · operating + financing</>}
            metrics={[
              { k: 'Revenue (MTD)', v: '+ ' + fmtIDR('512000000'), tone: 'pos' },
              { k: 'Operating expenses (MTD)', v: '− ' + fmtIDR('338000000'), tone: 'neg' },
              { k: 'Net operating', v: '+ ' + fmtIDR('174000000'), tone: 'pos' },
            ]} />
        </div>
        <div className="cfo-grid cfo-grid-4" style={{ marginBottom: 26 }}>
          <Card title="Receivables"><div className="cfo-stat-v cfo-mono" style={{ fontSize: 20 }}>{fmtIDR('92000000')}</div><div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>7 open invoices</div></Card>
          <Card title="Payables"><div className="cfo-stat-v cfo-mono" style={{ fontSize: 20 }}>{fmtIDR('64500000')}</div><div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>5 bills due</div></Card>
          <Card title="Payroll (next run)"><div className="cfo-stat-v cfo-mono" style={{ fontSize: 20 }}>{fmtIDR('128000000')}</div><div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>14 employees · 28 Jun</div></Card>
          <Card title="Financing (owner)"><div className="cfo-stat-v cfo-mono" style={{ fontSize: 20 }}>{fmtIDR('213000000')}</div><div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>loans + capital · not revenue</div></Card>
        </div>
        <div className="cfo-grid cfo-grid-2">
          <Card title="AI CFO summary" action={<StatusBadge tone="info">Placeholder</StatusBadge>}>
            <div style={{ display: 'flex', gap: 12 }}>
              <span className="cfo-state-ic" style={{ background: 'var(--info-soft)', color: 'var(--brand-navy)', width: 40, height: 40, borderRadius: 11, flexShrink: 0 }}><Icon.cfo width="20" height="20" /></span>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Cash is healthy with ~3.8 months runway. Revenue is up 9% MTD; the largest obligation is payroll on 28 Jun. Founder financing is treated as a liability, not revenue. <span style={{ color: 'var(--text-muted)' }}>(AI CFO narrative is wired in a later phase.)</span>
              </div>
            </div>
          </Card>
          <Card title="Financing activity"><DataList items={B_FINANCING} /></Card>
        </div>
      </>}
    </>
  )
}

function LoadingView() {
  return (
    <>
      <div className="cfo-card" style={{ marginBottom: 26, boxShadow: 'none' }}>
        <LoadingSkeleton rows={3} height={18} width={(i) => ['180px', '320px', '240px'][i]} />
      </div>
      <div className="cfo-grid cfo-grid-4">
        {[0, 1, 2, 3].map(i => <div key={i} className="cfo-money"><LoadingSkeleton rows={3} height={16} width={(r) => ['60px', '80%', '50%'][r]} /></div>)}
      </div>
    </>
  )
}

// ── Gated preview wrapper ────────────────────────────────────────────────────
function NotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-ui)', color: 'var(--text-muted)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 64, color: 'var(--brand-navy)' }}>404</div>
        <div>Not found</div>
      </div>
    </div>
  )
}

export default function PreviewApp() {
  if (!PREVIEW_ON) return <NotFound />
  return <PreviewInner />
}

function PreviewInner() {
  const [activeId, setActiveId] = useState('p1')
  const [state, setState] = useState('normal')   // normal | loading | empty | error

  useEffect(() => {
    document.title = 'CFO AI — UI Preview (synthetic)'
    const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex, nofollow'; m.id = 'preview-robots'
    document.head.appendChild(m)
    return () => { document.getElementById('preview-robots')?.remove() }
  }, [])

  const all = [...WORKSPACES.personal, ...WORKSPACES.business]
  const active = all.find(w => String(w.id) === String(activeId)) || all[0]
  const isPersonal = active.type === 'personal'

  return (
    <div>
      {/* preview banner */}
      <div style={{ background: 'var(--brand-navy)', color: '#fff', padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 12, fontSize: 12.5, fontFamily: 'var(--font-ui)', position: 'sticky', top: 0, zIndex: 100, flexWrap: 'wrap' }}>
        <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 7, letterSpacing: '.04em' }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--brand-electric-blue)' }} /> UI PREVIEW · SYNTHETIC DATA
        </strong>
        <span style={{ opacity: .6 }}>No real data · write actions disabled</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <span style={{ opacity: .7 }}>State:</span>
          {['normal', 'loading', 'empty', 'error'].map(s => (
            <button key={s} onClick={() => setState(s)}
              style={{ textTransform: 'capitalize', fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
                border: '1px solid ' + (state === s ? 'var(--brand-electric-blue)' : 'rgba(255,255,255,.25)'),
                background: state === s ? 'var(--brand-electric-blue)' : 'transparent', color: '#fff' }}>{s}</button>
          ))}
        </span>
      </div>

      <WorkspaceShell
        workspaces={WORKSPACES} activeId={activeId} onSelectWorkspace={(w) => { setActiveId(w.id); setState('normal') }}
        nav={isPersonal ? PERSONAL_NAV : BUSINESS_NAV} activeKey={isPersonal ? 'overview' : 'pulse'} onNavigate={() => {}}>
        {isPersonal ? <PersonalOverview state={state} /> : <BusinessOverview state={state} />}
      </WorkspaceShell>
    </div>
  )
}
