// Documents / Bills audit fixes (2026-10-09). Run: node tests/design/v2DocumentsBills.test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { billHasDocument, docPath, docNeedsLook, billChecklistItems, tabForPath } from '../../client/src/v2/lib/obligations.js'
import { partitionDocuments } from '../../client/src/pages/business/companyVault.js'
import { previewKind } from '../../client/src/lib/documentPreview.js'
import ru from '../../client/src/v2/i18n/ru.js'
import en from '../../client/src/v2/i18n/en.js'
import id from '../../client/src/v2/i18n/id.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
let pass = 0, fail = 0
const ok = (msg, cond) => { if (cond) { console.log('OK  ' + msg); pass++ } else { console.error('FAIL ' + msg); fail++ } }

console.log('\n--- a bill is documented by a Document Center link, not only by a legacy attachment')
ok('document_links → documented', billHasDocument({ document_links: [{ link_id: 'l', document_id: 'd' }] }))
ok('linked_documents_count → documented', billHasDocument({ linked_documents_count: 2 }))
ok('legacy attachments → documented', billHasDocument({ attachments: [{ url: 'x' }] }))
ok('legacy attachment_url → documented', billHasDocument({ attachment_url: 'https://x' }))
ok('nothing → not documented', !billHasDocument({ document_links: [], linked_documents_count: 0, attachments: [] }))
ok('null bill → not documented', !billHasDocument(null))

console.log('\n--- deep link and checklist')
ok('docPath opens the document in place on the Documents page', docPath({ id: 'a b' }) === '/business/documents?doc=a%20b')
const items = billChecklistItems({ id: 1 }, { hasInvoice: true, invoiceDocPath: docPath({ id: 'x' }) })
ok('checklist "View" on the invoice goes to that document', items.find((c) => c.key === 'invoice').link === '/business/documents?doc=x')
const legacy = billChecklistItems({ id: 1 }, { hasInvoice: true })
ok('without a linked document id it falls back to Documents', legacy.find((c) => c.key === 'invoice').link === '/business/documents')
ok('tabs map to their routes', tabForPath('/business/payables') === 'pay' && tabForPath('/business/receivables') === 'collect' && tabForPath('/business/invoices') === 'all')

console.log('\n--- new screen text exists in every language')
for (const [k, L] of Object.entries({ ru, en, id })) {
  ok(`${k}: docs.recent / open / shown / uploadProofFor`, !!(L.docs.recent && L.docs.open && L.docs.shown && L.docs.uploadProofFor))
  ok(`${k}: docs.linkedTo.*`, ['payable', 'receivable', 'debt', 'transaction', 'transactionNoDate'].every((x) => L.docs.linkedTo?.[x]))
  ok(`${k}: bill.uploadInvoiceFor / uploadProofFor`, !!(L.bill.uploadInvoiceFor && L.bill.uploadProofFor))
}

console.log('\n--- payment and upload windows: same keys in RU / EN / ID, no English left in the markup')
const keysOf = (src, name) => {
  const start = src.indexOf(`const ${name} = {`)
  const body = src.slice(start, src.indexOf('\n}\n', start))
  const out = {}
  for (const lang of ['en', 'ru', 'id']) {
    const i = body.indexOf(`\n  ${lang}: {`)
    const j = ['en', 'ru', 'id'].map((l) => body.indexOf(`\n  ${l}: {`)).filter((x) => x > i).sort((a, b) => a - b)[0] ?? body.length
    out[lang] = [...body.slice(i, j).matchAll(/\b([a-zA-Z]+): /g)].map((m) => m[1]).filter((x) => x !== lang).sort().join(',')
  }
  return out
}
for (const [file, name, english] of [
  ['client/src/components/DebtPaymentModal.jsx', 'PAY_T', ['Record payment made', 'Total amount', 'Select account…']],
  ['client/src/components/DocumentIntakeModal.jsx', 'INTAKE_T', ['Drag &amp; drop files here', 'Uploading to <b>', 'Open existing document']],
]) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const k = keysOf(src, name)
  ok(`${name}: ru keys = en keys`, k.ru === k.en && k.en.length > 0)
  ok(`${name}: id keys = en keys`, k.id === k.en)
  const markup = src.slice(src.indexOf('return ('))
  ok(`${name}: no hard-coded English in the markup`, english.every((e) => !markup.includes(e)))
}

