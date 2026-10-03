// Assets & balance (designs/Assets.dc.html). Management balance from existing data — cash,
// owed by customers, bills to pay, engine-calculated taxes — plus the asset register
// (P-11, migration 063: GET /api/assets). Book values use straight-line depreciation from
// the VERIFIED tax rules (computed by the server); an asset without a verified rule shows
// its cost and "no useful life yet", never a guessed one. Loans need the funding register
// (P-03). Before 063 the register says so. Business only.
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
  const reg = useApi('/assets')
  const fund = useApi('/business-funding')
  const head = <PageHead title={t('nav.assets')} sub={t('assets.sub', { d: shortDate(new Date(), lang) })} actions={<Btn variant="primary" icon={<I.plus size={16} />} to="/business/assets/new">{t('screen.addAsset')}</Btn>} />
  // Owes and net worth include calculated taxes, so wait for /accountant/obligations as well:
  // a slow or failed request must not read as "no taxes" (review 8.2 #11d).
  if (pulse.loading || obl.loading) return <>{head}<Card><Skeleton rows={6} /></Card></>
  if (pulse.error) return <>{head}<ErrorBox error={pulse.error} onRetry={pulse.reload} /></>
  if (obl.error) return <>{head}<ErrorBox error={obl.error} onRetry={obl.reload} /></>
  const p = pulse.data || {}
  const taxes = (obl.data?.obligations || []).filter((o) => o.status === 'calculated').reduce((s, o) => s + Number(o.amount || 0), 0)
  const hasReg = reg.data?.available === true
  const hasFund = fund.data?.available === true
  const equipment = hasReg ? Number(reg.data.totals?.book_value || 0) : 0
  const loans = hasFund ? Number(fund.data.totals?.loans_outstanding || 0) : 0
  const owns = Number(p.totalBalance || 0) + Number(p.receivables || 0) + equipment
  const owes = Number(p.payables || 0) + taxes + loans
  const complete = hasReg && hasFund
  const list = reg.data?.assets || []
  const Line = ({ label, value, na }) => (
    <><dt>{label}</dt><dd className="v2-r">{na ? <Pill tone="warn">{t('placeholder.notSetUp')}</Pill> : <span className="v2-num">{money(value)}</span>}</dd></>
  )
  return (
    <div className="v2-page">
      {head}
      <div className="v2-grid-2">
        <Card title={t('assets.owns')} aside={<span className="v2-num">{money(owns)}{hasReg ? '' : '+'}</span>}>
          <dl className="v2-dl v2-dl-tight">
            <Line label={t('assets.cash')} value={p.totalBalance} />
            <Line label={t('assets.owedBy')} value={p.receivables} />
            <Line label={t('assets.equipment')} value={equipment} na={!hasReg} />
          </dl>
        </Card>
        <Card title={t('assets.owes')} aside={<span className="v2-num">{money(owes)}{hasFund ? '' : '+'}</span>}>
          <dl className="v2-dl v2-dl-tight">
            <Line label={t('assets.bills')} value={p.payables} />
            <Line label={t('assets.taxes')} value={taxes} />
            <Line label={t('assets.loans')} value={loans} na={!hasFund} />
          </dl>
        </Card>
      </div>
      <Card title={t('assets.netWorth')}>
        <p className="v2-sec">{complete ? t('assets.netWorthIs', { v: money(owns - owes) }) : t('assets.netWorthNa', { v: money(owns - owes) })}</p>
        <p className="v2-muted v2-small">{t('assets.official')}</p>
      </Card>
      <div className="v2-grid-detail">
        <Card title={t('assets.register')} className="v2-col" aside={hasReg && list.length > 0 ? <span className="v2-num">{money(reg.data.totals.book_value)}</span> : null}>
          {reg.loading ? <Skeleton rows={4} />
            : !hasReg ? <Empty icon={<I.assets size={28} />} title={t('assets.notAppliedTitle')} text={t('assets.notApplied')} />
            : list.length === 0 ? <Empty icon={<I.assets size={28} />} title={t('assets.emptyTitle')} text={t('assets.emptyText')}
              action={<Btn variant="primary" to="/business/assets/new">{t('screen.addAsset')}</Btn>} />
            : (
              <ul className="v2-grouplist">
                {list.map((a) => (
                  <li key={a.id} className="v2-grouprow">
                    <span className="v2-group-name">
                      <strong>{a.name}{a.quantity > 1 && ` × ${a.quantity}`}</strong>
                      <span className="v2-muted v2-small">{t(`addAsset.t.${a.asset_type}`)} · {shortDate(a.acquired_on, lang)}
                        {a.useful_life_months ? ` · ${t('assets.life', { n: a.useful_life_months })}` : ` · ${t('assets.noLife')}`}
                        {a.disposed_on && ` · ${t('assets.disposed', { d: shortDate(a.disposed_on, lang) })}`}</span>
                    </span>
                    <span className="v2-r">
                      <span className="v2-num"><strong>{money(a.book_value)}</strong></span>
                      <span className="v2-muted v2-small v2-num"> {t('assets.ofCost', { v: money(a.cost) })}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          {hasReg && Number(reg.data.totals?.without_life) > 0 && <p className="v2-muted v2-small">{t('assets.withoutLife', { n: reg.data.totals.without_life })}</p>}
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
