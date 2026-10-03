// Funding (designs/Funding.dc.html). Equity and loans — never revenue.
// There is no funding-records table yet (PROPOSALS.md P-03), so the register is an
// honest "not set up yet". What exists today is shown: cash the server's classifier
// already marks as funding in the last 12 months (GET /api/pulse/advanced-insights,
// other_cash_movement.funding). The Personal↔Business bridge is NOT called.
import { Link } from 'react-router-dom'
import I from '../icons'
import { PageHead, Card, NotYet, Empty } from '../ui'
import { useT } from '../i18n'
import { useApi } from '../data'
import { money } from '../lib/format'

const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

export default function Funding() {
  const t = useT()
  const ins = useApi(`/pulse/advanced-insights?scope=business&from=${daysAgo(365)}&to=${daysAgo(0)}`)
  const funding = ins.data?.metrics?.other_cash_movement?.funding
  return (
    <div className="v2-page">
      <PageHead title={t('nav.funding')} sub={t('fund.sub')} actions={<NotYet note={t('placeholder.notSetUp')}>{t('fund.record')}</NotYet>} />
      <div className="v2-tiles v2-tiles-3">
        <div className="v2-tile"><span className="v2-tile-label">{t('fund.raised')}</span><span className="v2-tile-val v2-muted">—</span><span className="v2-tile-sub">{t('placeholder.notSetUp')}</span></div>
        <div className="v2-tile"><span className="v2-tile-label">{t('fund.toRepay')}</span><span className="v2-tile-val v2-muted">—</span><span className="v2-tile-sub">{t('placeholder.notSetUp')}</span></div>
        <div className="v2-tile"><span className="v2-tile-label">{t('fund.seen')}</span><span className="v2-tile-val v2-num">{funding == null ? '—' : money(funding)}</span><span className="v2-tile-sub">{t('fund.seenSub')}</span></div>
      </div>
      <div className="v2-grid-detail">
        <Card className="v2-col">
          <Empty icon={<I.funding size={28} />} title={t('fund.emptyTitle')} text={t('fund.emptyText')}
            action={<Link to="/business/transactions">{t('fund.seeTx')}</Link>} />
        </Card>
        <aside className="v2-col">
          <Card title={t('fund.howTitle')}><p className="v2-sec">{t('fund.how')}</p></Card>
          <Card title={t('fund.intercoTitle')}><p className="v2-sec">{t('fund.interco')}</p><Link to="/business/intercompany">{t('fund.intercoLink')}</Link></Card>
        </aside>
      </div>
    </div>
  )
}
