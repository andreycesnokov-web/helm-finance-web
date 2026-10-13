// Only an accessible, active document linked to this bill can satisfy a document row.
// Payment receipts and ledger rows establish payment, not an uploaded proof file.
export function billDocumentEvidence(debt, response) {
  const docs = response?.documents
  const known = Array.isArray(docs) && !response?.error && docs.length < 200
  const linked = Array.isArray(docs) ? docs.filter(d => d?.id && d.file_id && d.file
    && !d.archived_at && d.links?.some(l => l.target_type === 'debt'
      && String(l.target_id) === String(debt?.id))) : []
  const invoiceTypes = ['invoice', 'tax_invoice', debt?.type === 'receivable' ? 'customer_invoice' : 'vendor_invoice']
  const invoice = linked.find(d => invoiceTypes.includes(d.document_type)) || null
  const proof = linked.find(d => d.document_type === 'payment_proof') || null
  return { known, invoice, proof }
}
