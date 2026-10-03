// Bill detail (designs/BillDetail.dc.html) — /business/payables/:id and the additive
// /business/receivables/:id.
//
// Data: GET /api/debts (the item, business-scoped by the server), GET /api/accountant/rules
// (verified rule engine — the ONLY source of a withholding rate), GET /api/pulse (cash effect
// with the Radar rules). Approve / Reject / Ask for details use the existing endpoints and
// only appear while the item is waiting for approval; the server enforces who may decide.
// The Documents checklist (incl. the P-05 slip and accountant check) is components/BillChecklist.
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import I from '../icons'
import { Card, Pill, Btn, Skeleton, ErrorBox, Empty } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi } from '../data'
import { money, shortDate } from '../lib/format'
import { remaining, billStatus, withholdingTreatment } from '../lib/obligations'
import { cashItems, forecast, applyScenario } from '../lib/radarSeries'
import { findWithholdingRule, computeInvoicePlan } from '../../pages/business/InvoiceReviewDrawer'
import DecisionActions from '../components/DecisionActions'
import BillChecklist from '../components/BillChecklist'
import WithholdingCard from '../components/WithholdingCard'
import { StatusPill } from './Bills'

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
  const debts = useApi('/debts')
  const rules = useApi('/accountant/rules')
  const pulse = useApi('/pulse')
  const fund = useApi('/business-funding')
  const cps = useApi('/counterparties')
  const listPath = kind === 'receivable' ? '/business/receivables' : '/business/payables'

  const d = useMemo(() => (Array.isArray(debts.data) ? debts.data : []).find((x) => String(x.id) === String(id)), [debts.data, id])
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

  const docs = Array.isArray(d.attachments) ? d.attachments : []
  const hasInvoice = docs.length > 0 || !!d.attachment_url
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
          <h1 className="v2-h1">{d.counterparty || t('bills.noName')}</h1>
          <p className="v2-sub"><strong className="v2-num">{money(d.original_amount ?? d.amount, { full: true, currency: d.currency || 'IDR' })}</strong>
            {d.description && ` · ${d.description}`}{d.due_date && ` · ${t('pulse.dec.due', { d: shortDate(d.due_date, lang) })}`}</p>
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
              <dd><Link to="/business/counterparties">{d.counterparty || '—'}</Link></dd>
              {d.invoice_number && <><dt>{t('bill.invoiceNo')}</dt><dd className="v2-num">{d.invoice_number}</dd></>}
              <dt>{t('bill.created')}</dt><dd>{shortDate(d.created_at, lang)}</dd>
              <dt>{t('bill.dueDate')}</dt><dd>{d.due_date ? shortDate(d.due_date, lang) : t('bill.noDue')}</dd>
              {Number(d.paid_amount) > 0 && <><dt>{t('bill.paidSoFar')}</dt><dd className="v2-num">{money(d.paid_amount)}</dd></>}
              {d.category && <><dt>{t('bill.category')}</dt><dd>{d.category}</dd></>}
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

          <BillChecklist d={d} hasInvoice={hasInvoice} paid={s === 'paid'} slipNeeded={!!split} />
          <WithholdingCard d={d} />
        </div>
      </div>
    </div>
  )
}
