// Transactions v2 (designs/Transactions). GET /api/transactions?period=all and
// GET /api/wallets; filtering and paging happen in the browser. Categorising,
// editing and exporting stay in the existing page under "Manage" — v2 links
// there rather than writing anything itself.
import { useMemo, useState } from 'react'
import { BusinessTransactions } from '../../pages/business'
import { Page, Card, Btn, Pill, Tabs, Loading, ErrorBox, Empty, Num, Note, ViewSwitch } from '../ui'
import { useV2T, LOCALE } from '../lib/i18n'
import { useV2Data } from '../lib/data'
import { useView } from '../lib/useView'
import { money, dayMonth } from '../lib/format'
import { P } from '../routes'
import { txDir, txDate, needsCategory, recent } from '../lib/derive'




const PAGE = 25

export default function Transactions() {
  const { t, lang } = useV2T()
  const locale = LOCALE[lang]
  const [view, setView] = useView()
  const [filter, setFilter] = useState('all')
  const [wallet, setWallet] = useState('all')
  const [range, setRange] = useState('30')
  const [shown, setShown] = useState(PAGE)
  const txQ = useV2Data(view === 'overview' ? '/transactions?period=all' : null)
  const wQ = useV2Data(view === 'overview' ? '/wallets' : null, { silent: true })
  const wallets = wQ.data?.wallets || []
  const wName = useMemo(() => Object.fromEntries(wallets.map((w) => [w.id, w.name])), [wallets])
  const all = Array.isArray(txQ.data) ? txQ.data : txQ.data?.transactions || []
  const inRange = range === 'all' ? recent(all, 36500) : recent(all, Number(range))
  const byWallet = inRange.filter((x) => wallet === 'all' || x.wallet_id === wallet || (!x.wallet_id && x.source === wName[wallet]))
  const review = byWallet.filter(needsCategory)
  const rows = byWallet.filter((x) => filter === 'all' || (filter === 'review' ? needsCategory(x) : txDir(x) === filter))

  const actions = <>
    <ViewSwitch view={view} onChange={setView} overviewLabel={t('view.overview')} manageLabel={t('view.manage')} />
    <Btn variant="primary" icon="plus" to={P.add}>{t('nav.add')}</Btn>
  </>
  if (view === 'manage') return <Page title={t('nav.transactions')} sub={t('tx.sub')} actions={actions}><div className="v2-legacy-embed"><BusinessTransactions /></div></Page>

  return (
    <Page title={t('nav.transactions')} sub={t('tx.sub')} actions={actions}>
      {txQ.error ? <ErrorBox error={txQ.error} onRetry={txQ.reload} /> : txQ.loading ? <Card><Loading rows={8} /></Card> : <>
        {review.length > 0 && <Note tone="warning" icon="warn" action={<Btn size="sm" onClick={() => setView('manage')}>{t('tx.reviewN', { n: review.length })}</Btn>}>
          <strong>{t('tx.needCat', { n: review.length })}</strong> {t('tx.needCatWhy')}</Note>}
        <div className="v2-filterbar">
          <Tabs label={t('tx.filter')} active={filter} onChange={(v) => { setFilter(v); setShown(PAGE) }} items={[
            { key: 'all', label: t('tx.fAll') }, { key: 'in', label: t('tx.fIn') }, { key: 'out', label: t('tx.fOut') },
            { key: 'transfer', label: t('tx.fTransfers') }, { key: 'review', label: t('tx.fReview', { n: review.length }) }]} />
          <div className="v2-filterbar-selects">
            <label className="v2-sr" htmlFor="v2-tx-wallet">{t('tx.account')}</label>
            <select id="v2-tx-wallet" className="v2-input v2-select" value={wallet} onChange={(e) => setWallet(e.target.value)}>
              <option value="all">{t('tx.allAccounts')}</option>{wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
            <label className="v2-sr" htmlFor="v2-tx-range">{t('tx.period')}</label>
            <select id="v2-tx-range" className="v2-input v2-select" value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="30">{t('tx.last30')}</option><option value="90">{t('tx.last90')}</option><option value="all">{t('tx.allTime')}</option></select>
          </div>
        </div>
        <Card flush className="v2-pad-table">
          {rows.length === 0 ? <Empty icon="list" title={t('tx.empty')} /> : <>
            <div className="v2-table-wrap"><table className="v2-table v2-table-tx">
              <thead><tr><th>{t('radar.colDate')}</th><th>{t('radar.colWhat')}</th><th className="v2-hide-sm">{t('tx.category')}</th><th className="v2-hide-sm">{t('tx.account')}</th><th className="r">{t('radar.colAmount')}</th></tr></thead>
              <tbody>{rows.slice(0, shown).map((x) => { const dir = txDir(x); const amt = Number(x.amount_original ?? x.amount_idr ?? 0); const ccy = x.currency_original || 'IDR'; return (
                <tr key={x.id}>
                  <td className="v2-strong">{dayMonth(txDate(x), locale)}</td>
                  <td className="ellipsis"><span className="v2-strong">{x.description || x.counterparty || '—'}</span>{x.notes ? <div className="is-muted v2-small">{x.notes}</div> : null}
                    <div className="v2-phone-sub">{dir === 'transfer' ? t('tx.transfer') : needsCategory(x) ? <Pill tone="warning">{t('tx.chooseCat')}</Pill> : x.category}</div></td>
                  <td className="v2-hide-sm">{dir === 'transfer' ? <Pill tone="neutral">{t('tx.transfer')}</Pill> : needsCategory(x) ? <Pill tone="warning">{t('tx.chooseCat')}</Pill> : <span className="v2-small">{x.category}</span>}</td>
                  <td className="v2-hide-sm v2-small">{wName[x.wallet_id] || x.source || '—'}</td>
                  <td className="r"><Num tone={dir === 'in' ? 'pos' : null}>{money(dir === 'out' ? -amt : amt, { currency: ccy, sign: dir === 'in' })}</Num></td>
                </tr>) })}</tbody>
            </table></div>
            <div className="v2-table-foot"><span>{t('tx.showing', { n: Math.min(shown, rows.length), m: rows.length })}</span>
              {shown < rows.length && <Btn size="sm" onClick={() => setShown((s) => s + PAGE)}>{t('tx.loadMore')}</Btn>}</div>
          </>}
        </Card>
      </>}
    </Page>
  )
}
