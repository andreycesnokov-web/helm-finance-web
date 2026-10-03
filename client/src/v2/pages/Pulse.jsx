// Pulse v2 (designs/Main, PulseMobile). Reads the same GET /api/pulse the
// existing Pulse reads, plus GET /api/accountant/summary (read-only; upcoming
// deadlines from the verified tax engine) for the tax decision row.
//
// Cash view only (DESIGN_SPEC rule 4): every figure here is money that moved or
// is due to move. "Money in/out" are the server's OPERATING figures for the
// current month (pulse.operating), labelled as such — not last 30 days, because
// that is not what the API returns. Nothing on this page writes: "Approve" and
// "Send reminder" are links to the screens where a person acts.
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { Page, Card, Btn, Pill, Ico, Kpi, Loading, ErrorBox, Num, Note } from '../ui'
import { useV2T, LOCALE } from '../lib/i18n'
import { useV2Data, PULSE_PATH } from '../lib/data'
import { buildForecast, nextDays } from '../lib/forecast'
import { openApprovedDebts, pendingDebts, remainingOf } from '../lib/counts'
import { money, dayMonth, longDate, weekdayShort, daysFromToday } from '../lib/format'
import { canApprove } from '../lib/roles'
import { P } from '../routes'
import { pulseStatus } from '../lib/pulseStatus'

function DecisionRow({ icon, tone, title, sub, amount, amountTone, actions }) {
  return (
    <div className="v2-row v2-decision">
      <span className={`v2-tile-ic${tone ? ' is-' + tone : ''}`}><Ico name={icon} size={20} /></span>
      <div className="v2-row-main">
        <div className="v2-row-title">{title}</div>
        {sub && <div className="v2-row-sub">{sub}</div>}
      </div>
      {amount && <Num className="v2-row-amt" tone={amountTone}>{amount}</Num>}
      <div className="v2-row-actions">{actions}</div>
    </div>
  )
}

