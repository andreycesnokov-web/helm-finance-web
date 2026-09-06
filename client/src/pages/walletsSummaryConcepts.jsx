// The APPROVED future multi-currency model — design preview only.
//
// Approved shape ("Balances by currency"):
//   • the workspace/base currency is visually primary — it keeps the navy
//     flagship card and the compact-over-exact hierarchy;
//   • every other currency is shown SEPARATELY, in restrained secondary cards
//     beside it, each labelled with its own code and name;
//   • there is no combined grand total, and never will be without a rate: this
//     product has no exchange rate that can value one currency in another, and a
//     summed figure would be a fabrication;
//   • no second navy flagship — one dominant figure per page, or the page has no
//     subject and the cards start to look like each other's totals.
//
// NOT ACTIVE. Turning this on requires a trustworthy native-balance backend:
// GET /api/wallets derives balance from transactions.amount_idr, the
// IDR-reporting column, so only IDR balances are provably native today. Until it
// derives from amount_original + asset_code, Accounts totals IDR and says plainly
// what it left out. See lib/walletBalanceContract.js.
//
// This module exists so "preview only" is structural rather than a promise: it is
// imported by DesignPreview.jsx and by nothing else, DesignPreview is behind
// VITE_DESIGN_PREVIEW_ENABLED, and a test asserts the built production bundle
// does not contain it.
import { formatCurrency, compactAmount, walletsByCurrency } from '../lib/money'
import { WORKSPACE_DEFAULT_CURRENCY } from '../lib/walletBalanceContract'

const countOf = (t, n) => (n === 1
  ? t('accounts.walletsCountOne')
  : t('accounts.walletsCountMany').replace('{n}', n))

/**
 * @returns { label, value, meta, compact } for the flagship SummaryCard, plus
 *          `secondary` — the other currencies, which the caller renders as their
 *          own restrained cards outside the navy surface.
 */
export function walletsSummaryByCurrency({ wallets, t, scopeLabel,
                                           base = WORKSPACE_DEFAULT_CURRENCY }) {
  const { groups, unknown } = walletsByCurrency(wallets || [])
  // Base currency first; it is the one that keeps the flagship.
  const ordered = [
    ...groups.filter((g) => g.currency === base),
    ...groups.filter((g) => g.currency !== base),
  ]
  const unknownNote = unknown.length
    ? ' · ' + t('accounts.needsCurrencyCount').replace('{n}', unknown.length) : ''

  const head = ordered[0]
  const rest = ordered.slice(1)
  const exact = head ? formatCurrency(head.total, head.currency) : null
  return {
    label: head ? `${scopeLabel} · ${head.currency}` : scopeLabel,
    value: head
      ? <span className="fin">{compactAmount(head.total, head.currency) || exact}</span>
      : <span className="cfo-summary-nototal">{t('accounts.noProvenBalance')}</span>,
    meta: head ? `${exact} · ${countOf(t, head.wallets.length)}${unknownNote}` : unknownNote,
    compact: !!head,
    secondary: rest.length ? rest : null,
  }
}

export default walletsSummaryByCurrency