console.log('\n--- "Needs a look" follows the derived state, not review_status (never advanced by any route)')
ok('linked document with review_status needs_review → filed', !docNeedsLook({ review_status: 'needs_review', links: [{ target_type: 'debt', target_id: 1 }] }))
ok('unlinked document → needs a look', docNeedsLook({ review_status: 'approved', links: [] }))
ok('linked but unreadable → needs a look', docNeedsLook({ links: [{ target_type: 'transaction', target_id: 2 }], extraction_status: 'failed' }))
ok('no links field → needs a look', docNeedsLook({}))

console.log('\n--- company documents are kept apart from evidence')
const nib = { id: 'n', document_type: 'other', file: { file_name: 'NIB_PT.pdf' }, extracted_json: { ai_intake: { doc_type: 'nib', classification_status: 'manually_confirmed' } } }
const suggested = { id: 's', document_type: 'other', file: { file_name: 'x.pdf' }, extracted_json: { ai_intake: { doc_type: 'npwp', classification_status: 'auto_classified' } } }
const invoice = { id: 'i', document_type: 'vendor_invoice', file: { file_name: 'INV-NPWP-1.pdf' }, extracted_json: { ai_intake: { doc_type: 'npwp', classification_status: 'manually_confirmed' } } }
const statement = { id: 'b', document_type: 'bank_document', extracted_json: { ai_intake: { doc_type: 'bank_statement', classification_status: 'manually_confirmed' } } }
const parts = partitionDocuments([nib, suggested, invoice, statement])
ok('confirmed NIB → company documents', parts.vault.map((d) => d.id).join() === 'n')
ok('suggestion, invoice and statement stay in the work list', parts.evidence.map((d) => d.id).join() === 's,i,b')

console.log('\n--- "Fix" reviews the document in place; it never sends the user to the classic list')
const docsSrc = fs.readFileSync(path.join(ROOT, 'client/src/v2/pages/Documents.jsx'), 'utf8')
ok('Documents rows open the review panel', /onOpen\(d\)/.test(docsSrc) && /<DocumentDrawer /.test(docsSrc))
ok('no row link into /business/documents/classic?doc=', !/documents\/classic\?doc=/.test(docsSrc))
ok('company documents excluded from "Needs a look" and the month', /evidence\.filter\(needsLook\)/.test(docsSrc) && /evidence\.filter\(\(d\) => docMonth\(d\) === month\)/.test(docsSrc))
ok('Company profile "Upload" opens the company documents tab', fs.readFileSync(path.join(ROOT, 'client/src/v2/pages/CompanyProfile.jsx'), 'utf8').includes('/business/documents?tab=company'))

