// CFO Finance MCP — submit_invoice_draft (the connector's only write).
//
// Driven through a REAL MCP client against the real McpServer. Extraction, dates, the intake
// orchestrator and the settlement engine are the real CFO modules; only persistence
// (createPendingPayableDraft) is a recording fake. These tests pin the safety contract:
//   1. the tool does not exist unless MCP_WRITE_TOOLS_ENABLED (ctx.writeToolsEnabled) is on;
//   2. amount / supplier / due date come from CFO's reading, and a conflicting model amount
//      is refused — nothing is written;
//   3. non-IDR, unknown supplier, unreadable amount, forbidden role and foreign company are
//      refused before any write;
//   4. the persistence call never carries an approval decision — drafts are always pending.

const { test } = require('node:test');
const assert = require('node:assert');

const ORCH = require('../../server/lib/documentIntakeOrchestrator');
const docExtract = require('../../server/lib/documentExtraction');
const docDates = require('../../server/lib/documentDates');
const SETTLE = require('../../server/lib/invoiceSettlement');
const CUR = require('../../server/lib/telegramCurrency');
const { buildServer } = require('../../server/mcp/server');

const OWNER = -1;
const BIZ_A = {
  business: { id: 'biz-a', name: 'Helm Care Pay', business_code: 'HF-BIZ-000004', base_currency: 'IDR', type: 'business' },
  role: 'owner', ownerUserId: OWNER,
};

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

function readingOf(text, readSource) {
  const extraction = docExtract.extractFromText(text, { text_available: true });
  return { extraction, readSource, ocr: null,
    dates: docDates.extractDates(text, { document_type: extraction.document_type }), parties: null };
}
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
  const role = over.__role || 'owner';
  const biz = { ...BIZ_A, role };
  const s = {
    calls,
    listAccessibleWorkspaces: async () => [],
    findDefaultBusiness: async () => ({ business: biz.business, membership: { role } }),
    resolveBusinessReadOnly: async (req) => {
      const requested = (req.body && req.body.business_id) || null;
      if (requested && requested !== 'biz-a') { const e = new Error('workspace_not_accessible'); throw e; }
      return biz;
    },
    canViewBusinessFinance: (r) => ['owner', 'ceo', 'admin', 'cfo', 'accountant', 'auditor'].includes(r),
    canUploadDocument: (r) => r !== 'auditor',
    canCreateFinancialRequest: (r) => ['owner', 'ceo', 'admin', 'cfo', 'accountant', 'manager', 'employee'].includes(r),
    hasDocumentsAccess: async () => true,
    isSupportedTelegramCurrency: CUR.isSupportedTelegramCurrency,
    normalizeCurrency: CUR.normalizeCurrency,
    loadDocumentScoped: async (b, id) => (id === 'doc-1' ? { id: 'doc-1', document_type: null, extracted_json: {}, archived_at: null } : null),
    readDocumentForIntake: async () => readingOf(SAMPLE_INVOICE, 'embedded_text'),
    readTextForIntake: (text) => readingOf(text, 'client_model_text'),
    analyzeDocumentReading: async (b, doc, read) => ORCH.processDocument({
      document: doc, extraction: read.extraction, businessName: b.business.name,
      counterparties: [], existingLinks: {}, taxRules: [], readSource: read.readSource,
    }),
    findDocumentDuplicate: async () => ({ duplicate: false }),
    linkedInvoiceSettlement: async () => null,
    invoiceReadinessPreview: (f, tax) => previewOf(f, tax),
    createPendingPayableDraft: async (b, uid, draft) => {
      log('createPendingPayableDraft', b.business.id, uid, draft);
      return { debt: { id: 'debt-1', counterparty: draft.counterparty, amount: draft.amount,
        currency: draft.currency, due_date: draft.due_date, description: draft.description,
        approval_status: 'pending_approval' }, telegram_notified: 1 };
    },
    ...over,
  };
  return s;
}

async function connect(ctx) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const server = await buildServer(ctx);
  const [c, sv] = InMemoryTransport.createLinkedPair();
  await server.connect(sv);
  const client = new Client({ name: 'mcp-write-test', version: '0' });
  await client.connect(c);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
const body = (r) => JSON.parse(r.content[0].text);
const writes = (s) => s.calls.filter((c) => c[0] === 'createPendingPayableDraft');
async function call(services, args, { enabled = true } = {}) {
  const { client, close } = await connect({ mcpUser: { userId: OWNER }, services, writeToolsEnabled: enabled,
    webAppUrl: 'https://cfo.example' });
  try { return await client.callTool({ name: 'submit_invoice_draft', arguments: args }); } finally { await close(); }
}

test('flag OFF: submit_invoice_draft is not registered (Phase-1 stays read-only)', async () => {
  const { client, close } = await connect({ mcpUser: { userId: OWNER }, services: fakeServices() });
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(!names.includes('submit_invoice_draft'));
    assert.deepStrictEqual(names.sort(), ['analyze_invoice', 'get_company_context', 'get_financial_summary', 'get_missing_documents', 'list_documents']);
  } finally { await close(); }
});

test('flag ON: tool is listed and annotated as a non-read-only, non-destructive write', async () => {
  const { client, close } = await connect({ mcpUser: { userId: OWNER }, services: fakeServices(), writeToolsEnabled: true });
  try {
    const t = (await client.listTools()).tools.find((x) => x.name === 'submit_invoice_draft');
    assert.ok(t);
    assert.strictEqual(t.annotations.readOnlyHint, false);
    assert.strictEqual(t.annotations.destructiveHint, false);
  } finally { await close(); }
});

