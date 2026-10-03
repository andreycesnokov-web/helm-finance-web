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
import { useApi } from '../data'
import { money, shortDate, daysUntil } from '../lib/format'
import { statementFreshness, txDate, unlinkedMoney } from '../lib/obligations'

const KIND = { bank: 'acc.kind.bank', cash: 'acc.kind.cash', ewallet: 'acc.kind.ewallet', card: 'acc.kind.card', gateway: 'acc.kind.gateway' }
const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--brand-navy)', 'var(--text-muted)']

export default function Accounts() {
  const t = useT()
  const lang = useLang()
  const w = useApi('/wallets')
  const batches = useApi('/bank-import/batches')
  const transfers = useApi('/transactions?period=all&type=transfer')
  const allTx = useApi('/transactions?period=all')
  const head = (
    <PageHead title={t('nav.accounts')} sub={t('acc.sub')}
      actions={<><Btn to="/business/bank-import">{t('acc.import')}</Btn><Btn variant="primary" icon={<I.plus size={16} />} to="/business/accounts/manage">{t('acc.add')}</Btn></>} />
  )
  if (w.loading) return <>{head}<Card><Skeleton rows={5} /></Card></>
  if (w.error) return <>{head}<ErrorBox error={w.error} onRetry={w.reload} /></>

  const wallets = (w.data?.wallets || []).filter((x) => x.is_active !== false)
  const labelledPersonal = wallets.filter((x) => x.scope === 'personal')
  // Payments recorded without an account: they are in the company total on Pulse, in no account here.
  const unlinked = Array.isArray(allTx.data) ? unlinkedMoney(allTx.data, w.data?.wallets || []) : { sum: 0, count: 0 }
  const idr = wallets.filter((x) => (x.currency || 'IDR') === 'IDR')
  const other = wallets.filter((x) => (x.currency || 'IDR') !== 'IDR')
  const total = idr.reduce((s, x) => s + Number(x.balance || 0), 0)
  const positive = idr.filter((x) => Number(x.balance) > 0)
  const posSum = positive.reduce((s, x) => s + Number(x.balance), 0)
  const fresh = statementFreshness(batches.data?.batches || [])
  const stale = idr.filter((x) => x.type === 'bank' && (!fresh[x.id] || daysUntil(fresh[x.id].date) < -7))
  const moves = (Array.isArray(transfers.data) ? transfers.data : []).slice(0, 4)
  const shareLabel = positive.map((x) => `${x.name} ${Math.round((Number(x.balance) / posSum) * 100)}%`).join(', ')

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
                <span className="v2-stat-label">{t('acc.total', { n: idr.length })}</span>
                <span className="v2-stat-big v2-num">{money(total)}</span>
              </div>
              <p className="v2-muted v2-small">{t('acc.personalNote')}</p>
              {unlinked.count > 0 && <p className="v2-small"><Pill tone="warn">{t('acc.unlinkedTitle', { n: unlinked.count })}</Pill> {t('acc.unlinked', { v: money(unlinked.sum, { sign: true }), total: money(total + unlinked.sum) })} <Link to="/business/transactions">{t('nav.transactions')}</Link></p>}
              {labelledPersonal.length > 0 && <p className="v2-small"><Pill tone="warn">{t('acc.labelledPersonal')}</Pill> {t('acc.labelledNote', { n: labelledPersonal.length })}</p>}
            </div>
            {posSum > 0 && (
              <>
                <div className="v2-sharebar" role="img" aria-label={t('acc.shareLabel', { list: shareLabel })}>
                  {positive.map((x, i) => <span key={x.id} style={{ width: `${(Number(x.balance) / posSum) * 100}%`, background: SERIES[i % SERIES.length] }} />)}
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
                return (
                  <li key={x.id} className="v2-acc">
                    <span className="v2-dec-ic v2-tone-info" aria-hidden="true">{x.type === 'cash' ? <I.funding /> : <I.accounts />}</span>
                    <span className="v2-acc-text">
                      <span className="v2-dec-title">{x.name}{x.scope === 'personal' && <> <Pill tone="warn">{t('acc.labelledPersonal')}</Pill></>}</span>
                      <span className="v2-dec-meta">{[t(KIND[x.type] || 'acc.kind.other'), x.entity_name, x.currency !== 'IDR' ? x.currency : null].filter(Boolean).join(' · ')}</span>
                      <span className="v2-small">{fr
                        ? <>{t('acc.statementOn', { d: shortDate(fr.date, lang) })}{fr.status === 'review_required' && <> · <Link to="/business/bank-import">{t('acc.toReview')}</Link></>}</>
                        : x.type === 'bank' ? <><span className="v2-muted">{t('acc.noStatement')}</span> · <Link to="/business/bank-import">{t('acc.upload')}</Link></> : <span className="v2-muted">{t('acc.manual')}</span>}</span>
                    </span>
                    <span className="v2-dec-amt v2-num">{money(x.balance, { currency: x.currency || 'IDR' })}</span>
                    <Link className="v2-iconbtn" to="/business/accounts/manage" aria-label={t('acc.more', { name: x.name })}><I.chevRight size={18} /></Link>
                  </li>
                )
              })}
            </ul>
            {other.length > 0 && <p className="v2-muted v2-small">{t('acc.otherCcy')}</p>}
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
                {moves.map((m) => <li key={m.id}><span>{shortDate(txDate(m), lang)} · {m.description || t('acc.transfer')}{m.scope === 'personal' && <> <Pill tone="warn">{t('acc.labelledPersonal')}</Pill></>}</span><span className="v2-num">{money(m.amount_original, { currency: m.currency_original || 'IDR' })}</span></li>)}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  )
}
