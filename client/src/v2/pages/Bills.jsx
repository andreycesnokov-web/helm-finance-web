// Bills & invoices v2 (designs/Bills, MobileBills). One page, three entry routes:
// /business/receivables → To collect, /business/payables → To pay,
// /business/invoices → Invoices (the existing invoice-document hub, unchanged).
//
// Data: GET /api/debts and GET /api/wallets. Actions reuse the existing modals
// verbatim — DebtPaymentModal (mark paid / received → POST /api/debts/:id/pay) and
// DebtFormModal (add a bill / invoice). No new write path.
import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import DebtPaymentModal from '../../components/DebtPaymentModal'
import DebtFormModal from '../../components/DebtFormModal'
import { BusinessInvoices, BusinessPayables, BusinessReceivables } from '../../pages/business'
import { useView } from '../lib/useView'
import { Page, Card, Btn, Pill, Tabs, Kpi, Loading, ErrorBox, Empty, Num, ViewSwitch } from '../ui'
import { useV2T, LOCALE } from '../lib/i18n'
import { useV2Data, useV2Invalidate } from '../lib/data'
import { summarize, rowsFor, debtStatus, isPending, asList } from '../lib/debts'
import { remainingOf } from '../lib/counts'
import { canApprove } from '../lib/roles'
import { money, dayMonth } from '../lib/format'
import { P } from '../routes'

const TAB_BY_PATH = { [P.receivables]: 'collect', [P.payables]: 'pay', [P.invoices]: 'invoices' }
const PATH_BY_TAB = { collect: P.receivables, pay: P.payables, invoices: P.invoices }

