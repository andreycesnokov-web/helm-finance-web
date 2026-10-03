// Performance (designs/Performance, PerformanceCash, PerformanceForecast, PerformanceMobile,
// PerformanceApril) — /business/performance, /performance/cash, /performance/forecast.
// Read-only. Spec: specs/PERFORMANCE_METRICS.md; what the data allows today is explained in
// lib/performance.js. Profit is an ESTIMATE and says so; Cash and Forecast are cash view.
// The two views are never mixed in one figure.
//
// Drill-down (DESIGN_SPEC rule 6): ?month=YYYY-MM&compare=YYYY-MM&focus=<key> shows a filter
// chip (× / All months), what changed vs the comparison month, the payments behind it and an
// "Ask AI CFO" summary. The same link format is what AI text carries (lib/aiLinks.js).
import { Fragment, useMemo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import I from '../icons'
import { PageHead, Card, Pill, Btn, Skeleton, ErrorBox, Empty } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi } from '../data'
import { money, shortDate } from '../lib/format'
import BarChart from '../charts/BarChart'
import { cashItems, forecast, isCounted } from '../lib/radarSeries'
import { readDrill, drillLink } from '../lib/aiLinks'
import { txDate } from '../lib/obligations'
import {
  lastMonths, profitRows, cashRows, burn3, runwayFrom, weekBuckets, cashOutDate, threeMonths, monthCompare, prevMonth,
} from '../lib/performance'
import { AskButton } from '../ai/AskPanel'
import { useAskContext } from '../ai/AskContext'
import AiText from '../ai/AiText'

const TABS = [['profit', '/business/performance'], ['cash', '/business/performance/cash'], ['forecast', '/business/performance/forecast']]
const loc = (lang) => (lang === 'ru' ? 'ru-RU' : lang === 'id' ? 'id-ID' : 'en-GB')
const mName = (k, lang, style = 'long') => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(loc(lang), style === 'short' ? { month: 'short' } : { month: 'long', year: 'numeric' }) }
const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null)

function Kpi({ label, value, sub, tone }) {
  return (
    <div className="v2-tile">
      <span className="v2-tile-label">{label}</span>
      <span className={`v2-tile-val v2-num ${tone || ''}`}>{value}</span>
      {sub && <span className="v2-tile-sub">{sub}</span>}
    </div>
  )
}

