// Transactions (designs/Transactions.dc.html). GET /api/transactions?period=all, then
// filtered on screen (search, In/Out/Transfers/Needs review, account, period).
// "Choose category" saves through the existing PATCH /api/transactions/:id (category
// only) — the same call the existing Transactions page makes. Export builds a CSV of
// the rows on screen in the browser. Editing everything else stays on the classic page.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import I from '../icons'
import { PageHead, Card, Btn, Skeleton, ErrorBox, Empty } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi, useInvalidate } from '../data'
import { money, shortDate } from '../lib/format'
import { txFilter, txDir, txDate, needsCategory, toCsv, txSource } from '../lib/obligations'
import { setTransactionCategory, actionError } from '../lib/actions'

const PAGE = 25

function CategoryPicker({ tx, categories, onSaved }) {
  const t = useT()
  const { token } = useAuth()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const pick = async (e) => {
    const v = e.target.value
    if (!v) return
    setBusy(true); setErr(null)
    try { await setTransactionCategory(token, tx.id, v); onSaved() }
    catch (x) { setErr(actionError(x) === 'forbidden' ? t('dec.forbidden') : actionError(x)) }
    finally { setBusy(false) }
  }
  return (
    <span className="v2-catpick">
      <select className="v2-select" defaultValue="" onChange={pick} disabled={busy} aria-label={t('tx.choose', { what: tx.description || '' })}>
        <option value="">{t('tx.chooseCategory')}</option>
        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      {err && <span className="v2-inline-err" role="alert">{err}</span>}
    </span>
  )
}

export default function Transactions() {
  const t = useT()
  const lang = useLang()
  const invalidate = useInvalidate()
  const [kind, setKind] = useState('all')
  const [walletId, setWalletId] = useState('all')
  const [days, setDays] = useState(30)
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const tx = useApi('/transactions?period=all')
  const wallets = useApi('/wallets')
  const cats = useApi('/cashflow-categories')
  const all = Array.isArray(tx.data) ? tx.data.filter((x) => (x.scope || 'business') === 'business') : []
  const walletName = Object.fromEntries((wallets.data?.wallets || []).map((w) => [String(w.id), w.name]))
  const categories = (cats.data?.categories || []).map((c) => c.name).filter(Boolean)
  const rows = useMemo(() => txFilter(all, { kind, walletId, days, q }), [all, kind, walletId, days, q])
  const review = useMemo(() => txFilter(all, { kind: 'review', days: 0 }).length, [all])

  const exportCsv = () => {
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const head = (
    <PageHead title={t('nav.transactions')} sub={t('tx.sub')}
      actions={<><Btn onClick={exportCsv} disabled={!rows.length}>{t('tx.export')}</Btn><Btn variant="primary" icon={<I.plus size={16} />} to="/business/add">{t('nav.add')}</Btn></>} />
  )
  if (tx.loading) return <>{head}<Card><Skeleton rows={8} /></Card></>
  if (tx.error) return <>{head}<ErrorBox error={tx.error} onRetry={tx.reload} /></>

  return (
    <div className="v2-page">
      {head}
      {review > 0 && (
        <div className="v2-banner v2-tone-warn" role="status">
          <I.warn size={18} />
          <span className="v2-banner-text"><strong>{t('tx.needN', { n: review })}</strong> {t('tx.needHint')}</span>
          <Btn variant="primary" onClick={() => { setKind('review'); setDays(0) }}>{t('tx.reviewN', { n: review })}</Btn>
        </div>
      )}
      <Card>
        <div className="v2-filters">
          <label className="v2-search">
            <I.search size={16} />
            <span className="v2-sr">{t('tx.search')}</span>
            <input className="v2-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('tx.searchPh')} />
          </label>
          <div className="v2-chips" role="group" aria-label={t('tx.kind')}>
            {['all', 'in', 'out', 'transfer', 'review'].map((k) => (
              <button key={k} type="button" className="v2-chip v2-chip-sel" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === 'review' ? t('tx.k.reviewN', { n: review }) : t(`tx.k.${k}`)}
              </button>
            ))}
          </div>
          <div className="v2-row-gap v2-row-start">
            <select className="v2-select" value={walletId} onChange={(e) => setWalletId(e.target.value)} aria-label={t('tx.account')}>
              <option value="all">{t('tx.allAccounts')}</option>
              {(wallets.data?.wallets || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <select className="v2-select" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={t('tx.period')}>
              <option value={30}>{t('tx.p.30')}</option><option value={90}>{t('tx.p.90')}</option><option value={365}>{t('tx.p.365')}</option><option value={0}>{t('tx.p.all')}</option>
            </select>
          </div>
        </div>
        {rows.length === 0 ? <Empty icon={<I.transactions size={28} />} title={t('tx.emptyTitle')} text={t('tx.emptyText')} /> : (
          <div className="v2-txtable" role="table" aria-label={t('nav.transactions')}>
            <div className="v2-txrow v2-txrow-head" role="row">
              <span role="columnheader">{t('radar.col.date')}</span><span role="columnheader">{t('radar.col.what')}</span>
              <span role="columnheader">{t('tx.col.category')}</span><span role="columnheader">{t('tx.col.account')}</span>
              <span role="columnheader">{t('tx.col.source')}</span><span role="columnheader" className="v2-r">{t('radar.col.amount')}</span>
            </div>
            {rows.slice(0, limit).map((x) => {
              const dir = txDir(x)
              const signed = dir === 'in' ? Number(x.amount_original) : dir === 'out' ? -Number(x.amount_original) : Number(x.amount_original)
              return (
                <div key={x.id} className="v2-txrow" role="row">
                  <span role="cell" className="v2-tx-date v2-num">{shortDate(txDate(x), lang)}</span>
                  <span role="cell" className="v2-tx-what"><span className="v2-dec-title">{x.description || x.counterparty || t(`tx.type.${x.type}`)}</span>
                    {dir === 'transfer' && <span className="v2-muted v2-small">{t('tx.notIncome')}</span>}</span>
                  <span role="cell" className="v2-tx-cat">{needsCategory(x)
                    ? <CategoryPicker tx={x} categories={categories} onSaved={invalidate} />
                    : (x.category || <span className="v2-muted">—</span>)}</span>
                  <span role="cell" className="v2-tx-acc v2-small">{walletName[String(x.wallet_id)] || x.source || '—'}</span>
                  <span role="cell" className="v2-tx-src v2-small v2-muted">{t(`tx.src.${txSource(x)}`)}</span>
                  <span role="cell" className={`v2-tx-amt v2-num v2-r ${dir === 'in' ? 'v2-pos' : ''}`}>
                    {money(signed, { sign: dir === 'in' || dir === 'out', currency: x.currency_original || 'IDR' })}</span>
                </div>
              )
            })}
          </div>
        )}
        <div className="v2-foot">
          <span>{t('tx.showing', { n: Math.min(limit, rows.length), m: rows.length })}</span>
          {rows.length > limit && <button type="button" className="v2-btn-link" onClick={() => setLimit((l) => l + PAGE)}>{t('tx.loadMore')}</button>}
          <Link to="/business/transactions/classic">{t('bills.classic')}</Link>
        </div>
      </Card>
    </div>
  )
}
