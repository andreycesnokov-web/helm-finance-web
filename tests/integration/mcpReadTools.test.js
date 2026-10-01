// CFO Finance MCP — Phase-1 read-only tools, driven through a REAL MCP client (in-memory
// transport) against the real McpServer and tool registry.
//
// The CFO services are injected exactly as server/index.js injects them; here they are fakes
// that record every call, EXCEPT the parts that decide what an invoice says — extraction
// (documentExtraction), dates (documentDates), the intake orchestrator and the settlement /
// closeout engine (invoiceSettlement) are the real modules. So these tests check two things:
//   1. the MCP layer enforces identity → company → role → plan, never trusts a model-chosen id,
//      and never writes;
//   2. an invoice read through MCP gets the same answer the CFO engine gives the web app.

const { test } = require('node:test');
const assert = require('node:assert');

const ORCH = require('../../server/lib/documentIntakeOrchestrator');
const docExtract = require('../../server/lib/documentExtraction');
const docDates = require('../../server/lib/documentDates');
const SETTLE = require('../../server/lib/invoiceSettlement');
const { buildServer } = require('../../server/mcp/server');

const OWNER = -1;
const BIZ_A = {
  business: { id: 'biz-a', name: 'Helm Care Pay', business_code: 'HF-BIZ-000004', base_currency: 'IDR', type: 'business' },
  role: 'owner', ownerUserId: OWNER,
};

// No bare "INVOICE" title line: the CFO extractor currently reads the invoice number as the
// word "Invoice" when one precedes "Invoice No:" — a known extractor bug tracked separately.
// These tests check the MCP plumbing, so they use a layout the extractor already reads.
const SAMPLE_INVOICE = [
  'Invoice No: INV-2026-0012',
  'From: PT ABC Indonesia',
  'Bill to: PT Helm Care Pay',
  'Tanggal: 05-09-2026',
  'Jatuh Tempo: 05-10-2026',
  'Dasar Pengenaan Pajak: 16.666.667',
  'Jumlah PPN: 1.833.333',
  'Grand Total: 18.500.000',
].join('\n');

// Same reading shape server/index.js produces (readDocumentForIntake / readTextForIntake).
function readingOf(text, readSource) {
  const extraction = docExtract.extractFromText(text, { text_available: true });
  return {
    extraction, readSource, ocr: null,
    dates: docDates.extractDates(text, { document_type: extraction.document_type }), parties: null,
  };
}

// Mirrors server/index.js invoiceReadinessPreview: the real settlement + closeout engine.
function previewOf(fields = {}, tax = {}) {
  const settlement = SETTLE.settlementOf({
    invoice_total: fields.gross_amount, base_amount: fields.commercial_base_amount,
    tax_amount: tax.ppn_detected ? tax.ppn_amount : null, allocations: [],
  });
  const documents = { invoice: true };
  return { basis: 'preview_as_new_invoice', settlement, documents,
    closeout: SETTLE.closeoutState({ settlement, documents, has_tax: !!tax.ppn_detected }) };
}

