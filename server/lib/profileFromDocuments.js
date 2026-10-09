// The company tax profile, read from the company's own documents (NPWP card, NIB with its KBLI
// list, deed, SK Kemenkumham, SPPKP, KPP registration, BPJS certificate) — owner 2026-10-09:
// "a new company uploads NPWP / NIB / KBLI and sees which taxes it has to file".
//
// WHO DECIDES WHAT
//   · The model READS fields printed on the documents. It never decides a tax status from a
//     guess: PKP is "registered" only when an SPPKP / PKP certificate says so.
//   · Identifiers (NPWP, NIB, KBLI codes) are kept only when they are printed in the document's
//     own text — a scan has no text to check against, so its values are marked "read from the
//     image" for the user to compare with the preview.
//   · Nothing is written to the profile here. The user applies the suggestions they accept with
//     the existing PUT /api/accountant/profile (role-checked, critical fields audited).
//
// FAIL-OPEN: no key, a timeout or unparseable output → that document contributes nothing.
'use strict';

const MODEL = 'claude-sonnet-4-5';
const TIMEOUT_MS = 45000;
const MAX_TEXT_CHARS = 12000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** Company documents that can carry profile fields (intake doc_type). */
const PROFILE_DOC_TYPES = ['npwp', 'nib', 'akta', 'sk_kemenkumham', 'oss_license', 'pkp_certificate', 'kpp_registration', 'bpjs_document'];

/** Profile fields a document may suggest, and how each is normalised. */
const FIELDS = ['company_legal_name', 'legal_entity_type', 'foreign_owned', 'npwp', 'kpp', 'nib', 'nib_issue_date',
  'primary_kbli', 'additional_kbli', 'actual_business_activities', 'pkp_status', 'pkp_effective_date', 'bpjs_registered', 'country'];
const LEGAL_ENTITY = ['PT Local', 'PT PMA', 'CV', 'Yayasan', 'Individual / Freelancer', 'Representative Office / Branch', 'Other'];

function prompt({ docType, fileName, text }) {
  return `You read ONE Indonesian company document to fill the company's tax profile. Document type (classifier): ${docType}. File: ${fileName}.
Return ONLY a JSON object, no markdown fence, with exactly these keys (use "" / [] / null when the document does not print it — never guess):
{"company_legal_name":"","legal_entity_type":"","foreign_owned":"","npwp":"","kpp":"","nib":"","nib_issue_date":"","kbli":[],"activities":"","pkp_registered":null,"pkp_effective_date":"","bpjs_registered":null}
- company_legal_name: the legal name as printed, e.g. "PT HELM CARE INDONESIA".
- legal_entity_type: one of ${LEGAL_ENTITY.join(', ')} — "PT PMA" only if the document says PMA / Penanaman Modal Asing / foreign capital; "PT Local" if it says PMDN / domestic; otherwise "" when it is a PT but the capital status is not printed.
- foreign_owned: "yes" for PMA, "no" for PMDN, "" if not printed.
- npwp: the NPWP / TIN digits as printed (15 or 16 digits, separators allowed). kpp: the registered tax office (KPP) name.
- nib: the NIB number as printed. nib_issue_date: YYYY-MM-DD.
- kbli: every KBLI listed, as objects {"code":"5 digits","title":"as printed"} — the first one is the main activity if the document marks one as main (utama), else keep the printed order.
- activities: 1 short sentence in English describing what the company does, from the KBLI titles.
- pkp_registered: true ONLY if this is an SPPKP / "Pengukuhan Pengusaha Kena Pajak" document; false only if it states the company is not PKP; else null.
- pkp_effective_date: YYYY-MM-DD from the SPPKP.
- bpjs_registered: true if this is a BPJS registration certificate for the company; else null.
${text ? `Document text:\n"""\n${String(text).slice(0, MAX_TEXT_CHARS)}\n"""` : 'The document is attached above (a scan or photo — read it from the image).'}`
}

function fileBlock(buffer, mime_type, file_name) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_FILE_BYTES) return null
  const mime = String(mime_type || '').toLowerCase()
  if (/pdf/.test(mime) || /\.pdf$/i.test(file_name || '')) return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } }
  const img = IMAGE_MIME.find((m) => mime === m) || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[(/\.([a-z]+)$/i.exec(file_name || '')?.[1] || '').toLowerCase()]
  return img ? { type: 'image', source: { type: 'base64', media_type: img, data: buffer.toString('base64') } } : null
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const digits = (v) => String(v || '').replace(/\D/g, '')
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
/** Is this run of digits printed in the text (separators inside the number ignored)? */
function digitsPrinted(text, value) {
  const d = digits(value)
  if (d.length < 5 || !text) return false
  return digits(text).includes(d) || (String(text).match(/\d[\d.\-\s]{3,30}\d/g) || []).some((n) => digits(n) === d)
}

