// Links into the AI CFO. Batch 5 turns these into the in-place AI CFO panel; until
// then they open the AI CFO page with the question and the page it came from.
import { P } from '../routes.js'

export function askLink({ page = '', period = '', q = '' } = {}) {
  const sp = new URLSearchParams()
  if (q) sp.set('ask', q)
  if (page) sp.set('from', page)
  if (period) sp.set('period', period)
  const s = sp.toString()
  return s ? `${P.aiCfo}?${s}` : P.aiCfo
}
