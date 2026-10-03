// Funding v2 (designs/Funding). Equity and loans are never revenue.
// There is no funding-records table in production (migrations 037–039 hold the
// Personal↔Business bridge and stay untouched), so the register shows an honest
// "Not set up yet" state and the proposal lives in _specs/design-v2/PROPOSALS.md.
// What IS real: money the existing classifier already files as funding this
// month (pulse.other_cash_movement.funding) — cash view, labelled as such.
import { Page, Card, Btn, Empty, Kpi, Note } from '../ui'
import { useV2T } from '../lib/i18n'
import { useV2Data, PULSE_PATH } from '../lib/data'
import { money } from '../lib/format'
import { askLink } from '../lib/ask'

export default function Funding() {
  const { t } = useV2T()
  const pulse = useV2Data(PULSE_PATH, { silent: true })
  const funding = Number(pulse.data?.other_cash_movement?.funding || 0)
  return (
    <Page title={t('nav.funding')} sub={t('fund.sub')} actions={<Btn variant="primary" icon="plus" notYet>{t('fund.record')}</Btn>}>
      <Card flush><div className="v2-kpis v2-kpis-2">
        <Kpi label={t('fund.thisMonth')} value={money(funding)} meta={t('fund.thisMonthMeta')} />
        <Kpi label={t('fund.toRepay')} value="—" meta={t('state.notSetUp')} />
      </div></Card>
      <Card title={t('fund.register')}>
        <Empty icon="dollar" title={t('state.notSetUp')} body={t('fund.registerBody')} />
      </Card>
      <Note tone="info" icon="book">{t('fund.howShows')}</Note>
      <Card title={t('fund.updateTitle')} sub={t('fund.updateSub')}>
        <Btn icon="spark" to={askLink({ page: 'funding', q: t('fund.updateQ') })}>{t('fund.updateBtn')}</Btn>
      </Card>
    </Page>
  )
}
