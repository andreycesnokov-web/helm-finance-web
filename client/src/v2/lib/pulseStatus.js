// Pure, tested in tests/design/v2/forecast.test.mjs.
/** Status line from the server's aiStatus (runway thresholds live on the server). */
export function pulseStatus(d) {
  const runway = Number(d.runway)
  const known = Number.isFinite(runway) && runway < 999 && Number(d.burnRate) > 0
  if (!known) return { tone: 'neutral', key: 'unknown', runway: null }
  if (d.aiStatus === 'critical') return { tone: 'critical', key: 'critical', runway }
  if (d.aiStatus === 'attention') return { tone: 'warning', key: 'attention', runway }
  return { tone: 'good', key: 'healthy', runway }
}

