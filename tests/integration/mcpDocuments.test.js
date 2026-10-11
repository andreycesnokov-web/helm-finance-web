// CFO Finance MCP — Phase 2 · Batch B: documents through the connector.
//   list_documents (read) · upload_document (write, inline bytes or a 15-minute link) ·
//   link_document (write) · submit_invoice_draft attaches its source document.
//
// Real MCP client (in-memory transport) against the real McpServer. The Document Center
// functions (listDocumentsForUser, storeDocumentBytes, linkDocument, …) are injected exactly as
// server/index.js injects them; here they are recording fakes, so these tests pin the MCP
// contract: gates, isolation, "nothing written on refusal", and what may appear in a reply.

const { test } = require('node:test');
const assert = require('node:assert');

const ORCH = require('../../server/lib/documentIntakeOrchestrator');
const docExtract = require('../../server/lib/documentExtraction');
const docDates = require('../../server/lib/documentDates');
const SETTLE = require('../../server/lib/invoiceSettlement');
const CUR = require('../../server/lib/telegramCurrency');
const { buildServer } = require('../../server/mcp/server');

const ME = -7;
const OTHER = -99;
const COMPANIES = {
  'biz-a': { id: 'biz-a', name: 'Helm Care Indonesia', business_code: 'HF-BIZ-000002', base_currency: 'IDR', type: 'business' },
};
const SECRET_TEXT = 'SECRET-DOCUMENT-TEXT-MUST-NOT-LEAK';
const INVOICE = ['Invoice No: INV-2026-0012', 'From: PT ABC Indonesia', 'Bill to: PT Helm Care Indonesia',
  'Tanggal: 05-09-2026', 'Grand Total: 18.500.000'].join('\n');

const canViewBusinessFinance = (r) => ['owner', 'ceo', 'admin', 'cfo', 'accountant', 'auditor'].includes(r);
const canCreateFinancialRequest = (r) => ['owner', 'ceo', 'admin', 'cfo', 'accountant', 'manager', 'employee'].includes(r);
const canUploadDocument = (r) => canCreateFinancialRequest(r) && r !== 'auditor';
const canManageDocuments = (r) => ['owner', 'ceo', 'admin', 'cfo', 'accountant'].includes(r);
const canApproveFinancialRecord = (r) => ['owner', 'ceo', 'admin', 'cfo'].includes(r);

function docRow(id, over = {}) {
  return {
    id, document_type: 'vendor_invoice', created_at: '2026-09-20T10:00:00Z', document_number: 'INV-1',
    document_date: '2026-09-18', gross_amount: 18500000, currency: 'IDR', archived_at: null, created_by_user_id: ME,
    file: { file_name: `${id}.pdf`, mime_type: 'application/pdf', file_size: 1234, upload_channel: 'web' },
    links: [],
    extracted_json: {
      notes: SECRET_TEXT,
      ai_intake: { doc_type: 'invoice', confidence: 'high', classification_status: 'auto_classified' },
      ai_intake_v2: { status: 'needs_counterparty', document_type: 'invoice', direction: 'payable', amount: 18500000,
        currency: 'IDR', suggested_record_type: 'payable', counterparty_status: 'not_found', missing_fields: [] },
    },
    ...over,
  };
}
const readingOf = (text, readSource) => {
  const extraction = docExtract.extractFromText(text, { text_available: true });
  return { extraction, readSource, ocr: null, dates: docDates.extractDates(text, { document_type: extraction.document_type }) };
};

