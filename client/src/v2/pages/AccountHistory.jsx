import { Link, useParams, useSearchParams } from 'react-router-dom'
import { PageHead, Card, Btn, Skeleton, ErrorBox, Empty } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi } from '../data'
import { money, shortDate } from '../lib/format'
import { txDir, txDate } from '../lib/obligations'
import { catLabel, descLabel } from '../lib/categoryLabel'
const PERIODS = ['all', 'month', '3m', 'week']
const PAGE = 50

export default function AccountHistory() {
  const { id } = useParams()
  const [sp, setSp] = useSearchParams()
  const t = useT(), lang = useLang()
  const period = PERIODS.includes(sp.get('period')) ? sp.get('period') : 'month'
  const rawOffset = Number(sp.get('offset') || 0)
  const offset = Number.isSafeInteger(rawOffset) && rawOffset >= 0 && rawOffset <= 100000 ? rawOffset : 0
  const data = useApi('/wallets/' + encodeURIComponent(id) + '/transactions?period=' + period + '&limit=' + PAGE + '&offset=' + offset)
  const select = (nextPeriod, nextOffset = 0) => setSp((old) => {
    const next = new URLSearchParams(old); next.set('period', nextPeriod); next.set('offset', String(nextOffset)); return next
  })
  const head = <PageHead title={data.data?.wallet?.name || t('history.title')} sub={t('history.note')}
    back={{ to: '/business/accounts', label: t('nav.accounts') }} />
  return <div className="v2-page">{head}
    <Card>
      <div className="v2-chips" role="group" aria-label={t('tx.period')}>
        {PERIODS.map((p) => <button type="button" className="v2-chip v2-chip-sel" key={p} aria-pressed={period === p} onClick={() => select(p)}>{t(`history.period.${p}`)}</button>)}
      </div>
      {data.loading ? <Skeleton rows={6} /> : data.error ? <ErrorBox error={data.error} onRetry={data.reload} /> : !data.data?.transactions?.length ?
        <Empty title={t('tx.emptyTitle')} text={t('tx.emptyText')} /> :
        <ul className="v2-moves">{data.data.transactions.map((tx) => {
          const dir = txDir(tx), amount = tx.amount_original
          const signed = dir === 'out' && amount != null ? '-' + String(amount).replace(/^-/, '') : amount
          const query = new URLSearchParams(sp); query.delete('offset'); query.set('tx', String(tx.id))
          return <li key={tx.id}><span>
            <Link className="v2-btn-link" to={'/business/transactions?' + query}>{descLabel(t, tx.description || tx.counterparty || t(`tx.type.${tx.type}`))}</Link>
            <span className="v2-small v2-muted" style={{ display: 'block' }}>{shortDate(txDate(tx), lang)} · {catLabel(t, tx.category || '')}{dir === 'transfer' ? ' · ' + t('tx.notIncome') : ''}</span>
          </span><span className="v2-num">{money(signed, { sign: dir === 'in' || dir === 'out', full: true, currency: tx.currency_original || data.data.wallet.currency })}</span></li>
        })}</ul>}
      {!data.loading && !data.error && <div className="v2-foot"><span>{t('history.page', { start: data.data?.transactions?.length ? offset + 1 : 0, end: offset + (data.data?.transactions?.length || 0), total: data.data?.total ?? '—' })}</span><span className="v2-btnpair">
        <Btn disabled={!offset} onClick={() => select(period, Math.max(0, offset - PAGE))}>{t('history.previous')}</Btn>
        <Btn disabled={!data.data?.has_more} onClick={() => select(period, offset + PAGE)}>{t('history.next')}</Btn>
      </span></div>}
    </Card>
  </div>
}
