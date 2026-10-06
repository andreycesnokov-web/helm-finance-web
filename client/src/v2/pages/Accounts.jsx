// Accounts (designs/Accounts.dc.html). This company's wallets only (GET /api/wallets is
// business-scoped by the server); the Personal workspace is never fetched or counted here.
// Statement freshness from GET /api/bank-import/batches; moves between accounts from
// GET /api/transactions (type=transfer). Adding/editing accounts stays on the existing
// page (Manage accounts).
//
// A wallet or transfer labelled scope='personal' can still carry this company's business_id
// (migration 017 backfill; _specs/accounts-personal-scope-ambiguity.md). The label does not
// prove ownership either way, so such rows are NOT dropped and NOT re-totalled: they stay in
// the list and the total exactly as the API returns them, with a "Labelled personal" chip and
// a note saying so. Fixing the label or the owner is a data decision, not done here.
import { Link } from 'react-router-dom'
import I from '../icons'
import { PageHead, Card, Btn, Pill, Skeleton, ErrorBox, Empty } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi, useInvalidate } from '../data'
import { money, shortDate, daysUntil } from '../lib/format'
import { statementFreshness, txDate, unlinkedMoney } from '../lib/obligations'
import BusinessWalletTransferModal from '../../components/BusinessWalletTransferModal'
import { useAuth } from '../../hooks/useAuth'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { useState, useEffect } from 'react'

const KIND = { bank: 'acc.kind.bank', cash: 'acc.kind.cash', ewallet: 'acc.kind.ewallet', card: 'acc.kind.card', gateway: 'acc.kind.gateway' }
const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--brand-navy)', 'var(--text-muted)']

