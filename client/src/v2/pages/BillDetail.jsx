// Bill detail (designs/BillDetail.dc.html) — /business/payables/:id and the additive
// /business/receivables/:id.
//
// Data: GET /api/debts (the item, business-scoped by the server), GET /api/accountant/rules
// (verified rule engine — the ONLY source of a withholding rate), GET /api/pulse (cash effect
// with the Radar rules). Approve / Reject / Ask for details use the existing endpoints and
// only appear while the item is waiting for approval; the server enforces who may decide.
// The Documents checklist (incl. the P-05 slip and accountant check) is components/BillChecklist.
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import I from '../icons'
import { Card, Pill, Btn, Skeleton, ErrorBox, Empty } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi, useInvalidate } from '../data'
import DocumentIntakeModal from '../../components/DocumentIntakeModal'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { money, shortDate } from '../lib/format'
import { remaining, billStatus, withholdingTreatment } from '../lib/obligations'
import { cashItems, forecast, applyScenario } from '../lib/radarSeries'
import { findWithholdingRule, computeInvoicePlan } from '../../pages/business/InvoiceReviewDrawer'
import DecisionActions from '../components/DecisionActions'
import BillChecklist from '../components/BillChecklist'
import WithholdingCard from '../components/WithholdingCard'
import { StatusPill } from './Bills'
import { billHasDocument, docPath } from '../lib/obligations'
import { catLabel } from '../lib/categoryLabel'

// Free text that older edits stored as the literal string "null" (PATCH /api/debts/:id before
// this fix) must never reach the screen.
const clean = (v) => (v == null || ['null', 'undefined'].includes(String(v).trim()) ? '' : String(v))