function fakeServices(over = {}) {
  const calls = [];
  const log = (name, ...args) => calls.push([name, ...args]);
  const s = {
    calls,
    listAccessibleWorkspaces: async (uid) => {
      log('listAccessibleWorkspaces', uid);
      return [
        { role: 'owner', businesses: { id: 'biz-a', name: 'Helm Care Pay', business_code: 'HF-BIZ-000004', type: 'business' } },
        { role: 'owner', businesses: { id: 'per-1', name: 'Personal Finance', business_code: 'HF-BIZ-000010', type: 'personal' } },
      ];
    },
    findDefaultBusiness: async (uid) => { log('findDefaultBusiness', uid); return { business: BIZ_A.business, membership: { role: 'owner' } }; },
    // Stand-in for businessResolver: only biz-a is a membership of this user.
    resolveBusinessReadOnly: async (req) => {
      const requested = (req.body && req.body.business_id) || null;
      log('resolveBusinessReadOnly', requested, req.user.userId);
      if (requested && requested !== 'biz-a') { const e = new Error('workspace_not_accessible'); e.status = 403; throw e; }
      return BIZ_A;
    },
    canViewBusinessFinance: (r) => ['owner', 'ceo', 'admin', 'cfo', 'accountant', 'auditor'].includes(r),
    canUploadDocument: (r) => r !== 'auditor',
    hasDocumentsAccess: async () => true,
    buildAiCfoContext: async (uid, lang, biz) => {
      log('buildAiCfoContext', uid, biz.business.id);
      return {
        cash: { total_balance: 1000, wallets_count: 2, wallets: [{ name: 'BCA' }] },
        current_month: { income: 500, expenses: 200, net_flow: 300, transactions_count: 4, burn_rate: 7 },
        runway_days: 90, receivables: { total_remaining: 10 }, payables: { total_remaining: 20 },
        pending_submissions: { count: 1, receivables_total: 0, payables_total: 50, items: [{ created_by: 'Someone' }] },
        risks: [], cfo_score: { score: 70 }, compliance: { overdue_count: 0, upcoming_30d: 2 }, next_actions: [],
      };
    },
    buildRequiredDocuments: async (biz, uid) => {
      log('buildRequiredDocuments', biz.business.id, uid);
      return { business: { id: biz.business.id }, items: [], missing: ['NPWP card'], truncated: false, warnings: [] };
    },
    loadDocumentScoped: async (biz, id) => {
      log('loadDocumentScoped', biz.business.id, id);
      if (id === 'doc-1') return { id: 'doc-1', document_type: null, extracted_json: {}, archived_at: null };
      if (id === 'doc-arch') return { id: 'doc-arch', document_type: null, extracted_json: {}, archived_at: '2026-01-01' };
      return null; // includes every document of another company
    },
    readDocumentForIntake: async (biz, doc) => { log('readDocumentForIntake', doc.id); return readingOf(SAMPLE_INVOICE, 'embedded_text'); },
    readTextForIntake: (text) => { log('readTextForIntake'); return readingOf(text, 'client_model_text'); },
    analyzeDocumentReading: async (biz, doc, read) => {
      log('analyzeDocumentReading', doc.id, read.readSource);
      return ORCH.processDocument({
        document: doc, extraction: read.extraction, businessName: biz.business.name,
        counterparties: [], existingLinks: {}, taxRules: [], readSource: read.readSource,
      });
    },
    findDocumentDuplicate: async (biz, id, f) => {
      log('findDocumentDuplicate', biz.business.id, id);
      return { duplicate: false, reference: f.document_number || null };
    },
    linkedInvoiceSettlement: async (biz, id) => { log('linkedInvoiceSettlement', id); return null; },
    invoiceReadinessPreview: (f, tax) => previewOf(f, tax),
    ...over,
  };
  return s;
}

async function connect(ctx) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const server = await buildServer(ctx);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'mcp-read-tools-test', version: '0' });
  await client.connect(clientSide);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
const body = (r) => JSON.parse(r.content[0].text);
const called = (s, name) => s.calls.filter((c) => c[0] === name);
async function call(services, name, args = {}, user = { userId: OWNER, via: 'dev_token' }) {
  const { client, close } = await connect({ mcpUser: user, services });
  try { return await client.callTool({ name, arguments: args }); } finally { await close(); }
}

/* ── registry ─────────────────────────────────────────────────────────────── */

test('exactly four read-only tools are exposed — no period-readiness tool without an engine', async () => {
  const { client, close } = await connect({ mcpUser: { userId: OWNER }, services: fakeServices() });
  try {
    const { tools } = await client.listTools();
    assert.deepStrictEqual(tools.map((t) => t.name).sort(),
      ['analyze_invoice', 'get_company_context', 'get_financial_summary', 'get_missing_documents']);
    for (const t of tools) {
      assert.strictEqual(t.annotations.readOnlyHint, true, `${t.name} must be readOnlyHint`);
      assert.strictEqual(t.annotations.destructiveHint, false, `${t.name} must not be destructive`);
    }
  } finally { await close(); }
});

/* ── identity ─────────────────────────────────────────────────────────────── */

test('without an authenticated user every data tool refuses and no service is touched', async () => {
  for (const name of ['get_company_context', 'get_financial_summary', 'get_missing_documents']) {
    const s = fakeServices();
    const r = await call(s, name, {}, null);
    assert.strictEqual(r.isError, true, name);
    assert.strictEqual(body(r).error, 'authentication_required', name);
    assert.strictEqual(s.calls.length, 0, `${name} touched a service without a user`);
  }
});

/* ── company resolution: the model never picks a tenant ───────────────────── */

test('get_company_context lists only the user\'s memberships and marks personal workspaces unusable', async () => {
  const s = fakeServices();
  const out = body(await call(s, 'get_company_context'));
  assert.strictEqual(out.default_company_id, 'biz-a');
  assert.deepStrictEqual(out.companies.map((c) => [c.company_id, c.kind, c.usable_with_tools]),
    [['biz-a', 'company', true], ['per-1', 'personal_workspace', false]]);
  assert.deepStrictEqual(called(s, 'listAccessibleWorkspaces'), [['listAccessibleWorkspaces', OWNER]]);
});

