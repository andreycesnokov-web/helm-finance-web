// AI CFO — presentation blocks.
//
// Split out of AICFO.jsx the way RadarBlocks is split out of Radar.jsx: the page
// needs auth, two network calls and chat state, and a design preview must be
// able to photograph the REAL components against fixed data rather than a
// hand-drawn copy. AICFO.jsx keeps the token, the fetches, the refresh and the
// loading/error states; every pixel below is a pure function of its props.
//
// NO FINANCIAL FIGURE IS COMPUTED HERE. Cash, runway, net flow, the CFO Score
// and its five factors, the AI alert, hiring readiness, the risks and the next
// actions all arrive already calculated from GET /api/ai-cfo/context. The only
// client-side derivations this page has ever had are the display thresholds and
// the remaining-questions arithmetic, and those now live in lib/aiCfoFigures.js
// so a unit test can pin them.
//
// WHAT CHANGED VISUALLY: the page drew its own header with no <h1> at all, a
// dark hero from .hf-dark-card — a #0F172A gradient with a graph-paper grid
// built from two repeating-linear-gradients, which is the legacy navy PR #80
// replaced — and hf-card panels, 105 inline style blocks, 9 hex literals, 18
// rgba() literals and 16 emoji standing in for icons. It now uses the same
// PageHeader and the same flagship SummaryCard as Pulse, Accounts and Radar.
import {
  PageHeader, SummaryCard, Card, Stat, StatusBadge, EmptyState, Btn, Icon,
} from '../shell/ui'
import {
  FACTOR_ORDER, scoreBand, factorBand, runwayBand, signBand,
  money, moneyFull, signedMoney, directionalMoney, countOrMissing, MISSING,
} from '../lib/aiCfoFigures'
import './AICFO.css'

// The official symbol, from the existing /brand pipeline — the same asset every
// other empty state uses, at the size an empty state uses it. Nothing is drawn
// in CSS and no second mark is introduced: the page's one brand moment is the
// watermark SummaryCard puts on the flagship card, which comes from the shared
// FlagshipMark and is not restyled here.
export const AICFO_SYMBOL = '/brand/symbol_navy_blue_dot_transparent.svg'

/* ── localised backend copy ────────────────────────────────────────────────
   The engines emit English; these maps translate the fixed sentences they can
   emit. The maps are unchanged from the previous page. What changed is that the
   language is now an argument rather than a call to getLang(): a presentation
   module that reads global state cannot be photographed deterministically — a
   screenshot would follow whatever language the developer happens to have
   stored — and RadarBlocks keeps the same discipline. The container passes
   getLang(); the preview passes 'en'. Runtime behaviour is identical. */
