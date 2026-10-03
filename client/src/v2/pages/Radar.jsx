// Radar (designs/Radar.dc.html, RadarMobile.dc.html) — 30-day cash view.
//
// Data: GET /api/pulse?scope=business (cash now, burn, debts) and, when the role may
// read it, GET /api/accountant/obligations (only engine-CALCULATED tax amounts are
// used). The line rules are the existing Radar rules — see lib/radarSeries.js.
// What-if chips change only what is drawn here; nothing is saved.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccess } from '../../hooks/useAccess'
import I from '../icons'
import { PageHead, Card, Pill, Btn, Skeleton, ErrorBox, Empty, NotYet } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi } from '../data'
import { money, shortDate } from '../lib/format'
import ForecastChart from '../charts/ForecastChart'
import { useAsk, useAskContext } from '../ai/AskContext'
import {
  cashItems, forecast, keyDates, applyScenario, withCashAfter, scenarioChips, pendingSummary, isCounted,
  KEY_DATE_MIN_IDR, DEFAULT_HORIZON,
} from '../lib/radarSeries'

const HORIZONS = [30, 60, 90]
const TAG_TONE = { scheduled: 'neutral', expected: 'good', approval: 'info', late: 'crit', deadline: 'warn' }

export function TagPill({ it }) {
  const t = useT()
  const lang = useLang()
  const text = it.tag === 'late' && it.due_date
    ? t('radar.tag.lateSince', { d: shortDate(it.due_date, lang) })
    : t(`radar.tag.${it.tag}`)
  return <Pill tone={TAG_TONE[it.tag] || 'neutral'}>{text}</Pill>
}