function fakeServices(role = 'owner', over = {}) {
  const calls = [];
  const log = (name, ...args) => calls.push([name, ...args]);
  const biz = { business: COMPANIES['biz-a'], role, ownerUserId: -1 };
  const DEBTS = {
    '41': { id: 41, type: 'payable', approval_status: 'approved', status: 'open', created_by_user_id: OTHER },
    '42': { id: 42, type: 'payable', approval_status: 'pending_approval', status: 'open', created_by_user_id: ME },
    '43': { id: 43, type: 'receivable', approval_status: 'approved', status: 'open', created_by_user_id: ME },
  };
  const DOCS = { 'doc-1': docRow('doc-1'), 'doc-2': docRow('doc-2', { created_at: '2026-08-02T10:00:00Z', document_date: null }) };
  return {
    calls,
    listAccessibleWorkspaces: async () => [{ role, businesses: COMPANIES['biz-a'] }],
    findDefaultBusiness: async () => ({ business: COMPANIES['biz-a'] }),
    resolveBusinessReadOnly: async (req) => {
      const id = (req.body && req.body.business_id) || 'biz-a';
      if (id !== 'biz-a') throw new Error('workspace_not_accessible');
      return biz;
    },
    canViewBusinessFinance, canCreateFinancialRequest, canUploadDocument, canManageDocuments, canApproveFinancialRecord,
    hasDocumentsAccess: async () => true,
    canAccessDocument: async (b, uid, doc) => canViewBusinessFinance(b.role) || doc.created_by_user_id === uid,
    isSupportedTelegramCurrency: CUR.isSupportedTelegramCurrency,
    normalizeCurrency: CUR.normalizeCurrency,
    listDocumentsForUser: async (b, uid, f) => {
      log('listDocumentsForUser', f);
      let docs = Object.values(DOCS);
      if (f.document_id) docs = docs.filter((d) => d.id === f.document_id);
      return { documents: docs };
    },
    signedDocumentUrl: async (b, uid, doc) => { log('signedDocumentUrl', doc.id); return { url: `https://signed.example/${doc.id}`, expires_in: 600 }; },
    storeDocumentBytes: async (b, uid, input) => {
      log('storeDocumentBytes', b.business.id, uid, input);
      return { doc: { id: 'doc-new', document_type: input.documentType || 'other' },
        link_result: input.link ? { ok: true, link_id: 'lnk-1' } : null,
        intake: { status: 'needs_counterparty', document: { type: 'invoice', direction: 'payable' },
          financial_record: { suggested_record_type: 'payable', amount: 18500000, currency: 'IDR' },
          counterparty: { status: 'not_found', matched_counterparty_id: 'cp-secret' }, missing_fields: [] } };
    },
    issueUploadLink: (b, uid, opts) => { log('issueUploadLink', b.business.id, uid, opts);
      return { url: 'https://app.example/upload#t=TOKEN', expires_at: '2026-10-02T12:15:00.000Z', issued_at: '2026-10-02T12:00:00.000Z' }; },
    loadDebtScoped: async (b, id) => DEBTS[String(id)] || null,
    loadDocumentScoped: async (b, id) => DOCS[id] || (id === 'doc-mine' ? docRow('doc-mine') : null),
    documentLinks: async (b, doc) => (doc.id === 'doc-1' ? [{ link_id: 'lnk-9', target_type: 'debt', target_id: '41' }] : []),
    linkDocument: async (b, doc, type, id, uid) => { log('linkDocument', doc.id, type, String(id), uid); return { ok: true, link_id: 'lnk-new' }; },
    unlinkDocument: async (b, doc, linkId, uid) => { log('unlinkDocument', doc.id, linkId, uid); return { ok: true }; },
    readDocumentForIntake: async () => readingOf(INVOICE, 'embedded_text'),
    readTextForIntake: (text) => readingOf(text, 'client_model_text'),
    analyzeDocumentReading: async (b, doc, read) => ORCH.processDocument({ document: doc, extraction: read.extraction,
      businessName: b.business.name, counterparties: [], existingLinks: {}, taxRules: [], readSource: read.readSource, dates: read.dates }),
    findDocumentDuplicate: async () => ({ duplicate: false }),
    linkedInvoiceSettlement: async () => null,
    invoiceReadinessPreview: (f) => {
      const settlement = SETTLE.settlementOf({ invoice_total: f.gross_amount, allocations: [] });
      return { basis: 'preview_as_new_invoice', settlement, documents: { invoice: true },
        closeout: SETTLE.closeoutState({ settlement, documents: { invoice: true } }) };
    },
    createPendingPayableDraft: async (b, uid, draft) => { log('createPendingPayableDraft', draft);
      return { debt: { id: 77, counterparty: draft.counterparty, amount: draft.amount, currency: draft.currency,
        due_date: draft.due_date, description: draft.description, approval_status: 'pending_approval' }, telegram_notified: 0 }; },
    ...over,
  };
}

