// PERSONAL OVERVIEW DEMO — design-approval screen (master task §11).
// Standalone, no auth, synthetic data only. Uses the official brand assets
// (client/public/brand/*) and the canonical design tokens (src/brand/tokens.css).
// State via ?state=loading|empty|error ; viewport drives desktop/tablet/mobile.
import { useSearchParams } from 'react-router-dom'
import { formatAmount, sum } from '../lib/money'

// ── synthetic data (decimal strings; reporting currency = IDR) ───────────────
const RATE_TS = '20 Jun 2026, 15:42'
const STALE_TS = '18 Jun 2026, 09:10'
const WALLETS = [
  { asset: 'IDR',  type: 'Fiat',   native: '48500000',    reporting: '48500000',  ts: RATE_TS,  stale: false },
  { asset: 'USD',  type: 'Fiat',   native: '12500.50',    reporting: '203758150', ts: RATE_TS,  stale: false },
  { asset: 'USDT', type: 'Crypto', native: '8200.000000', reporting: '133579800', ts: STALE_TS, stale: true,  network: 'TRC-20' },
  { asset: 'BTC',  type: 'Crypto', native: '0.42500000',  reporting: '442000000', ts: RATE_TS,  stale: false, network: 'Bitcoin' },
]
const SUMMARY = {
  investments: '250000000', outstandingLoans: '163000000', capital: '50000000', repayments: '48900000',
  monthIncome: '37500000', monthSpending: '21900000',
}
const TX = [
  { id: 'TX-90412', label: 'Salary — October',        asset: 'IDR',  amount: '37500000',   dir: 'in',  date: '18 Jun' },
  { id: 'TX-90410', label: 'Funding → Helm Care',     asset: 'USD',  amount: '10000.00',   dir: 'out', date: '17 Jun', tag: 'Funding' },
  { id: 'TX-90408', label: 'Loan repayment received', asset: 'IDR',  amount: '48900000',   dir: 'in',  date: '15 Jun', tag: 'Repayment' },
  { id: 'TX-90405', label: 'BTC top-up',              asset: 'BTC',  amount: '0.05000000', dir: 'in',  date: '12 Jun' },
  { id: 'TX-90401', label: 'Apartment rent',          asset: 'IDR',  amount: '15000000',   dir: 'out', date: '05 Jun' },
]
const totalReporting = sum(WALLETS.map(w => w.reporting))

// ── brand asset paths (official, from client/public/brand) ───────────────────
const LOGO_WORDMARK = '/brand/logo_main_navy_transparent_2400.png'
const SYMBOL = '/brand/symbol_navy_blue_dot_transparent.svg'
const SYMBOL_WHITE = '/brand/symbol_white_transparent.svg'

const fmtIDR = (v) => 'Rp ' + formatAmount(v, 'IDR')

export default function PersonalOverviewDemo() {
  const [params] = useSearchParams()
  const state = params.get('state') || 'ready'  // ready | loading | empty | error

  return (
    <div className="pod">
      <style>{POD_CSS}</style>

      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="pod-sidebar">
        <div className="pod-brand"><img src={LOGO_WORDMARK} alt="CFO AI — Financial OS" /></div>
        <WorkspaceSwitcher />
        <nav className="pod-nav">
          {['Overview', 'Accounts', 'Transactions', 'Business Funding', 'Connections', 'Documents', 'Personal AI CFO', 'Settings'].map((it, i) => (
            <a key={it} className={'pod-navitem' + (i === 0 ? ' is-active' : '')} href="#" onClick={e => e.preventDefault()}>
              <span className="pod-navdot" aria-hidden />{it}
            </a>
          ))}
        </nav>
        <div className="pod-side-foot">
          <span className="pod-private"><LockIcon /> Private workspace</span>
        </div>
      </aside>

      {/* ── Mobile header (symbol-only) ─────────────────────────────────── */}
      <header className="pod-mobilehead">
        <img className="pod-mobilesym" src={SYMBOL} alt="CFO AI" />
        <span className="pod-badge pod-badge-private"><LockIcon /> Private</span>
        <button className="pod-burger" aria-label="Menu"><span /><span /><span /></button>
      </header>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="pod-main">
        <div className="pod-pagehead">
          <div>
            <div className="pod-eyebrow">Personal Workspace</div>
            <h1 className="pod-h1">Andrey Personal</h1>
          </div>
          <div className="pod-headactions">
            <span className="pod-badge pod-badge-private"><LockIcon /> Private · only you can view these finances</span>
            <button className="pod-btn pod-btn-primary"><PlusIcon /> Fund a Business</button>
          </div>
        </div>

        {state === 'loading' && <LoadingState />}
        {state === 'error' && <ErrorState />}
        {state === 'empty' && <EmptyState />}
        {state === 'ready' && <ReadyState />}
      </main>
    </div>
  )
}

