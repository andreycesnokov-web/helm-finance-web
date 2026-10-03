// Pulse (designs/Main.dc.html, PulseMobile.dc.html). Cash view only.
//
// Data (all existing, all reads):
//   GET /api/pulse?scope=business          cash now, burn, runway, receivables/payables, debts
//   GET /api/pulse/advanced-insights       money in/out for the last 30 days and the 30 before
//   GET /api/accountant/obligations        engine-CALCULATED tax amounts (role-gated; optional)
// "Approve" links to Approvals and "Review" to the bill — Pulse itself changes nothing.
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import I from '../icons'
import { PageHead, Card, Pill, Btn, Skeleton, ErrorBox } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi } from '../data'
import { money, shortDate, longDate } from '../lib/format'
import { cashItems, forecast } from '../lib/radarSeries'
import {
  runwayTarget, minCash, runwayDays, pulseStatus, headlineKey, decisions, nextDays, flowOf, pctChange, obligationTiles,
} from '../lib/pulseModel'
import { useAskContext } from '../ai/AskContext'

const iso = (d) => d.toISOString().slice(0, 10)
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }
const STATUS = { good: { tone: 'good', key: 'pulse.status.good' }, warn: { tone: 'warn', key: 'pulse.status.warn' }, crit: { tone: 'crit', key: 'pulse.status.crit' } }

function DecisionRow({ d, t, lang }) {
  if (d.kind === 'approval') {
    const bill = d.type !== 'receivable'
    return (
      <div className="v2-dec">
        <span className="v2-dec-ic v2-tone-info" aria-hidden="true">{bill ? <I.bills /> : <I.approvals />}</span>
        <div className="v2-dec-text">
          <span className="v2-dec-title">{t(bill ? 'pulse.dec.approveBill' : 'pulse.dec.approveInvoice', { who: d.label })}</span>
          <span className="v2-dec-meta">{[d.note && d.note !== d.label ? d.note : null, d.due_date ? t('pulse.dec.due', { d: shortDate(d.due_date, lang) }) : null].filter(Boolean).join(' · ')}</span>
        </div>
        <span className="v2-dec-amt v2-num">{money(d.amount)}</span>
        <div className="v2-dec-actions">
          <Btn to={bill ? `/business/payables/${d.id}` : '/business/receivables'}>{t('pulse.dec.review')}</Btn>
          <Btn variant="primary" to="/business/approvals">{t('pulse.dec.approve')}</Btn>
        </div>
      </div>
    )
  }
  if (d.kind === 'late') {
    return (
      <div className="v2-dec">
        <span className="v2-dec-ic v2-tone-crit" aria-hidden="true"><I.clock /></span>
        <div className="v2-dec-text">
          <span className="v2-dec-title">{t('pulse.dec.late', { who: d.label, n: d.days })}</span>
          <span className="v2-dec-meta">{[d.note, t('pulse.dec.wasDue', { d: shortDate(d.due_date, lang) })].filter(Boolean).join(' · ')}</span>
        </div>
        <span className="v2-dec-amt v2-num v2-pos">{money(d.amount, { sign: true })}</span>
        {/* Reminders have no channel yet (DECISIONS Q4): open the invoice instead (review 8.2 #5). */}
        <div className="v2-dec-actions"><Btn to={`/business/receivables/${encodeURIComponent(d.id)}`}>{t('pulse.dec.openInvoice')}</Btn></div>
      </div>
    )
  }
  return (
    <div className="v2-dec">
      <span className="v2-dec-ic v2-tone-warn" aria-hidden="true"><I.warn /></span>
      <div className="v2-dec-text">
        <span className="v2-dec-title">{t('pulse.dec.tax', { what: d.label, period: d.period })}</span>
        <span className={`v2-dec-meta${d.overdue ? ' v2-neg' : ''}`}>{d.overdue
          ? t('pulse.dec.taxOverdue', { d: shortDate(d.due_date, lang), n: -d.days })
          : t('pulse.dec.taxMeta', { d: shortDate(d.due_date, lang), n: d.days })}</span>
      </div>
      <span className="v2-dec-amt v2-num">{money(d.amount)}</span>
      <div className="v2-dec-actions"><Btn to="/business/accountant">{t('pulse.dec.prepare')}</Btn></div>
    </div>
  )
}

