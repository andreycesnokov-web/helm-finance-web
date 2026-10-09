// "What is this document?" — a plain-language reading of one stored document, for a user who
// may not read Indonesian bureaucratic Bahasa (owner 2026-10-09: "for a foreigner it is a
// headache to understand what a document is and where it belongs").
//
// WHO DECIDES WHAT
//   · The TYPE comes from the deterministic content classifier (documentContent.js) when it is
//     confident. The model may only PROPOSE a type when the classifier is not, and the proposal
//     is labelled as the model's. Either way nothing is applied: the user confirms with the
//     existing classification route (PATCH /api/ai-accountant/documents/:id/classification).
//   · The model EXPLAINS: what the document is, who issued it, what it is for, where it belongs.
//     It never sets an amount, links a record or moves money.
//
// FAIL-OPEN: no key, a timeout, a refusal or unparseable output return { ok: false, reason }
// and the caller still shows the classifier's verdict.
'use strict';

const MODEL = 'claude-sonnet-4-5';
const TIMEOUT_MS = 40000;
const MAX_TEXT_CHARS = 8000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const LANGS = { ru: 'Russian', en: 'English', id: 'Indonesian' };
const PLACES = ['company_documents', 'accounting', 'other'];

/** Intake types the model may propose (server/lib/documentIntake.js INTAKE_TYPES). */
function buildPrompt({ lang, file_name, text, verdict, company_name, types }) {
  const language = LANGS[lang] || LANGS.en;
  return `You help a business owner (often a foreigner in Indonesia) understand ONE document stored in their accounting system.
Company: ${company_name || 'unknown'}. File name: ${file_name || 'unknown'}.
A rule-based classifier says: type "${verdict?.doc_type || 'unknown'}", confidence "${verdict?.confidence || 'unknown'}".

Write in ${language}. Plain words, no jargon; when you use an Indonesian term, explain it in brackets.
Return ONLY a JSON object, no markdown fence:
{"title":"","summary":"","issued_by":"","issued_on":"","number":"","purpose":"","place":"","next_step":"","suggested_type":"","bank_name":"","account_number":"","period":"","counterparty_name":"","warnings":[]}

- title: what the document is, at most 8 words (e.g. "Ministry of Law notice: change of directors").
- summary: 1-2 sentences: what it says and why the company has it.
- issued_by / issued_on (YYYY-MM-DD) / number: only as printed on the document; "" if not printed.
- purpose: 1 sentence: what it is used for (licensing, tax, a payment, payroll…).
- place: exactly one of ${PLACES.join(', ')}. "company_documents" = a permanent company / legal / licence /
  tax-registration / BPJS document kept on file. "accounting" = evidence of money (invoice, receipt, payment proof,
  bank statement, tax payment, payroll). "other" = neither.
- next_step: 1 sentence: what the owner should do with it in the system (keep it with company documents; link it to
  the bill it pays; link it to the payment it proves; nothing).
- suggested_type: exactly one of: ${types.join(', ')}.
- bank_name / account_number: for a bank statement or bank letter, as printed ("" otherwise).
- period: the month the document covers, YYYY-MM (statement period, payroll month, tax period); "" if none.
- counterparty_name: the other party (supplier, customer, landlord, employee…) if there is one, else "".
- warnings: short strings for anything unreadable or inconsistent.
Never invent a number, a date or a name that is not printed.

${text ? `Document text:
"""
${String(text).slice(0, MAX_TEXT_CHARS)}
"""` : 'The document is attached above (a scan or a photo — read it from the image).'}`
}

const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function normalize(parsed, types) {
  if (!parsed || typeof parsed !== 'object') return null
  const date = str(parsed.issued_on, 10)
  return {
    title: str(parsed.title, 120),
    summary: str(parsed.summary, 600),
    issued_by: str(parsed.issued_by, 200),
    issued_on: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    number: str(parsed.number, 120),
    purpose: str(parsed.purpose, 400),
    place: PLACES.includes(parsed.place) ? parsed.place : 'other',
    next_step: str(parsed.next_step, 400),
    suggested_type: types.includes(parsed.suggested_type) ? parsed.suggested_type : null,
    bank_name: str(parsed.bank_name, 80),
    account_number: str(parsed.account_number, 40).replace(/[^\dA-Za-z-]/g, ''),
    period: /^\d{4}-(0[1-9]|1[0-2])$/.test(str(parsed.period, 7)) ? str(parsed.period, 7) : '',
    counterparty_name: str(parsed.counterparty_name, 160),
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.slice(0, 5).map((w) => str(w, 200)).filter(Boolean) : [],
  }
}

/**
 * @param {object} o
 * @param {object} o.client       Anthropic client (messages.create)
 * @param {string} o.text         the document's text (embedded or OCR transcript)
 * @param {object} o.verdict      documentContent.classifyDocument result
 * @param {string[]} o.types      allowed intake types
 * @returns {Promise<{ok:true, explanation:object}|{ok:false, reason:string}>}
 */
