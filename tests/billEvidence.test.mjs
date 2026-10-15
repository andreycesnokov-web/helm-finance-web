import test from 'node:test'
import assert from 'node:assert/strict'
import { billDocumentEvidence,hasDocumentDuplicate } from '../client/src/v2/lib/billEvidence.js'
import { billChecklistItems } from '../client/src/v2/lib/obligations.js'
const debt = { id: 12, type: 'payable', status: 'paid', last_payment_at: '2026-10-13', linked_transaction_id: 99 }
const document = (id, type, target = 12) => ({ id, file_id: 'file-' + id, file: { file_name: id + '.pdf' }, document_type: type, links: [{ target_type: 'debt', target_id: target }] })
test('duplicate false object is not a duplicate warning, and a positive warning identifies an existing match',()=>{
 for(const r of [null,{duplicate:false},{duplicate:false,reference:'123'},{duplicate:true},{duplicate:true,reference:'123'}])assert.equal(hasDocumentDuplicate(r),false)
 assert.equal(hasDocumentDuplicate({duplicate:true,reference:'123',match:{id:'doc'}}),true)
})
test('a paid ledger and receipt do not establish an invoice or proof document', () => {
  assert.deepEqual(billDocumentEvidence(debt, { documents: [] }), { known: true, invoice: null, proof: null })
  assert.equal(billChecklistItems(debt, { paid: true }).find(c => c.key === 'proof').done, false)
})
test('typed active files of this exact bill are independent evidence', () => {
  const invoice = document('invoice', 'vendor_invoice'), proof = document('proof', 'payment_proof')
  assert.deepEqual(billDocumentEvidence(debt, { documents: [document('other', 'other'), document('foreign', 'payment_proof', 42), { ...proof, id: 'archived', archived_at: '2026-10-13' }, invoice] }), { known: true, invoice, proof: null })
  assert.deepEqual(billDocumentEvidence(debt, { documents: [proof] }), { known: true, invoice: null, proof })
  assert.equal(billDocumentEvidence({ ...debt, type: 'receivable' }, { documents: [invoice] }).invoice, null)
})
test('failed, malformed or truncated reads and absent files are not reported as complete', () => {
  for (const response of [null, { documents: null }, { documents: [], error: 'refused' }, { documents: Array(200).fill({}) }]) {
    const evidence = billDocumentEvidence(debt, response)
    assert.equal(evidence.known, false)
    assert.ok(billChecklistItems(debt, { documentsKnown: evidence.known }).find(c => c.key === 'proof').unknown)
  }
  assert.equal(billDocumentEvidence(debt, { documents: [{ ...document('missing', 'payment_proof'), file: null }] }).proof, null)
})