export default function Radar() {
  const t = useT()
  const lang = useLang()
  const { hasFeature } = useAccess()
  const pulse = useApi('/pulse?scope=business')
  const obl = useApi('/accountant/obligations')
  const [horizon, setHorizon] = useState(DEFAULT_HORIZON)
  const [scenario, setScenario] = useState({ kind: 'worst' })
  const [filter, setFilter] = useState('all')
  const advanced = hasFeature('advanced_radar_enabled')
  const { openAsk } = useAsk()
  useAskContext(t('nav.radar'), t('radar.days', { n: horizon }))

  const model = useMemo(() => {
    if (!pulse.data) return null
    const p = pulse.data
    const { items, excluded } = cashItems({ debts: p.debts, obligations: obl.data?.obligations || [], horizon })
    const chips = scenarioChips(items)
    const active = scenario.kind === 'worst' ? null : scenario
    const used = applyScenario(items, active)
    const f = forecast({ balance: p.totalBalance, burnRate: p.burnRate, items: used, horizon })
    const collect = chips.find((c) => c.kind === 'collect')
    const fCollect = collect ? forecast({ balance: p.totalBalance, burnRate: p.burnRate, items: applyScenario(items, collect), horizon }) : null
    const listed = withCashAfter(used.filter((it) => it.day <= horizon).sort((a, b) => a.day - b.day), { balance: p.totalBalance, burnRate: p.burnRate })
    return { items: listed, excluded, chips, f, collect, fCollect, burn: Number(p.burnRate) || 0, pending: pendingSummary(used) }
  }, [pulse.data, obl.data, horizon, scenario])

  const from = new Date()
  const to = new Date(); to.setDate(to.getDate() + horizon)
  const head = (
    <PageHead
      title={t('nav.radar')}
      sub={t('radar.sub', { n: horizon, from: shortDate(from, lang), to: shortDate(to, lang) })}
      actions={
        <div className="v2-seg" role="group" aria-label={t('radar.horizon')}>
          {HORIZONS.map((h) => {
            const locked = h !== DEFAULT_HORIZON && !advanced
            return (
              <button key={h} type="button" className="v2-seg-btn" aria-pressed={horizon === h} disabled={locked}
                onClick={() => setHorizon(h)} title={locked ? t('radar.founderOnly') : undefined}>
                {t('radar.days', { n: h })}{locked && <span className="v2-tag-info">{t('radar.founder')}</span>}
              </button>
            )
          })}
        </div>
      }
    />
  )

  if (pulse.loading) return <>{head}<Card><Skeleton rows={6} /></Card></>
  if (pulse.error) return <>{head}<ErrorBox error={pulse.error} onRetry={pulse.reload} /></>
  if (!model) return head

  const { f, chips, collect, fCollect, burn } = model
  const kd = keyDates(model.items, { filter })
  const daysOfSpend = burn > 0 ? Math.round(Math.max(0, f.worstLowest.value) / burn) : null
  const late = scenario.kind === 'late' ? chips.find((c) => c.kind === 'late') : null
  const approving = scenario.kind === 'approve' ? chips.find((c) => c.kind === 'approve') : null

  return (
    <div className="v2-radar">
      {head}
      <Card className="v2-radar-hero">
        <div className="v2-stats3">
          <div className="v2-stat v2-stat-main">
            <span className="v2-stat-label">{t('radar.expectedOn', { d: shortDate(f.end.date, lang) })}</span>
            <span className="v2-stat-big v2-num">{money(f.end.value)}</span>
            <span className="v2-stat-sub">{f.end.change < 0
              ? t('radar.downFromToday', { v: money(-f.end.change) })
              : t('radar.upFromToday', { v: money(f.end.change) })}</span>
          </div>
          <div className="v2-stat v2-stat-box">
            <span className="v2-stat-label">{t('radar.lowest')}</span>
            <span className="v2-stat-mid v2-num">{money(f.lowest.value)}</span>
            <span className="v2-stat-sub">{f.lowest.day === 0 ? t('radar.today') : shortDate(f.lowest.date, lang)}</span>
          </div>
          <div className="v2-stat v2-stat-box v2-stat-warn">
            <span className="v2-stat-label">{t('radar.worstLowest')}</span>
            <span className="v2-stat-mid v2-num">{money(f.worstLowest.value)}</span>
            <span className="v2-stat-sub">{f.worstLowest.day === 0 ? t('radar.today') : shortDate(f.worstLowest.date, lang)} · {t('radar.worstRule')}</span>
          </div>
        </div>

        <ForecastChart days={f.days} lowest={f.lowest} worstLowest={f.worstLowest} />

        <div className="v2-whatif">
          <div className="v2-whatif-head">
            <h2 className="v2-h3">{t('radar.whatIf')}</h2>
            <span className="v2-muted">{t('radar.whatIfHint')}</span>
          </div>
          <div className="v2-chips" role="group" aria-label={t('radar.whatIf')}>
            <button type="button" className="v2-chip" aria-pressed={scenario.kind === 'worst'} onClick={() => setScenario({ kind: 'worst' })}>{t('radar.chip.worst')}</button>
            {chips.map((c) => (
              <button key={c.kind + c.key} type="button" className="v2-chip" aria-pressed={scenario.key === c.key && scenario.kind === c.kind}
                onClick={() => setScenario(c)}>
                {t(`radar.chip.${c.kind}`, { who: c.label })}
              </button>
            ))}
            <button type="button" className="v2-chip v2-chip-ask" onClick={() => openAsk()}><I.plus size={16} />{t('radar.chip.ask')}</button>
          </div>
          <div className="v2-callout">
            <span className="v2-callout-ic" aria-hidden="true"><I.cfo size={18} /></span>
            <p className="v2-callout-text">
              {approving
                ? t('radar.say.approve', { who: approving.label, amt: money(approving.amount), end: money(f.end.value), d: shortDate(f.end.date, lang), low: money(f.lowest.value), lowD: shortDate(f.lowest.date, lang) })
                : late
                ? t('radar.say.late', { who: late.label, end: money(f.end.value), d: shortDate(f.end.date, lang), low: money(f.lowest.value), lowD: shortDate(f.lowest.date, lang) })
                : <>{t('radar.say.worst1')} <strong>{t('radar.say.worst2', { v: money(f.worstLowest.value), d: shortDate(f.worstLowest.date, lang) })}</strong>
                  {daysOfSpend >= 1 && ` — ${t('radar.say.daysOfSpend', { n: daysOfSpend })}`}.
                  {collect && fCollect && ` ${t('radar.say.collect', { who: collect.label, amt: money(collect.amount), v: money(fCollect.worstLowest.value) })}`}</>}
            </p>
            {collect && <NotYet note={t('bills.reminderSoon')}>{t('radar.sendReminder')}</NotYet>}
          </div>
        </div>
      </Card>

      <Card className="v2-keydates">
        <div className="v2-card-head v2-wrap">
          <div>
            <h2 className="v2-h2">{t('radar.keyDates')}</h2>
            <p className="v2-muted v2-small">{t('radar.keyDatesHint', { min: money(KEY_DATE_MIN_IDR) })}</p>
          </div>
          <div className="v2-seg" role="group" aria-label={t('radar.filter')}>
            {['all', 'in', 'out'].map((k) => (
              <button key={k} type="button" className="v2-seg-btn" aria-pressed={filter === k} onClick={() => setFilter(k)}>{t(`radar.f.${k}`)}</button>
            ))}
          </div>
        </div>
        {kd.shown.length === 0 ? (
          <Empty title={t('radar.noDates')} text={t('radar.noDatesHint')} />
        ) : (
          <div className="v2-kd" role="table" aria-label={t('radar.keyDates')}>
            <div className="v2-kd-row v2-kd-head" role="row">
              <span role="columnheader">{t('radar.col.date')}</span><span role="columnheader">{t('radar.col.what')}</span>
              <span role="columnheader">{t('radar.col.status')}</span><span role="columnheader" className="v2-r">{t('radar.col.amount')}</span>
              <span role="columnheader" className="v2-r">{t('radar.col.after')}</span>
            </div>
            {kd.shown.map((it) => (
              <div key={it.key} className="v2-kd-row" role="row">
                <span role="cell" className="v2-kd-date v2-num">{it.day === 0 ? t('radar.today') : shortDate(it.date, lang)}</span>
                <span role="cell" className="v2-kd-what">
                  {it.source === 'debt' && it.type === 'payable'
                    ? <Link to={`/business/payables/${it.id}`}>{it.label}</Link>
                    : it.label}
                </span>
                <span role="cell" className="v2-kd-status"><TagPill it={it} /></span>
                <span role="cell" className={`v2-kd-amt v2-r v2-num ${it.dir === 'in' ? 'v2-pos' : ''}`}>{money(it.dir === 'in' ? it.amount : -it.amount, { sign: true })}
                  {it.tag !== 'scheduled' && <span className="v2-kd-tagm"><TagPill it={it} /></span>}</span>
                <span role="cell" className="v2-kd-after v2-r v2-num">{isCounted(it) ? money(it.cashAfter) : <span className="v2-muted v2-small">{t('radar.notCounted')}</span>}</span>
              </div>
            ))}
          </div>
        )}
        <div className="v2-foot">
          <span>{t('radar.showing', { n: kd.shown.length, m: kd.total })}
            {kd.hiddenCount > 0 && ` · ${t('radar.hidden', { k: kd.hiddenCount, min: money(KEY_DATE_MIN_IDR), sum: money(kd.hiddenSum) })}`}
            {model.excluded.foreign > 0 && ` · ${t('radar.foreign', { k: model.excluded.foreign })}`}
            {model.pending.count > 0 && ` · ${t('radar.pendingNote', { k: model.pending.count, sum: money(model.pending.sum) })}`}</span>
          <Link to="/business/transactions">{t('radar.showAll', { m: kd.total })}</Link>
        </div>
      </Card>
    </div>
  )
}
