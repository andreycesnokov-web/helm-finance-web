// What the Wallets total-balance card says, for any collection of wallets.
//
// ── the invariant ──────────────────────────────────────────────────────────
// One wallet has exactly one native currency, and a balance must be shown in
// THAT currency. Unlike currencies are never added together as raw numbers, and
// nothing here converts anything: this product has no rate that can value one
// currency in another for a balance.
//
// ── why the release is IDR-only ────────────────────────────────────────────
// The rule above is about presentation. There is a second, harder question —
// what unit is `wallet.balance` actually in? — and the answer today is only
// trustworthy for IDR:
//
//   business  GET /api/wallets   balance = SUM(transactions.amount_idr)
//   personal  GET /api/personal/wallets  balance = SUM(transactions.amount_original)
//
// Accounts reads the BUSINESS endpoint, so its balances are sums of amount_idr —
// the IDR-reporting column, which migration 037 explicitly demotes: "amount_idr
// is KEPT for back-compat but is no longer the universal source of truth."
//
// For an IDR wallet, reporting and native are the same number, so the balance is
// provably native. For a USD wallet it is not: printing "$" in front of a sum of
// amount_idr would relabel an IDR-reporting figure as dollars, which is a worse
// bug than the cross-currency addition it replaced. So a currency is only
// totalled once its native balance is provable, and today that is IDR alone.
//
// Wallets in other currencies are still listed and counted — they are not hidden
// — but no amount is claimed for them until the backend contract is repaired.
// See walletsSummaryByCurrency below for the approved future model, which is
// rendered in the gated design preview and nowhere else.
import { formatCurrency, compactAmount } from '../lib/money'
// The policy this file renders lives in its own plain module — it is a rule about
// what may be stated, not a rendering concern, and it needs to be unit-testable
// without a JSX transform. Re-exported so importers need not care where it lives.
import {
  WORKSPACE_DEFAULT_CURRENCY, PROVEN_NATIVE_CURRENCIES, partitionWallets,
} from '../lib/walletBalanceContract'

export { WORKSPACE_DEFAULT_CURRENCY, PROVEN_NATIVE_CURRENCIES, partitionWallets }

const countOf = (t, n) => (n === 1
  ? t('accounts.walletsCountOne')
  : t('accounts.walletsCountMany').replace('{n}', n))

/**
 * The production card. IDR-only by construction.
 *
 * @param wallets    the wallets this card is totalling (already scope-filtered)
 * @param t          the page's translation function
 * @param scopeLabel the card's label for the current scope tab
 */
export function walletsSummary({ wallets, t, scopeLabel }) {
  const { proven, unproven, unknown } = partitionWallets(wallets)

  // Notes for what is deliberately NOT in the total, so the figure is never
  // silently narrower than the page it sits on.
  const asideCount = unproven.reduce((n, g) => n + g.wallets.length, 0)
  const notes = []
  if (asideCount) notes.push(t('accounts.otherCurrenciesAside').replace('{n}', asideCount))
  if (unknown.length) notes.push(t('accounts.needsCurrencyCount').replace('{n}', unknown.length))
  const noteSuffix = notes.length ? ' · ' + notes.join(' · ') : ''

  // No wallets at all.
  if (!wallets || wallets.length === 0) {
    return {
      label: scopeLabel,
      value: <span className="fin">{formatCurrency(0, WORKSPACE_DEFAULT_CURRENCY)}</span>,
      meta: t('accounts.noWalletsYet'),
      compact: false,
    }
  }

  // Wallets exist, but none of them is in a currency whose balance we can prove.
  // There is no honest figure to print, so none is printed.
  if (proven.length === 0) {
    return {
      label: scopeLabel,
      value: <span className="cfo-summary-nototal">{t('accounts.noProvenBalance')}</span>,
      meta: (notes.join(' · ') || t('accounts.noWalletsYet')),
      compact: false,
    }
  }

  // The release case: one proven currency, in the approved hierarchy —
  // abbreviated figure as the headline, exact figure beneath.
  const g = proven[0]
  const exact = formatCurrency(g.total, g.currency)
  return {
    label: `${scopeLabel} · ${g.currency}`,
    value: <span className="fin">{compactAmount(g.total, g.currency) || exact}</span>,
    meta: `${exact} · ${countOf(t, g.wallets.length)}${noteSuffix}`,
    compact: true,
  }
}

export default walletsSummary