const fmtTime = (iso, lang) => {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const loc = lang === 'ru' ? 'ru-RU' : lang === 'id' ? 'id-ID' : 'en-GB'
  return d.toLocaleString(loc, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function BillDetail({ kind = 'payable' }) {
  const t = useT()
  const lang = useLang()
  const { id } = useParams()
  const { active } = useWorkspace()
  const invalidate = useInvalidate()
  const [upload, setUpload] = useState(null)   // null | 'invoice' | 'proof'
  const debts = useApi('/debts')
  const rules = useApi('/accountant/rules')
  const pulse = useApi('/pulse')
  const fund = useApi('/business-funding')
  const cps = useApi('/counterparties')
  const d = useMemo(() => (Array.isArray(debts.data) ? debts.data : []).find((x) => String(x.id) === String(id)), [debts.data, id])
  // The record decides which list it belongs to (a document link opens /payables/:id for any debt).
  const listPath = (d ? d.type === 'receivable' : kind === 'receivable') ? '/business/receivables' : '/business/payables'
  const engine = useMemo(() => findWithholdingRule(rules.data?.rules || []), [rules.data])

  const crumbs = (
    <nav className="v2-crumbs" aria-label={t('bill.breadcrumb')}>
      <Link to={listPath}>{t('nav.bills')}</Link><span aria-hidden="true"> / </span><span>{d?.invoice_number || d?.counterparty || id}</span>
    </nav>
  )
  if (debts.loading) return <>{crumbs}<Card><Skeleton rows={6} /></Card></>
  if (debts.error) return <>{crumbs}<ErrorBox error={debts.error} onRetry={debts.reload} /></>
  if (!d) return <>{crumbs}<Card><Empty icon={<I.bills size={28} />} title={t('bill.notFound')} text={t('bill.notFoundText')} action={<Btn to={listPath}>{t('bill.back')}</Btn>} /></Card></>

  const isPay = d.type !== 'receivable'
  const amount = remaining(d)
  const s = billStatus(d)
  // The split is shown only when the counterparty or bill carries a withholding treatment, and
  // it is computed on what is still to pay — never on every IDR bill (review 8.2 #9).
  const cp = (cps.data?.counterparties || []).find((c) => [c.name, c.legal_name, c.display_name].some((n) => n && String(n).trim().toLowerCase() === String(d.counterparty || '').trim().toLowerCase()))
  const treatment = withholdingTreatment(d, cp)
  const plan = treatment === 'withhold' && engine?.rate
    ? computeInvoicePlan({ doc: { gross_amount: amount, currency: 'IDR' }, supplier: d.counterparty, treatment: 'withhold', rate: engine.rate, engine, dir: 'payable' })
    : null
  const split = plan && plan.rateValid && amount > 0 ? { gross: amount, rate: plan.rateNum, tax: plan.withheld, net: plan.net } : null

  // Cash effect with the same rules Radar uses: forecast with and without this item.
  let effect = null
  if (pulse.data && (d.currency || 'IDR') === 'IDR' && s !== 'paid' && s !== 'cancelled') {
    const p = pulse.data
    // A bill waiting for approval is not counted anywhere else; here it is counted as
    // if approved, because the question is "what happens if this one goes ahead".
    const all = applyScenario(cashItems({ debts: (p.debts || []).some((x) => String(x.id) === String(d.id)) ? p.debts : [...(p.debts || []), d], repayments: fund.data?.upcoming || [] }).items,
      { kind: 'approve', key: `debt:${d.id}` })
    const without = all.filter((x) => x.key !== `debt:${d.id}`)
    const f1 = forecast({ balance: p.totalBalance, burnRate: p.burnRate, items: all })
    const f0 = forecast({ balance: p.totalBalance, burnRate: p.burnRate, items: without })
    const me = all.find((x) => x.key === `debt:${d.id}`)
    if (me) {
      const after = f1.days[me.day]?.expected
      effect = { date: me.date, after, low: f1.lowest, changed: Math.round(f1.lowest.value) !== Math.round(f0.lowest.value) }
    }
  }

  // Documents linked in the Document Center (document_debt_links) count as well as legacy attachments.
  const hasInvoice = billHasDocument(d)
  const firstDocId = (d.document_links || [])[0]?.document_id || null
  const who = clean(d.counterparty) || t('bills.noName')
  const description = clean(d.description)
  const history = [
    d.created_at && { at: d.created_at, text: d.source_channel === 'mcp' ? t('bill.hist.createdAi', { who: d.created_by_name || '' })
      : d.source_channel === 'telegram' ? t('bill.hist.createdTg', { who: d.created_by_name || '' }) : d.created_by_name ? t('bill.hist.created', { who: d.created_by_name }) : t('bill.hist.createdAnon') },
    d.info_requested_at && { at: d.info_requested_at, text: t('bill.hist.info', { note: d.info_request_note || '' }) },
    d.approved_at && { at: d.approved_at, text: d.approval_status === 'rejected' ? t('bill.hist.rejected', { why: d.rejected_reason || '' }) : t('bill.hist.approved') },
    d.last_payment_at && { at: d.last_payment_at, text: t('bill.hist.paid') },
  ].filter(Boolean).sort((a, b) => (a.at < b.at ? 1 : -1))

  return (
    <div className="v2-page">
      {crumbs}
      <header className="v2-pagehead">
        <div className="v2-pagehead-text">
          <StatusPill d={d} />
          <h1 className="v2-h1">{who}</h1>
          <p className="v2-sub"><strong className="v2-num">{money(d.original_amount ?? d.amount, { full: true, currency: d.currency || 'IDR' })}</strong>
            {description && ` · ${description}`}{d.due_date && ` · ${t('pulse.dec.due', { d: shortDate(d.due_date, lang) })}`}</p>
        </div>
        {s === 'pending' && <div className="v2-pagehead-actions"><DecisionActions debt={d} /></div>}
      </header>

      <div className="v2-grid-detail">
        <div className="v2-col">
          {isPay && (
            <Card title={t('bill.youPay')} aside={t('bill.suggested')}>
              {split ? (
                <>
                  <div className="v2-split">
                    <div className="v2-split-box"><span className="v2-stat-label">{t('bill.total')}</span><span className="v2-stat-mid v2-num">{money(split.gross)}</span></div>
                    <div className="v2-split-box v2-tone-info"><span className="v2-stat-label">{t('bill.toSupplier')}</span><span className="v2-stat-mid v2-num">{money(split.net)}</span></div>
                    <div className="v2-split-box v2-tone-warn"><span className="v2-stat-label">{t('bill.toTax')}</span><span className="v2-stat-mid v2-num">{money(split.tax)}</span>
                      <span className="v2-stat-sub">{t('bill.rateFrom', { rule: engine.rule?.title || engine.rule?.rule_code || '', rate: split.rate })}</span></div>
                  </div>
                  <p className="v2-muted v2-small">{t('bill.splitNote', { rule: engine.rule?.title || engine.rule?.rule_code || '' })}</p>
                </>
              ) : (
                <>
                  <div className="v2-split"><div className="v2-split-box"><span className="v2-stat-label">{t('bill.total')}</span><span className="v2-stat-mid v2-num">{money(d.original_amount ?? d.amount, { currency: d.currency || 'IDR' })}</span></div></div>
                  <p className="v2-muted v2-small">{rules.loading ? '' : treatment === 'applied' ? t('bill.alreadyNet') : t('bill.noRate')}</p>
                </>
              )}
            </Card>
          )}

          <Card title={t('bill.details')}>
            <dl className="v2-dl">
              <dt>{t(isPay ? 'bills.col.supplier' : 'bills.col.customer')}</dt>
              <dd>{cp ? <Link to={`/business/counterparties/${encodeURIComponent(cp.id)}/edit`}>{who}</Link> : <Link to="/business/counterparties">{clean(d.counterparty) || '—'}</Link>}</dd>
              {d.invoice_number && <><dt>{t('bill.invoiceNo')}</dt><dd className="v2-num">{d.invoice_number}</dd></>}
              <dt>{t('bill.created')}</dt><dd>{shortDate(d.created_at, lang)}</dd>
              <dt>{t('bill.dueDate')}</dt><dd>{d.due_date ? shortDate(d.due_date, lang) : t('bill.noDue')}</dd>
              {Number(d.paid_amount) > 0 && <><dt>{t('bill.paidSoFar')}</dt><dd className="v2-num">{money(d.paid_amount)}</dd></>}
              {d.category && <><dt>{t('bill.category')}</dt><dd>{catLabel(t, d.category)}</dd></>}
            </dl>
          </Card>

          <Card title={t('bill.history')}>
            {history.length === 0 ? <p className="v2-muted">—</p> : (
              <ul className="v2-hist">
                {history.map((h, i) => <li key={i}><span className="v2-hist-at">{fmtTime(h.at, lang)}</span><span>{h.text}</span></li>)}
              </ul>
            )}
          </Card>
        </div>

        <div className="v2-col">
          <Card title={t('bill.effect')}>
            {effect ? (
              <dl className="v2-dl v2-dl-tight">
                <dt>{t('bill.cashAfter', { d: shortDate(effect.date, lang) })}</dt><dd className="v2-num v2-r"><strong>{money(effect.after)}</strong></dd>
                <dt>{t('bill.lowest', { d: shortDate(effect.low.date, lang) })}</dt>
                <dd className="v2-num v2-r"><strong>{money(effect.low.value)}</strong>{!effect.changed && ` · ${t('bill.unchanged')}`}</dd>
              </dl>
            ) : <p className="v2-muted">{t('bill.noEffect')}</p>}
            <Link className="v2-more-link" to="/business/radar">{t('bill.seeRadar')}</Link>
          </Card>

          <BillChecklist d={d} hasInvoice={hasInvoice} paid={s === 'paid'} slipNeeded={!!split}
            invoiceDocPath={firstDocId ? docPath({ id: firstDocId }) : null} onUpload={setUpload} />
          <WithholdingCard d={d} />
        </div>
      </div>
      {upload && (
        <DocumentIntakeModal business={active} link={{ target_type: 'debt', target_id: d.id }}
          defaultType={upload === 'proof' ? 'payment_proof' : isPay ? 'vendor_invoice' : 'customer_invoice'}
          uploadSource={upload === 'proof' ? 'payment_proof_upload' : isPay ? 'payable_upload' : 'receivable_upload'}
          heading={t(upload === 'proof' ? 'bill.uploadProofFor' : 'bill.uploadInvoiceFor', { who })}
          onClose={() => setUpload(null)} onUploaded={() => invalidate()} />
      )}
    </div>
  )
}
