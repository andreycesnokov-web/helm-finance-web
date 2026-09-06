// The approved FUTURE multi-currency model — design preview only.
//
// This module exists so "preview only" is structural rather than a promise. It is
// imported by DesignPreview.jsx and by nothing else, and DesignPreview is behind
// VITE_DESIGN_PREVIEW_ENABLED — so none of this reaches a production bundle at
// all, which a test asserts against the built output rather than against source.
//
// What it renders is "Balances by currency": once wallet balances are derived
// natively, a workspace holding several currencies shows one clearly labelled
// total per currency and never a combined figure, because this product has no
// rate that could produce one. Today Accounts cannot do this honestly — its
// balances come from amount_idr — so it totals IDR and says plainly what it left
// out. See lib/walletBalanceContract.js.
//
// Two alternatives, for review before the backend work:
//   'grouped' — every currency a peer inside one navy section
//   'primary' — base currency keeps the navy flagship, the rest sit beneath it
// Deliberately not offered: a navy hero per currency. Three competing heroes make
// a page with no subject, and this layout must never suggest that any figure is
// the sum of the others.
import { formatCurrency, compactAmount, walletsByCurrency } from '../lib/money'
import { WORKSPACE_DEFAULT_CURRENCY } from '../lib/walletBalanceContract'

const countOf = (t, n) => (n === 1
  ? t('accounts.walletsCountOne')
  : t('accounts.walletsCountMany').replace('{n}', n))

export function walletsSummaryByCurrency({ wallets, t, scopeLabel, variant = 'primary',
                                           base = WORKSPACE_DEFAULT_CURRENCY }) {
  const { groups, unknown } = walletsByCurrency(wallets || [])
  const ordered = [
    ...groups.filter((g) => g.currency === base),
    ...groups.filter((g) => g.currency !== base),
  ]
  const unknownNote = unknown.length
    ? ' · ' + t('accounts.needsCurrencyCount').replace('{n}', unknown.length) : ''

  const row = (g) => (
    <span key={g.currency} className="cfo-cur-row">
      <span className="cfo-cur-code">{g.currency}</span>
      <span className="fin cfo-cur-amt">
        {compactAmount(g.total, g.currency) || formatCurrency(g.total, g.currency)}
      </span>
      <span className="cfo-cur-exact">
        {formatCurrency(g.total, g.currency)} · {countOf(t, g.wallets.length)}
      </span>
    </span>
  )

  if (variant === 'grouped') {
    // Alternative 1 — one navy section, every currency a peer inside it. No
    // combined figure, and no currency is visually privileged.
    return {
      label: t('accounts.balancesByCurrency'),
      value: <span className="cfo-cur-list">{ordered.map(row)}</span>,
      meta: t('accounts.walletsAcrossCurrencies')
        .replace('{n}', (wallets || []).length - unknown.length)
        .replace('{m}', ordered.length) + unknownNote,
      compact: false,
      secondary: null,
    }
  }

  // Alternative 2 — the base currency keeps the flagship headline; the others sit
  // beneath it as restrained rows, so the page still has one dominant figure
  // without any currency being presented as the sum of the rest.
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
    // Rendered outside the navy card by the caller.
    secondary: rest.length ? rest : null,
  }
}