export default function Pulse() {
  const t = useT()
  const lang = useLang()
  const pulse = useApi('/pulse?scope=business')
  const ins30 = useApi(`/pulse/advanced-insights?scope=business&from=${daysAgo(30)}&to=${daysAgo(0)}`)
  const ins60 = useApi(`/pulse/advanced-insights?scope=business&from=${daysAgo(60)}&to=${daysAgo(31)}`)
  const obl = useApi('/accountant/obligations')
  // P-01 / P-08. Missing, failed or null → the documented defaults (60 days, no floor).
  const targets = useApi('/business/targets')
  const fund = useApi('/business-funding') // P-03: loan repayments are scheduled payments
  useAskContext(t('nav.pulse'), t('pulse.today'))

  const m = useMemo(() => {
    const p = pulse.data
    if (!p) return null
    const obligations = obl.data?.obligations || []
    const { items } = cashItems({ debts: p.debts, obligations, repayments: fund.data?.upcoming || [] })
    const f = forecast({ balance: p.totalBalance, burnRate: p.burnRate, items })
    const runway = runwayDays(p)
    const tg = targets.data?.targets || null
    const target = runwayTarget(tg)
    const floor = minCash(tg)
    const status = pulseStatus({ runway, lowestExpected: f.lowest.value, target, floor })
    return {
      p, f, runway, status, target, floor, targetIsDefault: tg?.runway_target_days == null,
      head: headlineKey(status, { runway, lowestExpected: f.lowest.value, target, floor }),
      decs: decisions({ debts: p.debts || [], obligations }),
      next: nextDays(items, { burnRate: p.burnRate, forecastDays: f.days }),
      tiles: obligationTiles(p),
      accounts: (p.accounts || []).filter((a) => (a.scope || 'business') === 'business'),
    }
  }, [pulse.data, obl.data, targets.data, fund.data])

  const flow = flowOf(ins30.data?.ok !== false ? ins30.data?.metrics : null)
  const prev = flowOf(ins60.data?.ok !== false ? ins60.data?.metrics : null)
  const head = (
    <PageHead title={t('nav.pulse')} sub={longDate(new Date(), lang)}
      actions={<Link className="v2-iconbtn v2-iconbtn-boxed v2-desk" to="/business/approvals" aria-label={t('shell.notifications')}><I.bell size={20} /></Link>} />
  )
  if (pulse.loading) return <>{head}<Card><Skeleton rows={6} /></Card></>
  if (pulse.error) return <>{head}<ErrorBox error={pulse.error} onRetry={pulse.reload} /></>
  if (!m) return head

  const { p, f, runway, status, decs, next, tiles, target, floor } = m
  const st = STATUS[status]
  const monthName = new Date().toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang === 'id' ? 'id-ID' : 'en-GB', { month: 'long' })
  const currencies = [...new Set(m.accounts.map((a) => a.currency || 'IDR'))]
  const runwayPct = runway == null ? 0 : Math.min(100, Math.round((runway / target) * 100))
  const inPct = flow && prev ? pctChange(flow.moneyIn, prev.moneyIn) : null

  return (
    <div className="v2-pulse">
      {head}
      <section className="v2-hero" aria-labelledby="v2-hero-title">
        <div className="v2-hero-text">
          <Pill tone={st.tone} dot>{t(st.key)}</Pill>
          <h2 id="v2-hero-title" className="v2-hero-title">{t(m.head, { month: monthName, target, floor: floor == null ? '' : money(floor) })}</h2>
          <p className="v2-hero-p">
            {flow && (flow.net < 0
              ? t('pulse.say.spendMore', { v: money(-flow.net) })
              : t('pulse.say.covered'))}
            {Number(p.receivables) > 0 && ` ${t('pulse.say.owed', { v: money(p.receivables) })}`}
            {f.worstLowest.value < f.start && ` ${t('pulse.say.worst', { v: money(f.worstLowest.value), d: shortDate(f.worstLowest.date, lang) })}`}
          </p>
          <Link className="v2-hero-link v2-desk" to="/business/radar">{t('pulse.seeForecast')}<I.chevRight size={16} /></Link>
        </div>
        <div className="v2-hero-figs">
          <div className="v2-hero-cash">
            <span className="v2-hero-label">{t('pulse.cashNow')}</span>
            <span className="v2-hero-big v2-num">{money(p.totalBalance)}</span>
            <span className="v2-hero-meta">{t('pulse.accounts', { n: m.accounts.length, cur: currencies.join(', ') || 'IDR' })}</span>
          </div>
          <div className="v2-hero-pair">
            <div className="v2-hero-cell">
              <span className="v2-hero-label">{t('pulse.runway')}</span>
              <span className="v2-hero-mid v2-num">{runway == null ? t('pulse.runwayNone') : t('pulse.daysN', { n: runway })}</span>
              <div className="v2-meter" role="meter" aria-valuemin={0} aria-valuemax={target} aria-valuenow={runway ?? 0}
                aria-label={t('pulse.runwayVsTarget', { n: runway ?? 0, target })}>
                <span className={`v2-meter-fill v2-meter-${status}`} style={{ width: `${runwayPct}%` }} />
              </div>
              <span className="v2-hero-meta">{t('pulse.target', { n: target })}{floor != null && ` · ${t('pulse.minCash', { v: money(floor) })}`}</span>
            </div>
            <div className="v2-hero-cell">
              <span className="v2-hero-label">{t('pulse.net30')}</span>
              <span className={`v2-hero-mid v2-num ${flow && flow.net < 0 ? 'v2-on-neg' : 'v2-on-pos'}`}>{flow ? money(flow.net, { sign: true }) : '—'}</span>
              {flow && <span className="v2-hero-meta">{t('pulse.inOut', { in: money(flow.moneyIn), out: money(flow.moneyOut) })}</span>}
            </div>
          </div>
          <Link className="v2-hero-worst v2-phone" to="/business/radar">
            <span>{t('pulse.worstLine', { v: money(f.worstLowest.value), d: shortDate(f.worstLowest.date, lang) })}</span>
            <I.chevRight size={18} />
          </Link>
        </div>
      </section>

      <div className="v2-grid-pulse">
        <Card title={t('pulse.needs')} aside={<span className="v2-num">{t('pulse.items', { n: decs.length })}</span>} className="v2-needs">
          {decs.length === 0 && <p className="v2-muted">{t('pulse.nothing')}</p>}
          {decs.map((d) => <DecisionRow key={d.kind + d.id} d={d} t={t} lang={lang} />)}
          {Number(p.needs_review_count) > 0 && (
            <div className="v2-note">
              <I.transactions size={18} />
              <span>{t('pulse.needCategory', { n: p.needs_review_count })}</span>
              <Link to="/business/transactions">{t('pulse.review')}</Link>
            </div>
          )}
        </Card>

        <Card title={t('pulse.next7')} aside={<Link to="/business/radar">{t('pulse.fullForecast')}</Link>} className="v2-next">
          <div className="v2-next-tiles">
            <div className="v2-next-tile v2-tone-good">
              <span className="v2-next-label">{t('pulse.comingIn')}</span>
              <span className="v2-next-val v2-num">{money(next.comingIn, { sign: true })}</span>
            </div>
            <div className="v2-next-tile v2-tone-neutral">
              <span className="v2-next-label">{t('pulse.goingOut')}</span>
              <span className="v2-next-val v2-num">{money(-next.goingOut, { sign: true })}</span>
              {next.dayToDay > 0 && <span className="v2-next-sub">{t('pulse.dayToDay', { v: money(next.dayToDay) })}</span>}
            </div>
          </div>
          {next.list.length === 0 && <p className="v2-muted">{t('pulse.noNext')}</p>}
          <ul className="v2-next-list">
            {next.list.slice(0, 5).map((it) => {
              const d = new Date(it.date)
              return (
                <li key={it.key} className="v2-next-row">
                  <span className="v2-next-day"><span>{d.toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang === 'id' ? 'id-ID' : 'en-GB', { weekday: 'short' })}</span><span className="v2-num">{d.getDate()}</span></span>
                  <span className="v2-next-what">{it.label}</span>
                  <span className={`v2-num v2-next-amt ${it.dir === 'in' ? 'v2-pos' : ''}`}>{money(it.dir === 'in' ? it.amount : -it.amount, { sign: true })}</span>
                </li>
              )
            })}
          </ul>
          {next.cashOn && (
            <div className="v2-next-cash">
              <span>{t('pulse.cashOn', { d: shortDate(next.cashOn.date, lang) })}</span>
              <span className="v2-num">≈ {money(next.cashOn.value)}</span>
            </div>
          )}
        </Card>
      </div>

      <section className="v2-tiles" aria-label={t('pulse.tilesLabel')}>
        <div className="v2-tile">
          <span className="v2-tile-label">{t('pulse.moneyIn')}</span>
          <span className="v2-tile-val v2-num">{flow ? money(flow.moneyIn) : '—'}</span>
          {inPct != null && <span className={`v2-tile-sub ${inPct >= 0 ? 'v2-pos' : 'v2-neg'}`}>{t(inPct >= 0 ? 'pulse.upPct' : 'pulse.downPct', { n: Math.abs(inPct) })}</span>}
        </div>
        <div className="v2-tile">
          <span className="v2-tile-label">{t('pulse.moneyOut')}</span>
          <span className="v2-tile-val v2-num">{flow ? money(flow.moneyOut) : '—'}</span>
          {flow && flow.capex > 0 && <span className="v2-tile-sub">{t('pulse.inclCapex', { v: money(flow.capex) })}</span>}
        </div>
        <Link className="v2-tile" to="/business/receivables">
          <span className="v2-tile-label">{t('pulse.owedToYou')}</span>
          <span className="v2-tile-val v2-num">{money(tiles.owedToYou)}</span>
          {tiles.owedLate > 0 && <span className="v2-tile-sub v2-neg">{t('pulse.lateAmt', { v: money(tiles.owedLate) })}</span>}
        </Link>
        <Link className="v2-tile" to="/business/payables">
          <span className="v2-tile-label">{t('pulse.youOwe')}</span>
          <span className="v2-tile-val v2-num">{money(tiles.youOwe)}</span>
          <span className={`v2-tile-sub ${tiles.oweLateCount ? 'v2-neg' : ''}`}>{tiles.oweLateCount
            ? t('pulse.billsLate', { n: tiles.oweCount, k: tiles.oweLateCount })
            : t('pulse.billsOk', { n: tiles.oweCount })}</span>
        </Link>
      </section>
    </div>
  )
}