test('creates a pending draft from CFO\'s own reading of the invoice', async () => {
  const s = fakeServices();
  const r = await call(s, { invoice_text: SAMPLE_INVOICE });
  assert.ok(!r.isError, JSON.stringify(body(r)));
  const out = body(r);
  assert.strictEqual(out.written, true);
  assert.strictEqual(out.draft.approval_status, 'pending_approval');
  assert.strictEqual(out.counts_in_cash_flow, false);
  assert.strictEqual(out.draft.amount, 18500000);
  assert.strictEqual(out.draft.amount_source, 'cfo_extraction');
  assert.strictEqual(out.draft.currency, 'IDR');
  assert.strictEqual(out.confirm_in_app_url, 'https://cfo.example/payables');
  assert.strictEqual(out.telegram_approval_sent, true);
  const w = writes(s);
  assert.strictEqual(w.length, 1);
  const draft = w[0][3];
  assert.strictEqual(w[0][1], 'biz-a');
  assert.strictEqual(w[0][2], OWNER);
  assert.match(draft.counterparty, /ABC/);
  assert.strictEqual(draft.invoice_number, 'INV-2026-0012');
  // The persistence call never carries an approval decision.
  assert.ok(!('approval_status' in draft));
});

test('a model amount that disagrees with CFO is refused — nothing written', async () => {
  const s = fakeServices();
  const r = await call(s, { invoice_text: SAMPLE_INVOICE, amount: 1850000 });
  assert.ok(r.isError);
  assert.strictEqual(body(r).error, 'amount_mismatch');
  assert.strictEqual(body(r).cfo_total, 18500000);
  assert.strictEqual(writes(s).length, 0);
});

test('a matching model amount is accepted; CFO\'s reading is what is stored', async () => {
  const s = fakeServices();
  const r = await call(s, { invoice_text: SAMPLE_INVOICE, amount: 18500000 });
  assert.ok(!r.isError);
  assert.strictEqual(writes(s)[0][3].amount, 18500000);
});

test('unreadable total: refused without a model amount, accepted (flagged) with one', async () => {
  const text = 'Invoice No: X-1\nFrom: PT Supplier Satu\nPembayaran jasa kebersihan';
  const s1 = fakeServices();
  const r1 = await call(s1, { invoice_text: text });
  assert.ok(r1.isError);
  assert.ok(['amount_unreadable', 'counterparty_missing'].includes(body(r1).error));
  assert.strictEqual(writes(s1).length, 0);

  const s2 = fakeServices();
  const r2 = await call(s2, { invoice_text: text, amount: 750000, counterparty: 'PT Supplier Satu' });
  assert.ok(!r2.isError, JSON.stringify(body(r2)));
  assert.strictEqual(body(r2).draft.amount_source, 'model_reading');
  assert.ok(body(r2).warnings.some((x) => /AI assistant/.test(x)));
});

test('non-IDR invoice is refused before any write', async () => {
  const s = fakeServices();
  const r = await call(s, { invoice_text: 'Invoice No: US-9\nFrom: Acme Inc\nTotal: 1000', amount: 1000,
    counterparty: 'Acme Inc', currency: 'USD' });
  assert.ok(r.isError);
  assert.strictEqual(body(r).error, 'currency_not_supported');
  assert.strictEqual(writes(s).length, 0);
});

test('role and company isolation: auditor refused, foreign company refused', async () => {
  const s1 = fakeServices({ __role: 'auditor' });
  const r1 = await call(s1, { invoice_text: SAMPLE_INVOICE });
  assert.strictEqual(body(r1).error, 'forbidden_role');
  assert.strictEqual(writes(s1).length, 0);

  const s2 = fakeServices();
  const r2 = await call(s2, { invoice_text: SAMPLE_INVOICE, company_id: 'biz-other' });
  assert.strictEqual(body(r2).error, 'workspace_not_accessible');
  assert.strictEqual(writes(s2).length, 0);
});

test('exactly one source: both or neither is invalid', async () => {
  const s = fakeServices();
  assert.strictEqual(body(await call(s, {})).error, 'invalid_arguments');
  assert.strictEqual(body(await call(s, { invoice_text: SAMPLE_INVOICE, document_id: 'doc-1' })).error, 'invalid_arguments');
  assert.strictEqual(writes(s).length, 0);
});

test('duplicate payable and plan limit come back as clear errors', async () => {
  const dup = fakeServices({ createPendingPayableDraft: async () => ({ error: 'duplicate_payable',
    existing: { id: 'debt-0', counterparty: 'PT ABC Indonesia', amount: 18500000, approval_status: 'pending_approval' } }) });
  const r1 = await call(dup, { invoice_text: SAMPLE_INVOICE });
  assert.strictEqual(body(r1).error, 'duplicate_payable');
  assert.strictEqual(body(r1).existing.id, 'debt-0');

  const lim = fakeServices({ createPendingPayableDraft: async () => ({ error: 'plan_limit_reached', limit: 10, usage: 10 }) });
  const r2 = await call(lim, { invoice_text: SAMPLE_INVOICE });
  assert.strictEqual(body(r2).error, 'plan_limit_reached');
  assert.strictEqual(body(r2).upgrade_required, true);
});

test('stored document path uses the business-scoped document', async () => {
  const s = fakeServices();
  const r = await call(s, { document_id: 'doc-1' });
  assert.ok(!r.isError, JSON.stringify(body(r)));
  assert.strictEqual(writes(s)[0][3].raw_input_text, null);
  const r2 = await call(fakeServices(), { document_id: 'doc-of-other-company' });
  assert.strictEqual(body(r2).error, 'document_not_found');
});
