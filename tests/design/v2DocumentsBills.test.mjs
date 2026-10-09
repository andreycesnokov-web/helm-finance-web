// Documents / Bills audit fixes (2026-10-09). Run: node tests/design/v2DocumentsBills.test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { billHasDocument, classicDocPath, billChecklistItems, tabForPath } from '../../client/src/v2/lib/obligations.js'
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
ok('classicDocPath opens the document in the classic center', classicDocPath({ id: 'a b' }) === '/business/documents/classic?doc=a%20b')
const items = billChecklistItems({ id: 1 }, { hasInvoice: true, invoiceDocPath: '/business/documents/classic?doc=x' })
ok('checklist "View" on the invoice goes to that document', items.find((c) => c.key === 'invoice').link === '/business/documents/classic?doc=x')
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

console.log(`\nV2 DOCUMENTS/BILLS: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
