// Accounts v2 (designs/Accounts). GET /api/wallets (balances computed by the
// server) and GET /api/bank-import/batches for statement freshness per account.
// Totals never add different currencies: IDR is the headline, other currencies
// are listed on their own. Personal wallets never appear (business-scoped API).
// Add / edit / archive / adjust stay in the existing page under "Manage".
import { useMemo } from 'react'
import AccountsLegacy from '../../pages/Accounts'
import { Page, Card, Btn, Pill, Loading, ErrorBox, Empty, Num, Note, ViewSwitch, Ico } from '../ui'
import { useV2T, LOCALE } from '../lib/i18n'
import { useV2Data } from '../lib/data'
import { useView } from '../lib/useView'
import { money, dayMonth, daysFromToday, BASE_CCY } from '../lib/format'
import { P } from '../routes'
import { freshnessByWallet } from '../lib/derive'



const TYPE_KEY = { bank: 'acc.typeBank', cash: 'acc.typeCash', ewallet: 'acc.typeEwallet', gateway: 'acc.typeGateway', card: 'acc.typeCard', crypto: 'acc.typeCrypto' }

export default function Accounts() {
  const { t, lang } = useV2T()
  const locale = LOCALE[lang]
  const [view, setView] = useView()
  const wQ = useV2Data(view === 'overview' ? '/wallets' : null)
  const bQ = useV2Data(view === 'overview' ? '/bank-import/batches' : null, { silent: true })
  const wallets = wQ.data?.wallets || []
  const fresh = useMemo(() => freshnessByWallet(bQ.data?.batches), [bQ.data])
  const base = wallets.filter((w) => (w.currency || BASE_CCY) === BASE_CCY)
  const other = wallets.filter((w) => (w.currency || BASE_CCY) !== BASE_CCY)
  const total = base.reduce((s, w) => s + Number(w.balance || 0), 0)
  const stale = wallets.map((w) => ({ w, f: fresh[w.id] })).filter(({ w, f }) => w.type === 'bank' && (!f || daysFromToday(f.date) < -7))

  const actions = <>
    <ViewSwitch view={view} onChange={setView} overviewLabel={t('view.overview')} manageLabel={t('view.manage')} />
    <Btn icon="upload" to="/business/bank-import">{t('acc.import')}</Btn>
    <Btn variant="primary" icon="plus" onClick={() => setView('manage')}>{t('acc.add')}</Btn>
  </>
  if (view === 'manage') return <Page title={t('nav.accounts')} sub={t('acc.sub')} actions={actions}><div className="v2-legacy-embed"><AccountsLegacy /></div></Page>

  return (
    <Page title={t('nav.accounts')} sub={t('acc.sub')} actions={actions}>
      {wQ.error ? <ErrorBox error={wQ.error} onRetry={wQ.reload} /> : wQ.loading ? <Card><Loading rows={5} /></Card> : wallets.length === 0
        ? <Card><Empty icon="wallet" title={t('acc.empty')} body={t('acc.emptyBody')} action={<Btn variant="primary" icon="plus" onClick={() => setView('manage')}>{t('acc.add')}</Btn>} /></Card> : <>
        <Card hero className="v2-acc-hero">
          <div className="v2-hero-label">{t('acc.total', { n: base.length })}</div>
          <div className="v2-hero-big v2-num">{money(total)}</div>
          {other.length > 0 && <div className="v2-hero-meta">{t('acc.otherCcy', { list: other.map((w) => `${w.currency} ${Number(w.balance || 0).toLocaleString(locale)}`).join(' · ') })}</div>}
          <div className="v2-hero-meta">{t('acc.personalNote')}</div>
        </Card>
        <div className="v2-grid v2-grid-2">{wallets.map((w) => {
          const f = fresh[w.id]
          return (
            <Card key={w.id} className="v2-acccard">
              <div className="v2-acccard-top">
                <span className="v2-tile-ic"><Ico name={w.type === 'cash' ? 'wallet' : 'bank'} size={20} /></span>
                <div className="v2-row-main">
                  <div className="v2-row-title">{w.name}</div>
                  <div className="v2-row-sub">{[t(TYPE_KEY[w.type] || 'acc.typeOther'), w.currency || BASE_CCY, w.entity_name].filter(Boolean).join(' · ')}</div>
                </div>
                <Num className="v2-acccard-bal">{(w.currency || BASE_CCY) === BASE_CCY ? money(w.balance) : `${w.currency} ${Number(w.balance || 0).toLocaleString(locale)}`}</Num>
              </div>
              <div className="v2-acccard-foot">
                {f ? <span>{t('acc.statement', { date: dayMonth(f.date, locale) })}</span> : <span className="is-muted">{t('acc.noStatement')}</span>}
                {f?.review > 0 && <Pill tone="warning">{t('acc.toReview', { n: f.review })}</Pill>}
                {w.type === 'bank' && <Btn size="sm" variant="ghost" to="/business/bank-import">{t('acc.uploadStatement')}</Btn>}
              </div>
            </Card>)
        })}</div>
        {stale.length > 0 && <Note tone="warning" icon="clock" action={<Btn size="sm" to="/business/bank-import">{t('acc.uploadStatement')}</Btn>}>
          {t('acc.keepTrue', { list: stale.map(({ w }) => w.name).join(', ') })}</Note>}
        <Card title={t('acc.transfersTitle')} sub={t('acc.transfersSub')}>
          <Btn variant="ghost" size="sm" to={P.transactions}>{t('acc.seeTransfers')}</Btn>
        </Card>
      </>}
    </Page>
  )
}