export default function Pulse() {
  const { t, lang } = useV2T()
  const locale = LOCALE[lang]
  const { active } = useWorkspace()
  const pulse = useV2Data(PULSE_PATH)
  const tax = useV2Data('/accountant/summary', { silent: true })
  const fc = useMemo(() => (pulse.data ? buildForecast(pulse.data) : null), [pulse.data])
  const now = new Date()

  const bell = (
    <Btn variant="secondary" to={P.approvals} icon="bell" aria-label={t('nav.approvals')} className="v2-only-desk v2-btn-icon" />
  )
  const head = { title: t('nav.pulse'), sub: `${longDate(now, locale)} · ${t('pulse.updatedNow')}` }
  if (pulse.loading) return <Page {...head}><Card hero><Loading rows={4} /></Card></Page>
  if (pulse.error) return <Page {...head}><ErrorBox error={pulse.error} onRetry={pulse.reload} /></Page>

  const d = pulse.data || {}
  const st = pulseStatus(d)
  const debts = d.debts || []
  const open = openApprovedDebts(debts)
  const pending = pendingDebts(debts)
  const lateIn = open.filter((x) => x.type === 'receivable' && x.status === 'overdue')
  const lateOut = open.filter((x) => x.type === 'payable' && x.status === 'overdue')
  const payablesOpen = open.filter((x) => x.type === 'payable')
  const sum = (arr) => arr.reduce((s, x) => s + remainingOf(x), 0)
  const accounts = (d.accounts || []).length
  const opIn = Number(d.operating?.revenue ?? d.income ?? 0)
  const opOut = Number(d.operating?.cash_out ?? d.expenses ?? 0)
  const net = opIn - opOut
  const burnMonth = Number(d.burnRate || 0) * 30
  const mayApprove = canApprove(active?.role)

  // Upcoming tax deadline within 21 days, from the engine's stored events.
  const taxNext = (tax.data?.upcoming || []).find((e) => e.days >= 0 && e.days <= 21 && !['paid', 'filed'].includes(e.status))

  const decisions = []
  for (const x of pending.slice(0, 3)) {
    decisions.push(<DecisionRow key={x.id} icon={x.type === 'payable' ? 'receipt' : 'checkCircle'}
      title={t(x.type === 'payable' ? 'pulse.approveBill' : 'pulse.approveItem', { name: x.counterparty || '—' })}
      sub={[x.description, x.due_date ? t('pulse.due', { date: dayMonth(x.due_date, locale) }) : null].filter(Boolean).join(' · ')}
      amount={money(remainingOf(x))}
      actions={<>
        <Btn to={x.type === 'payable' ? P.billDetail(x.id) : P.invoiceDetail(x.id)}>{t('pulse.review')}</Btn>
        {mayApprove && <Btn variant="primary" to={P.approvals}>{t('pulse.approve')}</Btn>}
      </>} />)
  }
  for (const x of lateIn.slice(0, 2)) {
    decisions.push(<DecisionRow key={x.id} icon="clock" tone="critical"
      title={t('pulse.lateBy', { name: x.counterparty || '—', n: x.days_overdue || Math.max(0, -daysFromToday(x.due_date)) })}
      sub={[x.description, x.due_date ? t('pulse.wasDue', { date: dayMonth(x.due_date, locale) }) : null].filter(Boolean).join(' · ')}
      amount={money(remainingOf(x), { sign: true })} amountTone="pos"
      actions={<Btn variant="primary" to={P.receivables}>{t('pulse.sendReminder')}</Btn>} />)
  }
  if (taxNext) {
    decisions.push(<DecisionRow key="tax" icon="warn" tone="warning" title={taxNext.title}
      sub={t('pulse.taxSub', { date: dayMonth(taxNext.due_date, locale), n: taxNext.days })}
      actions={<Btn to={P.accountantTaxes}>{t('pulse.prepare')}</Btn>} />)
  }

  const nd = nextDays(fc, 7)
  const headline = st.key === 'unknown' ? t('pulse.hUnknown')
    : t(`pulse.h_${st.key}`, { n: st.runway })
  const bodyParts = []
  if (burnMonth > 0) bodyParts.push(t('pulse.bBurn', { v: money(burnMonth) }))
  if (Number(d.receivables) > 0 || Number(d.payables) > 0) bodyParts.push(t('pulse.bOwed', { in: money(d.receivables), out: money(d.payables) }))
  if (fc.worstLow.worst < fc.balance) bodyParts.push(t('pulse.bWorst', { v: money(fc.worstLow.worst), date: dayMonth(fc.worstLow.date, locale) }))

  return (
    <Page {...head} actions={bell}>
      <Card hero className="v2-pulse-hero">
        <div className="v2-hero-story">
          <Pill tone={st.tone} dot>{t(`pulse.st_${st.key}`)}</Pill>
          <h2 className="v2-hero-h">{headline}</h2>
          {bodyParts.length > 0 && <p className="v2-hero-p">{bodyParts.join(' ')}</p>}
          <Link to={P.radar} className="v2-hero-link v2-only-desk">{t('pulse.seeForecast')}<Ico name="chevRight" size={16} /></Link>
        </div>
        <div className="v2-hero-figs">
          <div className="v2-hero-cash">
            <div className="v2-hero-label">{t('pulse.cashNow')}</div>
            <div className="v2-hero-big v2-num">{money(d.totalBalance)}</div>
            <div className="v2-hero-meta">{t('pulse.accountsMeta', { n: accounts })}</div>
          </div>
          <div className="v2-hero-split">
            <div className="v2-hero-cell">
              <div className="v2-hero-label">{t('pulse.runway')}</div>
              <div className="v2-hero-mid v2-num">{st.runway === null ? '—' : t('pulse.days', { n: st.runway })}</div>
              <div className="v2-hero-meta">{t('pulse.noTarget')}</div>
            </div>
            <div className="v2-hero-cell">
              <div className="v2-hero-label">{t('pulse.netMonth')}</div>
              <div className={`v2-hero-mid v2-num${net < 0 ? ' is-neg-inv' : net > 0 ? ' is-pos-inv' : ''}`}>{money(net, { sign: true })}</div>
              <div className="v2-hero-meta">{t('pulse.inOut', { in: money(opIn), out: money(opOut) })}</div>
            </div>
          </div>
          <Link to={P.radar} className="v2-hero-worst v2-only-phone">
            <span>{t('pulse.worstCase', { v: money(fc.worstLow.worst), date: dayMonth(fc.worstLow.date, locale) })}</span><Ico name="chevRight" size={16} />
          </Link>
        </div>
      </Card>

      <div className="v2-grid v2-grid-main">
        <Card title={t('pulse.needsDecision')} action={<span className="v2-cardsub v2-strong">{t('pulse.items', { n: decisions.length })}</span>}>
          {decisions.length ? <div className="v2-rows">{decisions}</div>
            : <Note tone="info" icon="checkCircle">{t('pulse.nothingToDecide')}</Note>}
        </Card>

        <Card title={t('pulse.next7')} action={<Btn variant="ghost" size="sm" to={P.radar}>{t('pulse.fullForecast')}</Btn>}>
          <div className="v2-next-tiles">
            <div className="v2-next-tile is-in"><div className="v2-kpi-label">{t('pulse.comingIn')}</div>
              <div className="v2-next-val v2-num is-pos">{money(nd.inSum, { sign: true })}</div></div>
            <div className="v2-next-tile"><div className="v2-kpi-label">{t('pulse.goingOut')}</div>
              <div className="v2-next-val v2-num">{money(-nd.outSum)}</div></div>
          </div>
          {nd.items.length ? <div className="v2-rows v2-next-rows">{nd.items.slice(0, 5).map((it) => (
            <div key={it.id} className="v2-row">
              <span className="v2-next-day"><span>{it.overdue ? t('pulse.late') : weekdayShort(it.due_date, locale)}</span>
                <strong>{new Date(it.due_date).getDate()}</strong></span>
              <div className="v2-row-main"><div className="v2-row-title">{it.counterparty || it.description || '—'}</div>
                {it.pending && <div className="v2-row-sub">{t('radar.stPending')}</div>}</div>
              <Num tone={it.dir === 'in' ? 'pos' : null} className="v2-row-amt">{money(it.dir === 'in' ? it.amount : -it.amount, { sign: true })}</Num>
            </div>))}</div>
            : <p className="v2-cardsub">{t('pulse.nothingDue')}</p>}
          {Number(d.burnRate) > 0 && <p className="v2-cardsub">{t('pulse.dailyNote', { v: money(d.burnRate) })}</p>}
          <div className="v2-next-foot"><span>{t('pulse.cashOn', { date: dayMonth(nd.date, locale) })}</span>
            <Num className="v2-strong">≈ {money(nd.cashOnDay)}</Num></div>
        </Card>
      </div>

      <Card flush>
        <div className="v2-kpis">
          <Kpi label={t('pulse.moneyIn')} value={money(opIn)} meta={t('pulse.thisMonthOp')} />
          <Kpi label={t('pulse.moneyOut')} value={money(opOut)} meta={t('pulse.thisMonthOp')} />
          <Kpi label={t('pulse.owedToYou')} value={money(d.receivables)}
            meta={lateIn.length ? t('pulse.lateSum', { v: money(sum(lateIn)) }) : t('pulse.nothingLate')} metaTone={lateIn.length ? 'neg' : null} />
          <Kpi label={t('pulse.youOwe')} value={money(d.payables)}
            meta={lateOut.length ? t('pulse.overdueSum', { v: money(sum(lateOut)) }) : t('pulse.billsNothingOverdue', { n: payablesOpen.length })}
            metaTone={lateOut.length ? 'neg' : null} />
        </div>
      </Card>
      {Number(d.needs_review_count) > 0 && (
        <Note tone="warning" icon="warn" action={<Btn size="sm" to={P.transactions}>{t('pulse.review')}</Btn>}>
          {t('pulse.needsCategory', { n: d.needs_review_count })}
        </Note>
      )}
    </Page>
  )
}
