// The currency control on the Add / Edit wallet form.
//
// Its own module for the same reason WalletsEmptyState is: the design preview has
// to be able to photograph the real control, and a copied one drifts. The rules it
// enforces are the wallet currency contract:
//
//   1. Currency is required. There is always a selected value, defaulting to the
//      workspace base currency.
//   2. It is chosen from a fixed ISO 4217 list — never typed. No free text can
//      reach the API from this form.
//   3. Code and readable name are both shown, because "SGD" alone is not obvious
//      to everyone picking the right one for a bank account.
//   4. Codes whose native balance the backend cannot yet prove are visible but
//      disabled, with the reason. Today that is everything except IDR: the
//      business endpoint derives balance from amount_idr, so a wallet created in
//      USD would report a balance whose unit we could not honestly state.
//   5. An existing wallet's currency cannot be changed at all. The server's
//      PUT /api/wallets/:id will happily rewrite it — which would silently
//      relabel every transaction the wallet already holds — so the UI does not
//      offer it rather than offering it only when it looks safe.
import { CURRENCY_NAMES } from '../lib/money'
import { PROVEN_NATIVE_CURRENCIES } from '../lib/walletBalanceContract'

/**
 * @param currencies  the ISO codes this product offers at all
 * @param value       the selected code (always set — the field is required)
 * @param onChange    (code) => void
 * @param locked      true when editing an existing wallet
 * @param styleFor    (code) => ({bg, color}) — the page's currency chip palette
 * @param t           the page's translation function
 */
export function WalletCurrencyField({ currencies, value, onChange, locked = false, styleFor, t }) {
  return (
    <>
      <label className="modal-label">
        {t('accounts.currency')} <span style={{ color: 'var(--red)', fontWeight: 700 }}>*</span>
      </label>
      <div className="wallet-currency-options"
        style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        {currencies.map((c) => {
          const cs = styleFor(c)
          const selectable = PROVEN_NATIVE_CURRENCIES.includes(c) && !locked
          const active = value === c
          return (
            <button
              key={c}
              type="button"
              disabled={!selectable}
              aria-pressed={active}
              aria-label={`${c} — ${CURRENCY_NAMES[c] || c}`}
              title={selectable ? (CURRENCY_NAMES[c] || c) : t('accounts.currencyNotYetSupported')}
              onClick={() => selectable && onChange(c)}
              style={{
                padding: '8px 14px', borderRadius: 10, fontSize: 'var(--text-sm)',
                border: '0.5px solid var(--border-2)', fontFamily: 'inherit', fontWeight: 700,
                background: active ? cs.bg : 'none',
                color: active ? cs.color : 'var(--text-3)',
                opacity: selectable ? 1 : .45,
                cursor: selectable ? 'pointer' : 'not-allowed', transition: 'all .1s',
              }}
            >{c}</button>
          )
        })}
      </div>
      <div className="wallet-currency-note"
        style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 14, lineHeight: 1.45 }}>
        {CURRENCY_NAMES[value] ? `${value} — ${CURRENCY_NAMES[value]}. ` : ''}
        {locked ? t('accounts.currencyImmutable') : t('accounts.currencyLockedNote')}
      </div>
    </>
  )
}

export default WalletCurrencyField