console.log('\n--- document writes go only through lib/actions.js, each on the reviewed allow-list')
// WRITE_ALLOW is read from v2Guards.test.mjs as text: importing that file would run its checks.
const guardsSrc = fs.readFileSync(path.join(ROOT, 'tests/design/v2Guards.test.mjs'), 'utf8')
const allowStart = guardsSrc.indexOf('export const WRITE_ALLOW = [')
const allowSrc = guardsSrc.slice(allowStart, guardsSrc.indexOf('\n]', allowStart))
const WRITE_ALLOW = [...allowSrc.matchAll(/\{ method: '(\w+)', path: ([^}]+?) \}/g)].map((m) => ({ method: m[1], path: new Function(`return ${m[2]}`)() }))
const actionsSrc = fs.readFileSync(path.join(ROOT, 'client/src/v2/lib/actions.js'), 'utf8')
const writes = [...actionsSrc.matchAll(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/g)]
const unlisted = writes.filter((m) => { const line = actionsSrc.slice(actionsSrc.lastIndexOf('\n', m.index), m.index); return !WRITE_ALLOW.some((w) => line.includes(w.path) && w.method === m[1]) })
ok('every write in actions.js is on WRITE_ALLOW', unlisted.length === 0)
ok('WRITE_ALLOW has exactly the writes actions.js makes', writes.length === WRITE_ALLOW.length && WRITE_ALLOW.length > 0)
const drawerSrc = fs.readFileSync(path.join(ROOT, 'client/src/v2/components/DocumentDrawer.jsx'), 'utf8')
ok('the review panel makes no direct request', !/apiFetch|fetch\(/.test(drawerSrc) && !/method:/.test(drawerSrc))

console.log('\n--- the review window shows the file itself before anything is linked (centred, not a side panel)')
ok('pdf by MIME', previewKind({ mime_type: 'application/pdf', file_name: 'x' }) === 'pdf')
ok('image by extension when MIME is generic', previewKind({ mime_type: 'application/octet-stream', file_name: 'WhatsApp_Image.jpeg' }) === 'image')
ok('xlsx → spreadsheet table', previewKind({ file_name: 'salary_06_helm.xlsx' }) === 'sheet')
ok('unknown type → no inline preview, open / download instead', previewKind({ file_name: 'a.docx', mime_type: 'application/msword' }) === 'other')
const modalSrc = fs.readFileSync(path.join(ROOT, 'client/src/v2/components/DocumentDrawer.jsx'), 'utf8')
ok('the window renders the preview', /<DocumentPreview doc=\{doc\}/.test(modalSrc))
ok('centred window, not the side drawer', modalSrc.includes('v2-docmodal') && !modalSrc.includes('v2-workbench-drawer'))
const pvSrc = fs.readFileSync(path.join(ROOT, 'client/src/v2/components/DocumentPreview.jsx'), 'utf8')
ok('preview gets the file through the audited signed-url action only', pvSrc.includes('documentFileUrl(token, id, ') && !/apiFetch|method:/.test(pvSrc))
ok('classic preview still exports previewKind (same rule for both)', /export \{ previewKind, gsheetUrlOf \}/.test(fs.readFileSync(path.join(ROOT, 'client/src/pages/business/DocumentPreview.jsx'), 'utf8')))

console.log('\n--- "what is this document": read by itself, applied only on Accept')
const idSrc = fs.readFileSync(path.join(ROOT, 'client/src/v2/components/DocumentIdentity.jsx'), 'utf8')
ok('the window shows the identity card', modalSrc.includes('<DocumentIdentity '))
ok('reads by itself once per document and language (stored reading reused)', idSrc.includes('ai_identify?.[lang]') && /asked\.current === key/.test(idSrc))
ok('the suggested type is applied only through the classification route, on a click', /onClick=\{accept\}/.test(idSrc) && idSrc.includes('confirmDocumentKind(token, doc.id, type)'))
ok('a spreadsheet waits for its cells from the preview', /waitForSheet && sheetText === undefined/.test(idSrc) && pvSrc.includes('onSheetText?.('))
ok('every intake type has a label in every language', ['npwp', 'nib', 'akta', 'sk_kemenkumham', 'oss_license', 'pkp_certificate', 'kpp_registration', 'bank_statement', 'invoice', 'receipt', 'payroll_document', 'bpjs_document', 'tax_report', 'tax_payment_proof', 'contract', 'unknown'].every((k) => ru.docs.kind[k] && en.docs.kind[k] && id.docs.kind[k]))

console.log('\n--- review panel and company tab text: same keys in RU / EN / ID')
const flat = (o, pre = '') => Object.entries(o || {}).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${pre}${k}.`) : [`${pre}${k}`])).sort().join(',')
for (const sub of ['dr', 'company', 'vault', 'pv', 'id', 'kind']) {
  ok(`docs.${sub}: ru = en`, flat(ru.docs[sub]) === flat(en.docs[sub]) && flat(en.docs[sub]).length > 0)
  ok(`docs.${sub}: id = en`, flat(id.docs[sub]) === flat(en.docs[sub]))
}
for (const [k, L] of Object.entries({ ru, en, id })) ok(`${k}: docs.tabCompany / looksLike / extractFailed`, !!(L.docs.tabCompany && L.docs.looksLike && L.docs.extractFailed))

console.log(`\nV2 DOCUMENTS/BILLS: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
