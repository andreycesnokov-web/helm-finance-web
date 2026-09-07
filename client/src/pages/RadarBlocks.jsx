// Radar — presentation blocks.
//
// Split out of Radar.jsx for the same reason PulseBlocks is split out of Pulse:
// the page needs auth and a network call, and a design preview must be able to
// photograph the REAL components against fixed data rather than a hand-drawn
// copy. Radar.jsx keeps the token, the fetch and the loading/error states; every
// pixel below is a pure function of the props.
//
// FIGURES ARE NOT COMPUTED HERE DIFFERENTLY. radarFigures() is the previous
// implementation's arithmetic moved verbatim — same expressions, same fields of
// GET /api/pulse?scope=business, same fmt/fmtFull formatting. Nothing about the
// forecast, the burn rate or the runway changed in this migration.
import {
  PageHeader, SummaryCard, Card, Stat, DataList, EmptyState, StatusBadge,
} from '../shell/ui'
import { fmt, fmtFull, daysUntil } from '../lib/api'
import { currencyPrefix } from '../lib/money'
import { WORKSPACE_DEFAULT_CURRENCY } from '../lib/walletBalanceContract'
// The arithmetic lives in a plain module so a unit test can pin every figure
// without a JSX transform — which is how this migration proves it moved none.
import { radarFigures } from '../lib/radarFigures'
import './Radar.css'

// The official symbol, from the existing /brand pipeline — the same asset every
// other empty state uses. Nothing is drawn in CSS.
export const RADAR_SYMBOL = '/brand/symbol_navy_blue_dot_transparent.svg'

export { radarFigures }

const signed = (v) => (v >= 0 ? '+' : '') + fmt(Math.round(v))

/* Colour follows the FIGURE, not the card it sits in.
   Best and worst case used to be permanently green and red because of what they
   were called. With no planned movements both scenarios collapse onto the
   expected balance, and the worst case rendered "+24.4M" in red — a positive
   figure coloured as a loss. The labels already say which scenario is which; the
   colour is free to say something the label cannot. Same rule as Pulse's KPIs:
   green only when there is genuinely something positive, red only for a real
   negative, and neither at zero. */
const toneOf = (v) => (v < 0 ? 'cfo-neg' : v > 0 ? 'cfo-pos' : '')

/* A money figure says which currency it is in.
   The mini-metrics dropped the currency when the page moved onto the shared card,
   which is fine while everything is rupiah and wrong the moment it is not — so the
   symbol comes from currencyPrefix() against the workspace currency context,
   never a literal "Rp". When Radar learns a real base currency, this is the one
   line that changes.

   Deliberately NOT money.js's compactAmount(): it rounds half-up, while the fmt()
   this page has always used does not. Swapping it would print "Rp 122.9M" here
   beside a best case still reading "+122.8M" for the same number. Prefix plus the
   existing formatter names the currency and moves no digit. */
const CURRENCY = WORKSPACE_DEFAULT_CURRENCY
const money = (v) => currencyPrefix(CURRENCY) + fmt(v)

/** The shared page hero. `badge` is withheld until the figures are known. */
export function RadarHeader({ t, isHealthy, badge = true }) {
  return (
    <PageHeader
      eyebrow="Business Workspace"
      title={t('radar.title')}
      description={`${t('radar.projectedBalance30')} · ${t('aicfo.subtitle')}`}
      context={badge && (
        <StatusBadge tone={isHealthy ? 'success' : 'danger'}>
          {isHealthy ? t('radar.healthy') : t('radar.atRisk')}
        </StatusBadge>
      )}
    />
  )
}