export default function Accounts() {
  const t = useT()
  const lang = useLang()
  const { token } = useAuth()
  const { active, scopeKey } = useWorkspace()
  const [showTransfer, setShowTransfer] = useState(false)
  const invalidate = useInvalidate()
  const w = useApi('/wallets')
  const batches = useApi('/bank-import/batches')
  const transfers = useApi('/transactions?period=all&type=transfer')
  const allTx = useApi('/transactions?period=all')

  // Company switch protection: close transfer modal immediately
  useEffect(() => {
    setShowTransfer(false)
  }, [active?.id, scopeKey])

  const head = (
    <PageHead title={t('nav.accounts')} sub={t('acc.sub')}
      actions={<>
        <Btn onClick={() => setShowTransfer(true)} id="open-wallet-transfer-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          ⇄ Transfer between accounts
        </Btn>
        <Btn to="/business/bank-import">{t('acc.import')}</Btn>
        <Btn variant="primary" icon={<I.plus size={16} />} to="/business/accounts/manage">{t('acc.add')}</Btn>
      </>} />
  )
  if (w.loading) return <>{head}<Card><Skeleton rows={5} /></Card></>
  if (w.error) return <>{head}<ErrorBox error={w.error} onRetry={w.reload} /></>

  const wallets = (w.data?.wallets || []).filter((x) => x.is_active !== false)
  const labelledPersonal = wallets.filter((x) => x.scope === 'personal')
  // Payments recorded without an account: they are in the company total on Pulse, in no account here.
  const unlinked = Array.isArray(allTx.data) ? unlinkedMoney(allTx.data, w.data?.wallets || []) : { sum: 0, count: 0 }
  const idr = wallets.filter((x) => (x.currency || 'IDR') === 'IDR')
  const other = wallets.filter((x) => (x.currency || 'IDR') !== 'IDR')
  const total = w.data?.total_balance_idr != null
    ? Number(w.data.total_balance_idr)
    : wallets.reduce((s, x) => s + Number(x.balance_idr ?? x.balance ?? 0), 0)
  const positive = wallets.filter((x) => Number(x.balance_idr ?? x.balance) > 0)
  const posSum = positive.reduce((s, x) => s + Number(x.balance_idr ?? x.balance), 0)
  const fresh = statementFreshness(batches.data?.batches || [])
  const stale = idr.filter((x) => x.type === 'bank' && (!fresh[x.id] || daysUntil(fresh[x.id].date) < -7))
  
  // Find transfers and group linked legs by transfer_id so exactly one transfer entry appears in UI
  const allTransactions = Array.isArray(allTx.data) ? allTx.data : []
  const transferTransactions = Array.isArray(transfers.data) ? transfers.data : []
  const rawTransfers = [...transferTransactions]
  allTransactions.forEach(t => {
    if ((t.transfer_id || t.type === 'transfer' || t.category === 'Transfer') && !rawTransfers.some(c => c.id === t.id)) {
      rawTransfers.push(t)
    }
  })

  const transferMap = new Map()
  const groupedMoves = []

  rawTransfers.forEach(t => {
    if (t.transfer_id) {
      if (transferMap.has(t.transfer_id)) {
        const item = transferMap.get(t.transfer_id)
        if (t.type === 'expense' || t.direction === 'out') {
          item.from = t.source || item.from
          item.amount = t.amount_original || item.amount
          item.currency = t.currency_original || item.currency
        } else if (t.type === 'income' || t.direction === 'in') {
          item.to = t.source || item.to
        }
        return
      }
      const entry = {
        id: `xfer-${t.transfer_id}`,
        transfer_id: t.transfer_id,
        date: t.transaction_date || t.created_at,
        amount: t.amount_original,
        currency: t.currency_original || 'IDR',
        description: t.description,
        from: (t.type === 'expense' || t.direction === 'out') ? t.source : null,
        to: (t.type === 'income' || t.direction === 'in') ? t.source : null,
        scope: t.scope,
      }
      transferMap.set(t.transfer_id, entry)
      groupedMoves.push(entry)
    } else {
      groupedMoves.push({
        id: t.id,
        date: t.transaction_date || t.created_at,
        amount: t.amount_original,
        currency: t.currency_original || 'IDR',
        description: t.description,
        from: t.source,
        to: null,
        scope: t.scope,
      })
    }
  })

  groupedMoves.sort((a, b) => new Date(b.date) - new Date(a.date))
  const moves = groupedMoves.slice(0, 6)
  const shareLabel = positive.map((x) => `${x.name} ${Math.round((Number(x.balance_idr ?? x.balance) / posSum) * 100)}%`).join(', ')

  const formatRateSource = (src) => {
    if (!src || src === 'uninitialized') return null
    if (src === 'bi_jisdor_hybrid') return 'Bank Indonesia JISDOR, ExchangeRate-API, CoinGecko'
    if (src === 'exchangerate_api_hybrid') return 'ExchangeRate-API, CoinGecko'
    if (src === 'bi_jisdor') return 'Bank Indonesia JISDOR'
    if (src === 'exchangerate_api') return 'ExchangeRate-API'
    if (src === 'coingecko') return 'CoinGecko'
    if (src === 'fixed_accounting_table') return 'Fixed accounting table'
    return src
  }

  if (!wallets.length) {
    return <>{head}<Card><Empty icon={<I.accounts size={28} />} title={t('acc.emptyTitle')} text={t('acc.emptyText')}
      action={<Btn variant="primary" to="/business/accounts/manage">{t('acc.add')}</Btn>} /></Card></>
  }

  return (
    <div className="v2-page">
      {head}
      <div className="v2-grid-detail">
        <div className="v2-col">
          <Card>
            <div className="v2-acc-total">
              <div className="v2-stat">
                <span className="v2-stat-label">{t('acc.total', { n: wallets.length })}</span>
                <span className="v2-stat-big v2-num">{money(total)}</span>
                {other.length > 0 && (
                  <span className="v2-muted v2-small">
                    {t('acc.asOfDate', { d: shortDate(w.data?.rates_metadata?.rate_effective_date || w.data?.as_of_date || new Date(), lang) })}
                    {formatRateSource(w.data?.rates_metadata?.source) && (
                      <> · {formatRateSource(w.data?.rates_metadata?.source)}</>
                    )}
                    {w.data?.rates_metadata?.status === 'weekend_holding' && <> · <span className="v2-tag-info">Weekend holding</span></>}
                    {w.data?.rates_metadata?.status === 'degraded' && <> · <span className="v2-tag-warn">Fallback rates</span></>}
                    {w.data?.rates_metadata?.status === 'stale' && <> · <span className="v2-tag-warn">Stale rate</span></>}
                  </span>
                )}
              </div>
              {w.data?.has_incomplete_balance && (
                <p className="v2-small" style={{ color: 'var(--text-warn, #b45309)', marginTop: 4 }}>
                  <Pill tone="warn">Incomplete valuation</Pill> {w.data.unvalued_currencies?.join(', ')} {w.data.unvalued_currencies?.length > 1 ? 'wallets have' : 'wallet has'} no FX rate and {w.data.unvalued_currencies?.length > 1 ? 'are' : 'is'} excluded from the IDR total.
                </p>
              )}
              <p className="v2-muted v2-small">{t('acc.personalNote')}</p>
              {unlinked.count > 0 && <p className="v2-small"><Pill tone="warn">{t('acc.unlinkedTitle', { n: unlinked.count })}</Pill> {t('acc.unlinked', { v: money(unlinked.sum, { sign: true }), total: money(total + unlinked.sum) })} <Link to="/business/transactions">{t('nav.transactions')}</Link></p>}
              {labelledPersonal.length > 0 && <p className="v2-small"><Pill tone="warn">{t('acc.labelledPersonal')}</Pill> {t('acc.labelledNote', { n: labelledPersonal.length })}</p>}
            </div>
            {posSum > 0 && (
              <>
                <div className="v2-sharebar" role="img" aria-label={t('acc.shareLabel', { list: shareLabel })}>
                  {positive.map((x, i) => <span key={x.id} style={{ width: `${(Number(x.balance_idr ?? x.balance) / posSum) * 100}%`, background: SERIES[i % SERIES.length] }} />)}
                </div>
                <ul className="v2-sharelegend">
                  {positive.map((x, i) => <li key={x.id}><span className="v2-key-dot" style={{ background: SERIES[i % SERIES.length] }} aria-hidden="true" />{x.name}</li>)}
                </ul>
              </>
            )}
          </Card>
          <Card>
            <ul className="v2-acclist">
              {wallets.map((x) => {
                const fr = fresh[x.id]
                const isNonIdr = x.currency && x.currency !== 'IDR'
                return (
                  <li key={x.id} className="v2-acc">
                    <span className="v2-dec-ic v2-tone-info" aria-hidden="true">{x.type === 'cash' ? <I.funding /> : <I.accounts />}</span>
                    <span className="v2-acc-text">
                      <span className="v2-dec-title">{x.name}{x.scope === 'personal' && <> <Pill tone="warn">{t('acc.labelledPersonal')}</Pill></>}</span>
                      <span className="v2-dec-meta">{[t(KIND[x.type] || 'acc.kind.other'), x.entity_name, isNonIdr ? x.currency : null].filter(Boolean).join(' · ')}</span>
                      <span className="v2-small">{fr
                        ? <>{t('acc.statementOn', { d: shortDate(fr.date, lang) })}{fr.status === 'review_required' && <> · <Link to="/business/bank-import">{t('acc.toReview')}</Link></>}</>
                        : x.type === 'bank' ? <><span className="v2-muted">{t('acc.noStatement')}</span> · <Link to="/business/bank-import">{t('acc.upload')}</Link></> : <span className="v2-muted">{t('acc.manual')}</span>}</span>
                    </span>
                    <span className="v2-dec-amt v2-num">
                      <span>{money(x.balance, { currency: x.currency || 'IDR' })}</span>
                      {isNonIdr && x.balance_idr != null && <span className="v2-muted v2-small" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 400 }}>≈ {money(x.balance_idr, { currency: 'IDR' })}</span>}
                      {isNonIdr && x.balance_idr == null && <span className="v2-muted v2-small" style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-warn, #b45309)' }}>No FX rate</span>}
                    </span>
                    <Link className="v2-iconbtn" to="/business/accounts/manage" aria-label={t('acc.more', { name: x.name })}><I.chevRight size={18} /></Link>
                  </li>
                )
              })}
            </ul>
            {other.length > 0 && (
              <p className="v2-muted v2-small">
                {t('acc.asOfDate', { d: shortDate(w.data?.rates_metadata?.rate_effective_date || w.data?.as_of_date || new Date(), lang) })}
                {formatRateSource(w.data?.rates_metadata?.source) && ` · ${formatRateSource(w.data?.rates_metadata?.source)}`}
              </p>
            )}
          </Card>
        </div>
        <aside className="v2-col">
          <Card title={t('acc.keepTrue')}>
            <p className="v2-sec">{stale.length ? t('acc.staleN', { list: stale.map((x) => x.name).join(', ') }) : t('acc.allFresh')}</p>
            <Btn to="/business/bank-import">{t('acc.import')}</Btn>
          </Card>
          <Card title={t('acc.moves')}>
            <p className="v2-muted v2-small">{t('acc.movesNote')}</p>
            {moves.length === 0 ? <p className="v2-muted">{t('acc.noMoves')}</p> : (
              <ul className="v2-moves">
                {moves.map((m) => (
                  <li key={m.id}>
                    <span>
                      {shortDate(m.date, lang)} · {m.from && m.to ? `${m.from} → ${m.to}` : (m.description || t('acc.transfer'))}
                      {m.scope === 'personal' && <> <Pill tone="warn">{t('acc.labelledPersonal')}</Pill></>}
                    </span>
                    <span className="v2-num">{money(m.amount, { currency: m.currency || 'IDR' })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
      {showTransfer && (
        <BusinessWalletTransferModal
          token={token}
          wallets={wallets}
          userRole={active?.role}
          onClose={() => setShowTransfer(false)}
          onSuccess={() => {
            setShowTransfer(false)
            invalidate()
            w.reload()
            transfers.reload()
            allTx.reload()
          }}
        />
      )}
    </div>
  )
}