async function connect(services, { write = true } = {}) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const server = await buildServer({ mcpUser: { userId: ME, via: 'dev_token' }, services, writeToolsEnabled: write });
  const [c, sv] = InMemoryTransport.createLinkedPair();
  await server.connect(sv);
  const client = new Client({ name: 'mcp-docs-test', version: '0' });
  await client.connect(c);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
const body = (r) => JSON.parse(r.content[0].text);
const called = (s, name) => s.calls.filter((c) => c[0] === name);
async function call(services, name, args = {}, opts) {
  const { client, close } = await connect(services, opts);
  try { return await client.callTool({ name, arguments: args }); } finally { await close(); }
}
const PDF_B64 = Buffer.from('%PDF-1.4 tiny').toString('base64');

/* ── registration ─────────────────────────────────────────────────────────── */
test('flag OFF: upload_document and link_document are not registered; list_documents is (read-only)', async () => {
  const { client, close } = await connect(fakeServices(), { write: false });
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes('list_documents'));
    assert.ok(!names.includes('upload_document') && !names.includes('link_document'));
  } finally { await close(); }
});

test('the connector stays within its tool budget', async () => {
  const { client, close } = await connect(fakeServices());
  try { assert.ok((await client.listTools()).tools.length <= 15); } finally { await close(); }
});

/* ── list_documents ───────────────────────────────────────────────────────── */
test('list_documents: metadata and intake summary, never document text', async () => {
  const out = body(await call(fakeServices(), 'list_documents', {}));
  assert.strictEqual(out.count, 2);
  const d = out.documents[0];
  assert.strictEqual(d.document_id, 'doc-1');
  assert.strictEqual(d.intake.direction, 'payable');
  assert.ok(!JSON.stringify(out).includes(SECRET_TEXT), 'document notes leaked');
  assert.strictEqual(d.download_url, undefined);
});

test('list_documents: status and period map to the Document Center filters', async () => {
  const s = fakeServices();
  await call(s, 'list_documents', { status: 'needs_review' });
  await call(s, 'list_documents', { status: 'unlinked' });
  await call(s, 'list_documents', { status: 'archived' });
  const f = called(s, 'listDocumentsForUser').map((c) => c[1]);
  assert.strictEqual(f[0].review, 'needs_review');
  assert.strictEqual(f[1].linked_status, 'unlinked');
  assert.strictEqual(f[2].status, 'archived');
  const sept = body(await call(fakeServices(), 'list_documents', { period: '2026-09' }));
  assert.deepStrictEqual(sept.documents.map((d) => d.document_id), ['doc-1']);
  const aug = body(await call(fakeServices(), 'list_documents', { period: '2026-08' }));
  assert.deepStrictEqual(aug.documents.map((d) => d.document_id), ['doc-2'], 'no document date → upload date');
});

test('list_documents: download links only on request, at most 5, each issued through the audited path', async () => {
  const s = fakeServices();
  const out = body(await call(s, 'list_documents', { document_id: 'doc-1', include_download_url: true }));
  assert.strictEqual(out.documents[0].download_url, 'https://signed.example/doc-1');
  assert.strictEqual(called(s, 'signedDocumentUrl').length, 1);
  const many = fakeServices('owner', { listDocumentsForUser: async () => ({ documents: Array.from({ length: 6 }, (_, i) => docRow(`d${i}`)) }) });
  assert.strictEqual(body(await call(many, 'list_documents', { include_download_url: true })).error, 'too_many_for_download_links');
  assert.strictEqual(called(many, 'signedDocumentUrl').length, 0);
});

test('list_documents: unknown document, foreign company, Document Center off', async () => {
  assert.strictEqual(body(await call(fakeServices(), 'list_documents', { document_id: 'nope' })).error, 'document_not_found');
  assert.strictEqual(body(await call(fakeServices(), 'list_documents', { company_id: 'biz-x' })).error, 'workspace_not_accessible');
  const off = fakeServices('owner', { hasDocumentsAccess: async () => false });
  assert.strictEqual(body(await call(off, 'list_documents', {})).error, 'document_center_not_enabled');
  assert.strictEqual(called(off, 'listDocumentsForUser').length, 0);
});

