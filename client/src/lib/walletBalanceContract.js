// What this release is allowed to say about a wallet balance.
//
// Policy, not presentation — a plain module so it can be unit-tested without a
// JSX transform, and so the rule has a name to point at rather than living
// inside a component.
//
// ── the invariant ──────────────────────────────────────────────────────────
// One wallet has exactly one native currency. A balance is shown in THAT
// currency, and unlike currencies are never added together. Nothing converts:
// this product has no rate that can value one currency in another for a balance.
//
// ── the harder question ────────────────────────────────────────────────────
// What unit is `wallet.balance` actually in? The two server derivations differ:
//
//   business  GET /api/wallets           balance = SUM(transactions.amount_idr)
//   personal  GET /api/personal/wallets  balance = SUM(transactions.amount_original)
//
// Accounts reads the BUSINESS endpoint, so its balances are sums of amount_idr —
// the IDR-reporting column, which migration 037 explicitly demotes: "amount_idr
// is KEPT for back-compat but is no longer the universal source of truth."
//
// For an IDR wallet, reporting and native are the same number, so the balance is
// provably native. For a USD wallet it is not — printing "$" in front of a sum of
// amount_idr relabels rupiah as dollars, a worse bug than the cross-currency
// addition it would replace.
//
// So a currency is only totalled once its native balance is provable. Today that
// is IDR alone. This list grows when the endpoint derives balances from
// amount_original + asset_code, and not before.
// Explicit extension: this module is imported directly by the unit tests under
// plain Node ESM, which does not do extensionless resolution the way Vite does.
import { walletsByCurrency } from './money.js'

// The currency this workspace creates wallets in. Used for exactly one thing:
// the zero on an empty workspace, where the amount is zero in every currency and
// so naming one claims nothing about money that exists.
export const WORKSPACE_DEFAULT_CURRENCY = 'IDR'

// Currencies whose wallet balances this release can prove are native.
export const PROVEN_NATIVE_CURRENCIES = ['IDR']

/**
 * Split a wallet collection the way this release can honestly talk about it.
 *
 * proven   — currency whose balance is provably native (IDR today)
 * unproven — a real currency code, but the balance's unit cannot be vouched for
 * unknown  — no currency code at all; never guessed into a default
 *
 * Unproven wallets are counted and listed, never hidden and never totalled.
 */
export function partitionWallets(wallets, proven = PROVEN_NATIVE_CURRENCIES) {
  const { groups, unknown } = walletsByCurrency(wallets || [])
  const ok = new Set(proven)
  return {
    proven: groups.filter((g) => ok.has(g.currency)),
    unproven: groups.filter((g) => !ok.has(g.currency)),
    unknown,
  }
}

export default { WORKSPACE_DEFAULT_CURRENCY, PROVEN_NATIVE_CURRENCIES, partitionWallets }