// ── Ready (populated) ────────────────────────────────────────────────────────
function ReadyState() {
  return (
    <>
      {/* Hero: total cash in reporting currency */}
      <section className="pod-hero">
        <img className="pod-hero-sym" src={SYMBOL_WHITE} alt="" aria-hidden />
        <div className="pod-hero-label">Total Cash · reporting currency IDR</div>
        <div className="pod-hero-value">{fmtIDR(totalReporting)}</div>
        <div className="pod-hero-meta">
          <span><DotIcon /> Valued {RATE_TS}</span>
          <span className="pod-hero-sep">·</span>
          <span>4 accounts · 2 currencies · 2 crypto</span>
        </div>
        <div className="pod-hero-mini">
          <div><span className="pod-mini-k">Income this month</span><span className="pod-mini-v pos">+ {fmtIDR(SUMMARY.monthIncome)}</span></div>
          <div><span className="pod-mini-k">Spending this month</span><span className="pod-mini-v neg">− {fmtIDR(SUMMARY.monthSpending)}</span></div>
        </div>
      </section>

      {/* Native asset cards — never summed across assets */}
      <h2 className="pod-h2">Accounts <span className="pod-h2-note">native balances — not summed across assets</span></h2>
      <section className="pod-assets">
        {WALLETS.map(w => <AssetCard key={w.asset} w={w} />)}
      </section>

      <div className="pod-cols">
        {/* Investing into businesses */}
        <section className="pod-card">
          <h3 className="pod-h3">Business funding</h3>
          <div className="pod-statgrid">
            <Stat k="Invested (loans)" v={fmtIDR(SUMMARY.investments)} />
            <Stat k="Outstanding receivable" v={fmtIDR(SUMMARY.outstandingLoans)} accent />
            <Stat k="Capital contributed" v={fmtIDR(SUMMARY.capital)} />
            <Stat k="Repayments received" v={fmtIDR(SUMMARY.repayments)} pos />
          </div>
          <div className="pod-fundrow">
            <div>
              <div className="pod-fund-biz">Helm Care Indonesia</div>
              <div className="pod-fund-sub">Shareholder loan · <span className="mono">USD → IDR</span> · booked <span className="mono">16,300</span></div>
            </div>
            <div className="pod-fund-out">
              <span className="pod-fund-amt mono">163,000,000 IDR</span>
              <span className="pod-chip pod-chip-warn">Outstanding</span>
            </div>
          </div>
        </section>

        {/* Recent transactions */}
        <section className="pod-card">
          <h3 className="pod-h3">Recent activity</h3>
          <ul className="pod-txlist">
            {TX.map(t => (
              <li key={t.id} className="pod-tx">
                <span className={'pod-tx-ic ' + (t.dir === 'in' ? 'in' : 'out')}>{t.dir === 'in' ? '↓' : '↑'}</span>
                <span className="pod-tx-main">
                  <span className="pod-tx-label">{t.label}{t.tag && <span className="pod-chip pod-chip-soft">{t.tag}</span>}</span>
                  <span className="pod-tx-id mono">{t.id} · {t.date}</span>
                </span>
                <span className={'pod-tx-amt mono ' + (t.dir === 'in' ? 'pos' : 'neg')}>
                  {t.dir === 'in' ? '+ ' : '− '}{formatAmount(t.amount, t.asset)} {t.asset}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}

function AssetCard({ w }) {
  return (
    <div className="pod-asset">
      <div className="pod-asset-top">
        <span className={'pod-asset-badge ' + (w.type === 'Crypto' ? 'crypto' : 'fiat')}>{w.asset}</span>
        <span className="pod-asset-type">{w.type}{w.network ? ' · ' + w.network : ''}</span>
      </div>
      <div className="pod-asset-native mono">{formatAmount(w.native, w.asset)} <span className="pod-asset-unit">{w.asset}</span></div>
      <div className="pod-asset-rep">≈ {fmtIDR(w.reporting)}</div>
      <div className={'pod-asset-ts' + (w.stale ? ' stale' : '')}>
        {w.stale ? <><WarnIcon /> Rate may be stale · {w.ts}</> : <>Valued {w.ts}</>}
      </div>
    </div>
  )
}

const Stat = ({ k, v, accent, pos }) => (
  <div className="pod-stat">
    <span className="pod-stat-k">{k}</span>
    <span className={'pod-stat-v mono' + (accent ? ' accent' : '') + (pos ? ' pos' : '')}>{v}</span>
  </div>
)

function WorkspaceSwitcher() {
  return (
    <button className="pod-switch">
      <span className="pod-switch-ava">A</span>
      <span className="pod-switch-text">
        <span className="pod-switch-name">Andrey Personal</span>
        <span className="pod-switch-type"><LockIcon /> Personal · PRIV-001</span>
      </span>
      <ChevIcon />
    </button>
  )
}

// ── States ───────────────────────────────────────────────────────────────────
function LoadingState() {
  return (
    <>
      <div className="pod-hero pod-skel-hero">
        <div className="pod-skel" style={{ width: 180, height: 14 }} />
        <div className="pod-skel" style={{ width: 320, height: 40, marginTop: 14 }} />
        <div className="pod-skel" style={{ width: 240, height: 12, marginTop: 16 }} />
      </div>
      <div className="pod-assets">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="pod-asset">
            <div className="pod-skel" style={{ width: 60, height: 22 }} />
            <div className="pod-skel" style={{ width: '70%', height: 24, marginTop: 16 }} />
            <div className="pod-skel" style={{ width: '50%', height: 12, marginTop: 12 }} />
          </div>
        ))}
      </div>
    </>
  )
}

function EmptyState() {
  return (
    <div className="pod-empty">
      <img src={SYMBOL} alt="" className="pod-empty-sym" aria-hidden />
      <h2 className="pod-empty-h">Your workspace is ready</h2>
      <p className="pod-empty-p">Add your first account to start tracking cash across currencies and crypto. Everything here stays private to you.</p>
      <div className="pod-empty-actions">
        <button className="pod-btn pod-btn-primary"><PlusIcon /> Add an account</button>
        <button className="pod-btn pod-btn-ghost">Import wallet</button>
      </div>
    </div>
  )
}

function ErrorState() {
  return (
    <div className="pod-error">
      <span className="pod-error-ic"><WarnIcon /></span>
      <h2 className="pod-error-h">We couldn’t load your overview</h2>
      <p className="pod-error-p">Something went wrong while fetching your accounts. Your data is safe — this is only a display issue.</p>
      <button className="pod-btn pod-btn-primary">Try again</button>
    </div>
  )
}

// ── tiny inline icons (stroke = currentColor) ────────────────────────────────
const LockIcon = () => <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
const PlusIcon = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="6" x2="12" y2="18" /><line x1="6" y1="12" x2="18" y2="12" /></svg>
const ChevIcon = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>
const WarnIcon = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
const DotIcon = () => <svg viewBox="0 0 24 24" width="9" height="9"><circle cx="12" cy="12" r="6" fill="currentColor" /></svg>

const POD_CSS = `
.pod{--gap:24px;min-height:100vh;background:var(--surface-page);color:var(--text-primary);
  font-family:var(--font-ui);display:grid;grid-template-columns:296px 1fr;font-size:15px;line-height:var(--line-normal)}
.pod *{box-sizing:border-box}
.mono{font-family:var(--font-mono);font-variant-numeric:tabular-nums}
/* sidebar */
.pod-sidebar{background:var(--surface-card);border-right:1px solid var(--border-default);padding:22px 18px;display:flex;flex-direction:column;gap:18px;min-height:100vh}
.pod-brand img{height:38px;width:auto;display:block}
.pod-switch{display:flex;align-items:center;gap:10px;width:100%;padding:10px;border:1px solid var(--border-default);border-radius:var(--radius-md);background:var(--surface-card-muted);cursor:pointer;text-align:left}
.pod-switch-ava{width:34px;height:34px;border-radius:9px;background:var(--brand-navy);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.pod-switch-text{display:flex;flex-direction:column;flex:1;min-width:0}
.pod-switch-name{font-weight:700;font-size:14px;color:var(--text-primary)}
.pod-switch-type{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text-muted);font-family:var(--font-mono)}
.pod-nav{display:flex;flex-direction:column;gap:2px;margin-top:4px}
.pod-navitem{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:var(--radius-sm);color:var(--text-secondary);text-decoration:none;font-weight:600;font-size:14px}
.pod-navitem:hover{background:var(--surface-card-muted)}
.pod-navitem.is-active{background:var(--info-soft);color:var(--brand-navy)}
.pod-navdot{width:7px;height:7px;border-radius:50%;background:var(--border-strong)}
.pod-navitem.is-active .pod-navdot{background:var(--brand-electric-blue)}
.pod-side-foot{margin-top:auto}
.pod-private{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted)}
/* mobile header */
.pod-mobilehead{display:none;align-items:center;gap:10px;background:var(--surface-card);border-bottom:1px solid var(--border-default);padding:12px 16px;position:sticky;top:0;z-index:5}
.pod-mobilesym{height:30px;width:30px}
.pod-burger{margin-left:auto;background:none;border:0;display:flex;flex-direction:column;gap:4px;cursor:pointer;padding:6px}
.pod-burger span{width:20px;height:2px;background:var(--text-primary);border-radius:2px}
/* main */
.pod-main{padding:28px 32px 56px;max-width:1180px}
.pod-pagehead{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;flex-wrap:wrap;margin-bottom:22px}
.pod-eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-muted);font-weight:700}
.pod-h1{font-family:var(--font-display);font-size:32px;line-height:var(--line-tight);margin:4px 0 0;color:var(--brand-navy)}
.pod-headactions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.pod-badge{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:999px}
.pod-badge-private{background:var(--info-soft);color:var(--brand-navy)}
.pod-btn{display:inline-flex;align-items:center;gap:8px;font-family:var(--font-ui);font-weight:700;font-size:14px;border-radius:var(--radius-md);padding:11px 16px;cursor:pointer;border:1px solid transparent}
.pod-btn-primary{background:var(--brand-electric-blue);color:#fff;box-shadow:var(--shadow-sm)}
.pod-btn-primary:hover{background:#2486e6}
.pod-btn-ghost{background:var(--surface-card);border-color:var(--border-default);color:var(--text-primary)}
/* hero */
.pod-hero{position:relative;overflow:hidden;background:var(--brand-navy);color:#fff;border-radius:var(--radius-lg);padding:26px 28px;box-shadow:var(--shadow-md);margin-bottom:26px}
.pod-hero-sym{position:absolute;right:-20px;top:-20px;width:190px;opacity:.10}
.pod-hero-label{font-size:13px;letter-spacing:.04em;color:#AFC6DE;font-weight:600}
.pod-hero-value{font-family:var(--font-display);font-size:42px;line-height:1.1;margin-top:6px}
.pod-hero-meta{display:flex;align-items:center;gap:8px;margin-top:12px;color:#C5D6E7;font-size:13px}
.pod-hero-meta svg{color:var(--brand-electric-blue)}
.pod-hero-sep{opacity:.5}
.pod-hero-mini{display:flex;gap:34px;margin-top:18px;padding-top:16px;border-top:1px solid rgba(255,255,255,.14)}
.pod-mini-k{display:block;font-size:12px;color:#AFC6DE}
.pod-mini-v{display:block;font-weight:800;font-size:18px;margin-top:3px;font-family:var(--font-mono)}
.pod-mini-v.pos{color:#7FE3B6}.pod-mini-v.neg{color:#FFB4A8}
/* section headings */
.pod-h2{font-size:15px;font-weight:800;color:var(--text-primary);margin:0 0 12px;display:flex;align-items:baseline;gap:10px}
.pod-h2-note{font-size:12px;font-weight:500;color:var(--text-muted)}
.pod-h3{font-size:14px;font-weight:800;margin:0 0 14px;color:var(--text-primary)}
/* asset cards */
.pod-assets{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:26px}
.pod-asset{background:var(--surface-card);border:1px solid var(--border-default);border-radius:var(--radius-lg);padding:16px;box-shadow:var(--shadow-sm)}
.pod-asset-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.pod-asset-badge{font-family:var(--font-mono);font-weight:700;font-size:13px;padding:4px 9px;border-radius:7px}
.pod-asset-badge.fiat{background:var(--info-soft);color:var(--brand-navy)}
.pod-asset-badge.crypto{background:#EDEAFB;color:#3B2F8A}
.pod-asset-type{font-size:11.5px;color:var(--text-muted)}
.pod-asset-native{font-size:21px;font-weight:700;color:var(--text-primary)}
.pod-asset-unit{font-size:13px;color:var(--text-muted)}
.pod-asset-rep{font-size:13px;color:var(--text-secondary);margin-top:4px}
.pod-asset-ts{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--text-muted);margin-top:10px}
.pod-asset-ts.stale{color:var(--warning)}
/* columns */
.pod-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.pod-card{background:var(--surface-card);border:1px solid var(--border-default);border-radius:var(--radius-lg);padding:20px;box-shadow:var(--shadow-sm)}
.pod-statgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px 18px;margin-bottom:18px}
.pod-stat{display:flex;flex-direction:column;gap:3px}
.pod-stat-k{font-size:12px;color:var(--text-muted)}
.pod-stat-v{font-size:17px;font-weight:700;color:var(--text-primary)}
.pod-stat-v.accent{color:var(--brand-navy)}.pod-stat-v.pos{color:var(--success)}
.pod-fundrow{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px;border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--surface-card-muted)}
.pod-fund-biz{font-weight:700;font-size:14px}
.pod-fund-sub{font-size:12px;color:var(--text-muted);margin-top:3px}
.pod-fund-out{display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.pod-fund-amt{font-size:14px;font-weight:700}
.pod-chip{font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px}
.pod-chip-warn{background:var(--warning-soft);color:var(--warning)}
.pod-chip-soft{background:var(--info-soft);color:var(--brand-navy);margin-left:8px;font-weight:600}
/* tx list */
.pod-txlist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.pod-tx{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--border-subtle)}
.pod-tx:last-child{border-bottom:0}
.pod-tx-ic{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0}
.pod-tx-ic.in{background:var(--success-soft);color:var(--success)}
.pod-tx-ic.out{background:var(--danger-soft);color:var(--danger)}
.pod-tx-main{display:flex;flex-direction:column;flex:1;min-width:0}
.pod-tx-label{font-size:14px;font-weight:600}
.pod-tx-id{font-size:11.5px;color:var(--text-muted)}
.pod-tx-amt{font-size:14px;font-weight:700;white-space:nowrap}
.pos{color:var(--success)}.neg{color:var(--danger)}
/* states */
.pod-skel{background:linear-gradient(90deg,#EAEFF4 25%,#F4F7FA 37%,#EAEFF4 63%);background-size:400% 100%;animation:podsh 1.3s ease infinite;border-radius:8px}
.pod-skel-hero{background:var(--surface-card);border:1px solid var(--border-default);box-shadow:none}
@keyframes podsh{0%{background-position:100% 50%}100%{background-position:0 50%}}
@media (prefers-reduced-motion:reduce){.pod-skel{animation:none}}
.pod-empty,.pod-error{background:var(--surface-card);border:1px solid var(--border-default);border-radius:var(--radius-lg);padding:54px 28px;text-align:center;box-shadow:var(--shadow-sm)}
.pod-empty-sym{width:64px;height:64px;opacity:.9;margin-bottom:8px}
.pod-empty-h{font-family:var(--font-display);font-size:24px;color:var(--brand-navy);margin:8px 0 6px}
.pod-empty-p,.pod-error-p{color:var(--text-secondary);max-width:440px;margin:0 auto 22px;font-size:14px}
.pod-empty-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.pod-error-ic{display:inline-flex;width:52px;height:52px;border-radius:14px;align-items:center;justify-content:center;background:var(--danger-soft);color:var(--danger);margin-bottom:10px}
.pod-error-ic svg{width:24px;height:24px}
.pod-error-h{font-size:21px;color:var(--brand-navy);margin:4px 0 6px}
/* ── tablet ── */
@media (max-width:1024px){
  .pod{grid-template-columns:1fr}
  .pod-sidebar{display:none}
  .pod-mobilehead{display:flex}
  .pod-main{padding:20px 20px 48px}
  .pod-assets{grid-template-columns:repeat(2,1fr)}
  .pod-cols{grid-template-columns:1fr}
}
/* ── mobile ── */
@media (max-width:640px){
  .pod-main{padding:16px 14px 44px}
  .pod-h1{font-size:26px}
  .pod-hero-value{font-size:32px}
  .pod-assets{grid-template-columns:1fr 1fr;gap:12px}
  .pod-statgrid{grid-template-columns:1fr 1fr}
  .pod-headactions{width:100%}
  .pod-btn-primary{flex:1;justify-content:center}
  .pod-hero-mini{gap:20px}
}
@media (max-width:380px){.pod-assets{grid-template-columns:1fr}}
`