const RU_TEXT_MAP_AICFO = {
  'Business is financially stable': 'Финансы бизнеса стабильны',
  'Immediate cash action required': 'Требуются действия по деньгам',
  'Cash is strong with no urgent payment risks detected. Keep monitoring monthly.': 'Денежная позиция стабильная, срочных рисков нет. Продолжайте контролировать финансы.',
  'Not enough expense history': 'Недостаточно истории расходов',
  'Runway unknown — add expenses': 'Запас денег неизвестен — добавьте расходы',
  'No payables': 'Обязательств нет',
  'No receivables': 'Дебиторки нет',
  'No monthly data yet': 'За месяц пока нет данных',
  'No significant risks': 'Существенных рисков нет',
  'Finances look stable': 'Финансы выглядят стабильно',
  'No urgent actions detected. Keep adding transactions daily and review cash weekly.': 'Срочных действий нет. Продолжайте добавлять операции и проверять деньги еженедельно.',
  'Needs Attention': 'Требует внимания',
  'Some areas need attention.': 'Есть зоны, которые требуют внимания.',
  'No urgent actions detected.': 'Срочных действий нет.',
  'Healthy': 'Хорошо',
  'Critical': 'Критично',
  'Not enough data': 'Недостаточно данных',
  'Add wallets, transactions and expenses to calculate safe hiring budget.': 'Добавьте кошельки, операции и расходы, чтобы рассчитать безопасный бюджет на найм.',
  'No risks detected.': 'Рисков не обнаружено.',
  'Income covers obligations.': 'Доход покрывает обязательства.',
  'Not recommended': 'Не рекомендуется',
  'Ready to hire': 'Можно нанимать',
  'Proceed with caution': 'Осторожно',
}
const ID_TEXT_MAP_AICFO = {
  'Business is financially stable': 'Keuangan bisnis stabil',
  'Immediate cash action required': 'Perlu tindakan kas segera',
  'Cash is strong with no urgent payment risks detected. Keep monitoring monthly.': 'Posisi kas stabil dan tidak ada risiko pembayaran mendesak. Tetap pantau keuangan secara rutin.',
  'Not enough expense history': 'Riwayat pengeluaran belum cukup',
  'Runway unknown — add expenses': 'Cadangan kas belum diketahui — tambahkan pengeluaran',
  'No payables': 'Tidak ada kewajiban',
  'No receivables': 'Tidak ada piutang',
  'No monthly data yet': 'Belum ada data bulanan',
  'No significant risks': 'Tidak ada risiko signifikan',
  'Finances look stable': 'Keuangan terlihat stabil',
  'No urgent actions detected. Keep adding transactions daily and review cash weekly.': 'Tidak ada tindakan mendesak. Tetap tambah transaksi harian dan tinjau cash flow setiap minggu.',
  'Needs Attention': 'Perlu perhatian',
  'Some areas need attention.': 'Ada beberapa area yang perlu diperhatikan.',
  'No urgent actions detected.': 'Tidak ada tindakan mendesak.',
  'Healthy': 'Baik',
  'Critical': 'Kritis',
  'Not enough data': 'Data belum cukup',
  'Add wallets, transactions and expenses to calculate safe hiring budget.': 'Tambahkan dompet, transaksi, dan pengeluaran untuk menghitung anggaran rekrutmen yang aman.',
  'No risks detected.': 'Tidak ada risiko terdeteksi.',
  'Income covers obligations.': 'Pemasukan menutup kewajiban.',
  'Not recommended': 'Tidak disarankan',
  'Ready to hire': 'Siap merekrut',
  'Caution': 'Hati-hati',
  'Proceed with caution': 'Hati-hati',
}
export function localizeInsight(text, lang) {
  if (!text) return text
  if (lang === 'ru') return RU_TEXT_MAP_AICFO[text] || text
  if (lang === 'id') return ID_TEXT_MAP_AICFO[text] || text
  return text
}

/* ── money, with its currency named ────────────────────────────────────────
   Every money figure on this page says which currency it is in, the same way
   Radar's do: currencyPrefix() against the workspace's own base currency, never
   a literal "Rp". The formatter itself is untouched — fmt() and fmtFull() are
   the ones this page has always used, so not one digit or rounding decision
   moves. Deliberately NOT money.js's compactAmount(), which rounds half-up
   where fmt() does not.

   Days and scores are NOT money and never take a prefix.

   Caveat worth knowing while reading these: cash.total_balance is summed
   server-side across every business wallet from transactions.amount_original,
   regardless of each wallet's own currency, and then labelled with the
   business's base currency. In a single-currency workspace that is exact. In a
   mixed one the sum itself is unsound — a pre-existing backend issue this
   migration does not touch and does not create; naming the currency only makes
   the existing claim visible.

   money(), moneyFull() and signedMoney() now live in lib/aiCfoFigures.js — a
   plain module, so a Node test can render the old expression and the new one
   over one fixture and compare them token by token. */

/* Band → the class a figure wears. One mapping, so "green means genuinely
   healthy" holds identically in the score, the factors, the alert and the
   hiring card. `neutral` and the runway's `adequate` deliberately resolve to no
   colour at all: an uncoloured figure is the default, and colour is spent only
   where it says something the label cannot. */
const BAND_CLASS = {
  healthy: 'is-healthy', attention: 'is-attention', critical: 'is-critical',
  neutral: '', adequate: '', unknown: '', positive: 'is-healthy', negative: 'is-critical',
}
const BAND_TONE = {
  healthy: 'success', attention: 'warning', critical: 'danger',
  neutral: 'neutral', adequate: 'neutral', unknown: 'neutral',
  positive: 'success', negative: 'danger',
}
/** Stat's own tone vocabulary (shell.css: .cfo-stat-v.pos/.neg/.warn). */
const STAT_TONE = {
  healthy: 'pos', positive: 'pos', attention: 'warn', critical: 'neg', negative: 'neg',
  neutral: '', adequate: '', unknown: '',
}
/** SummaryCard's metric tones, on navy (shell.css: .cfo-summary-v.pos/.neg/.warn). */
const METRIC_TONE = STAT_TONE

