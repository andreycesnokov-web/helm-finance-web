// Radar v2 (designs/Radar, RadarMobile). Same GET /api/pulse?scope=business the
// existing Radar reads; the day-by-day model is lib/forecast.js (existing Radar
// formulas, laid out by due date). Nothing here writes.
import { useMemo, useState } from 'react'
import { useAccess } from '../../hooks/useAccess'
import { Page, Card, Btn, Pill, Chip, Tabs, Loading, ErrorBox, Empty, Num } from '../ui'
import ForecastChart from '../ui/ForecastChart'
import { useV2T, LOCALE } from '../lib/i18n'
import { useV2Data, PULSE_PATH } from '../lib/data'
import { buildForecast, keyDates, collectCandidate, KEY_DATE_MIN } from '../lib/forecast'
import { money, dayMonth } from '../lib/format'
import { P } from '../routes'
import { askLink } from '../lib/ask'
import { useIsPhone } from '../lib/media'

export function statusOf(it, t) {
  if (it.pending) return { tone: 'info', label: t('radar.stPending') }
  if (it.overdue && it.dir === 'in') return { tone: 'critical', label: t('radar.stLateIn', { n: it.daysLate }) }
  if (it.overdue) return { tone: 'critical', label: t('radar.stOverdue', { n: it.daysLate }) }
  return { tone: 'neutral', label: t('radar.stScheduled') }
}

export function itemTitle(it) {
  return it.counterparty || it.description || '—'
}