/** Raw model answer → the fields of one document, each { value, printed }. */
function normalize(raw, { text = '' } = {}) {
  if (!raw || typeof raw !== 'object') return {}
  const fromText = !!text
  const out = {}
  const put = (field, value, mustBePrinted = false) => {
    if (value === '' || value == null || (Array.isArray(value) && !value.length)) return
    let printed = null
    if (mustBePrinted) {
      if (fromText) { printed = Array.isArray(value) ? value.every((v) => digitsPrinted(text, v)) : digitsPrinted(text, value); if (!printed) return }
      else printed = false   // read from the image — shown for the user to compare
    } else printed = fromText ? true : false
    out[field] = { value, printed }
  }
  put('company_legal_name', str(raw.company_legal_name, 160))
  if (LEGAL_ENTITY.includes(raw.legal_entity_type)) put('legal_entity_type', raw.legal_entity_type)
  if (['yes', 'no'].includes(raw.foreign_owned)) put('foreign_owned', raw.foreign_owned)
  const npwp = digits(raw.npwp); if (npwp.length === 15 || npwp.length === 16) put('npwp', str(raw.npwp, 30), true)
  put('kpp', str(raw.kpp, 120))
  const nib = digits(raw.nib); if (nib.length >= 10 && nib.length <= 20) put('nib', nib, true)
  if (isDate(raw.nib_issue_date)) put('nib_issue_date', raw.nib_issue_date)
  const kbli = (Array.isArray(raw.kbli) ? raw.kbli : []).map((k) => ({ code: digits(k?.code).slice(0, 5), title: str(k?.title, 160) })).filter((k) => k.code.length === 5)
  const kbliOk = fromText ? kbli.filter((k) => digitsPrinted(text, k.code)) : kbli
  if (kbliOk.length) {
    put('primary_kbli', kbliOk[0].code)
    if (kbliOk.length > 1) put('additional_kbli', kbliOk.slice(1).map((k) => k.code))
    out.kbli_titles = { value: kbliOk, printed: fromText }
  }
  put('actual_business_activities', str(raw.activities, 300))
  if (raw.pkp_registered === true) put('pkp_status', 'pkp_registered')
  if (raw.pkp_registered === false) put('pkp_status', 'non_pkp')
  if (isDate(raw.pkp_effective_date)) put('pkp_effective_date', raw.pkp_effective_date)
  if (raw.bpjs_registered === true) put('bpjs_registered', true)
  return out
}

async function readDocument({ client, text, buffer, mime_type, file_name, docType }) {
  if (!client || typeof client?.messages?.create !== 'function' || !process.env.ANTHROPIC_API_KEY) return { ok: false, reason: 'ai_unavailable' }
  const block = text ? null : fileBlock(buffer, mime_type, file_name)
  if (!text && !block) return { ok: false, reason: 'unreadable' }
  const p = prompt({ docType, fileName: file_name, text })
  let resp
  try {
    resp = await Promise.race([
      client.messages.create({ model: MODEL, max_tokens: 1200, messages: [{ role: 'user', content: block ? [block, { type: 'text', text: p }] : p }] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('profile_read_timeout')), TIMEOUT_MS)),
    ])
  } catch (e) { return { ok: false, reason: /timeout/.test(e?.message || '') ? 'ai_timeout' : 'ai_request_failed' } }
  const raw = String(resp?.content?.[0]?.text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try { return { ok: true, fields: normalize(JSON.parse(raw), { text }) } } catch { return { ok: false, reason: 'ai_unparseable' } }
}

const same = (a, b) => JSON.stringify(Array.isArray(a) ? [...a].sort() : (typeof a === 'string' ? a.trim().toLowerCase() : a))
  === JSON.stringify(Array.isArray(b) ? [...b].sort() : (typeof b === 'string' ? b.trim().toLowerCase() : b))
const sameId = (f, a, b) => (['npwp', 'nib'].includes(f) ? digits(a) === digits(b) : same(a, b))

/**
 * Merge the readings of several documents into one suggestion per field.
 * @param {{document_id,file_name,doc_type,fields}[]} readings
 * @param {object} profile  the current tax profile (to skip what is already the same)
 */
function mergeSuggestions(readings, profile = {}) {
  const byField = new Map()
  for (const r of readings) {
    for (const [field, v] of Object.entries(r.fields || {})) {
      if (field === 'kbli_titles') continue
      if (!byField.has(field)) byField.set(field, [])
      byField.get(field).push({ value: v.value, printed: v.printed, document_id: r.document_id, file_name: r.file_name, doc_type: r.doc_type })
    }
  }
  const titles = readings.flatMap((r) => r.fields?.kbli_titles?.value || [])
  const out = []
  for (const field of FIELDS) {
    const c = byField.get(field)
    if (!c?.length) continue
    const values = []
    for (const x of c) if (!values.some((v) => sameId(field, v, x.value))) values.push(x.value)
    const current = profile?.[field] ?? null
    const value = values[0]
    out.push({
      field, value, values, conflict: values.length > 1,
      sources: c.map(({ value: _v, ...s }) => s),
      current, same_as_current: current != null && current !== '' && sameId(field, current, value),
    })
  }
  return { suggestions: out, kbli_titles: titles.filter((k, i) => titles.findIndex((x) => x.code === k.code) === i) }
}

module.exports = { PROFILE_DOC_TYPES, FIELDS, LEGAL_ENTITY, MODEL, prompt, normalize, readDocument, mergeSuggestions, digitsPrinted, fileBlock }