function Drill({ drill, tx, t, lang, clear }) {
  const c = useMemo(() => monthCompare(tx, drill.month, drill.compare), [tx, drill.month, drill.compare])
  const monthQ = t('perf.drill.askQ', { m: mName(drill.month, lang), c: drill.compare ? mName(drill.compare, lang) : '' })
  return (
    <div className="v2-page">
      <div className="v2-drillbar">
        <span className="v2-chip v2-chip-on">
          {drill.compare ? t('perf.drill.chip', { m: mName(drill.month, lang), c: mName(drill.compare, lang) }) : mName(drill.month, lang)}
          {drill.focus && <span className="v2-muted"> · {drill.focus.replace(/-/g, ' ')}</span>}
          <button type="button" className="v2-chip-x" onClick={clear} aria-label={t('perf.drill.clear')}><I.close size={14} /></button>
        </span>
        <button type="button" className="v2-btn-link" onClick={clear}>{t('perf.drill.all')}</button>
        <span className="v2-muted v2-small">{t('perf.drill.opened')}</span>
      </div>
      <div className="v2-tiles">
        <Kpi label={t('perf.drill.costsAdded')} value={money(c.costsNow - c.costsBefore, { sign: true })} sub={drill.compare ? t('perf.drill.fromTo', { a: money(c.costsBefore), b: money(c.costsNow) }) : null} />
        <Kpi label={t('perf.drill.revenueAdded')} value={money(c.revenueNow - c.revenueBefore, { sign: true })} sub={drill.compare ? t('perf.drill.fromTo', { a: money(c.revenueBefore), b: money(c.revenueNow) }) : null} />
        <Kpi label={t('perf.drill.records')} value={String(c.count)} sub={t('perf.cashBasis')} />
      </div>
      <div className="v2-grid-detail">
        <Card title={t('perf.drill.whatChanged', { m: mName(drill.month, lang) })} className="v2-col">
          {c.changes.length === 0 ? <p className="v2-muted">{t('perf.drill.noChange')}</p> : (
            <ul className="v2-changes">
              {c.changes.slice(0, 8).map((x) => (
                <li key={x.category}>
                  <span className="v2-dec-title">{x.category === '—' ? t('perf.noCategory') : x.category}</span>
                  <span className={`v2-num ${x.delta > 0 ? 'v2-neg' : 'v2-pos'}`}>{money(x.delta, { sign: true })}</span>
                  <span className="v2-muted v2-small v2-num">{money(x.before)} → {money(x.now)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <aside className="v2-col">
          <Card title={t('nav.cfo')}>
            <p className="v2-sec">{t('perf.drill.aiNote')}</p>
            <AskButton variant="primary" question={monthQ}>{t('perf.askCfo')}</AskButton>
          </Card>
        </aside>
      </div>
      {c.excluded.length > 0 && (
        <Card title={t('perf.drill.excluded')}>
          <p className="v2-muted v2-small">{t('perf.drill.excludedSub')}</p>
          <ul className="v2-moves">
            {c.excluded.map((x) => <li key={x.cls}><span>{t(`perf.cls.${x.cls}`)}</span><span className="v2-num">{money(x.amount, { sign: true })}</span></li>)}
          </ul>
        </Card>
      )}
      <Card title={t('perf.drill.payments', { m: mName(drill.month, lang) })} aside={<Link to="/business/transactions">{t('perf.drill.allTx')}</Link>}>
        {c.payments.length === 0 ? <p className="v2-muted">—</p> : (
          <ul className="v2-moves">
            {c.payments.map((p) => <li key={p.id}><span>{shortDate(txDate(p), lang)} · {p.description || '—'}{p.category && <span className="v2-muted"> · {p.category}</span>}</span><span className="v2-num">{money(-Number(p.amount_original), { sign: true })}</span></li>)}
          </ul>
        )}
      </Card>
    </div>
  )
}

function ProfitTab({ rows, sel, t, lang, needsReview, tx }) {
  const cur = rows.find((r) => r.month === sel) || rows[rows.length - 1]
  const prev = rows.find((r) => r.month === prevMonth(cur.month))
  const chartRows = rows.map((r) => ({ key: r.month, label: mName(r.month, lang), short: mName(r.month, lang, 'short'), values: { revenue: r.revenue, gross: r.gross, ebitda: r.ebitda, net: r.net } }))
  const cmp = monthCompare(tx, cur.month, prevMonth(cur.month))
  const noteLink = drillLink('performance', { month: cur.month, compare: prevMonth(cur.month), focus: 'costs' })
  const note = t('perf.profit.note', { m: mName(cur.month, lang), c: mName(prevMonth(cur.month), lang), costs: money(cmp.costsNow - cmp.costsBefore, { sign: true }), link: noteLink })
  return (
    <>
      <div className="v2-banner v2-tone-info" role="note">
        <Pill tone="info">{t('perf.estimate')}</Pill>
        <span className="v2-banner-text">{t('perf.estimateNote')}{needsReview > 0 && ` ${t('perf.needsReview', { n: needsReview })}`}</span>
        <Btn to="/business/accountant">{t('acct.tab.close')}</Btn>
      </div>
      <div className="v2-tiles">
        <Kpi label={t('perf.revenue', { m: mName(cur.month, lang, 'short') })} value={money(cur.revenue)} sub={prev && pct(cur.revenue, prev.revenue) != null ? t(cur.revenue >= prev.revenue ? 'perf.upOn' : 'perf.downOn', { n: Math.abs(pct(cur.revenue, prev.revenue)), m: mName(prev.month, lang, 'short') }) : null} />
        <Kpi label={t('perf.gross')} value={money(cur.gross, { sign: cur.gross < 0 })} sub={cur.margin != null ? t('perf.margin', { n: Math.round(cur.margin * 100) }) : null} />
        <Kpi label="EBITDA" value={money(cur.ebitda, { sign: cur.ebitda < 0 })} tone={cur.ebitda < 0 ? 'v2-neg' : ''} />
        <Kpi label={t('perf.net')} value={money(cur.net, { sign: cur.net < 0 })} tone={cur.net < 0 ? 'v2-neg' : ''} sub={t('perf.noDepreciation')} />
      </div>
      <Card>
        <p className="v2-sec v2-note-ai"><AiText text={note} /></p>
        <AskButton question={t('perf.profit.askQ', { m: mName(cur.month, lang) })}>{t('perf.askCfo')}</AskButton>
      </Card>
      <div className="v2-grid-2">
        <Card title={t('perf.chart.revGross')}><BarChart rows={chartRows} caption={t('perf.chart.revGross')} highlight={cur.month}
          series={[{ key: 'revenue', label: t('perf.revenueShort') }, { key: 'gross', label: t('perf.gross') }]} /></Card>
        <Card title={t('perf.chart.ebitdaNet')}><BarChart rows={chartRows} caption={t('perf.chart.ebitdaNet')} highlight={cur.month}
          series={[{ key: 'ebitda', label: 'EBITDA' }, { key: 'net', label: t('perf.net') }]} /></Card>
      </div>
      <div className="v2-grid-detail">
        <Card title={t('perf.waterfall', { m: mName(cur.month, lang) })} aside={<Pill tone="info">{t('perf.estimate')}</Pill>} className="v2-col">
          <dl className="v2-dl v2-dl-tight v2-waterfall">
            <dt>{t('perf.revenueShort')}</dt><dd className="v2-num v2-r">{money(cur.revenue)}</dd>
            <dt>{t('perf.direct')}</dt><dd className="v2-num v2-r">{money(-cur.direct, { sign: true })}</dd>
            <dt><strong>{t('perf.gross')}</strong>{cur.margin != null && <span className="v2-muted"> · {t('perf.margin', { n: Math.round(cur.margin * 100) })}</span>}</dt><dd className="v2-num v2-r"><strong>{money(cur.gross)}</strong></dd>
            <dt>{t('perf.opex')}</dt><dd className="v2-num v2-r">{money(-cur.opex, { sign: true })}</dd>
            <dt><strong>EBITDA</strong></dt><dd className="v2-num v2-r"><strong>{money(cur.ebitda)}</strong></dd>
            <dt>{t('perf.depreciation')}</dt><dd className="v2-r v2-muted">{t('perf.needsAssets')}</dd>
            <dt>{t('perf.interest')}</dt><dd className="v2-num v2-r">{money(-cur.interest, { sign: cur.interest > 0 })}</dd>
            <dt>{t('perf.incomeTax')}</dt><dd className="v2-num v2-r">{cur.ebitda - cur.interest > 0 ? money(-cur.tax, { sign: true }) : t('perf.lossNoTax')}</dd>
            <dt><strong>{t('perf.net')}</strong></dt><dd className="v2-num v2-r"><strong>{money(cur.net)}</strong></dd>
          </dl>
        </Card>
        <aside className="v2-col">
          <Card title={t('perf.where')} aside={<Link to="/business/transactions">{t('nav.transactions')}</Link>}>
            {cmp.changes.length === 0 && cmp.costsNow === 0 ? <p className="v2-muted">—</p> : (
              <ul className="v2-changes">
                {[...cmp.changes].sort((a, b) => b.now - a.now).slice(0, 8).map((x) => (
                  <li key={x.category}><span className="v2-dec-title">{x.category === '—' ? t('perf.noCategory') : x.category}</span>
                    <span className="v2-num">{money(x.now)}</span><span className="v2-muted v2-small v2-num">{t('perf.was', { v: money(x.before) })}</span></li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t('perf.howTitle')}>
            <ul className="v2-bullets">{['h1', 'h2', 'h3', 'h4', 'h5'].map((k) => <li key={k}>{t(`perf.how.${k}`)}</li>)}</ul>
          </Card>
          <Card title={t('perf.setupTitle')}><p className="v2-sec">{t('perf.setupText')}</p><Pill tone="warn">{t('placeholder.notSetUp')}</Pill></Card>
        </aside>
      </div>
    </>
  )
}

function CashTab({ rows, sel, cash, t, lang }) {
  const cur = rows.find((r) => r.month === sel) || rows[rows.length - 1]
  const currentKey = rows[rows.length - 1].month
  const burn = burn3(rows, currentKey)
  const runway = burn ? runwayFrom(cash, burn.monthly) : null
  const funding12 = rows.reduce((s, r) => s + r.funding, 0)
  const fundIn12 = rows.reduce((s, r) => s + r.fundingIn, 0), fundOut12 = rows.reduce((s, r) => s + r.fundingOut, 0)
  const lastCapex = [...rows].reverse().find((r) => r.equipment > 0)
  const flowRows = rows.map((r) => ({ key: r.month, label: mName(r.month, lang), short: mName(r.month, lang, 'short'), values: { operating: r.operating, equipment: -r.equipment, funding: r.funding } }))
  const endRows = rows.map((r) => ({ key: r.month, label: mName(r.month, lang), short: mName(r.month, lang, 'short'), values: { cash: r.endCash } }))
  return (
    <>
      <div className="v2-tiles">
        <Kpi label={t('perf.cash.operating', { m: mName(cur.month, lang, 'short') })} value={money(cur.operating, { sign: true })} tone={cur.operating < 0 ? 'v2-neg' : 'v2-pos'}
          sub={cur.incomplete ? <Pill tone="warn">{t('perf.cash.incomplete', { v: money(cur.unclassified) })}</Pill> : null} />
        <Kpi label={t('perf.cash.equipment', { m: mName(cur.month, lang, 'short') })} value={money(cur.equipment)} sub={lastCapex && lastCapex.month !== cur.month ? t('perf.cash.lastCapex', { v: money(lastCapex.equipment), m: mName(lastCapex.month, lang, 'short') }) : null} />
        <Kpi label={t('perf.cash.free', { m: mName(cur.month, lang, 'short') })} value={money(cur.free, { sign: true })} sub={t('perf.cash.freeSub')} />
        <Kpi label={t('perf.cash.funding12')} value={money(funding12, { sign: funding12 !== 0 })}
          sub={<>{t('perf.cash.fundingInOut', { a: money(fundIn12), b: money(fundOut12) })} · <Link to="/business/funding-investors">{t('nav.funding')}</Link></>} />
      </div>
      <Card title={t('perf.cash.whereTitle')}>
        <p className="v2-muted v2-small">{t('perf.cash.whereSub')}</p>
        <BarChart rows={flowRows} caption={t('perf.cash.whereTitle')} highlight={cur.month}
          series={[{ key: 'operating', label: t('perf.cash.operatingShort') }, { key: 'equipment', label: t('perf.cash.equipmentShort') }, { key: 'funding', label: t('perf.cash.fundingShort') }]} />
      </Card>
      <div className="v2-grid-detail">
        <Card title={t('perf.cash.endTitle')} className="v2-col">
          <p className="v2-muted v2-small">{t('perf.cash.endSub')}</p>
          <BarChart rows={endRows} caption={t('perf.cash.endTitle')} series={[{ key: 'cash', label: t('perf.cash.endShort') }]} />
        </Card>
        <aside className="v2-col">
          <Card title={t('perf.cash.burnTitle')}>
            {burn ? (
              <dl className="v2-dl v2-dl-tight">
                {burn.perMonth.map((m) => <Fragment key={m.month}><dt>{mName(m.month, lang)}</dt><dd className="v2-num v2-r">{money(m.value, { sign: true })}</dd></Fragment>)}
                <dt><strong>{t('perf.cash.avg')}</strong></dt><dd className="v2-num v2-r"><strong>{money(-burn.monthly, { sign: true })}</strong></dd>
                <dt>{t('perf.cash.runwayCalc', { cash: money(cash), burn: money(Math.abs(burn.monthly)) })}</dt>
                <dd className="v2-num v2-r"><strong>{runway == null ? t('perf.cash.notBurning') : t('pulse.daysN', { n: runway })}</strong></dd>
              </dl>
            ) : <p className="v2-muted">{t('perf.cash.noBurn')}</p>}
            {burn?.incomplete && <p><Pill tone="warn">{t('perf.cash.burnIncomplete')}</Pill></p>}
          </Card>
          <Card title={t('perf.cash.bridgeTitle')}>
            <p className="v2-sec">{t('perf.cash.bridgeNa')}</p><Pill tone="warn">{t('placeholder.notSetUp')}</Pill>
          </Card>
        </aside>
      </div>
    </>
  )
}

function ForecastTab({ pulse, obligations, burnMonthly, t, lang }) {
  const p = pulse
  // Pending approval is not counted (DECISIONS.md q2), same as Pulse and Radar.
  const items = cashItems({ debts: p.debts, obligations }).items.filter(isCounted)
  const f = forecast({ balance: p.totalBalance, burnRate: p.burnRate, items })
  const ins = items.filter((i) => i.dir === 'in'), outs = items.filter((i) => i.dir === 'out')
  const sum = (xs) => xs.reduce((s, x) => s + x.amount, 0)
  const lateIn = ins.filter((i) => i.tag === 'late')
  const out = cashOutDate({ days: f.days, burnMonthly })
  const weeks = weekBuckets(items).map((w) => ({ key: w.from, label: `${shortDate(w.from, lang)}–${shortDate(w.to, lang)}`, values: { in: w.in, out: -w.out } }))
  const three = threeMonths({ days: f.days, burnMonthly }).map((m) => ({ key: m.month, label: mName(m.month, lang), short: mName(m.month, lang, 'short'), values: { cash: m.cash } }))
  const List = ({ xs }) => (
    <ul className="v2-moves">{xs.map((x) => <li key={x.key}><span>{x.label}<span className="v2-muted"> · {shortDate(x.date, lang)}</span></span><span className="v2-num">{money(x.amount)}</span></li>)}</ul>
  )
  return (
    <>
      <div className="v2-tiles">
        <Kpi label={t('perf.fc.owed')} value={money(sum(ins), { sign: true })} sub={lateIn.length ? t('perf.fc.alreadyLate', { v: money(sum(lateIn)) }) : null} />
        <Kpi label={t('perf.fc.toPay')} value={money(-sum(outs), { sign: true })} sub={t('perf.fc.toPaySub')} />
        <Kpi label={t('perf.fc.cashOn', { d: shortDate(f.end.date, lang) })} value={money(f.end.value)} sub={<Link to="/business/radar">{t('perf.fc.withBurn')}</Link>} />
        <Kpi label={t('perf.fc.runsOut')} value={out ? `≈ ${shortDate(out.date, lang)}` : t('perf.fc.notRunningOut')} sub={out ? t(out.from === 'radar' ? 'perf.fc.inRadar' : 'perf.fc.ifBurn', { v: money(burnMonthly) }) : null} tone={out ? 'v2-neg' : ''} />
      </div>
      <div className="v2-grid-2">
        <Card title={t('perf.fc.byWeek')}><p className="v2-muted v2-small">{t('perf.fc.byWeekSub')}</p>
          <BarChart rows={weeks} caption={t('perf.fc.byWeek')} series={[{ key: 'in', label: t('pulse.comingIn') }, { key: 'out', label: t('pulse.goingOut') }]} /></Card>
        <Card title={t('perf.fc.three')}><p className="v2-muted v2-small">{t('perf.fc.threeSub')}</p>
          <BarChart rows={three} caption={t('perf.fc.three')} series={[{ key: 'cash', label: t('perf.cash.endShort') }]} /></Card>
      </div>
      <div className="v2-grid-2">
        <Card title={t('perf.fc.toPayList', { v: money(sum(outs)) })} aside={<Link to="/business/payables">{t('nav.bills')}</Link>}>{outs.length ? <List xs={outs} /> : <p className="v2-muted">—</p>}</Card>
        <Card title={t('perf.fc.toCollectList', { v: money(sum(ins)) })} aside={<Link to="/business/receivables">{t('bills.tab.collect')}</Link>}>{ins.length ? <List xs={ins} /> : <p className="v2-muted">—</p>}</Card>
      </div>
      <Card title={t('perf.fc.moveTitle')}>
        <p className="v2-sec">{t('perf.fc.moveText')}</p>
        <AskButton variant="primary" question={t('perf.fc.planQ')}>{t('perf.fc.plan')}</AskButton>
      </Card>
    </>
  )
}

export default function Performance() {
  const t = useT()
  const lang = useLang()
  const location = useLocation()
  const navigate = useNavigate()
  const tab = location.pathname.endsWith('/cash') ? 'cash' : location.pathname.endsWith('/forecast') ? 'forecast' : 'profit'
  const drill = readDrill(location.search)
  const drillOn = !!drill.month && (!!drill.compare || !!drill.focus)
  const months = useMemo(() => lastMonths(12), [])
  const sp = new URLSearchParams(location.search)
  const sel = sp.get('month') && months.includes(sp.get('month')) ? sp.get('month') : months[months.length - 2]
  const pulse = useApi('/pulse?scope=business')
  const ins = useApi(`/pulse/advanced-insights?scope=business&from=${months[0]}-01&to=${new Date().toISOString().slice(0, 10)}`)
  const tx = useApi('/transactions?period=all')
  const obl = useApi('/accountant/obligations')
  useAskContext(t('nav.performance'), drillOn ? mName(drill.month, lang) : mName(sel, lang))

  const series = ins.data?.series || []
  const txs = Array.isArray(tx.data) ? tx.data : []
  const pRows = useMemo(() => profitRows(series, months), [series, months])
  const cRows = useMemo(() => cashRows({ series, transactions: txs, balance: pulse.data?.totalBalance, months }), [series, txs, pulse.data, months])
  const burn = burn3(cRows, months[months.length - 1])
  const setMonth = (m) => { const n = new URLSearchParams(); n.set('month', m); navigate(`${location.pathname}?${n}`, { replace: true }) }

  const head = (
    <PageHead title={t('nav.performance')} sub={t('perf.sub')}
      actions={!drillOn && tab !== 'forecast' && (
        <select className="v2-select" value={sel} onChange={(e) => setMonth(e.target.value)} aria-label={t('acct.month')}>
          {[...months].reverse().map((m) => <option key={m} value={m}>{mName(m, lang)}</option>)}
        </select>
      )} />
  )
  const tabs = (
    <nav className="v2-tabs" aria-label={t('perf.views')}>
      {TABS.map(([k, to]) => <Link key={k} to={to} className={`v2-tab-link${tab === k ? ' is-on' : ''}`} aria-current={tab === k ? 'page' : undefined}>{t(`perf.tab.${k}`)}</Link>)}
    </nav>
  )
  if (ins.loading || pulse.loading) return <div className="v2-page">{head}{tabs}<Card><Skeleton rows={8} /></Card></div>
  const needTx = drillOn || tab !== 'forecast'
  if (needTx && tx.loading) return <div className="v2-page">{head}{tabs}<Card><Skeleton rows={8} /></Card></div>
  if (needTx && tx.error) return <div className="v2-page">{head}{tabs}<ErrorBox error={tx.error} onRetry={tx.reload} /></div>
  if (ins.error || pulse.error) return <div className="v2-page">{head}{tabs}<ErrorBox error={(ins.error || pulse.error)?.status === 403 ? t('perf.forbidden') : (ins.error || pulse.error)} onRetry={() => { ins.reload(); pulse.reload() }} /></div>

  const nothing = pRows.every((r) => r.empty) && !txs.length
  return (
    <div className="v2-page">
      {head}
      {tabs}
      {drillOn ? <Drill drill={drill} tx={txs} t={t} lang={lang} clear={() => navigate(location.pathname)} />
        : nothing ? <Card><Empty icon={<I.performance size={28} />} title={t('perf.emptyTitle')} text={t('perf.emptyText')} action={<Btn variant="primary" to="/business/bank-import">{t('acc.import')}</Btn>} /></Card>
        : tab === 'profit' ? <ProfitTab rows={pRows} sel={sel} t={t} lang={lang} needsReview={Number(ins.data?.needs_review_count) || 0} tx={txs} />
        : tab === 'cash' ? <CashTab rows={cRows} sel={sel} cash={pulse.data?.totalBalance} t={t} lang={lang} />
        : <ForecastTab pulse={pulse.data} obligations={obl.data?.obligations || []} burnMonthly={burn?.monthly} t={t} lang={lang} />}
    </div>
  )
}