/* Icons come from the shared set in shell/ui.jsx, which is also what the
   sidebar uses for these same destinations — so receivables carry the same
   glyph in the nav and on this page. They replace 16 emoji, which rendered at
   the mercy of the reader's font and gave a financial verdict the texture of a
   chat message. */
const FACTOR_ICON = {
  cash_health: Icon.wallet, runway: Icon.pulse, payables: Icon.up,
  receivables: Icon.down, expense_control: Icon.list,
}
const ACTION_ICON = {
  receivable_followup: Icon.down, receivable_due_soon: Icon.down,
  payable_overdue: Icon.warn, payable_due_soon: Icon.up,
  cash_protection: Icon.lock, expense_review: Icon.list,
  hiring_delay: Icon.users, hiring_ready: Icon.users,
  pulse: Icon.pulse,
}

/* Severity → band. `low` only ever reaches this page as the synthetic
   "no significant risks" entry the engine appends when it found nothing, so low
   is the one severity that earns green. */
const SEVERITY_BAND = { critical: 'critical', high: 'critical', medium: 'attention', low: 'healthy' }
const SEVERITY_LABEL_KEY = {
  critical: 'pulse.critical', high: 'aicfo.priorityHigh',
  medium: 'aicfo.priorityMedium', low: 'aicfo.priorityLow',
}
const STATUS_LABEL_KEY = { healthy: 'pulse.healthy', warning: 'pulse.attention', critical: 'pulse.critical' }
const ALERT_BAND = { healthy: 'healthy', warning: 'attention', critical: 'critical' }
const HIRE_BAND = { ready: 'healthy', caution: 'attention', not_ready: 'critical', insufficient_data: 'neutral' }
const HIRE_LABEL_KEY = {
  ready: 'aicfo.hireReady', caution: 'aicfo.hireCaution',
  not_ready: 'aicfo.notRecommended', insufficient_data: 'aicfo.hireNoData',
}
const ACTION_PRIORITY_BAND = { high: 'critical', medium: 'attention', low: 'neutral' }
const ACTION_PRIORITY_KEY = {
  high: 'aicfo.priorityHigh', medium: 'aicfo.priorityMedium', low: 'aicfo.priorityLow',
}

/* Where each destination lives INSIDE the business workspace.
   The page is mounted at /business/ai-cfo inside BusinessShell, but every card
   on it navigated to the bare legacy routes — /receivables, /payables, /radar,
   /transactions — which are rendered by the old Layout. Clicking a figure threw
   the user out of the workspace they were standing in. Every other business
   page uses /business/*; these now do too.
   /add is not among them, and no /business/add is introduced to make it fit.
   Wrapping the legacy Add component in BusinessShell would hold the workspace
   only until the first save — Add's own post-save links go straight back to the
   legacy routes — and a route that looks migrated but is not is worse than one
   that plainly is not. Migrating Add properly, post-save links included, is its
   own task: _specs/business-add-surface-migration.md.

   So both destinations that used to reach for /add now point at surfaces that
   already exist inside the workspace: Accounts, where wallets are set up, and
   Transactions, where the ledger lives. */
export const BUSINESS_ROUTES = {
  accounts: '/business/accounts',
  receivables: '/business/receivables',
  payables: '/business/payables',
  radar: '/business/radar',
  transactions: '/business/transactions',
}

/* Suggested questions — keys resolved via t() at render time. The decorative
   emoji each one carried are gone: they were not icons, they rendered at the
   mercy of the reader's installed fonts, and eight of them in a row gave a row
   of financial questions the texture of a chat toolbar. */
export const SUGGESTED_KEYS = [
  'aicfo.q1', 'aicfo.q2', 'aicfo.q3', 'aicfo.q4',
  'aicfo.q5', 'aicfo.q6', 'aicfo.q7', 'aicfo.q8',
]

/* ── markdown-lite, for the assistant's replies ───────────────────────────── */
export function MarkdownText({ text }) {
  if (!text) return null
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <span className="aicfo-md">
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={i}>{part.slice(2, -2)}</strong>
          : <span key={i}>{part}</span>)}
    </span>
  )
}

/** The shared page hero. Refresh is a secondary action in the header's own
 *  control zone, so it cannot push the title around or sit over the mark. */