// A document with no text layer (a scan, a photo) is sent to the model as the file itself.
function fileBlock(buffer, mime_type, file_name) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_FILE_BYTES) return null
  const mime = String(mime_type || '').toLowerCase()
  if (/pdf/.test(mime) || /\.pdf$/i.test(file_name || '')) return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } }
  const img = IMAGE_MIME.find((m) => mime === m) || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' })[(/\.([a-z]+)$/i.exec(file_name || '')?.[1] || '').toLowerCase()]
  return img ? { type: 'image', source: { type: 'base64', media_type: img, data: buffer.toString('base64') } } : null
}

async function explainDocument({ client, text, verdict, types, lang = 'en', file_name = '', company_name = '', buffer = null, mime_type = '' }) {
  if (!client || typeof client?.messages?.create !== 'function' || !process.env.ANTHROPIC_API_KEY) return { ok: false, reason: 'ai_unavailable' }
  const hasText = !!String(text || '').trim()
  const block = hasText ? null : fileBlock(buffer, mime_type, file_name)
  if (!hasText && !block) return { ok: false, reason: 'unreadable' }
  const prompt = buildPrompt({ lang, file_name, text: hasText ? text : '', verdict, company_name, types })
  let resp
  try {
    resp = await Promise.race([
      client.messages.create({
        model: MODEL, max_tokens: 900,
        messages: [{ role: 'user', content: block ? [block, { type: 'text', text: prompt }] : prompt }],
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('identify_timeout')), TIMEOUT_MS)),
    ])
  } catch (e) {
    return { ok: false, reason: /identify_timeout/.test(e?.message || '') ? 'ai_timeout' : 'ai_request_failed' }
  }
  const raw = String(resp?.content?.[0]?.text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  let parsed
  try { parsed = JSON.parse(raw) } catch { return { ok: false, reason: 'ai_unparseable' } }
  const explanation = normalize(parsed, types)
  return explanation ? { ok: true, explanation } : { ok: false, reason: 'ai_unparseable' }
}

/**
 * The type to OFFER the user: the classifier's when it is confident, otherwise the model's
 * proposal (labelled), otherwise the classifier's weaker verdict. Never applied automatically.
 */
function suggestedKind(verdict, explanation) {
  const det = verdict?.doc_type && verdict.doc_type !== 'unknown' ? verdict.doc_type : null
  if (det && verdict.confidence === 'high') return { type: det, source: 'classifier', confidence: 'high' }
  if (explanation?.suggested_type && explanation.suggested_type !== 'unknown') {
    return { type: explanation.suggested_type, source: 'ai', confidence: det === explanation.suggested_type ? 'high' : 'medium' }
  }
  if (det) return { type: det, source: 'classifier', confidence: verdict.confidence || 'low' }
  return null
}

const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** The business bank account a statement belongs to: by bank name or the account's last digits
 *  in the account name, same currency first. Only a single clear match is offered. */
function matchWallet(wallets = [], { bank_name, account_number, currency } = {}) {
  const bank = norm(bank_name).split(' ').filter((w) => w.length >= 3 && !['bank', 'pt', 'tbk'].includes(w))
  const last4 = String(account_number || '').replace(/\D/g, '').slice(-4)
  const scored = wallets.map((w) => {
    const name = norm(`${w.name} ${w.entity_name || ''}`)
    let score = 0
    if (last4.length === 4 && name.replace(/ /g, '').includes(last4)) score += 3
    if (bank.some((b) => name.split(' ').includes(b))) score += 2
    if (score && currency && String(w.currency || '').toUpperCase() === String(currency).toUpperCase()) score += 1
    return { w, score }
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score)
  if (!scored.length || (scored[1] && scored[1].score === scored[0].score)) return null
  return scored[0].w
}

function matchCounterparty(cps = [], name) {
  const n = norm(name).replace(/(pt|cv|tbk|ud)/g, '').trim()
  if (n.length < 3) return null
  const hits = cps.filter((c) => { const m = norm(c.name).replace(/(pt|cv|tbk|ud)/g, '').trim(); return m && (m === n || m.includes(n) || n.includes(m)) })
  return hits.length === 1 ? hits[0] : null
}

/** Where to keep a document that explains no single bill or payment. A suggestion only. */
function suggestedFiling(type, x, { wallets = [], counterparties = [], currency = null } = {}) {
  if (!type || !x) return null
  if (type === 'bank_statement') {
    const w = matchWallet(wallets, { bank_name: x.bank_name, account_number: x.account_number, currency })
    return { kind: 'bank_account_period', wallet_id: w?.id || null, wallet_name: w?.name || null, period: x.period || null }
  }
  if (type === 'payroll_document') return { kind: 'keep', reason: 'payroll', period: x.period || null }
  if (type === 'tax_report') return { kind: 'keep', reason: 'tax', period: x.period || null }
  if (type === 'contract') {
    const c = matchCounterparty(counterparties, x.counterparty_name)
    return c ? { kind: 'counterparty', counterparty_id: c.id, counterparty_name: c.name } : { kind: 'keep', reason: 'contract' }
  }
  return null
}

module.exports = { matchWallet, matchCounterparty, suggestedFiling, explainDocument, suggestedKind, normalize, buildPrompt, fileBlock, MODEL, LANGS, PLACES }