/* ── upload_document: inline bytes ───────────────────────────────────────── */
test('upload_document (inline): stored through the Document Center path, intake summary returned', async () => {
  const s = fakeServices();
  const out = body(await call(s, 'upload_document', { file_base64: PDF_B64, file_name: 'inv.pdf', mime_type: 'application/pdf' }));
  assert.strictEqual(out.written, true);
  assert.strictEqual(out.document_id, 'doc-new');
  assert.strictEqual(out.intake.direction, 'payable');
  const [w] = called(s, 'storeDocumentBytes');
  assert.strictEqual(w[1], 'biz-a');
  assert.strictEqual(w[2], ME);
  assert.strictEqual(w[3].buf.toString(), '%PDF-1.4 tiny');
  assert.ok(!JSON.stringify(out).includes('cp-secret'));
});

test('upload_document (inline): a duplicate file is reported, not stored twice', async () => {
  const s = fakeServices('owner', { storeDocumentBytes: async () => ({ error: 'duplicate', duplicate: true, existing_document_id: 'doc-1' }) });
  const out = body(await call(s, 'upload_document', { file_base64: PDF_B64, file_name: 'inv.pdf', mime_type: 'application/pdf' }));
  assert.strictEqual(out.duplicate, true);
  assert.strictEqual(out.written, false);
  assert.strictEqual(out.existing_document_id, 'doc-1');
});

test('upload_document (inline): bad input is refused before anything is stored', async () => {
  const s = fakeServices();
  assert.strictEqual(body(await call(s, 'upload_document', { file_base64: '!!!not base64!!!', file_name: 'a.pdf', mime_type: 'application/pdf' })).error, 'invalid_file');
  assert.strictEqual(body(await call(s, 'upload_document', { file_base64: PDF_B64 })).error, 'invalid_arguments');
  const big = Buffer.alloc(7 * 1024 * 1024 + 10, 1).toString('base64');
  assert.strictEqual(body(await call(s, 'upload_document', { file_base64: big, file_name: 'a.pdf', mime_type: 'application/pdf' })).error, 'file_too_large_for_inline');
  assert.strictEqual(body(await call(s, 'upload_document', { file_base64: PDF_B64, file_name: 'a.pdf', mime_type: 'application/pdf', company_id: 'biz-x' })).error, 'workspace_not_accessible');
  assert.strictEqual(called(s, 'storeDocumentBytes').length, 0);
});

test('upload_document: an auditor cannot upload; Document Center off refuses', async () => {
  const aud = fakeServices('auditor');
  const r = await call(aud, 'upload_document', {});
  assert.strictEqual(r.isError, true);  // not even listed for an auditor
  const off = fakeServices('owner', { hasDocumentsAccess: async () => false });
  assert.strictEqual(body(await call(off, 'upload_document', {})).error, 'document_center_not_enabled');
  assert.strictEqual(called(off, 'issueUploadLink').length, 0);
});

