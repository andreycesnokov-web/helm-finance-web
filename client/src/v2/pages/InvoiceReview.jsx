import { useParams, useSearchParams } from 'react-router-dom'
import { PageHead, Card, Btn, Skeleton, ErrorBox, Empty } from '../ui'
import { useApi } from '../data'
import { useT } from '../i18n'
import { money } from '../lib/format'
import { remaining } from '../lib/obligations'
export default function InvoiceReview() {
  const { mode } = useParams(), [sp] = useSearchParams(), t = useT()
  const debts = useApi('/debts')
  return <div className="v2-page"><PageHead title={t(mode === 'tax-split' ? 'route.taxSplit' : 'route.settlement')}
    sub={t('route.chooseInvoice')} back={{ to: '/business/invoices', label: t('nav.bills') }} />
    <Card>{debts.loading ? <Skeleton rows={5} /> : debts.error ? <ErrorBox error={debts.error} onRetry={debts.reload} /> : !debts.data?.length ? <Empty title={t('bills.none')} /> :
      <ul className="v2-moves">{debts.data.map((d) => {
        const query = new URLSearchParams(sp); query.set('tab', mode)
        return <li key={d.id}><span>{d.invoice_number || d.counterparty || t('bills.noName')} · {money(remaining(d), { currency: d.currency || 'IDR' })}</span>
          <Btn to={'/business/invoices/' + encodeURIComponent(d.id) + '?' + query}>{t('bills.open')}</Btn></li>
      })}</ul>}</Card>
  </div>
}
