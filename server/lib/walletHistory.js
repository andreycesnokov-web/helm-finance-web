// Read-only history: filter the wallet and period in PostgreSQL BEFORE pagination.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function historyOptions(query, now = new Date()) {
  const period = query.period || 'all';
  if (!['all', 'week', 'month', '3m'].includes(period)) throw new Error('Invalid history period');
  const integer = (value, fallback, min, max) => {
    if (value === undefined) return fallback;
    if (!/^[0-9]+$/.test(String(value))) throw new Error('Invalid history pagination');
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error('Invalid history pagination');
    return n;
  };
  const limit = integer(query.limit, 200, 1, 200);
  const offset = integer(query.offset, 0, 0, 100000);
  let from = null;
  if (period !== 'all') {
    from = new Date(now);
    if (period === 'week') from.setUTCDate(from.getUTCDate() - 7);
    if (period === 'month') from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    if (period === '3m') from.setUTCMonth(from.getUTCMonth() - 3);
  }
  return { period, limit, offset, from: from ? from.toISOString().slice(0, 10) : null };
}
function walletHistoryFilter(wallet, from) {
  if (!UUID.test(wallet.id)) throw new Error('Invalid wallet id');
  const walletMatch = 'or(wallet_id.eq.' + wallet.id + ',and(wallet_id.is.null,source.eq.' + JSON.stringify(String(wallet.name)) + '))';
  return from ? 'and(' + walletMatch + ',or(transaction_date.gte.' + from + ',and(transaction_date.is.null,created_at.gte.' + from + ')))' : walletMatch;
}
module.exports = { historyOptions, walletHistoryFilter, validWalletId: (id) => UUID.test(id) };
