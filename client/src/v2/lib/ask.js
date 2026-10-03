// Questions to the existing AI endpoints. These are POSTs that change no data: the
// server answers from deterministic data (AI Accountant) or the CFO context (AI CFO).
// Kept apart from lib/actions.js so the write allow-list stays about writes.
//   POST /api/accountant/ask  { question }
//   POST /api/ai-cfo/ask      { question, language }
import { apiFetch } from '../../lib/api'
import { getLang } from '../../i18n/index'

export const askAccountant = (token, question) =>
  apiFetch('/accountant/ask', token, { method: 'POST', body: { question: String(question).slice(0, 500), language: getLang() } })

export const askCfo = (token, question) =>
  apiFetch('/ai-cfo/ask', token, { method: 'POST', body: { question: String(question).slice(0, 2000), language: getLang() } })
