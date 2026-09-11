import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useWorkspace } from '../shell/WorkspaceProvider'
import { useAccess } from '../hooks/useAccess'
import { useTranslation } from '../hooks/useTranslation'
import { apiFetch, fmt, fmtFull } from '../lib/api'
import { formatCurrency } from '../lib/money'
import { walletsSummary } from './walletsSummary'
import { partitionWallets } from '../lib/walletBalanceContract'
import { createRequestGuard } from '../lib/requestGuard'
import { Card, Btn, ErrorState } from '../shell/ui'
import { WalletsEmptyState } from './WalletsEmptyState'
import {
  AccountsHeader, AccountsSummary, WalletList, AboutWallets, WalletFormModal,
} from './AccountsBlocks'
import { WORKSPACE_DEFAULT_CURRENCY } from './walletsSummary'

// ── Wallet type config ────────────────────────────────────────────────────────
const WALLET_TYPES = [
  { value: 'bank',            label: 'Bank account' },
  { value: 'cash',            label: 'Cash' },
  { value: 'ewallet',         label: 'E-Wallet' },
  { value: 'alipay',          label: 'Alipay' },
  { value: 'wechat_pay',      label: 'WeChat Pay' },
  { value: 'crypto',          label: 'Crypto wallet' },
  { value: 'payment_gateway', label: 'Payment gateway' },
  { value: 'other',           label: 'Other' },
  { value: '__custom__',      label: '✏️ Custom type…', adminOnly: true },
]

const CURRENCIES = ['IDR', 'USD', 'EUR', 'SGD', 'MYR', 'THB', 'CNY']

// TYPE_ICON and the private CURRENCY_STYLE palette that used to sit here are
// gone. The icons moved verbatim into AccountsBlocks.jsx and now draw at
// currentColor; the palette was seven hardcoded pairs (#E1F5EE / #085041 …) that
// belonged to no token layer and coloured a row by its CURRENCY while the icon
// depicts its TYPE. The form's currency swatches keep a styleFor() below, which
// is the one place that mapping was actually about a currency.

// The Add/Edit form still shows a colour behind each currency code. That is a
// swatch to tell options apart in a list, not a semantic colour, so it stays
// local to the form and out of the token layer.
const CURRENCY_SWATCH = {
  IDR: { bg: '#E1F5EE', color: '#085041' },
  USD: { bg: '#EEF2FF', color: '#3730a3' },
  EUR: { bg: '#FEF3C7', color: '#92400E' },
  SGD: { bg: '#FDE8FF', color: '#7E22CE' },
  MYR: { bg: '#FFF1F2', color: '#9F1239' },
  THB: { bg: '#F0F9FF', color: '#0369A1' },
  CNY: { bg: '#FFF1F0', color: '#991B1B' },
}
const getCurrencyStyle = (currency) => CURRENCY_SWATCH[currency] || { bg: '#F1F5F9', color: '#475569' }

// ── Default form state ────────────────────────────────────────────────────────
const EMPTY_FORM = { name: '', currency: WORKSPACE_DEFAULT_CURRENCY, type: '', entity_name: '', opening_balance: '', sort_order: 0, custom_type: '', scope: 'business' }