test('a company_id the user is not a member of is refused by the server-side resolver', async () => {
  const s = fakeServices();
  const r = await call(s, 'get_financial_summary', { company_id: 'biz-of-someone-else' });
  assert.strictEqual(r.isError, true);
  assert.strictEqual(body(r).error, 'workspace_not_accessible');
  // The id was passed to the resolver as a SELECTOR only, with the authenticated user.
  assert.deepStrictEqual(called(s, 'resolveBusinessReadOnly'),
    [['resolveBusinessReadOnly', 'biz-of-someone-else', OWNER]]);
  assert.strictEqual(called(s, 'buildAiCfoContext').length, 0, 'data was read for a foreign company');
});

test('omitting company_id resolves the default company read-only', async () => {
  const s = fakeServices();
  await call(s, 'get_financial_summary', {});
  assert.deepStrictEqual(called(s, 'resolveBusinessReadOnly'), [['resolveBusinessReadOnly', null, OWNER]]);
});

test('resolver errors never leak internals — unknown failures map to a generic code', async () => {
  const s = fakeServices({ resolveBusinessReadOnly: async () => { throw new Error('select * from secret_table failed'); } });
  const out = body(await call(s, 'get_financial_summary'));
  assert.strictEqual(out.error, 'company_unavailable');
  assert.ok(!/secret_table|select/i.test(JSON.stringify(out)), 'internal message leaked');
});

/* ── role / plan gates mirror the web routes ──────────────────────────────── */

test('a role that cannot view business finance gets no financial summary', async () => {
  const s = fakeServices({ resolveBusinessReadOnly: async () => ({ ...BIZ_A, role: 'manager' }) });
  const r = await call(s, 'get_financial_summary');
  assert.strictEqual(body(r).error, 'forbidden_role');
  assert.strictEqual(called(s, 'buildAiCfoContext').length, 0);
});

test('missing documents require Document Center, exactly like the web route', async () => {
  const s = fakeServices({ hasDocumentsAccess: async () => false });
  const out = body(await call(s, 'get_missing_documents'));
  assert.strictEqual(out.error, 'document_center_not_enabled');
  assert.strictEqual(out.upgrade_required, true);
  assert.strictEqual(called(s, 'buildRequiredDocuments').length, 0);
});

/* ── financial summary ────────────────────────────────────────────────────── */

test('financial summary returns the CFO engine figures for the resolved company, current month only', async () => {
  const s = fakeServices();
  const out = body(await call(s, 'get_financial_summary'));
  assert.strictEqual(out.company.company_id, 'biz-a');
  assert.strictEqual(out.period, 'current_month');
  assert.strictEqual(out.cash.total_balance, 1000);
  assert.strictEqual(out.runway_days, 90);
  assert.deepStrictEqual(called(s, 'buildAiCfoContext'), [['buildAiCfoContext', OWNER, 'biz-a']]);
  // Who submitted what is not exposed through the summary — only counts and totals.
  assert.strictEqual(out.pending_unconfirmed.items, undefined);
});

/* ── analyze_invoice ──────────────────────────────────────────────────────── */

test('analyze_invoice needs exactly one of document_id / invoice_text', async () => {
  for (const args of [{}, { document_id: 'doc-1', invoice_text: SAMPLE_INVOICE }]) {
    const s = fakeServices();
    const out = body(await call(s, 'analyze_invoice', args));
    assert.strictEqual(out.error, 'invalid_arguments', JSON.stringify(Object.keys(args)));
    assert.strictEqual(called(s, 'resolveBusinessReadOnly').length, 0);
  }
});

test('a document of another company is not found and its file is never read', async () => {
  const s = fakeServices();
  const out = body(await call(s, 'analyze_invoice', { document_id: 'doc-of-another-company' }));
  assert.strictEqual(out.error, 'document_not_found');
  assert.deepStrictEqual(called(s, 'loadDocumentScoped'), [['loadDocumentScoped', 'biz-a', 'doc-of-another-company']]);
  assert.strictEqual(called(s, 'readDocumentForIntake').length, 0);
});

test('an archived document is refused', async () => {
  const out = body(await call(fakeServices(), 'analyze_invoice', { document_id: 'doc-arch' }));
  assert.strictEqual(out.error, 'document_archived');
});

