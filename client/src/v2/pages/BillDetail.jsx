// Bill / invoice detail v2 (designs/BillDetail) at /business/payables/:id and
// /business/receivables/:id. Read-only:
//   GET /api/debts                       — the record (business-scoped list)
//   GET /api/invoices/:id/settlement     — paid / remaining, document checklist,
//                                          closeout gates (existing, read-only)
//   GET /api/pulse?scope=business        — cash effect on Radar (shared cache)
// Approve / Reject / Ask link to Approvals, where those existing actions live.
// The tax split is NOT computed here: rates come only from the verified engine,
// through the existing AI Tax Split flow, which this page links to.
import { useMemo } from 'react'
import { Link, useParams, useLocation } from 'react-router-dom'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { Page, Card, Btn, Pill, Loading, ErrorBox, Empty, Num, Note, Ico } from '../ui'
import { useV2T, LOCALE } from '../lib/i18n'
import { useV2Data, PULSE_PATH } from '../lib/data'
import { debtStatus, isPending, asList } from '../lib/debts'
import { remainingOf } from '../lib/counts'
import { buildForecast, dayIndex } from '../lib/forecast'
import { canApprove } from '../lib/roles'
import { money, moneyExact, dayMonth } from '../lib/format'
import { P } from '../routes'

const DOC_LABEL = { invoice: 'bd.docInvoice', tax_invoice: 'bd.docTaxInvoice', payment_proof: 'bd.docProof', contract: 'bd.docContract', accountant_confirmation: 'bd.docAccountant' }