export function RadarForecast({ figures: f, t, hasAdvanced = true }) {
  const dateLabel = (due) => (due
    ? new Date(due).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      + (daysUntil(due) >= 0 ? `${t('radar.inDays')}${daysUntil(due)}d` : t('radar.overdueLabel'))
    : t('radar.noDate'))

  const keyDates = [
    ...f.receivables.map((x) => ({
      id: `r${x.id}`, dir: 'in', label: x.counterparty, sub: dateLabel(x.due_date),
      amount: `+${fmt(Math.abs(x.amount))}`, amountTone: 'cfo-pos',
    })),
    ...f.payables.map((x) => ({
      id: `p${x.id}`, dir: 'out', label: x.counterparty, sub: dateLabel(x.due_date),
      amount: `−${fmt(Math.abs(x.amount))}`, amountTone: 'cfo-neg',
    })),
  ]

  const netFlow = [
    { k: t('radar.currentBalance'),   v: fmt(f.balance),            tone: '' },
    { k: t('radar.expectedIncome'),   v: `+${fmt(f.totalIn)}`,      tone: 'cfo-pos' },
    { k: t('radar.expectedPayments'), v: `−${fmt(f.totalOut)}`,     tone: 'cfo-neg' },
    { k: t('radar.monthlyBurnRow'),   v: `−${fmt(f.monthlyBurn)}`,  tone: 'cfo-neg' },
  ]

  return (
    <>
      {/* Plan gate. Unchanged behaviour — it says which Radar this is; it gates
          nothing on the page. */}
      {!hasAdvanced && (
        <Card className="radar-upsell">
          <div className="radar-upsell-text">
            <span className="radar-upsell-title">{t('radar.basicRadar')}</span>
            <span className="radar-upsell-sub">{t('radar.advancedRadarNote')}</span>
          </div>
          <StatusBadge tone="info">{t('radar.founderPlus')}</StatusBadge>
        </Card>
      )}

      {/* The headline figure — the EXPECTED scenario. The same navy surface, the
          same compact-over-exact hierarchy and the same single cropped watermark
          as Pulse's Total Cash and Accounts' Total Balance, from the same
          component. `flagship` is what earns the mark; nothing else here has one. */}
      <SummaryCard
        flagship
        compact
        /* The currency is named once, in the exact figure underneath — the
           radar.ifAllPlanned string already opens with "IDR ·", so putting it in
           the label too printed it twice. */
        label={t('radar.projectedBalance30')}
        value={<span className="fin">{signed(f.proj30)}</span>}
        meta={`${fmtFull(Math.round(f.proj30))} ${t('radar.ifAllPlanned')}`}
        metrics={[
          { k: t('radar.balance'), v: money(f.balance) },
          { k: t('radar.monthlyBurn'), v: money(f.monthlyBurn) },
          /* radar.runway does not exist in any locale — the previous page asked
             for it too and rendered the raw key. radar.runwayLeft is the real
             string and is translated in all three. */
          { k: t('radar.runwayLeft'), v: f.runway != null ? `${f.runway} ${t('radar.days')}` : '∞',
            tone: f.runway != null && f.runway < 30 ? 'warn' : '' },
        ]}
      />

      {/* Best and worst case. Ordinary cards: they used to be solid green and red
          panels, which made a forecast read as a verdict and put two colour
          fields either side of the real figure. The colour is on the number now,
          where it carries meaning, and the flagship above stays dominant. */}
      <div className="cfo-grid cfo-grid-2 radar-scenarios">
        <Card>
          <div className="radar-scenario-label">{t('radar.bestCaseFull')}</div>
          <div className={`radar-scenario-value fin ${toneOf(f.projBest)}`}>{signed(f.projBest)}</div>
          <div className="radar-scenario-sub">{t('radar.allIncomeReceived')}</div>
        </Card>
        <Card>
          <div className="radar-scenario-label">{t('radar.worstCaseFull')}</div>
          <div className={`radar-scenario-value fin ${toneOf(f.projWorst)}`}>{signed(f.projWorst)}</div>
          <div className="radar-scenario-sub">{t('radar.delaysInReceivables')}</div>
        </Card>
      </div>

      <Card title={t('radar.monthlyBurnBreakdown')}>
        <div className="cfo-grid cfo-grid-3 radar-burn">
          <Stat k={t('radar.monthlyBurn')} v={money(f.monthlyBurn)} tone="neg" />
          <Stat k={t('radar.dailyAverage')} v={money(f.burnRate)} />
          <Stat k={t('radar.runwayLeft')} v={f.runway != null ? `${f.runway}d` : '∞'}
            tone={f.runway != null && f.runway < 30 ? 'warn' : ''} />
        </div>
        <div className="radar-burn-sub">
          {f.burnWindowDays >= 30 ? t('pulse.avg30')
            : f.burnWindowDays > 0 ? `${f.burnWindowDays}${t('pulse.dAvg')}` : t('pulse.avg30')}
          {' · '}
          {f.burnRate > 0 ? t('radar.atCurrentBurn') : t('radar.noBurnData')}
        </div>
      </Card>

      {/* Zero-data: nothing planned. A real empty state at the symbol's normal
          size — not a page-sized logo filling the gap. */}
      {keyDates.length === 0 ? (
        <EmptyState
          symbol={RADAR_SYMBOL}
          title={t('radar.noPlannedTransactions')}
          description={t('radar.noPlannedSub')}
        />
      ) : (
        <Card title={t('radar.keyDates')}>
          <DataList items={keyDates} />
        </Card>
      )}

      <Card title={t('radar.netFlow30')}>
        <ul className="radar-flow">
          {netFlow.map((row) => (
            <li key={row.k}>
              <span className="radar-flow-k">{row.k}</span>
              <span className={`radar-flow-v fin ${row.tone}`}>{row.v}</span>
            </li>
          ))}
        </ul>
        <div className="radar-flow-total">
          <span>{t('radar.projectedBalanceRow')}</span>
          <span className={`fin ${toneOf(f.proj30)}`}>{signed(f.proj30)} IDR</span>
        </div>
      </Card>
    </>
  )
}