export function AICFOHeader({ t, onRefresh, refreshing = false }) {
  return (
    <PageHeader
      eyebrow="Business Workspace"
      title={t('aicfo.title')}
      description={t('aicfo.subtitle')}
      /* Deliberately not `sm`: a small ghost button measures 29px, which is
         under the thumb target the rest of the product holds to. */
      secondaryActions={onRefresh && (
        <Btn
          variant="ghost"
          onClick={onRefresh}
          disabled={refreshing}
          aria-busy={refreshing || undefined}
          className="aicfo-refresh"
        >
          {refreshing ? t('aicfo.refreshing') : t('aicfo.refresh')}
        </Btn>
      )}
    />
  )
}

/**
 * A refresh that failed.
 *
 * The figures below this notice are the last ones that loaded successfully, and
 * saying so is the whole job. The previous page printed the raw error message
 * and nothing else, which left a stale page looking like a current one — the
 * reader had no way to know the numbers were not from now.
 *
 * Deliberately amber rather than red: nothing is broken and nothing is wrong
 * with the figures, they are simply older than they look. The technical reason
 * is kept but demoted — useful in a support conversation, never the headline.
 *
 * It lives here rather than in the container so the design preview can render
 * it and a screenshot can prove it exists.
 */
export function AICFOStaleNotice({ t, error, onRetry, retrying = false }) {
  if (!error) return null
  return (
    <div className="aicfo-stale" role="alert">
      <span className="aicfo-stale-ic" aria-hidden="true"><Icon.warn /></span>
      <span className="aicfo-stale-text">
        <strong>{t('aicfo.refreshFailed')}</strong>
        <span>{t('aicfo.refreshFailedStale')}</span>
        <span className="aicfo-stale-reason">{error}</span>
      </span>
      {onRetry && (
        <Btn sm variant="ghost" onClick={onRetry} disabled={retrying}>{t('aicfo.tryAgain')}</Btn>
      )}
    </div>
  )
}

/**
 * The flagship card — the page's headline figure.
 *
 * The same navy surface, the same compact-over-exact hierarchy and the same one
 * cropped watermark as Pulse's Total Cash, Accounts' Total Balance and Radar's
 * projected balance, from the same component. `flagship` is what earns the
 * mark; nothing else on this page has one, and the mark's size, opacity, crop,
 * safe area and mobile behaviour all stay in .cfo-flagship where the other three
 * pages read them.
 */
export function AICFOSummary({ ctx, t, planLabel, aiQLeft }) {
  const c = ctx || {}
  const cash = c.cash || {}
  const month = c.current_month || {}
  const biz = c.business || {}
  const currency = biz.base_currency || 'IDR'
  const runway = c.runway_days
  const rBand = runwayBand(runway)

  const runwayValue = runway === null || runway === undefined ? MISSING
    : runway >= 999 ? '∞'
      : `${runway} ${t('radar.days')}`

  return (
    <SummaryCard
      flagship
      compact
      /* The label names the figure AND whose it is, so the amount beneath is
         never an unattributed number: "Cash · Nusantara Facilities". The plan
         sits in the supporting line with the exact amount rather than in a
         coloured pill — a plan tier is metadata, not a semantic status, and
         green there would compete with green that means "financially healthy". */
      label={`${t('aicfo.cash')} · ${biz.name || t('aicfo.myBusiness')}`}
      value={<span className="fin">{money(cash.total_balance, currency)}</span>}
      meta={`${moneyFull(cash.total_balance, currency)} · ${planLabel}`}
      metrics={[
        { k: t('aicfo.runway'), v: runwayValue, tone: METRIC_TONE[rBand] },
        {
          k: t('aicfo.netPerMonth'),
          v: signedMoney(month.net_flow, currency),
          tone: METRIC_TONE[signBand(month.net_flow)],
        },
        /* The plan's monthly allowance, not a live remaining count.
           usage.ai_questions_this_month is hardcoded to 0 server-side, so the
           subtraction never decrements — the card used to head this figure
           "AI Questions / remaining", which claimed a measurement that does not
           exist. The allowance is real and is what it is labelled. */
        { k: t('aicfo.aiQuestionsPerMonth'), v: aiQLeft === null ? '∞' : String(aiQLeft) },
      ]}
    />
  )
}

/**
 * CFO Score.
 *
 * Same number, same status, same five factors, same summary sentence — the
 * server computes all of it and not one threshold, weight or branch was touched.
 * What changed is that it stopped shouting: the score was 32px at weight 900 in
 * full semantic colour, directly under a hero, so the page had two headline
 * figures competing. It is quieter now, the verdict moved into a badge, and the
 * factor bars carry the colour.
 */