export default function BillDetail() {
  const { t, lang } = useV2T()
  const locale = LOCALE[lang]
  const { id } = useParams()
  const location = useLocation()
  const isReceivable = location.pathname.startsWith(P.receivables)
  const { active } = useWorkspace()
  const debtsQ = useV2Data('/debts')
  const settleQ = useV2Data(id ? `/invoices/${encodeURIComponent(id)}/settlement` : null, { silent: true })
  const pulse = useV2Data(PULSE_PATH, { silent: true })
  const back = isReceivable ? P.receivables : P.payables

  const debt = asList(debtsQ.data).find((d) => String(d.id) === String(id))
  const fc = useMemo(() => (pulse.data ? buildForecast(pulse.data) : null), [pulse.data])
  const crumb = <Link to={back} className="v2-crumb"><Ico name="chevLeft" size={16} />{t('nav.bills')}</Link>

  if (debtsQ.loading) return <Page>{crumb}<Card><Loading rows={6} /></Card></Page>
  if (debtsQ.error) return <Page>{crumb}<ErrorBox error={debtsQ.error} onRetry={debtsQ.reload} /></Page>
  if (!debt) return <Page>{crumb}<Card><Empty icon="receipt" title={t('bd.notFound')} body={t('bd.notFoundBody')}
    action={<Btn variant="primary" to={back}>{t('nav.bills')}</Btn>} /></Card></Page>

  const st = debtStatus(debt)
  const pending = isPending(debt)
  const mayApprove = canApprove(active?.role)
  const s = settleQ.data
  const total = Number(debt.original_amount || debt.amount || 0)
  const day = dayIndex(debt.due_date)
  const inLine = fc && day !== null && day <= fc.horizon
  const checklist = s?.closeout?.checklist?.filter((c) => c.required || c.present) || null

  return (
    <Page>
      {crumb}
      <Card>
        <div className="v2-bd-head">
          <div className="v2-bd-id">
            <Pill tone={st.tone}>{t(`bills.st.${st.key}`, { n: debt.days_overdue || 0 })}</Pill>
            <h1 className="v2-h1 v2-bd-name">{debt.counterparty || '—'}</h1>
            <div className="v2-bd-amt"><Num>{moneyExact(total, debt.currency || 'IDR')}</Num>
              <span className="is-muted"> · {[debt.description, debt.due_date ? t('pulse.due', { date: dayMonth(debt.due_date, locale) }) : null].filter(Boolean).join(' · ')}</span></div>
          </div>
          {pending && mayApprove && <div className="v2-row-actions">
            <Btn to={P.approvals} variant="secondary">{t('appr.reject')}</Btn>
            <Btn to={P.approvals}>{t('appr.ask')}</Btn>
            <Btn variant="primary" to={P.approvals}>{t('pulse.approve')}</Btn>
          </div>}
        </div>
      </Card>

      <div className="v2-grid v2-grid-main">
        <div className="v2-stack">
          <Card title={t(isReceivable ? 'bd.whatYouGet' : 'bd.whatYouPay')} sub={t('bd.splitSub')}>
            <div className="v2-bd-lines">
              <div className="v2-bd-line"><span>{t('bd.invoiceTotal')}</span><Num className="v2-strong">{money(total)}</Num></div>
              {s?.settlement && <div className="v2-bd-line"><span>{t('bd.paidSoFar')}</span><Num>{money(s.settlement.paid_amount ?? debt.paid_amount ?? 0)}</Num></div>}
              <div className="v2-bd-line"><span>{t('bd.remaining')}</span><Num className="v2-strong">{money(remainingOf(debt))}</Num></div>
            </div>
            <Note tone="info" icon="book" action={<Btn size="sm" to="/business/accountant/tax-split">{t('bd.openTaxSplit')}</Btn>}>
              {t('bd.taxNote')}
            </Note>
          </Card>

          <Card title={t('bd.details')}>
            <dl className="v2-dl">
              <dt>{t(isReceivable ? 'bills.colCustomer' : 'bills.colSupplier')}</dt><dd><Link to={P.counterparties} className="v2-rowlink">{debt.counterparty || '—'}</Link></dd>
              {s?.invoice?.document_number && <><dt>{t('bd.number')}</dt><dd>{s.invoice.document_number}</dd></>}
              <dt>{t('bd.dueDate')}</dt><dd>{debt.due_date ? dayMonth(debt.due_date, locale) : '—'}</dd>
              {debt.description && <><dt>{t('bd.description')}</dt><dd>{debt.description}</dd></>}
              {debt.category && <><dt>{t('bd.category')}</dt><dd>{debt.category}</dd></>}
              <dt>{t('bd.created')}</dt><dd>{debt.created_at ? dayMonth(debt.created_at, locale) : '—'}{debt.source_channel || debt.created_via ? ` · ${debt.source_channel || debt.created_via}` : ''}</dd>
              {debt.approved_at && <><dt>{t('bd.decided')}</dt><dd>{dayMonth(debt.approved_at, locale)}{debt.approved_via_channel ? ` · ${debt.approved_via_channel}` : ''}</dd></>}
              {debt.rejected_reason && <><dt>{t('bd.reason')}</dt><dd>{debt.rejected_reason}</dd></>}
            </dl>
          </Card>
        </div>

        <div className="v2-stack">
          <Card title={t('bd.cashEffect')}>
            {inLine ? <>
              <div className="v2-bd-line"><span>{t('bd.cashAfter', { date: dayMonth(debt.due_date, locale) })}</span><Num className="v2-strong">{money(fc.cashAfter(Math.max(day, 1)))}</Num></div>
              <div className="v2-bd-line"><span>{t('bd.lowest', { date: dayMonth(fc.lowest.date, locale) })}</span><Num>{money(fc.lowest.expected)}</Num></div>
            </> : <p className="v2-cardsub">{t('bd.outsideWindow')}</p>}
            <Btn variant="ghost" size="sm" to={P.radar}>{t('bd.seeRadar')}</Btn>
          </Card>

          <Card title={t('bd.documents')} action={checklist && <span className="v2-cardsub v2-strong">{t('bd.docsOf', { n: checklist.filter((c) => c.present).length, m: checklist.length })}</span>}>
            {settleQ.loading ? <Loading rows={3} /> : !checklist ? <p className="v2-cardsub">{t('bd.docsUnavailable')}</p> :
              <ul className="v2-checklist">{checklist.map((c) => (
                <li key={c.key} className={c.present ? 'is-done' : ''}>
                  <Ico name={c.present ? 'checkCircle' : 'clock'} size={18} />
                  <span className="v2-checklist-label">{DOC_LABEL[c.key] ? t(DOC_LABEL[c.key]) : c.label}</span>
                  <span className="v2-sr">{c.present ? t('bd.present') : t('bd.missing')}</span>
                  {!c.present && c.key !== 'accountant_confirmation' && <Btn size="sm" variant="ghost" to={P.documents}>{t('bd.upload')}</Btn>}
                </li>))}</ul>}
            <p className="v2-cardsub">{t('bd.nothingCloses')}</p>
          </Card>
        </div>
      </div>
    </Page>
  )
}
