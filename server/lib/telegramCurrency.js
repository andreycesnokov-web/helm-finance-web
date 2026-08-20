// Which currencies a Telegram-created payable may use.
//
// The answer today is: IDR, and nothing else.
//
// Why this exists — a P0 found in live smoke. "Pay 1000$ to China supplier" produced a debt
// row with amount=1000, currency='USD'. That row is stored correctly; the problem is that
// nothing downstream reads `debts.currency`:
//
//   * the Payables UI prefixes every amount with 'Rp';
//   * DebtPaymentModal labels everything IDR;
//   * POST /api/debts/:id/pay writes currency_original:'IDR', amount_idr:paymentAmount;
//   * the dashboard sums payables across currencies with no conversion.
//
// So paying that payable would have recorded a Rp 1,000 cash outflow (~US$0.06) and marked a
// US$1,000 obligation settled — understating liabilities and overstating cash by ~15,800x.
//
// Making USD work end to end needs FX conversion at the payment and aggregation boundaries,
// and there is no live rate source (server/lib/fxProvider.js is a mock; migrations 038/039
// are unapplied). Until that exists the only safe answer is to refuse the record.
//
// The product rule this enforces: NEVER silently reinterpret an amount across currencies.
// 1000 USD must never become Rp 1000. If we cannot preserve the currency, we do not write
// the row.

// Deliberately a list rather than a boolean: when multi-currency payables land, this is the
// one place that grows, and the tests below it enumerate what is allowed.
const TELEGRAM_SUPPORTED_CURRENCIES = ['IDR'];

/**
 * Canonical form of a currency coming from a parser, OCR, or a bot payload.
 *
 * An absent value means "the sender did not say", which has always meant IDR on this path —
 * that default is preserved exactly. Everything else is uppercased and trimmed so 'idr',
 * ' idr ' and 'IDR' are one value, and so a rejection message names the currency in a
 * predictable form.
 */
function normalizeCurrency(value) {
  if (value === null || value === undefined) return 'IDR';
  // A non-string is junk, not an omission. String([]) is '', which would otherwise pass
  // through the "absent means IDR" default and record a wrong row from a malformed payload.
  // Anything that is not a string gets a value no currency list will ever contain.
  if (typeof value !== 'string') return 'INVALID';
  const s = value.trim().toUpperCase();
  return s || 'IDR';
}

/** May a Telegram-created payable be recorded in this currency? */
function isSupportedTelegramCurrency(value) {
  return TELEGRAM_SUPPORTED_CURRENCIES.includes(normalizeCurrency(value));
}

/**
 * The 422 body for a refused currency.
 *
 * `currency` is echoed back normalized so the bot can name it in its localised message
 * ("This request is in USD…") without re-parsing the user's text.
 */
function currencyNotSupported(value) {
  return {
    error: 'currency_not_supported',
    currency: normalizeCurrency(value),
    message: 'Only IDR Telegram payables are supported right now.',
  };
}

module.exports = {
  TELEGRAM_SUPPORTED_CURRENCIES,
  normalizeCurrency,
  isSupportedTelegramCurrency,
  currencyNotSupported,
};
