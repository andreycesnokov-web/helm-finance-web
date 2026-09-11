// Wallets & Accounts — presentation blocks.
//
// Split out of Accounts.jsx the way RadarBlocks and AICFOBlocks are, and for the
// same reason: the page needs auth, two network calls and a form's worth of
// state, and a design preview must be able to photograph the REAL components.
//
// This split closes a specific gap. PR #80 shipped screenshots of "Accounts"
// that showed a page header and one navy card — the preview's AccountsBody
// rendered nothing else, so the wallet list, the scope tabs, the add row and the
// wallet form had never been photographed at all. A picture of the summary card
// is not a picture of this page.
//
// Accounts.jsx keeps the token, the fetches, the handlers and both modals'
// behaviour; every pixel below is a pure function of its props.
//
// NO BALANCE IS COMPUTED HERE. Totals, the per-currency partition and the share
// percentages arrive already derived — walletsSummary() and partitionWallets()
// own that, and this module only renders what they return. It does not sum, does
// not convert and does not fill in a missing currency.
import { PageHeader, SummaryCard, Card, Btn, Icon, EmptyState } from '../shell/ui'
import { formatCurrency } from '../lib/money'
import { WalletCurrencyField } from './WalletCurrencyField'
import './Accounts.css'

// The official mark, from the same /brand pipeline every other page uses. The
// list's add block wears it small; the zero state wears it at the size an empty
// state uses. Nothing is drawn in CSS and no new mark is introduced.
export const ACCOUNTS_SYMBOL = '/brand/symbol_navy_blue_dot_transparent.svg'

/* ── wallet type icons ──────────────────────────────────────────────────────
   Unchanged geometry, moved verbatim. They now draw at currentColor instead of
   taking a colour argument, so a row's icon follows its own CSS rather than a
   value computed in JS — which is what let the type icon and the currency chip
   drift apart. */
const TYPE_ICON = {
  bank: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      <line x1="12" y1="12" x2="12" y2="16" /><line x1="10" y1="14" x2="14" y2="14" />
    </svg>
  ),
  cash: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  ),
  ewallet: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  ),
  alipay: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9 9h6M9 12h6" />
      <path d="M7 15c2 1 8 2 10 0" />
    </svg>
  ),
  wechat_pay: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="9" y1="10" x2="9.01" y2="10" />
      <line x1="15" y1="10" x2="15.01" y2="10" />
    </svg>
  ),
  crypto: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9 8h4a2 2 0 0 1 0 4H9zm0 4h4.5a2 2 0 0 1 0 4H9z" />
      <line x1="12" y1="6" x2="12" y2="8" /><line x1="12" y1="16" x2="12" y2="18" />
    </svg>
  ),
  payment_gateway: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  other: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="1" y="4" width="22" height="16" rx="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  ),
}
export const typeIconFor = (type) => TYPE_ICON[type] || TYPE_ICON.other

/* ── the page hero ─────────────────────────────────────────────────────────
   The shared header and the shared flagship card. `flagship` is what earns the
   brand watermark: the total-balance card is this page's headline money figure
   and the only card here that gets one. */
export function AccountsHeader({ t, onAddWallet }) {
  return (
    <PageHeader
      title={t('accounts.walletsAccounts')}
      description={t('accounts.walletsSubtitle')}
      primaryAction={onAddWallet && (
        <Btn variant="primary" icon={<Icon.plus />} onClick={onAddWallet}>
          {t('accounts.addWalletAction')}
        </Btn>
      )}
    />
  )
}

/** The total-balance card. `summary` comes from walletsSummary() — this renders
 *  it and derives nothing. */
export function AccountsSummary({ summary }) {
  return (
    <SummaryCard
      flagship
      compact={summary.compact}
      label={summary.label}
      value={summary.value}
      meta={summary.meta}
    />
  )
}

/**
 * One wallet.
 *
 * Everything the row said before, it still says: name, currency, type,
 * Business/Personal, balance, share of its own currency's total, and the same
 * two actions. What changed is that it says it in the design system's colours
 * and type rather than in fifteen inline style blocks and a private palette.
 *
 * THE BALANCE RULE IS UNCHANGED and is not decided here. `group` is the wallet's
 * proven-currency group from partitionWallets(); when it is absent the row does
 * not print an amount, because the balance's unit cannot be vouched for. An
 * unavailable balance is never rendered as zero.
 */
