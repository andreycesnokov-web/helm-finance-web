// What the Wallets total-balance card says, for any collection of wallets.
//
// This is the currency-safety rule made into one function, in one place, because
// the page and the design preview both have to obey it and a copy of the rule is
// a copy that can drift. The rule:
//
//   A balance belongs to exactly one currency, so a total may only ever cover
//   wallets that share one. Nothing here converts anything — this product has no
//   rate that could value one currency in another, and inventing one would be a
//   worse bug than showing two numbers.
//
// The page used to add every wallet's balance together and label the result IDR,
// so a single dollar account silently turned $1 000 into Rp 1 000 in the headline.
// The rest of the codebase already states the rule (personal Pulse in
// server/index.js, and BusinessAccounts) — this brings Wallets in line.
//
// Returns the three slots SummaryCard renders, so the caller stays declarative.
import { formatCurrency, compactAmount, walletsByCurrency } from '../lib/money'

// The currency this workspace creates wallets in. It is used for ONE thing: the
// zero shown when there are no wallets at all, where the amount is zero in every
// currency and so naming one claims nothing about money that exists. It is never
// applied to a wallet that already has a balance.
export const WORKSPACE_DEFAULT_CURRENCY = 'IDR'

/**
 * @param wallets    the wallets this card is totalling (already scope-filtered)
 * @param t          the page's translation function
 * @param scopeLabel the card's label for the current scope tab
 * @returns { label, value, meta, compact } for SummaryCard
 */
export function walletsSummary({ wallets, t, scopeLabel }) {
  const { groups, unknown } = walletsByCurrency(wallets || [])
  const countOf = (n) => (n === 1
    ? t('accounts.walletsCountOne')
    : t('accounts.walletsCountMany').replace('{n}', n))
  const unknownNote = unknown.length
    ? ' · ' + t('accounts.needsCurrencyCount').replace('{n}', unknown.length)
    : ''

  // No wallets at all.
  if (!wallets || wallets.length === 0) {
    return {
      label: scopeLabel,
      value: <span className="fin">{formatCurrency(0, WORKSPACE_DEFAULT_CURRENCY)}</span>,
      meta: t('accounts.noWalletsYet'),
      compact: false,
    }
  }

  // Wallets exist, but not one of them says which currency it is in. There is no
  // honest total to print, so the card does not print one.
  if (groups.length === 0) {
    return {
      label: scopeLabel,
      value: <span className="cfo-summary-nototal">{t('accounts.noCurrencyTotal')}</span>,
      meta: t('accounts.needsCurrencyCount').replace('{n}', unknown.length),
      compact: false,
    }
  }

  // One currency: the approved hierarchy — abbreviated figure as the headline,
  // exact figure beneath it, both in that wallet's own currency.
  if (groups.length === 1) {
    const g = groups[0]
    const exact = formatCurrency(g.total, g.currency)
    return {
      label: `${scopeLabel} · ${g.currency}`,
      value: <span className="fin">{compactAmount(g.total, g.currency) || exact}</span>,
      meta: `${exact} · ${countOf(g.wallets.length)}${unknownNote}`,
      compact: true,
    }
  }

  // More than one: one clearly labelled amount each, and deliberately no combined
  // figure. Largest first, so the card still has a reading order.
  return {
    label: t('accounts.totalByCurrency'),
    value: (
      <span className="cfo-summary-currencies">
        {groups.map((g) => (
          <span key={g.currency} className="cfo-summary-cur">
            <span className="cfo-summary-cur-code">{g.currency}</span>
            <span className="fin cfo-summary-cur-amt">
              {compactAmount(g.total, g.currency) || formatCurrency(g.total, g.currency)}
            </span>
          </span>
        ))}
      </span>
    ),
    meta: t('accounts.walletsAcrossCurrencies')
      .replace('{n}', wallets.length - unknown.length)
      .replace('{m}', groups.length) + unknownNote,
    compact: false,
  }
}

export default walletsSummary