/* ── upload_document: link mode ───────────────────────────────────────────── */
test('upload_document (link): no bytes → a 15-minute link for THIS user and company; nothing written', async () => {
  const s = fakeServices();
  const out = body(await call(s, 'upload_document', { document_type: 'payment_proof', link_to: { type: 'payable', id: 41 } }));
  assert.strictEqual(out.mode, 'upload_link');
  assert.strictEqual(out.written, false);
  assert.match(out.upload_url, /\/upload#t=/);
  assert.match(out.next_step, /uploaded_after="2026-10-02T12:00:00.000Z"/);
  const [l] = called(s, 'issueUploadLink');
  assert.strictEqual(l[1], 'biz-a');
  assert.strictEqual(l[2], ME);
  assert.deepStrictEqual(l[3], { documentType: 'payment_proof', link: { target_type: 'debt', target_id: '41' } });
  assert.strictEqual(called(s, 'storeDocumentBytes').length, 0);
});

/* ── link targets ─────────────────────────────────────────────────────────── */
test('link_to: the record must exist in this company with the stated type', async () => {
  const s = fakeServices();
  assert.strictEqual(body(await call(s, 'upload_document', { link_to: { type: 'receivable', id: 41 } })).error, 'link_target_not_found');
  assert.strictEqual(body(await call(s, 'upload_document', { link_to: { type: 'payable', id: 999 } })).error, 'link_target_not_found');
  assert.strictEqual(called(s, 'issueUploadLink').length, 0);
});

test('link_to for a manager: only a request they created', async () => {
  const s = fakeServices('manager');
  assert.strictEqual(body(await call(s, 'upload_document', { link_to: { type: 'payable', id: 41 } })).error, 'link_target_not_found');
  assert.strictEqual(body(await call(s, 'upload_document', { link_to: { type: 'payable', id: 42 } })).mode, 'upload_link');
  assert.strictEqual(body(await call(s, 'upload_document', { link_to: { type: 'transaction', id: 5 } })).error, 'forbidden_role');
});

/* ── link_document ────────────────────────────────────────────────────────── */
test('link_document: attaches through the Document Center link (evidence only)', async () => {
  const s = fakeServices();
  const out = body(await call(s, 'link_document', { document_id: 'doc-2', target_type: 'payable', target_id: 41 }));
  assert.strictEqual(out.action, 'linked');
  assert.deepStrictEqual(called(s, 'linkDocument')[0].slice(1), ['doc-2', 'debt', '41', ME]);
  assert.match(out.note, /does not approve, pay or settle/);
});

test('link_document: unlink removes exactly that link', async () => {
  const s = fakeServices();
  const out = body(await call(s, 'link_document', { document_id: 'doc-1', target_type: 'payable', target_id: 41, unlink: true }));
  assert.strictEqual(out.action, 'unlinked');
  assert.deepStrictEqual(called(s, 'unlinkDocument')[0].slice(1), ['doc-1', 'lnk-9', ME]);
  assert.strictEqual(body(await call(s, 'link_document', { document_id: 'doc-2', target_type: 'payable', target_id: 41, unlink: true })).error, 'link_not_found');
});

test('link_document: refused for a manager, an unknown document, a wrong-type target; nothing written', async () => {
  const mgr = fakeServices('manager');
  assert.strictEqual((await call(mgr, 'link_document', { document_id: 'doc-1', target_type: 'payable', target_id: 41 })).isError, true);
  const s = fakeServices();
  assert.strictEqual(body(await call(s, 'link_document', { document_id: 'nope', target_type: 'payable', target_id: 41 })).error, 'document_not_found');
  assert.strictEqual(body(await call(s, 'link_document', { document_id: 'doc-1', target_type: 'receivable', target_id: 42 })).error, 'link_target_not_found');
  assert.strictEqual(called(s, 'linkDocument').length + called(mgr, 'linkDocument').length, 0);
});

/* ── submit_invoice_draft attaches its document ───────────────────────────── */
test('submit_invoice_draft from a stored document attaches the document to the new draft', async () => {
  const s = fakeServices();
  const out = body(await call(s, 'submit_invoice_draft', { document_id: 'doc-1' }));
  assert.strictEqual(out.draft.approval_status, 'pending_approval');
  assert.deepStrictEqual(out.document_attached, { ok: true, document_id: 'doc-1' });
  assert.deepStrictEqual(called(s, 'linkDocument')[0].slice(1), ['doc-1', 'debt', '77', ME]);
  // From pasted text there is no stored document to attach.
  const t = fakeServices();
  const out2 = body(await call(t, 'submit_invoice_draft', { invoice_text: INVOICE }));
  assert.strictEqual(out2.document_attached, null);
  assert.strictEqual(called(t, 'linkDocument').length, 0);
});

test('submit_invoice_draft: the draft stands even if attaching the document fails', async () => {
  const s = fakeServices('owner', { linkDocument: async () => ({ ok: false, error: 'already_linked' }) });
  const out = body(await call(s, 'submit_invoice_draft', { document_id: 'doc-1' }));
  assert.strictEqual(out.written, true);
  assert.deepStrictEqual(out.document_attached, { ok: false, document_id: 'doc-1', error: 'already_linked' });
});