export default function Accounts() {
  const { token } = useAuth()
  const { access } = useAccess()
  // switchTo() bumps scopeKey rather than remounting the page, so a page that
  // does not read it keeps rendering the previous workspace's data.
  //
  // Defaulted, not destructured directly: this component is ALSO mounted on the
  // legacy /accounts route, which sits in <Layout> outside WorkspaceProvider.
  // useWorkspace() returns null there, and destructuring null throws — so the
  // legacy page would have gone white. Outside the provider there is no switcher
  // to follow, and the single fetch on mount is the correct behaviour.
  const { active, scopeKey } = useWorkspace() || {}
  const navigate = useNavigate()
  const { t } = useTranslation()

  // Only owner/admin can adjust wallet balances
  const canAdjust = ['owner', 'admin'].includes(access?.membership?.role)

  const [wallets,      setWallets]      = useState([])
  const [legacySources,setLegacySources]= useState([]) // source-based accounts not yet in wallets
  const [loading,      setLoading]      = useState(true)
  // A failed load used to be swallowed into console.error, leaving wallets as []
  // with loading false — which is indistinguishable from "this workspace has no
  // wallets". The page then told a user with accounts that they had none and
  // invited them to add their first. An unknown balance is not zero.
  const [loadError,    setLoadError]    = useState(false)
  const [showForm,     setShowForm]     = useState(false)
  const [editWallet,   setEditWallet]   = useState(null)
  const [form,         setForm]         = useState(EMPTY_FORM)
  const [saving,       setSaving]       = useState(false)
  const [backfilling,  setBackfilling]  = useState(false)
  const [backfillDone, setBackfillDone] = useState(false)

  // ── Admin ─────────────────────────────────────────────────────────────────
  const [isAdmin,      setIsAdmin]      = useState(false)
  const [adjustWallet, setAdjustWallet] = useState(null) // wallet being adjusted
  const today = new Date().toISOString().slice(0, 10)
  const [adjustForm,   setAdjustForm]   = useState({ target_balance: '', reason: '', transaction_date: today })
  const [adjusting,    setAdjusting]    = useState(false)

  // ── Load wallets + legacy sources ─────────────────────────────────────────
  //
  // Guarded against out-of-order responses. Switching from company A to B while
  // A's request is still in flight is not hypothetical: A's slower response
  // lands last and paints A's wallets, balances and total under B's name. That
  // is a data-isolation bug, not a cosmetic one — the same one requestGuard was
  // written for on the AI Accountant intake.
  const guard = useRef(createRequestGuard())
  // Which workspace the rows currently on screen belong to.
  const loadedScope = useRef(undefined)

  const load = async () => {
    const req = guard.current.start()
    const scopeId = active?.id ?? null
    setLoading(true)
    setLoadError(false)
    // A WORKSPACE CHANGE clears the list first, so company A's wallets are never
    // on screen underneath company B's name while B is still loading. A reload
    // of the SAME workspace — after saving a wallet — keeps its rows until the
    // new ones arrive, so an ordinary save does not blank the page.
    if (loadedScope.current !== undefined && loadedScope.current !== scopeId) {
      setWallets([])
      setLegacySources([])
    }
    try {
      const [wData, pData] = await Promise.all([
        apiFetch('/wallets', token),
        apiFetch('/pulse?scope=all', token),
      ])
      // A response from a workspace the user has already left is discarded.
      if (req.isStale()) return

      const loaded = wData.wallets || []
      setWallets(loaded)

      // Legacy: source-based virtual accounts not yet migrated to wallets
      const walletNames = new Set(loaded.map(w => w.name))
      const legacy = (pData.accounts || []).filter(a => !walletNames.has(a.name))
      setLegacySources(legacy)
      loadedScope.current = scopeId
    } catch (e) {
      if (req.isStale()) return
      console.error(e)
      setLoadError(true)
      loadedScope.current = scopeId
    } finally {
      // Only the current request may clear the spinner: a stale one finishing
      // would otherwise report the newer request as done.
      if (!req.isStale()) setLoading(false)
    }
  }

  // Re-fetched per active workspace. The deps were `[]`, and switching company
  // does not remount this page — it bumps scopeKey — so the list, the balances
  // and the total stayed on the PREVIOUS company's data until a manual reload.
  // The API was never the problem: it is strictly business-scoped, and the page
  // simply never asked again. Same contract the other business pages use.
  useEffect(() => {
    load()
  }, [token, active?.id, scopeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Admin status is a property of the USER, not of the workspace, so it is
    // fetched once. Silent and non-blocking — it never errors visibly.
    apiFetch('/admin/status', token)
      .then(d => { setIsAdmin(d.is_admin === true) })
      .catch(e => console.warn('[admin/status] failed:', e.message))
  }, [token])

  // ── Computed totals ───────────────────────────────────────────────────────
  // The three cross-currency sums that used to live here are gone rather than
  // merely unused. Each added every wallet's balance regardless of denomination
  // and the result was labelled IDR, so one dollar account made the headline
  // wrong; leaving them in place would be leaving the next caller a loaded gun.
  // Totals are now derived per currency, below.

  // No client-side scope filter. GET /api/wallets is already restricted to the
  // ACTIVE COMPANY — resolveActiveBusiness() rejects a personal workspace
  // outright (`business_workspace_required`) and bizOrFilter() is a strict
  // `business_id.eq.<active business>` with the legacy NULL union removed. So
  // every row that arrives here belongs to the selected company by the only
  // link that establishes ownership, and the page shows all of them.
  //
  // The `scope` column is NOT that link. A row may carry scope='personal' and
  // this company's business_id — migration 017 backfilled every wallet of a user
  // into their owned business without filtering on scope — so the flag is a
  // label on a company-owned row, not proof the money is someone's own. It stays
  // visible as a chip on the row; it no longer filters the list or the total.
  // See _specs/accounts-personal-scope-ambiguity.md.

  // ── the summary card's amounts, one currency at a time ────────────────────
  //
  // A balance belongs to exactly one currency, so a total may only ever cover
  // wallets that share one. This page used to add every wallet's balance together
  // and label the result IDR, which silently turned $1 000 into Rp 1 000 the
  // moment a dollar account existed. The rule the rest of the codebase already
  // states — personal Pulse in server/index.js and BusinessAccounts both say
  // "NEVER sum across currencies" — now holds here too.
  //
  // Nothing is converted. There is no rate in this product that could value one
  // currency in another, so the page reports what it knows: a total per currency.
  // Grouping is needed twice: the card totals the one currency whose balances are
  // provable, and each wallet row shows its share of its OWN currency's total.
  //
  // `unproven` is not a display bug being hidden — it is a backend gap being told
  // the truth about. The business endpoint derives balance from amount_idr, so a
  // non-IDR wallet's number is an IDR-reporting figure wearing a foreign
  // currency's label. The row lists the wallet and says the balance is not
  // available yet rather than printing "$" in front of rupiah.
  const { proven: provenGroups, unproven: unprovenGroups } = partitionWallets(wallets)
  const groupOf = (w) => provenGroups.find((g) => g.wallets.includes(w))
  const isUnproven = (w) => unprovenGroups.some((g) => g.wallets.includes(w))
  // One label, because there is one list: this company's wallets.
  const summary = walletsSummary({ wallets, t, scopeLabel: t('accounts.totalBalance') })
  // The collection has resolved and holds nothing. Distinct from "still loading"
  // and from "the request failed", and only this one invites a first wallet.
  const resolvedEmpty = !loading && !loadError && wallets.length === 0

  // ── Backfill handler ──────────────────────────────────────────────────────
  const handleBackfill = async () => {
    if (!window.confirm('Import your existing account names as wallets? You can edit them afterwards.')) return
    setBackfilling(true)
    try {
      const r = await apiFetch('/wallets/backfill', token, { method: 'POST', body: {} })
      setBackfillDone(true)
      await load()
      if (r.created === 0) alert('All existing accounts are already in your wallet list.')
    } catch (e) {
      alert(e.message)
    } finally {
      setBackfilling(false)
    }
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditWallet(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  const openEdit = (w) => {
    setEditWallet(w)
    const knownType = WALLET_TYPES.find(t => t.value === w.type && t.value !== '__custom__')
    setForm({
      name: w.name, currency: w.currency || 'IDR',
      type: knownType ? w.type : (w.type ? '__custom__' : ''),
      custom_type: knownType ? '' : (w.type || ''),
      entity_name: w.entity_name || '', opening_balance: '', sort_order: w.sort_order || 0,
      scope: w.scope || 'business',
    })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      // Resolve custom type: if __custom__ selected, use the custom_type text
      const resolvedType = form.type === '__custom__'
        ? (form.custom_type.trim() || null)
        : (form.type || null)

      if (editWallet) {
        await apiFetch(`/wallets/${editWallet.id}`, token, {
          method: 'PUT',
          body: { name: form.name, currency: form.currency, type: resolvedType, entity_name: form.entity_name || null, scope: form.scope || 'business' },
        })
      } else {
        await apiFetch('/wallets', token, {
          method: 'POST',
          body: {
            name:            form.name,
            currency:        form.currency,
            type:            resolvedType,
            entity_name:     form.entity_name || null,
            opening_balance: Number(form.opening_balance) || 0,
            sort_order:      wallets.length,
            scope:           form.scope || 'business',
          },
        })
      }
      setShowForm(false)
      await load()
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Adjust balance (admin only) ───────────────────────────────────────────
  const openAdjust = (w) => {
    setAdjustWallet(w)
    setAdjustForm({ target_balance: '', reason: '', transaction_date: today })
  }

  const handleAdjust = async () => {
    if (!adjustWallet) return
    const targetNum = Number(adjustForm.target_balance)
    if (isNaN(targetNum) || adjustForm.target_balance === '') return
    if (!adjustForm.reason.trim()) return
    setAdjusting(true)
    try {
      const r = await apiFetch(`/wallets/${adjustWallet.id}/adjust-balance`, token, {
        method: 'POST',
        body: {
          target_balance:   targetNum,
          reason:           adjustForm.reason.trim(),
          transaction_date: adjustForm.transaction_date || undefined,
        },
      })
      if (r.delta === 0) {
        alert('Balance is already at target — no correction needed.')
      } else {
        const sign = r.delta > 0 ? '+' : ''
        alert(`Done. Delta: ${sign}${r.delta.toLocaleString('id')} ${adjustWallet.currency}.\nTransaction ID: ${r.transaction_id}`)
      }
      setAdjustWallet(null)
      await load()
    } catch (e) {
      alert(e.message)
    } finally {
      setAdjusting(false)
    }
  }

  const handleDelete = async () => {
    if (!editWallet) return
    if (!window.confirm(`Archive "${editWallet.name}"? The wallet will be hidden. Transactions are not deleted.`)) return
    setSaving(true)
    try {
      await apiFetch(`/wallets/${editWallet.id}`, token, { method: 'DELETE' })
      setShowForm(false)
      await load()
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  // The wallet's type label, resolved against the same list the form offers.
  const typeLabelFor = (w) => WALLET_TYPES.find(
    (x) => x.value === w.type && x.value !== '__custom__')?.label || (w.type || null)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    /* acct-page adds ONE 18px gap between top-level sections. The page was
       spaced by whichever margin each block happened to carry, so the rhythm
       changed with which sections a given state rendered. */
    <div className="hf-page acct-page">

      <AccountsHeader t={t} onAddWallet={openAdd} />

      {/* Total balance hero.
          The same navy surface Pulse uses, from the same component, and the only
          card on this page carrying the brand mark — it holds the page's
          headline money figure.

          It stays on an empty workspace, showing Rp 0 and saying so: zero is the
          true balance of a workspace with no accounts, and keeping the card
          steady means the first wallet fills it in rather than rebuilding the
          page. What it must NOT do is appear before we know — while loading, or
          after a failed load, there is no figure to state and it is not
          rendered. */}
      {!loading && !loadError && <AccountsSummary summary={summary} />}

      {loading && <div className="acct-loading">{t('accounts.loadingWallets')}</div>}

      {/* A failed load gets the shared error treatment and a retry — never the
          empty state, which would be a false claim about the account. */}
      {loadError && (
        <ErrorState
          title={t('accounts.loadFailed')}
          description={t('accounts.loadFailedSub')}
          onRetry={load}
        />
      )}

      {/* Backfill banner — only when legacy accounts exist and no wallets yet. */}
      {resolvedEmpty && legacySources.length > 0 && !backfillDone && (
        <Card className="acct-backfill">
          <p className="acct-addmore-title">
            {t('accounts.youHaveAccounts').replace('{n}', legacySources.length).replace('{s}', legacySources.length !== 1 ? 's' : '')}
          </p>
          <p className="acct-legacy-sub">{t('accounts.importSub')}</p>
          <Btn variant="primary" onClick={handleBackfill} disabled={backfilling}>
            {backfilling ? t('accounts.importing')
              : t('accounts.importAccounts').replace('{n}', legacySources.length).replace('{s}', legacySources.length !== 1 ? 's' : '')}
          </Btn>
        </Card>
      )}

      {/* Zero state — the collection resolved and it is empty. Not during a
          load, not after a failure, and not once a single wallet exists. It
          calls the page's own openAdd, so there is one wallet-creation flow. */}
      {resolvedEmpty && legacySources.length === 0 && (
        <WalletsEmptyState t={t} onAddWallet={openAdd} />
      )}

      {/* The wallet list, and the block that closes it.
          Every wallet the API returned for the active company. The partition
          comes from walletBalanceContract; WalletList renders and classifies
          nothing. */}
      {wallets.length > 0 && (
        <WalletList
          wallets={wallets}
          groupOf={groupOf}
          isUnproven={isUnproven}
          typeLabelFor={typeLabelFor}
          t={t}
          onOpen={(w) => navigate(`/accounts/${w.id}`)}
          onEdit={openEdit}
          onAdjust={canAdjust ? openAdjust : null}
          onAddWallet={openAdd}
        />
      )}

      {/* Legacy unmatched sources — source-based accounts not yet migrated to
          wallets. Same content, on the shared Card. */}
      {!loading && !loadError && wallets.length > 0 && legacySources.length > 0 && (
        <Card title={t('accounts.legacyTitle')}>
          <p className="acct-legacy-sub">{t('accounts.legacySub')}</p>
          <div className="acct-legacy-chips">
            {legacySources.map((a) => (
              <span key={a.id} className="acct-chip">{a.name}</span>
            ))}
          </div>
          <Btn variant="secondary" onClick={handleBackfill} disabled={backfilling}>
            {backfilling ? t('accounts.importing') : t('accounts.importAsWallets')}
          </Btn>
        </Card>
      )}

      <AboutWallets t={t} />

      {/* ── Adjust Balance modal (admin only) ──────────────────────────────── */}
      {adjustWallet && createPortal(
        <div className="modal-overlay" onClick={() => setAdjustWallet(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-drag-handle" />
            <button className="modal-close-btn" onClick={() => setAdjustWallet(null)}>✕</button>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#92400E" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text)' }}>{t('accounts.adjustBalance')}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}>{adjustWallet.name}</div>
              </div>
            </div>

            {/* Info badge */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--text-3)', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 20, padding: '3px 10px', marginBottom: 18 }}>
              {t('accounts.correctionInfo')}
            </div>

            {/* Current balance */}
            <div style={{ background: 'var(--bg-2)', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 4 }}>{t('accounts.currentBalance')}</div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--text)' }}>
                {fmtFull(adjustWallet.balance || 0)}
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-3)', marginLeft: 6 }}>{adjustWallet.currency}</span>
              </div>
            </div>

            {/* Target balance */}
            <label className="modal-label">{t('accounts.targetBalance')} ({adjustWallet.currency})</label>
            <input
              type="number"
              className="modal-input"
              value={adjustForm.target_balance}
              onChange={e => setAdjustForm(p => ({ ...p, target_balance: e.target.value }))}
              placeholder="Enter target balance"
              style={{ marginBottom: 8 }}
              autoFocus
            />

            {/* Delta preview */}
            {adjustForm.target_balance !== '' && !isNaN(Number(adjustForm.target_balance)) && (() => {
              const delta = Number(adjustForm.target_balance) - (adjustWallet.balance || 0)
              if (delta === 0) return (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', marginBottom: 12 }}>No change needed — balance already at target.</div>
              )
              const isPos = delta > 0
              return (
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: isPos ? '#085041' : '#991B1B', background: isPos ? '#E1F5EE' : '#FEE2E2', borderRadius: 8, padding: '6px 12px', marginBottom: 12 }}>
                  Correction: {isPos ? '+' : ''}{delta.toLocaleString('id')} {adjustWallet.currency}
                </div>
              )
            })()}

            {/* Reason */}
            <label className="modal-label">{t('accounts.reason')} <span style={{ color: 'var(--red)', fontWeight: 700 }}>*</span></label>
            <input
              className="modal-input"
              value={adjustForm.reason}
              onChange={e => setAdjustForm(p => ({ ...p, reason: e.target.value }))}
              placeholder="e.g. Bank reconciliation, Opening balance fix"
              style={{ marginBottom: 14 }}
            />

            {/* Date */}
            <label className="modal-label">{t('accounts.transactionDate')}</label>
            <input
              type="date"
              className="modal-input"
              value={adjustForm.transaction_date}
              onChange={e => setAdjustForm(p => ({ ...p, transaction_date: e.target.value }))}
              style={{ marginBottom: 20 }}
            />

            <button
              disabled={
                adjusting ||
                adjustForm.target_balance === '' ||
                isNaN(Number(adjustForm.target_balance)) ||
                !adjustForm.reason.trim()
              }
              onClick={handleAdjust}
              className="btn btn-primary btn-block btn-lg"
              style={{ marginBottom: 8, background: '#92400E', borderColor: '#92400E' }}
            >
              {adjusting ? t('accounts.creatingCorrection') : t('accounts.createCorrection')}
            </button>
            <button onClick={() => setAdjustWallet(null)} className="btn btn-ghost btn-block btn-lg">
              {t('common.cancel')}
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* The Add / Edit form. Presentational component, so the design preview
          renders the SAME form a user fills in rather than a drawing of it —
          the form had never been photographed before. Every handler, field and
          disabled condition below is this page's, passed down. */}
      {showForm && createPortal(
        <WalletFormModal
          t={t}
          form={form}
          setForm={setForm}
          editWallet={editWallet}
          saving={saving}
          canAdjust={canAdjust}
          currencies={CURRENCIES}
          walletTypes={WALLET_TYPES}
          styleFor={getCurrencyStyle}
          onSave={handleSave}
          onCancel={() => setShowForm(false)}
          onAdjust={() => { setShowForm(false); openAdjust(editWallet) }}
          onDelete={handleDelete}
        />,
        document.body
      )}
    </div>
  )
}
