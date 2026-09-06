// Radar's arithmetic — the 30-day cash forecast.
//
// Moved verbatim out of pages/Radar.jsx during the design-system migration. Not
// one expression changed: the point of lifting it into a plain module is that a
// test can pin the numbers directly, so a visual migration can be shown not to
// have moved a single figure. It is also why this is .js and not .jsx — plain
// Node ESM imports it without a transform.
//
// Reads GET /api/pulse?scope=business. Computes nothing the server does not
// already return; the three scenarios and the runway are the same client-side
// presentation arithmetic the page has always done.

export function radarFigures(data) {
  const d = data || {}
  const balance  = d.totalBalance || 0
  const burnRate = d.burnRate || 0
  const debts    = d.debts || []
  const receivables = debts.filter(x => x.type === 'receivable')
  const payables    = debts.filter(x => x.type === 'payable')
  const totalIn  = receivables.reduce((s, x) => s + Number(x.amount), 0)
  const totalOut = payables.reduce((s, x) => s + Number(x.amount), 0)

  // Expected: everything planned lands, and the burn continues for 30 days.
  const proj30    = balance + totalIn - totalOut - burnRate * 30
  // Best: all income received, only half the payables actually leave.
  const projBest  = balance + totalIn - totalOut * 0.5
  // Worst: no receivable arrives, every payable does, burn continues.
  const projWorst = balance - totalOut - burnRate * 30
  const monthlyBurn = burnRate * 30
  const runway    = burnRate > 0 ? Math.round(balance / burnRate) : null

  return {
    balance, burnRate, receivables, payables, totalIn, totalOut,
    proj30, projBest, projWorst, monthlyBurn, runway,
    isHealthy: proj30 >= 0,
    burnWindowDays: d.burnWindowDays,
  }
}

export default radarFigures