export function AICFOScore({ score: s, t, lang }) {
  if (!s) {
    return (
      <Card title={t('aicfo.cfoScore')}>
        <p className="aicfo-note">{t('aicfo.cfoScoreNote')}</p>
      </Card>
    )
  }
  const band = scoreBand(s.score)
  return (
    <Card title={t('aicfo.cfoScore')}>
      <div className="aicfo-score-head">
        <div className="aicfo-score-figure">
          <span className={`fin aicfo-score-num ${BAND_CLASS[band]}`}>{s.score}</span>
          <span className="aicfo-score-outof">/ 100</span>
        </div>
        <div className="aicfo-score-verdict">
          <StatusBadge tone={BAND_TONE[band]}>
            {t(STATUS_LABEL_KEY[s.status] || 'pulse.attention')}
          </StatusBadge>
          <p className="aicfo-score-summary">{localizeInsight(s.summary, lang)}</p>
        </div>
      </div>

      <ul className="aicfo-factors">
        {FACTOR_ORDER.map((key) => {
          const f = s.factors?.[key]
          if (!f) return null
          const fb = factorBand(f.impact)
          const Glyph = FACTOR_ICON[key]
          const name = t('pulse.factor' + key.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(''))
          return (
            <li key={key} className="aicfo-factor">
              <div className="aicfo-factor-top">
                <span className="aicfo-factor-name">
                  {Glyph && <Glyph aria-hidden="true" />}
                  {name}
                </span>
                <span className="aicfo-factor-meta">
                  <span className={`aicfo-factor-label ${BAND_CLASS[fb]}`}>{localizeInsight(f.label, lang)}</span>
                  <span className={`fin aicfo-factor-score ${BAND_CLASS[fb]}`}>{f.score}</span>
                </span>
              </div>
              {/* The width is the only thing that can be inline — it IS the
                  datum. Everything else about the bar lives in AICFO.css.
                  Given a role and a label so the bar is not information that
                  exists for sighted readers alone. */}
              <div
                className="aicfo-bar"
                role="meter"
                aria-valuenow={f.score}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${name}: ${f.score} / 100`}
              >
                <div className={`aicfo-bar-fill ${BAND_CLASS[fb]}`} style={{ width: `${f.score}%` }} />
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/**
 * AI Alert and Hiring Readiness — two independent judgements, two cards.
 *
 * They used to be solid tinted panels: a warning arrived as a filled amber block
 * and "Not recommended" as a filled red one, which read as a system error rather
 * than a considered opinion about a business. They are ordinary cards now with a
 * restrained severity stripe, so red still means red without the page shouting.
 */
export function AICFOSignals({ ctx, t, onAsk, lang }) {
  const c = ctx || {}
  const alert = c.ai_alert || null
  const hire = c.hiring_readiness || null
  const biz = c.business || {}
  const currency = biz.base_currency || 'IDR'
  const aBand = alert ? (ALERT_BAND[alert.status] || 'healthy') : 'neutral'
  const hBand = hire ? (HIRE_BAND[hire.status] || 'neutral') : 'neutral'

  return (
    <div className="cfo-grid cfo-grid-2 aicfo-signals">
      <Card title={t('aicfo.aiAlert')} className={`aicfo-signal ${BAND_CLASS[aBand]}`}>
        {alert ? (
          <>
            <StatusBadge tone={BAND_TONE[aBand]}>
              {t(STATUS_LABEL_KEY[alert.status] || 'pulse.attention')}
            </StatusBadge>
            <p className="aicfo-signal-headline">{localizeInsight(alert.headline, lang)}</p>
            <p className="aicfo-signal-body">{localizeInsight(alert.description, lang)}</p>
          </>
        ) : (
          <p className="aicfo-note">{t('aicfo.notEnoughDataAlert')}</p>
        )}
      </Card>

      <Card title={t('aicfo.hiringReadiness')} className={`aicfo-signal ${BAND_CLASS[hBand]}`}>
        {hire ? (
          <>
            <StatusBadge tone={BAND_TONE[hBand]}>
              {t(HIRE_LABEL_KEY[hire.status] || 'aicfo.hireNoData')}
            </StatusBadge>
            {hire.safe_monthly_salary > 0 && (
              <div className="aicfo-signal-figure">
                <span className="aicfo-signal-figure-k">{t('aicfo.safeSalary')}</span>
                <span className="fin aicfo-signal-figure-v">
                  {money(hire.safe_monthly_salary, currency)}
                  <span className="aicfo-signal-figure-unit">{t('aicfo.perMonth')}</span>
                </span>
              </div>
            )}
            <p className="aicfo-signal-body">{localizeInsight(hire.recommendation, lang)}</p>
            {/* Unchanged behaviour: it puts the hiring question to the assistant
                below and scrolls the answer into view. It does not navigate. */}
            {onAsk && (
              <Btn sm variant="secondary" onClick={() => onAsk('Can I hire someone?')}>
                {t('aicfo.askCFO')}
              </Btn>
            )}
          </>
        ) : (
          <p className="aicfo-note">{t('aicfo.notEnoughDataHiring')}</p>
        )}
      </Card>
    </div>
  )
}

/**
 * The four operating figures.
 *
 * Same values, same sources, same formatter — now on the shared Stat, inside one
 * Card, each in its own currency context. They were clickable <div>s before, so
 * they could not be reached from a keyboard at all; they are buttons now, at the
 * 44px thumb target the rest of the product uses.
 *
 * Colour follows meaning, not the row: money owed to the business is positive,
 * money owed by it is a real negative, and expenses are INK rather than red —
 * spending is not a failure, and Pulse already established that rule. Nothing is
 * coloured at zero.
 */
export function AICFOFigures({ ctx, t, onNavigate }) {
  const c = ctx || {}
  const month = c.current_month || {}
  const recv = c.receivables || {}
  const pay = c.payables || {}
  const biz = c.business || {}
  const currency = biz.base_currency || 'IDR'

  const figures = [
    {
      key: 'receivables',
      k: t('aicfo.receivables'),
      v: directionalMoney(recv.total_remaining, currency, '+'),
      tone: STAT_TONE[signBand(recv.total_remaining)],
      sub: recv.overdue_count > 0
        ? `${recv.overdue_count} ${t('common.overdue')}`
        : `${currency}${t('aicfo.outstanding')}`,
      route: BUSINESS_ROUTES.receivables,
    },
    {
      key: 'payables',
      k: t('aicfo.payables'),
      v: directionalMoney(pay.total_remaining, currency, '−'),
      // Money owed is a real negative, so a payables balance above zero is the
      // one figure here that earns red. Through the shared band rather than a
      // local `|| 0`, so an unmeasured total is uncoloured rather than
      // silently treated as an unproblematic zero.
      tone: signBand(pay.total_remaining) === 'positive' ? 'neg' : '',
      sub: pay.overdue_count > 0
        ? `${pay.overdue_count} ${t('common.overdue')}`
        : `${currency}${t('aicfo.toPay')}`,
      route: BUSINESS_ROUTES.payables,
    },
    {
      key: 'income',
      k: t('aicfo.income'),
      v: directionalMoney(month.income, currency, '+'),
      tone: STAT_TONE[signBand(month.income)],
      sub: `${countOrMissing(month.transactions_count)} ${t('aicfo.transactions')}`,
      route: null,
    },
    {
      key: 'expenses',
      k: t('aicfo.expenses'),
      v: directionalMoney(month.expenses, currency, '−'),
      tone: '',
      sub: `${money(month.burn_rate, currency)}${t('pulse.perDay')} · ${
        month.burn_window_days >= 30 ? t('pulse.avg30')
          : month.burn_window_days > 0 ? `${month.burn_window_days}${t('pulse.dAvg')}`
            : t('pulse.avg30')}`,
      route: BUSINESS_ROUTES.transactions,
    },
  ]

  return (
    <Card title={t('aicfo.thisMonth')}>
      <div className="cfo-grid cfo-grid-4 aicfo-figures">
        {figures.map((f) => {
          const body = (
            <>
              <Stat k={f.k} v={f.v} tone={f.tone} />
              <span className="aicfo-figure-sub">{f.sub}</span>
            </>
          )
          return f.route && onNavigate ? (
            <button key={f.key} type="button" className="aicfo-figure is-link" onClick={() => onNavigate(f.route)}>
              {body}
            </button>
          ) : (
            <div key={f.key} className="aicfo-figure">{body}</div>
          )
        })}
      </div>
    </Card>
  )
}

/** Risk summary. The render condition and the rows are the page's originals. */
export function AICFORisks({ ctx, t }) {
  const c = ctx || {}
  const risks = c.risks || []
  const currency = (c.business || {}).base_currency || 'IDR'
  // The page's original visibility rule, unchanged — including that it decides
  // visibility from the filtered set but then renders the whole list.
  if (risks.filter((r) => r.severity !== 'low' || r.type === 'healthy').length === 0) return null

  return (
    <Card title={t('aicfo.riskSummary')}>
      <ul className="aicfo-rows">
        {risks.map((r, i) => {
          const band = SEVERITY_BAND[r.severity] || 'healthy'
          // The severity lives in the badge on the right, not in a stripe on the
          // row: these rows sit inside one card as a list, and a coloured edge on
          // every line turns a summary into a warning panel — which is what this
          // page was doing before.
          return (
            <li key={i} className="aicfo-row">
              <span className="aicfo-row-main">
                <span className="aicfo-row-label">{r.title}</span>
                {r.amount > 0 && (
                  <span className="fin aicfo-row-sub">{money(r.amount, currency)}</span>
                )}
              </span>
              <StatusBadge tone={BAND_TONE[band]}>
                {t(SEVERITY_LABEL_KEY[r.severity] || 'aicfo.priorityLow')}
              </StatusBadge>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** Next best actions. Same list, same order, same routes — inside the workspace. */
export function AICFOActions({ ctx, t, onNavigate }) {
  const c = ctx || {}
  const actions = c.next_actions || []
  const currency = (c.business || {}).base_currency || 'IDR'
  if (actions.length === 0) return null

  return (
    <Card title={t('aicfo.nextBestActions')}>
      <ul className="aicfo-rows">
        {actions.map((a, i) => {
          const band = ACTION_PRIORITY_BAND[a.priority] || 'neutral'
          const Glyph = ACTION_ICON[a.action_type] || Icon.cfo
          // '/cfo' means "you are already here", so it was never a destination.
          const dest = a.route && a.route !== '/cfo'
            ? (BUSINESS_ROUTES[a.route.replace(/^\//, '')] || a.route)
            : null
          const body = (
            <>
              <span className={`aicfo-row-ic ${BAND_CLASS[band]}`}><Glyph aria-hidden="true" /></span>
              <span className="aicfo-row-main">
                <span className="aicfo-row-label">{a.title}</span>
                <span className="aicfo-row-sub">{a.description}</span>
              </span>
              <span className="aicfo-row-end">
                <StatusBadge tone={BAND_TONE[band]}>
                  {t(ACTION_PRIORITY_KEY[a.priority] || 'aicfo.priorityLow')}
                </StatusBadge>
                {a.amount > 0 && <span className="fin aicfo-row-amt">{money(a.amount, currency)}</span>}
              </span>
            </>
          )
          return dest && onNavigate ? (
            <li key={i} className="aicfo-row">
              <button type="button" className="aicfo-row-btn" onClick={() => onNavigate(dest)}>{body}</button>
            </li>
          ) : (
            <li key={i} className="aicfo-row">{body}</li>
          )
        })}
      </ul>
    </Card>
  )
}

/**
 * The assistant.
 *
 * Behaviour is entirely the container's — this renders what it is given. The
 * chat's own gradients (#1D4ED8 → #2563EB, four of them) and its ✦ emoji avatar
 * are gone; the avatar is the same Icon.cfo the sidebar uses for this page.
 */
export function AICFOAsk({
  t, messages = [], input = '', asking = false, limitHit = false, askErr = '',
  suggestions = [], onAsk, onInput, onKeyDown, inputRef, endRef, aiQLeft,
}) {
  return (
    <Card title={t('aicfo.askAICFO')}>
      <div className="aicfo-suggest">
        {suggestions.map((key) => (
          <button
            key={key}
            type="button"
            className="aicfo-suggest-chip"
            disabled={asking}
            onClick={() => onAsk?.(t(key))}
          >
            {t(key)}
          </button>
        ))}
      </div>

      <div className="aicfo-chat">
        {messages.length > 0 ? (
          <div className="aicfo-chat-log">
            {messages.map((msg, i) => (
              <div key={i} className={`aicfo-msg${msg.role === 'user' ? ' is-user' : ''}`}>
                {msg.role !== 'user' && (
                  <span className="aicfo-msg-avatar" aria-hidden="true"><Icon.cfo /></span>
                )}
                <div className="aicfo-msg-body">
                  <div className={`aicfo-bubble${msg.outOfScope ? ' is-outofscope' : ''}`}>
                    {msg.role === 'user' ? msg.content : <MarkdownText text={msg.content} />}
                  </div>
                  {msg.role !== 'user' && msg.outOfScope && (
                    <span className="aicfo-msg-note">{t('aicfo.outOfScope')}</span>
                  )}
                </div>
              </div>
            ))}
            {asking && (
              <div className="aicfo-msg">
                <span className="aicfo-msg-avatar" aria-hidden="true"><Icon.cfo /></span>
                <span className="aicfo-typing" role="status" aria-label={t('aicfo.thinking')}>
                  <i /><i /><i />
                </span>
              </div>
            )}
            <div ref={endRef} />
          </div>
        ) : (
          <div className="aicfo-chat-empty">
            <span className="aicfo-chat-empty-ic" aria-hidden="true"><Icon.cfo /></span>
            <p>{t('aicfo.emptyChat')}</p>
          </div>
        )}

        <div className="aicfo-composer">
          {/* aria-label rather than a visually-hidden <label>: the placeholder
              already carries the same words, and a hidden label would need a
              screen-reader utility class this stylesheet does not own. */}
          <textarea
            id="aicfo-question"
            ref={inputRef}
            value={input}
            onChange={(e) => onInput?.(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('aicfo.placeholder')}
            aria-label={t('aicfo.placeholder')}
            rows={1}
            disabled={asking || limitHit}
          />
          <Btn
            variant="primary"
            onClick={() => onAsk?.()}
            disabled={!input.trim() || asking || limitHit}
            aria-label={t('aicfo.send')}
            className="aicfo-send"
          >
            <Icon.up aria-hidden="true" />
          </Btn>
        </div>
        {askErr && <p className="aicfo-chat-err" role="alert">{askErr}</p>}
      </div>

      {aiQLeft === 0 && <p className="aicfo-note aicfo-limit">{t('aicfo.limitReached')}</p>}
    </Card>
  )
}

/** Quick navigation into the rest of the workspace. */
export function AICFOQuickNav({ ctx, t, onNavigate }) {
  const c = ctx || {}
  const recv = c.receivables || {}
  const pay = c.payables || {}
  const currency = (c.business || {}).base_currency || 'IDR'

  const links = [
    {
      key: 'recv',
      label: t('aicfo.receivables'),
      sub: money(recv.total_remaining, currency) + t('aicfo.outstanding'),
      icon: Icon.down,
      to: BUSINESS_ROUTES.receivables,
    },
    {
      key: 'pay',
      label: t('aicfo.payables'),
      sub: money(pay.total_remaining, currency) + t('aicfo.toPay'),
      icon: Icon.up,
      to: BUSINESS_ROUTES.payables,
    },
    {
      key: 'radar',
      label: t('nav.radar'),
      sub: t('aicfo.forecast30'),
      icon: Icon.radar,
      to: BUSINESS_ROUTES.radar,
    },
    {
      key: 'transactions',
      label: t('nav.transactions'),
      sub: t('aicfo.keepDataUpdated'),
      icon: Icon.list,
      to: BUSINESS_ROUTES.transactions,
    },
  ]

  return (
    <div className="cfo-grid cfo-grid-4 aicfo-quicknav">
      {links.map((l) => {
        const Glyph = l.icon
        return (
          <button key={l.key} type="button" className="aicfo-quick" onClick={() => onNavigate?.(l.to)}>
            <span className="aicfo-quick-ic"><Glyph aria-hidden="true" /></span>
            <span className="aicfo-quick-text">
              <span className="aicfo-quick-label">{l.label}</span>
              <span className="aicfo-quick-sub">{l.sub}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Nothing recorded yet.
 *
 * The engine will happily score an untouched workspace — "not enough expense
 * history" (70), "runway unknown" (60), "no receivables" (80), "no payables"
 * (90, positive) and "no monthly data" (60) weight to 72 — so a business that
 * has entered nothing was being told its financial health was 72 out of 100 and
 * its payables were in excellent shape. Those are verdicts derived from silence.
 * Rather than change one number in the engine, the page declines to present the
 * verdict when there is provably nothing behind it, and asks for the first
 * transaction instead. The official symbol at the size every other empty state
 * uses it — not a page-sized logo filling the gap.
 */
export function AICFOEmpty({ t, onNavigate }) {
  return (
    <EmptyState
      symbol={AICFO_SYMBOL}
      title={t('aicfo.noDataTitle')}
      description={t('aicfo.noDataBody')}
      actions={onNavigate && (
        <Btn variant="primary" onClick={() => onNavigate(BUSINESS_ROUTES.accounts)}>{t('aicfo.setUpWallets')}</Btn>
      )}
    />
  )
}
