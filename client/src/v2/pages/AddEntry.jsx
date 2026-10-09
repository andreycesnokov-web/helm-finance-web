// "+ Add" (design v2) — /business/add. One place to record something for THIS company:
//   expense / income   POST /api/transactions/batch, always scope 'business' (lib/addEntry.js);
//                      the server checks the role and that the account belongs to this company
//   bill / invoice     the existing DebtFormModal with the business scope locked (as Bills does)
//   document           Documents (upload and AI reading live there)
//   statement          Bank import
// The legacy Add page (scope 'personal' by default) is no longer reachable from v2.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import DebtFormModal from '../../components/DebtFormModal'
import I from '../icons'
import { PageHead, Card, Btn, Skeleton } from '../ui'
import { useT } from '../i18n'
import { useApi, useInvalidate } from '../data'
import { createBusinessTransaction, actionError } from '../lib/actions'
import { addEntryBody } from '../lib/addEntry'
import { money } from '../lib/format'

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const CHOICES = [
  ['expense', 'arrowUp'], ['income', 'arrowDown'], ['payable', 'bills'], ['receivable', 'arrowDown'],
]
const EMPTY = (type) => ({ type, amount: '', wallet_id: '', date: today(), description: '', category: '' })

export default function AddEntry() {
  const t = useT()
  const { token } = useAuth()
  const invalidate = useInvalidate()
  const wallets = useApi('/wallets')
  const [kind, setKind] = useState('expense')
  const [f, setF] = useState(EMPTY('expense'))
  const [modal, setModal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(null)
  const list = useMemo(() => (wallets.data?.wallets || []).filter((w) => w.is_active !== false), [wallets.data])
  const selectedWalletId = f.wallet_id || (list.length === 1 ? list[0].id : '')
  const selectedWallet = list.find((w) => w.id === selectedWalletId)
  const walletCurrency = (selectedWallet?.currency || 'IDR').toUpperCase()
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  const pick = (k) => {
    setErr(null); setDone(null)
    if (k === 'payable' || k === 'receivable') { setModal(k); return }
    setKind(k); setF((x) => ({ ...EMPTY(k), wallet_id: x.wallet_id }))
  }

  const save = async (e) => {
    e.preventDefault()
    const body = addEntryBody({ ...f, wallet_id: selectedWalletId, currency: walletCurrency })
    if (body.error) { setErr(t(`add.err.${body.error}`)); return }
    setBusy(true); setErr(null)
    try {
      await createBusinessTransaction(token, body.tx)
      invalidate()
      setDone({ type: body.tx.type, amount: body.tx.amount, currency: body.tx.currency })
      setF((x) => ({ ...EMPTY(x.type), wallet_id: x.wallet_id }))
    } catch (x) {
      setErr(actionError(x) === 'forbidden' ? t('add.forbidden') : (x?.data?.error || actionError(x)))
    } finally { setBusy(false) }
  }

  return (
    <div className="v2-page">
      <PageHead title={t('add.title')} sub={t('add.sub')} />
      <div className="v2-start4 v2-addgrid" role="group" aria-label={t('add.title')}>
        {CHOICES.map(([k, ic]) => {
          const Ic = I[ic] || I.plus
          return (
            <button key={k} type="button" className={`v2-card v2-start v2-start-btn${kind === k && !modal ? ' is-on' : ''}`} aria-pressed={kind === k && !modal} onClick={() => pick(k)}>
              <Ic size={20} /><strong>{t(`add.k.${k}`)}</strong><span className="v2-muted v2-small">{t(`add.k.${k}Hint`)}</span>
            </button>
          )
        })}
        <Link className="v2-card v2-start" to="/business/documents"><I.documents size={20} /><strong>{t('add.k.document')}</strong><span className="v2-muted v2-small">{t('add.k.documentHint')}</span></Link>
        <Link className="v2-card v2-start" to="/business/bank-import"><I.accounts size={20} /><strong>{t('add.k.statement')}</strong><span className="v2-muted v2-small">{t('add.k.statementHint')}</span></Link>
      </div>

      <Card title={t(`add.k.${kind}`)}>
        {wallets.loading ? <Skeleton rows={4} /> : (
          <form className="v2-form" onSubmit={save} noValidate>
            <div className="v2-field-row">
              <label className="v2-field">
                <span className="v2-field-label">{t('add.amount')} ({walletCurrency})</span>
                <input id="add-amount" className="v2-input" inputMode="decimal" autoComplete="off" value={f.amount} onChange={set('amount')} placeholder={walletCurrency === 'IDR' ? '1.500.000' : '1,500.00'} required />
              </label>
              <label className="v2-field">
                <span className="v2-field-label">{t('add.date')}</span>
                <input id="add-date" className="v2-input" type="date" value={f.date} onChange={set('date')} required />
              </label>
            </div>
            <label className="v2-field">
              <span className="v2-field-label">{t(kind === 'income' ? 'add.walletIn' : 'add.walletOut')}</span>
              {list.length === 0
                ? <span className="v2-muted v2-small">{t('add.noWallets')} <Link to="/business/accounts">{t('acc.add')}</Link></span>
                : (
                  <select id="add-wallet" className="v2-select" value={selectedWalletId} onChange={set('wallet_id')} required>
                    {list.length > 1 && <option value="">{t('add.pickWallet')}</option>}
                    {list.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}{w.currency && w.currency !== 'IDR' ? ` (${w.currency})` : ''}{w.balance != null ? ` · ${money(w.balance, { currency: w.currency || 'IDR' })}` : ''}
                      </option>
                    ))}
                  </select>
                )}
            </label>
            <label className="v2-field">
              <span className="v2-field-label">{t(kind === 'income' ? 'add.descIn' : 'add.descOut')}</span>
              <input id="add-desc" className="v2-input" value={f.description} onChange={set('description')} maxLength={300} required />
            </label>
            <label className="v2-field">
              <span className="v2-field-label">{t('add.category')}</span>
              <input id="add-category" className="v2-input" value={f.category} onChange={set('category')} maxLength={120} placeholder={t('add.categoryPh')} />
            </label>
            <p className="v2-muted v2-small">{t('add.businessNote')}</p>
            <div className="v2-decide-row">
              <Btn to="/business/transactions">{t('dec.cancel')}</Btn>
              <button type="submit" className="v2-btn v2-btn-primary" disabled={busy || list.length === 0}>{t(kind === 'income' ? 'add.saveIn' : 'add.saveOut')}</button>
            </div>
            {err && <p className="v2-inline-err" role="alert">{err}</p>}
            {done && <p className="v2-dec-done" role="status"><I.check size={16} />{t(done.type === 'income' ? 'add.doneIn' : 'add.doneOut', { v: money(done.amount, { currency: done.currency || 'IDR' }) })} <Link to="/business/transactions">{t('nav.transactions')}</Link></p>}
          </form>
        )}
      </Card>

      {modal && <DebtFormModal mode={modal} token={token} lockBusinessScope
        onClose={() => setModal(null)} onSuccess={() => { setModal(null); invalidate(); setDone(null) }} />}
    </div>
  )
}