export default function Radar() {
  const { t, lang } = useV2T()
  const locale = LOCALE[lang]
  const { hasFeature } = useAccess()
  const pulse = useV2Data(PULSE_PATH)
  const phone = useIsPhone()
  const [filter, setFilter] = useState('all')
  const [scenario, setScenario] = useState(null)   // null | 'worst' | 'collect'

  const base = useMemo(() => pulse.data ? buildForecast(pulse.data) : null, [pulse.data])
  const cand = base ? collectCandidate(base) : null
  const fc = useMemo(() => {
    if (!base) return null
    if (scenario === 'collect' && cand) return buildForecast(pulse.data, { overrides: { [cand.id]: { day: Math.min(3, base.horizon) } } })
    return base
  }, [base, scenario, cand, pulse.data])

  const today = new Date()
  const endDate = base ? base.end.date : today
  const sub = t('radar.sub', { from: dayMonth(today, locale), to: dayMonth(endDate, locale) })
  const advanced = hasFeature?.('advanced_radar_enabled')
  const range = (<div className="v2-only-desk">
    <Tabs label={t('radar.rangeLabel')} active="30" items={[
      { key: '30', label: t('radar.days30') },
      { key: '60', label: t('radar.days60'), badge: advanced ? null : t('radar.founder'), disabled: true },
      { key: '90', label: t('radar.days90'), badge: advanced ? null : t('radar.founder'), disabled: true },
    ]} /></div>
  )

  if (pulse.loading) return <Page title={t('nav.radar')} sub={sub} actions={range}><Card><Loading rows={6} /></Card></Page>
  if (pulse.error) return <Page title={t('nav.radar')} sub={sub}><ErrorBox error={pulse.error} onRetry={pulse.reload} /></Page>

  const delta = fc.end.expected - fc.balance
  const minLabel = money(KEY_DATE_MIN).replace('.0M', 'M')
  const kd = keyDates(fc, { filter })
  const scenarioCand = scenario === 'collect' ? base : null
  const worstDays = fc.burn > 0 ? Math.round(fc.worstLow.worst / fc.burn) : null
  const collectFc = cand ? buildForecast(pulse.data, { overrides: { [cand.id]: { day: Math.min(3, base.horizon) } } }) : null

  return (
    <Page title={t('nav.radar')} sub={sub} actions={range}>
      <Card>
        <div className="v2-radar-head">
          <div className="v2-radar-main">
            <div className="v2-kpi-label">{t('radar.expectedOn', { date: dayMonth(fc.end.date, locale) })}</div>
            <div className="v2-radar-big v2-num">{money(fc.end.expected)}</div>
            <div className="v2-kpi-meta">{delta < 0 ? t('radar.downFrom', { v: money(-delta) }) : delta > 0 ? t('radar.upFrom', { v: money(delta) }) : t('radar.flat')}</div>
          </div>
          <div className="v2-radar-side">
            <div className="v2-kpi-label">{t('radar.lowest')}</div>
            <div className="v2-radar-mid v2-num">{money(fc.lowest.expected)}</div>
            <div className="v2-kpi-meta">{fc.lowest.day === 0 ? t('radar.today') : dayMonth(fc.lowest.date, locale)}</div>
          </div>
          <div className="v2-radar-side">
            <div className="v2-kpi-label is-warn">{t('radar.worstLowest')}</div>
            <div className="v2-radar-mid v2-num is-warn">{money(fc.worstLow.worst)}</div>
            <div className="v2-kpi-meta">{fc.worstLow.day === 0 ? t('radar.today') : dayMonth(fc.worstLow.date, locale)} · {t('radar.worstWhy')}</div>
          </div>
        </div>

        <ForecastChart forecast={fc} t={t} locale={locale} compact={phone} />

        <div className="v2-whatif">
          <div className="v2-whatif-head"><h2 className="v2-h3">{t('radar.whatIf')}</h2><span className="v2-cardsub">{t('radar.whatIfSub')}</span></div>
          <div className="v2-chips">
            <Chip on={scenario === 'worst'} onClick={() => setScenario(scenario === 'worst' ? null : 'worst')}>{t('radar.chipWorst')}</Chip>
            {cand && <Chip on={scenario === 'collect'} onClick={() => setScenario(scenario === 'collect' ? null : 'collect')}>
              {t('radar.chipCollect', { name: itemTitle(cand) })}</Chip>}
            <Chip notYet>{t('radar.chipHire')}</Chip>
            <Chip notYet>{t('radar.chipRevenue')}</Chip>
            <Chip icon="plus" to={askLink({ page: 'radar', q: '' })}>{t('radar.chipAsk')}</Chip>
          </div>
          <div className="v2-insight">
            <span className="v2-insight-ic" aria-hidden="true">✦</span>
            <p className="v2-insight-text">
              {t('radar.insightWorst', { v: money(fc.worstLow.worst), date: dayMonth(fc.worstLow.date, locale) })}
              {worstDays !== null && worstDays > 0 ? ` ${t('radar.insightDays', { n: worstDays })}` : ''}
              {cand && collectFc && scenario !== 'collect' ? ` ${t('radar.insightCollect', { name: itemTitle(cand), amt: money(cand.amount), v: money(collectFc.worstLow.worst) })}` : ''}
            </p>
            {cand && <Btn variant="primary" to={`${P.receivables}`}>{t('radar.sendReminder')}</Btn>}
          </div>
          {scenarioCand && <p className="v2-cardsub">{t('radar.scenarioNote')}</p>}
        </div>
      </Card>

      <Card title={t('radar.keyDates')} sub={t('radar.keyDatesSub', { min: minLabel, burn: money(fc.burn) })}
        action={<Tabs label={t('radar.keyDates')} active={filter} onChange={setFilter} items={[
          { key: 'all', label: t('radar.fAll') }, { key: 'in', label: t('radar.fIn') }, { key: 'out', label: t('radar.fOut') }]} />}>
        {kd.total === 0 ? <Empty icon="calendar" title={t('radar.noDates')} body={t('radar.noDatesBody')}
          action={<Btn to={P.payables}>{t('nav.bills')}</Btn>} /> : <>
          <div className="v2-table-wrap v2-only-desk"><table className="v2-table v2-table-kd">
            <thead><tr><th>{t('radar.colDate')}</th><th>{t('radar.colWhat')}</th><th>{t('radar.colStatus')}</th><th className="r">{t('radar.colAmount')}</th><th className="r">{t('radar.colAfter')}</th></tr></thead>
            <tbody>{kd.rows.map((it) => { const st = statusOf(it, t); return (
              <tr key={it.id}>
                <td className="v2-strong">{dayMonth(it.due_date, locale)}</td>
                <td className="ellipsis v2-strong">{itemTitle(it)}{it.description && it.counterparty ? <span className="is-muted"> · {it.description}</span> : null}</td>
                <td><Pill tone={st.tone}>{st.label}</Pill></td>
                <td className="r"><Num tone={it.dir === 'in' ? 'pos' : null}>{money(it.dir === 'in' ? it.amount : -it.amount, { sign: true })}</Num></td>
                <td className="r"><Num>{money(it.cashAfter)}</Num></td>
              </tr>) })}</tbody>
          </table></div>
          <ul className="v2-kd-list v2-only-phone">{kd.rows.map((it) => { const st = statusOf(it, t); return (
            <li key={it.id} className="v2-kd-item">
              <span className="v2-kd-date">{dayMonth(it.due_date, locale)}</span>
              <span className="v2-kd-main"><span className="v2-strong">{itemTitle(it)}</span>
                <span className="v2-kd-sub"><Num tone={it.dir === 'in' ? 'pos' : null}>{money(it.dir === 'in' ? it.amount : -it.amount, { sign: true })}</Num>
                  {st.tone !== 'neutral' && <> · <Pill tone={st.tone}>{st.label}</Pill></>}</span></span>
              <Num className="v2-kd-after">{money(it.cashAfter)}</Num>
            </li>) })}</ul>
          <div className="v2-table-foot">
            <span>{t('radar.showing', { n: kd.shown, m: kd.total })}{kd.smallCount ? ` · ${t('radar.smaller', { n: kd.smallCount, min: minLabel, sum: money(kd.smallSum) })}` : ''}</span>
            <Btn variant="ghost" size="sm" to={P.transactions}>{t('radar.showAll', { m: kd.total })}</Btn>
          </div>
        </>}
      </Card>
    </Page>
  )
}