export default function Bills() {
  const { t, lang } = useV2T()
  const locale = LOCALE[lang]
  const { token } = useAuth()
  const { active } = useWorkspace()
  const location = useLocation()
  const navigate = useNavigate()
  const tab = TAB_BY_PATH[location.pathname] || 'pay'
  const [which, setWhich] = useState('open')
  const [view, setView] = useView()
  const [payDebt, setPayDebt] = useState(null)
  const [create, setCreate] = useState(null)   // 'payable' | 'receivable'
  const debtsQ = useV2Data('/debts')
  const walletsQ = useV2Data('/wallets', { silent: true })
  const invalidate = useV2Invalidate()
  const mayAct = canApprove(active?.role)

  const debts = asList(debtsQ.data)
  const sum = useMemo(() => summarize(debts), [debts])
  const reload = () => { invalidate('/debts'); invalidate('/pulse'); invalidate('/wallets'); debtsQ.reload() }

  const actions = <>
    {tab !== 'invoices' && <ViewSwitch view={view} onChange={setView} overviewLabel={t('view.overview')} manageLabel={t('view.manage')} />}
    <Btn icon="plus" onClick={() => setCreate('payable')}>{t('bills.addBill')}</Btn>
    <Btn variant="primary" icon="plus" onClick={() => setCreate('receivable')}>{t('bills.newInvoice')}</Btn>
  </>
  const tabs = (
    <Tabs label={t('nav.bills')} active={tab} items={[
      { key: 'collect', label: t('bills.tabCollect'), to: PATH_BY_TAB.collect, badge: sum.in.count || null },
      { key: 'pay', label: t('bills.tabPay'), to: PATH_BY_TAB.pay, badge: sum.out.count || null },
      { key: 'invoices', label: t('bills.tabInvoices'), to: PATH_BY_TAB.invoices },
    ]} />
  )

  const rowAction = (d) => {
    if (d.status === 'paid') return <Btn size="sm" variant="ghost" to={P.transactions}>{t('bills.paid')}</Btn>
    if (isPending(d)) return <Btn size="sm" to={d.type === 'payable' ? P.billDetail(d.id) : P.invoiceDetail(d.id)}>{t('bills.review')}</Btn>
    if (d.type === 'receivable' && d.status === 'overdue') return <Btn size="sm" notYet>{t('bills.sendReminder')}</Btn>
    if (mayAct) return <Btn size="sm" onClick={() => setPayDebt(d)}>{d.type === 'payable' ? t('bills.markPaid') : t('bills.markReceived')}</Btn>
    return <Btn size="sm" to={d.type === 'payable' ? P.billDetail(d.id) : P.invoiceDetail(d.id)}>{t('bills.open')}</Btn>
  }

  const list = (type) => {
    const rows = rowsFor(debts, type, which)
    const detail = (d) => (type === 'payable' ? P.billDetail(d.id) : P.invoiceDetail(d.id))
    if (!rows.length) return <Empty icon="receipt" title={t(which === 'paid' ? 'bills.noPaid' : type === 'payable' ? 'bills.noBills' : 'bills.noInvoices')}
      action={which === 'open' && <Btn variant="primary" icon="plus" onClick={() => setCreate(type)}>{t(type === 'payable' ? 'bills.addBill' : 'bills.newInvoice')}</Btn>} />
    return <>
      <div className="v2-table-wrap v2-only-desk"><table className="v2-table v2-table-bills">
        <thead><tr><th>{t(type === 'payable' ? 'bills.colSupplier' : 'bills.colCustomer')}</th><th>{t(type === 'payable' ? 'bills.colBill' : 'bills.colInvoice')}</th>
          <th>{t('bills.colDue')}</th><th>{t('bills.colStatus')}</th><th className="r">{t('bills.colAmount')}</th><th className="r"><span className="v2-sr">{t('bills.colAction')}</span></th></tr></thead>
        <tbody>{rows.map((d) => { const st = debtStatus(d); return (
          <tr key={d.id}>
            <td className="ellipsis"><Link className="v2-rowlink" to={detail(d)}>{d.counterparty || '—'}</Link></td>
            <td className="ellipsis is-muted">{d.description || '—'}</td>
            <td>{d.due_date ? dayMonth(d.due_date, locale) : '—'}</td>
            <td><Pill tone={st.tone}>{t(`bills.st.${st.key}`, { n: d.days_overdue || 0 })}</Pill></td>
            <td className="r"><Num>{money(d.status === 'paid' ? (d.original_amount || d.amount) : remainingOf(d))}</Num></td>
            <td className="r">{rowAction(d)}</td>
          </tr>) })}</tbody>
      </table></div>
      <ul className="v2-cards-list v2-only-phone">{rows.map((d) => { const st = debtStatus(d); return (
        <li key={d.id} className="v2-billcard">
          <Link to={detail(d)} className="v2-billcard-top">
            <span className="v2-billcard-name">{d.counterparty || '—'}</span>
            <Num className="v2-strong">{money(d.status === 'paid' ? (d.original_amount || d.amount) : remainingOf(d))}</Num>
          </Link>
          <div className="v2-billcard-meta"><Pill tone={st.tone}>{t(`bills.st.${st.key}`, { n: d.days_overdue || 0 })}</Pill>
            {d.due_date && <span>{t('bills.dueOn', { date: dayMonth(d.due_date, locale) })}</span>}</div>
          <div className="v2-billcard-act">{rowAction(d)}</div>
        </li>) })}</ul>
    </>
  }

  return (
    <Page title={t('nav.bills')} sub={t('bills.sub')} actions={actions}>
      {debtsQ.error ? <ErrorBox error={debtsQ.error} onRetry={debtsQ.reload} /> : debtsQ.loading ? <Card><Loading rows={5} /></Card> : <>
        <div className="v2-grid v2-grid-2">
          <Card className="v2-sumcard"><Kpi label={t('bills.owedToYou', { n: sum.in.count })} value={money(sum.in.total)}
            meta={[sum.in.late ? t('bills.lateSum', { v: money(sum.in.late) }) : null, t('bills.due14', { v: money(sum.in.due14) })].filter(Boolean).join(' · ')}
            metaTone={sum.in.late ? 'neg' : null} /></Card>
          <Card className="v2-sumcard"><Kpi label={t('bills.youOwe', { n: sum.out.count })} value={money(sum.out.total)}
            meta={[sum.out.pending ? t('bills.pendingSum', { v: money(sum.out.pending) }) : null,
              sum.out.late ? t('bills.overdueSum', { v: money(sum.out.late) }) : t('bills.nothingOverdue')].filter(Boolean).join(' · ')} /></Card>
        </div>
        <div className="v2-billsbar">{tabs}
          {tab !== 'invoices' && <Tabs size="sm" label={t('bills.filter')} active={which} onChange={setWhich}
            items={[{ key: 'open', label: t('bills.open') }, { key: 'paid', label: t('bills.paid') }]} />}
        </div>
        {tab === 'invoices' ? <div className="v2-legacy-embed"><BusinessInvoices /></div>
          : view === 'manage' ? <div className="v2-legacy-embed">{tab === 'collect' ? <BusinessReceivables /> : <BusinessPayables />}</div>
          : <Card flush className="v2-pad-table">{list(tab === 'collect' ? 'receivable' : 'payable')}</Card>}
      </>}

      {payDebt && <DebtPaymentModal debt={payDebt} accounts={walletsQ.data?.wallets || []} token={token}
        onClose={() => setPayDebt(null)} onSuccess={() => { setPayDebt(null); reload() }} />}
      {create && <DebtFormModal mode={create} token={token} lockBusinessScope
        onClose={() => setCreate(null)}
        onSuccess={() => { const c = create; setCreate(null); reload(); navigate(PATH_BY_TAB[c === 'payable' ? 'pay' : 'collect']) }} />}
    </Page>
  )
}
