// Assets & balance (designs/Assets.dc.html). There is no asset register (PROPOSALS P-11)
// and no funding register (P-03), so this shows the management balance only as far as
// existing data goes — cash, owed by customers, bills to pay, engine-calculated taxes —
// and says what is missing instead of a net worth that would be wrong.
// Business only: personal things stay in Personal and are never read here.
import I from '../icons'
import { PageHead, Card, Pill, Btn, Skeleton, ErrorBox, Empty } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi } from '../data'
import { money, shortDate } from '../lib/format'

export default function Assets() {
  const t = useT()
  const lang = useLang()
  const pulse = useApi('/pulse?scope=business')
  const obl = useApi('/accountant/obligations')
  const head = <PageHead title={t('nav.assets')} sub={t('assets.sub', { d: shortDate(new Date(), lang) })} actions={<Btn variant="primary" icon={<I.plus size={16} />} to="/business/assets/new">{t('screen.addAsset')}</Btn>} />
  // Owes and net worth include calculated taxes, so wait for /accountant/obligations as well:
  // a slow or failed request must not read as "no taxes" (review 8.2 #11d).
  if (pulse.loading || obl.loading) return <>{head}<Card><Skeleton rows={6} /></Card></>
  if (pulse.error) return <>{head}<ErrorBox error={pulse.error} onRetry={pulse.reload} /></>
  if (obl.error) return <>{head}<ErrorBox error={obl.error} onRetry={obl.reload} /></>
  const p = pulse.data || {}
  const taxes = (obl.data?.obligations || []).filter((o) => o.status === 'calculated').reduce((s, o) => s + Number(o.amount || 0), 0)
  const owns = Number(p.totalBalance || 0) + Number(p.receivables || 0)
  const owes = Number(p.payables || 0) + taxes
  const Line = ({ label, value, na }) => (
    <><dt>{label}</dt><dd className="v2-r">{na ? <Pill tone="warn">{t('placeholder.notSetUp')}</Pill> : <span className="v2-num">{money(value)}</span>}</dd></>
  )
  return (
    <div className="v2-page">
      {head}
      <div className="v2-grid-2">
        <Card title={t('assets.owns')} aside={<span className="v2-num">{money(owns)}+</span>}>
          <dl className="v2-dl v2-dl-tight">
            <Line label={t('assets.cash')} value={p.totalBalance} />
            <Line label={t('assets.owedBy')} value={p.receivables} />
            <Line label={t('assets.equipment')} na />
          </dl>
        </Card>
        <Card title={t('assets.owes')} aside={<span className="v2-num">{money(owes)}+</span>}>
          <dl className="v2-dl v2-dl-tight">
            <Line label={t('assets.bills')} value={p.payables} />
            <Line label={t('assets.taxes')} value={taxes} />
            <Line label={t('assets.loans')} na />
          </dl>
        </Card>
      </div>
      <Card title={t('assets.netWorth')}>
        <p className="v2-sec">{t('assets.netWorthNa', { v: money(owns - owes) })}</p>
        <p className="v2-muted v2-small">{t('assets.official')}</p>
      </Card>
      <div className="v2-grid-detail">
        <Card title={t('assets.register')} className="v2-col">
          <Empty icon={<I.assets size={28} />} title={t('assets.emptyTitle')} text={t('assets.emptyText')}
            action={<Btn variant="primary" to="/business/assets/new">{t('screen.addAsset')}</Btn>} />
        </Card>
        <aside className="v2-col">
          <Card title={t('assets.wearTitle')}><p className="v2-sec">{t('assets.wear')}</p></Card>
          <Card title={t('assets.autoTitle')}><p className="v2-sec">{t('assets.auto')}</p></Card>
          <Card title={t('assets.oneTitle')}><p className="v2-sec">{t('assets.one')}</p></Card>
        </aside>
      </div>
    </div>
  )
}