export function WalletRow({
  wallet, group, unproven, typeLabel, t, onOpen, onEdit, onAdjust,
}) {
  const balance = wallet.balance
  const negative = Number(balance || 0) < 0
  // Share of its OWN currency's total, and only when there is a total to take a
  // share of. Never a share of a mixed sum.
  const pct = group && group.total > 0
    ? Math.round(((Number(balance) || 0) / group.total) * 100)
    : 0
  const scope = wallet.scope || 'business'
  const currencyLabel = group ? group.currency
    : unproven ? (wallet.currency || '').toUpperCase()
      : t('accounts.needsCurrency')

  return (
    <li className="acct-row">
      {/* The row is one button so the whole card is the target and a keyboard
          reaches it. It used to be a div with onClick, which no keyboard could
          reach at all, and the two action buttons were nested inside it. */}
      <button type="button" className="acct-row-open" onClick={() => onOpen(wallet)}>
        <span className={`acct-row-ic${group ? '' : ' is-unproven'}`} aria-hidden="true">
          {typeIconFor(wallet.type)}
        </span>

        <span className="acct-row-main">
          <span className="acct-row-name">{wallet.name}</span>
          <span className="acct-row-tags">
            <span className={`acct-chip acct-chip-cur${group ? '' : ' is-unproven'}`}>{currencyLabel}</span>
            {typeLabel && <span className="acct-chip">{typeLabel}</span>}
            <span className={`acct-chip acct-chip-scope is-${scope}`}>
              {scope === 'business' ? t('accounts.scopeBusiness') : t('accounts.scopePersonal')}
            </span>
          </span>
        </span>

        <span className="acct-row-amount">
          {/* An amount is printed only where its unit is provable. For a wallet
              in another currency the number exists but its unit does not — the
              balance is a sum of amount_idr — so the row says so rather than
              dressing rupiah up as dollars, and never falls back to zero. */}
          <span className={`fin acct-row-balance${negative ? ' is-neg' : ''}${group ? '' : ' is-missing'}`}>
            {group ? formatCurrency(balance || 0, group.currency) : '—'}
          </span>
          <span className="acct-row-sub">
            {group ? `${Math.abs(pct)}${t('accounts.share')}`
              : unproven ? t('accounts.balanceUnavailable')
                : t('accounts.needsCurrency')}
          </span>
          {/* The share, as a short meter under the figure it describes. It ran
              along the row's bottom edge at first, where it overlapped the row
              border and read as a broken rule rather than a measure. Drawn only
              where there is a provable total to take a share OF. */}
          {group && (
            <span
              className="acct-row-meter"
              role="meter"
              aria-valuenow={Math.abs(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${wallet.name}: ${Math.abs(pct)}${t('accounts.share')}`}
            >
              <span
                className={`acct-row-meter-fill${negative ? ' is-neg' : ''}`}
                style={{ width: `${Math.max(2, Math.min(100, Math.abs(pct)))}%` }}
              />
            </span>
          )}
        </span>
      </button>

      <span className="acct-row-actions">
        {onAdjust && (
          <button
            type="button"
            className="acct-iconbtn"
            onClick={() => onAdjust(wallet)}
            aria-label={`${t('accounts.adjustBalance')} — ${wallet.name}`}
            title={t('accounts.adjustBalance')}
          >
            <Icon.plus aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="acct-iconbtn"
          onClick={() => onEdit(wallet)}
          aria-label={`${t('common.edit')} — ${wallet.name}`}
          title={t('common.edit')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      </span>

    </li>
  )
}

/**
 * Add another wallet.
 *
 * Replaces the dashed "+ Add wallet" row that closed the list. That row was a
 * placeholder shape — a card pretending to be a wallet — and it read as an empty
 * slot rather than an invitation.
 *
 * Deliberately smaller than the zero state: the zero state is the whole page and
 * carries the mark at 60px, this closes a list that already has content and
 * carries it at 34px with one line of explanation. Same official asset, same
 * add-wallet flow as the header button — there is exactly one wallet-creation
 * path and both of these call it.
 */
export function AddAnotherWallet({ t, onAddWallet }) {
  return (
    <div className="acct-addmore">
      <img className="acct-addmore-sym" src={ACCOUNTS_SYMBOL} alt="" aria-hidden="true" />
      <div className="acct-addmore-text">
        <p className="acct-addmore-title">{t('accounts.addAnother')}</p>
        <p className="acct-addmore-sub">{t('accounts.addAnotherSub')}</p>
      </div>
      <Btn variant="secondary" icon={<Icon.plus />} onClick={onAddWallet}>
        {t('accounts.addWalletAction')}
      </Btn>
    </div>
  )
}

/**
 * The wallet list.
 *
 * `wallets` is every wallet the API returned for the active company, and
 * `groupOf` / `isUnproven` are the caller's partition — this component
 * classifies nothing itself.
 */
export function WalletList({
  wallets, groupOf, isUnproven, typeLabelFor, t,
  onOpen, onEdit, onAdjust, onAddWallet,
}) {
  // The caller renders this only when the company has wallets, and there is no
  // filter that could empty it — so there is no empty branch here. The zero
  // state belongs to the page, which knows the difference between "this company
  // has no wallets", "the request failed" and "still loading".
  return (
    <>
      <ul className="acct-list">
        {wallets.map((w) => (
          <WalletRow
            key={w.id}
            wallet={w}
            group={groupOf(w)}
            unproven={isUnproven(w)}
            typeLabel={typeLabelFor(w)}
            t={t}
            onOpen={onOpen}
            onEdit={onEdit}
            onAdjust={onAdjust}
          />
        ))}
      </ul>
      <AddAnotherWallet t={t} onAddWallet={onAddWallet} />
    </>
  )
}

/** What this page is, in one card. Unchanged copy, on the shared Card. */
export function AboutWallets({ t }) {
  return (
    <Card title={t('accounts.aboutWallets')} className="acct-about">
      <p className="acct-about-text">{t('accounts.aboutWalletsSub')}</p>
    </Card>
  )
}

/** The zero state, re-exported so the preview and the page take the same one. */
export { WalletsEmptyState } from './WalletsEmptyState'
export { EmptyState }

/**
 * The Add / Edit wallet form.
 *
 * Moved out of Accounts.jsx unchanged in behaviour so the design preview can
 * photograph the form a user actually fills in — it had never been in a
 * screenshot. Every field, placeholder, disabled condition and handler is the
 * page's, passed in; this component owns no state and performs no validation of
 * its own.
 *
 * The currency control is WalletCurrencyField, which owns the currency contract:
 * required, ISO-only, name beside the code, currencies whose native balance the
 * backend cannot prove are visible but DISABLED with the reason, and the field
 * is locked outright once the wallet exists — changing it would relabel every
 * transaction the wallet already holds.
 */
export function WalletFormModal({
  t, form, setForm, editWallet, saving, canAdjust,
  currencies, walletTypes, styleFor,
  onSave, onCancel, onAdjust, onDelete,
}) {
  const isCustom = form.type === '__custom__'
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-drag-handle" />
        <button className="modal-close-btn" onClick={onCancel} aria-label={t('common.close')}>✕</button>

        <h2 className="acct-form-title">
          {editWallet ? `${t('accounts.editWallet')}${editWallet.name}` : t('accounts.addWalletAction')}
        </h2>

        <label className="modal-label" htmlFor="acct-wallet-name">{t('accounts.walletName')}</label>
        <input
          id="acct-wallet-name"
          className="modal-input acct-form-field"
          value={form.name}
          onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="e.g. BCA IDR, Cash Office, Wise USD"
          autoFocus
        />

        <WalletCurrencyField
          currencies={currencies}
          value={form.currency}
          onChange={(c) => setForm((prev) => ({ ...prev, currency: c }))}
          locked={!!editWallet}
          styleFor={styleFor}
          t={t}
        />

        <label className="modal-label" htmlFor="acct-wallet-type">
          {t('accounts.type')} <span className="acct-form-optional">(optional)</span>
        </label>
        <select
          id="acct-wallet-type"
          className={`modal-input${isCustom ? '' : ' acct-form-field'}`}
          value={form.type}
          onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value, custom_type: '' }))}
        >
          <option value="">{t('accounts.selectType')}</option>
          {walletTypes
            .filter((x) => x.value !== '__custom__' || canAdjust)
            .map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </select>

        {isCustom && canAdjust && (
          <>
            <input
              className="modal-input"
              value={form.custom_type}
              onChange={(e) => setForm((prev) => ({ ...prev, custom_type: e.target.value }))}
              placeholder="e.g. Stripe, Dana, PayPal, USDT wallet…"
              autoFocus
            />
            <p className="acct-form-hint">{t('accounts.customType')}</p>
          </>
        )}

        <label className="modal-label" htmlFor="acct-wallet-entity">
          {t('accounts.company')} <span className="acct-form-optional">(optional)</span>
        </label>
        <input
          id="acct-wallet-entity"
          className="modal-input acct-form-field"
          value={form.entity_name}
          onChange={(e) => setForm((prev) => ({ ...prev, entity_name: e.target.value }))}
          placeholder="e.g. PT Siberian BG, Personal"
        />

        {/* Wallets created in the Business Workspace are always business-scoped.
            The Business/Personal selector was removed — Personal Workspace is
            gated off, so business pages must not create personal wallets.
            form.scope stays 'business'. */}

        {/* Opening balance — only for a new wallet. Editing one never rewrites
            its balance; that is what the audited adjust-balance flow is for. */}
        {!editWallet && (
          <>
            <label className="modal-label" htmlFor="acct-wallet-opening">
              {t('accounts.openingBalanceOpt')} <span className="acct-form-optional">(optional)</span>
            </label>
            <input
              id="acct-wallet-opening"
              type="number"
              className="modal-input acct-form-field"
              value={form.opening_balance}
              onChange={(e) => setForm((prev) => ({ ...prev, opening_balance: e.target.value }))}
              placeholder="0"
            />
          </>
        )}

        <div className="acct-form-actions">
          <Btn
            variant="primary"
            disabled={!form.name.trim() || saving}
            onClick={onSave}
          >
            {saving ? t('accounts.saving')
              : editWallet ? t('accounts.saveChanges') : t('accounts.addWalletAction')}
          </Btn>

          <Btn variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Btn>

          {editWallet && canAdjust && (
            <Btn variant="secondary" disabled={saving} onClick={onAdjust}>
              {t('accounts.adjustBalance')}
            </Btn>
          )}

          {editWallet && (
            <Btn variant="danger" disabled={saving} onClick={onDelete}>
              {t('accounts.archiveDelete')}
            </Btn>
          )}
        </div>
      </div>
    </div>
  )
}
