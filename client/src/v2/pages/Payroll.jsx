// Payroll v2 (designs/Payroll). GET /api/payroll/overview (existing; owner/CFO
// roles). Shows people, gross pay and the last runs with their recorded
// deductions. PPh 21 is NOT calculated here — TER rates belong to the verified
// tax engine; a figure appears only where a payroll run recorded a withholding
// line. Running payroll, adding people and editing stay in the existing page.
import PayrollLegacy from '../../pages/Payroll'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { Page, Card, Btn, Pill, Kpi, Loading, ErrorBox, Empty, Num, Note, ViewSwitch } from '../ui'
import { useV2T, LOCALE } from '../lib/i18n'
import { useV2Data } from '../lib/data'
import { useView } from '../lib/useView'
import { canApprove } from '../lib/roles'
import { money, dayMonth } from '../lib/format'
import { askLink } from '../lib/ask'
import { runBreakdown } from '../lib/derive'



export default function Payroll() {
  const { t, lang } = useV2T()
  const locale = LOCALE[lang]
  const { active } = useWorkspace()
  const [view, setView] = useView()
  const allowed = canApprove(active?.role)
  const q = useV2Data(view === 'overview' && allowed ? '/payroll/overview' : null)

  const actions = <>
    <ViewSwitch view={view} onChange={setView} overviewLabel={t('view.overview')} manageLabel={t('view.manage')} />
    <Btn variant="primary" icon="plus" onClick={() => setView('manage')}>{t('pay.addPerson')}</Btn>
  </>
  if (view === 'manage') return <Page title={t('nav.payroll')} actions={actions}><div className="v2-legacy-embed"><PayrollLegacy /></div></Page>
  if (!allowed) return <Page title={t('nav.payroll')}><Note tone="warning" icon="lock">{t('pay.noAccess')}</Note></Page>

  const d = q.data || {}
  const emps = d.employees || []
  const pays = d.payments || []
  const last = pays.find((p) => p.status === 'paid') || pays[0]
  const lb = last ? runBreakdown(last) : null
  const monthlyGross = emps.reduce((s, e) => s + Number(e.default_salary || 0), 0)

  return (
    <Page title={t('nav.payroll')} sub={t('pay.sub', { n: emps.length })} actions={actions}>
      {q.error ? <ErrorBox error={q.error} onRetry={q.reload} /> : q.loading ? <Card><Loading rows={6} /></Card> : emps.length === 0 && pays.length === 0
        ? <Card><Empty icon="userPlus" title={t('pay.empty')} body={t('pay.emptyBody')} action={<Btn variant="primary" onClick={() => setView('manage')}>{t('pay.addPerson')}</Btn>} /></Card> : <>
        <Card flush><div className="v2-kpis">
          <Kpi label={t('pay.paidThisMonth')} value={money(d.summary?.paid_this_month || 0)} meta={t('pay.runsThisMonth', { n: d.summary?.payments_this_month || 0 })} />
          <Kpi label={t('pay.monthlyGross')} value={money(monthlyGross)} meta={t('pay.fromSalaries', { n: emps.length })} />
          <Kpi label={t('pay.pph21')} value={lb?.hasTaxLine ? money(lb.tax) : '—'} meta={lb?.hasTaxLine ? t('pay.lastRun') : t('pay.noTaxLine')} />
          <Kpi label={t('pay.lastRunLabel')} value={last ? money(lb.net) : '—'} meta={last ? dayMonth(last.payment_date, locale) : t('pay.noRuns')} />
        </div></Card>

        <Card title={t('pay.people')} flush className="v2-pad-table">
          <div className="v2-table-wrap"><table className="v2-table">
            <thead><tr><th>{t('pay.person')}</th><th>{t('pay.role')}</th><th className="r">{t('pay.gross')}</th><th className="r">{t('pay.payDay')}</th></tr></thead>
            <tbody>{emps.map((e) => <tr key={e.id}><td className="v2-strong">{e.name}</td><td className="v2-small">{e.role || '—'}</td>
              <td className="r"><Num>{money(e.default_salary || 0, { currency: e.currency || 'IDR' })}</Num></td><td className="r v2-small">{e.pay_day || '—'}</td></tr>)}</tbody>
          </table></div>
        </Card>

        <Card title={t('pay.recentRuns')}>
          {pays.length === 0 ? <p className="v2-cardsub">{t('pay.noRuns')}</p> : <div className="v2-rows">{pays.slice(0, 8).map((p) => { const b = runBreakdown(p); return (
            <div key={p.id} className="v2-row">
              <div className="v2-row-main"><div className="v2-row-title">{(emps.find((e) => e.id === p.employee_id) || {}).name || p.employee_name || p.period_month || '—'}</div>
                <div className="v2-row-sub">{[p.period_month, p.payment_date ? dayMonth(p.payment_date, locale) : null, b.hasTaxLine ? t('pay.taxWithheld', { v: money(b.tax) }) : null].filter(Boolean).join(' · ')}</div></div>
              <Pill tone={p.status === 'paid' ? 'good' : 'neutral'}>{t(p.status === 'paid' ? 'pay.stPaid' : 'pay.stOther')}</Pill>
              <Num className="v2-row-amt">{money(b.net)}</Num>
            </div>) })}</div>}
        </Card>

        <Note tone="info" icon="book">{t('pay.terNote')}</Note>
        <Card title={t('pay.hiringTitle')} sub={t('pay.hiringSub')}>
          <Btn to={askLink({ page: 'payroll', q: t('pay.hiringQ') })} icon="spark">{t('pay.askCfo')}</Btn>
        </Card>
      </>}
    </Page>
  )
}