test('invoice text from the AI client goes through the CFO pipeline and nothing is written', async () => {
  const s = fakeServices();
  const out = body(await call(s, 'analyze_invoice', { invoice_text: SAMPLE_INVOICE }));
  assert.strictEqual(out.source, 'client_text');
  assert.strictEqual(out.written, false);
  assert.strictEqual(out.document_id, null);
  assert.strictEqual(out.invoice.invoice_number, 'INV-2026-0012');
  assert.strictEqual(out.invoice.total, 18500000);
  assert.ok(/ABC Indonesia/.test(out.invoice.supplier || ''), `supplier: ${out.invoice.supplier}`);
  // The client text is analysed as a model reading — never as the document's own text layer.
  assert.deepStrictEqual(called(s, 'analyzeDocumentReading'), [['analyzeDocumentReading', null, 'client_model_text']]);
  // Duplicate check runs for this company, with no stored id to exclude.
  assert.deepStrictEqual(called(s, 'findDocumentDuplicate'), [['findDocumentDuplicate', 'biz-a', null]]);
  // Readiness comes from the CFO closeout engine: a new invoice is unpaid and lacks payment proof.
  assert.strictEqual(out.package_readiness.basis, 'preview_as_new_invoice');
  assert.strictEqual(out.package_readiness.payment_status, 'unpaid');
  assert.ok(out.package_readiness.missing_documents.includes('Payment proof'));
  assert.strictEqual(out.package_readiness.can_close, false);
  assert.ok(out.package_readiness.required_documents_present < out.package_readiness.required_documents_total);
});

test('tax read from client text is held to the vision standard, not trusted as printed', async () => {
  const fromClient = body(await call(fakeServices(), 'analyze_invoice', { invoice_text: SAMPLE_INVOICE }));
  const fromFile = body(await call(fakeServices(), 'analyze_invoice', { document_id: 'doc-1' }));
  // Same invoice, same numbers — but only the document's own text layer counts as "stated".
  assert.strictEqual(fromFile.tax.tax_status, 'tax_detected');
  assert.strictEqual(fromClient.tax.tax_status, 'tax_needs_review');
  assert.ok(fromClient.tax.notes.some((n) => /AI client/.test(n)), JSON.stringify(fromClient.tax.notes));
});

test('a stored document already attached to an invoice reports that invoice\'s REAL readiness', async () => {
  const real = {
    invoice: { debt_id: 'debt-7' },
    settlement: { status: 'paid' },
    documents: { invoice: true, payment_proof: true },
    closeout: { state: 'Ready for accountant review', can_close: false,
      checklist: [{ key: 'invoice', required: true, present: true }, { key: 'payment_proof', required: true, present: true },
        { key: 'accountant_confirmation', required: true, present: false }],
      missing_documents: ['Accountant confirmation'], blockers: ['Accountant review is not complete.'] },
  };
  const s = fakeServices({ linkedInvoiceSettlement: async () => real });
  const out = body(await call(s, 'analyze_invoice', { document_id: 'doc-1' }));
  assert.strictEqual(out.package_readiness.basis, 'linked_invoice');
  assert.strictEqual(out.package_readiness.invoice_id, 'debt-7');
  assert.strictEqual(out.package_readiness.payment_status, 'paid');
  assert.strictEqual(out.package_readiness.required_documents_present, 2);
  assert.strictEqual(out.package_readiness.required_documents_total, 3);
});

/* ── the engine change itself (assessTax provenance) ─────────────────────── */

test('assessTax: client_model_text is treated like ocr_vision; embedded text is unchanged', () => {
  const fields = { commercial_tax_amount: 1122000 };
  const noEvidence = { readSource: 'client_model_text', taxEvidence: false };
  const t1 = ORCH.assessTax('invoice', fields, noEvidence);
  assert.strictEqual(t1.ppn_detected, false);
  assert.strictEqual(t1.tax_status, 'tax_not_confirmed');

  const t2 = ORCH.assessTax('invoice', fields, { readSource: 'client_model_text', taxEvidence: true });
  assert.strictEqual(t2.tax_status, 'tax_needs_review');
  assert.ok(t2.notes.some((n) => /AI client/.test(n)));

  const t3 = ORCH.assessTax('invoice', fields, { readSource: 'ocr_vision', taxEvidence: true });
  assert.ok(t3.notes.some((n) => /OCR\/Vision/.test(n)), 'existing OCR wording must not change');

  const t4 = ORCH.assessTax('invoice', fields, { readSource: 'embedded_text', taxEvidence: false });
  assert.strictEqual(t4.tax_status, 'tax_detected');
});
