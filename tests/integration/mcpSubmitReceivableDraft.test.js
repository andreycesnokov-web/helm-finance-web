// CFO Finance MCP — submit_receivable_draft ("a client owes us").
//
// Same harness as mcpSubmitInvoiceDraft: a REAL MCP client against the real McpServer, the
// real CFO extraction/orchestrator modules, and a recording fake for persistence
// (createPendingDebtDraft). The safety contract:
//   1. the tool only exists with write tools on (and, for OAuth, the cfo:drafts grant — see
//      mcpOAuth.test.js);
//   2. it always writes a RECEIVABLE draft and never carries an approval decision;
//   3. from the user's words it needs customer + amount; from an issued invoice CFO's reading
//      wins and a conflicting amount is refused;
//   4. an invoice billed TO this company is refused as "looks like a payable";
//   5. non-IDR, forbidden role and foreign company are refused before any write.

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

// An invoice Helm Care Pay ISSUED to a client.
const ISSUED_INVOICE = [
  'Invoice No: HCP-2026-0107',
  'From: PT Helm Care Pay',
  'Bill to: PT Klien Maju Sejahtera',
  'Tanggal: 01-10-2026',
  'Jatuh Tempo: 31-10-2026',
  'Grand Total: 12.000.000',
].join('\n');

// A bill Helm Care Pay RECEIVED (must not become a receivable).
const RECEIVED_BILL = [
  'Invoice No: INV-2026-0012',
  'From: PT ABC Indonesia',
  'Bill to: PT Helm Care Pay',
  'Tanggal: 05-09-2026',
  'Jatuh Tempo: 05-10-2026',
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
    readDocumentForIntake: async () => readingOf(ISSUED_INVOICE, 'embedded_text'),
    readTextForIntake: (text) => readingOf(text, 'client_model_text'),
    analyzeDocumentReading: async (b, doc, read) => ORCH.processDocument({
      document: doc, extraction: read.extraction, businessName: b.business.name,
      counterparties: [], existingLinks: {}, taxRules: [], readSource: read.readSource,
    }),
    findDocumentDuplicate: async () => ({ duplicate: false }),
    linkedInvoiceSettlement: async () => null,
    invoiceReadinessPreview: (f, tax) => previewOf(f, tax),
    createPendingDebtDraft: async (b, uid, draft, type) => {
      log('createPendingDebtDraft', b.business.id, uid, draft, type);
      return { debt: { id: 'debt-9', counterparty: draft.counterparty, amount: draft.amount,
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
  const client = new Client({ name: 'mcp-recv-test', version: '0' });
  await client.connect(c);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
const body = (r) => JSON.parse(r.content[0].text);
const writes = (s) => s.calls.filter((c) => c[0] === 'createPendingDebtDraft');
async function call(services, args, { enabled = true } = {}) {
  const { client, close } = await connect({ mcpUser: { userId: OWNER }, services, writeToolsEnabled: enabled,
    webAppUrl: 'https://cfo.example' });
  try { return await client.callTool({ name: 'submit_receivable_draft', arguments: args }); } finally { await close(); }
}

test('flag OFF: submit_receivable_draft is not registered', async () => {
  const { client, close } = await connect({ mcpUser: { userId: OWNER }, services: fakeServices() });
  try {
    assert.ok(!(await client.listTools()).tools.some((t) => t.name === 'submit_receivable_draft'));
  } finally { await close(); }
});

test('flag ON: listed as a non-read-only, non-destructive write; an OAuth read-only grant does not see it', async () => {
  const on = await connect({ mcpUser: { userId: OWNER }, services: fakeServices(), writeToolsEnabled: true });
  try {
    const t = (await on.client.listTools()).tools.find((x) => x.name === 'submit_receivable_draft');
    assert.ok(t);
    assert.strictEqual(t.annotations.readOnlyHint, false);
    assert.strictEqual(t.annotations.destructiveHint, false);
  } finally { await on.close(); }
  const ro = await connect({ mcpUser: { userId: OWNER, via: 'oauth', scopes: ['cfo:read'] }, services: fakeServices(), writeToolsEnabled: true });
  try {
    const names = (await ro.client.listTools()).tools.map((x) => x.name);
    assert.ok(!names.includes('submit_receivable_draft') && !names.includes('submit_invoice_draft'));
  } finally { await ro.close(); }
});

test('from the user\'s words: a pending RECEIVABLE draft with the stated customer, amount and due date', async () => {
  const s = fakeServices();
  const r = await call(s, { customer: 'PT Klien Maju', amount: 7500000, due_date: '2026-10-31', invoice_number: 'HCP-77' });
  assert.ok(!r.isError, JSON.stringify(body(r)));
  const out = body(r);
  assert.strictEqual(out.written, true);
  assert.strictEqual(out.draft.type, 'receivable');
  assert.strictEqual(out.draft.approval_status, 'pending_approval');
  assert.strictEqual(out.counts_in_receivables, false);
  assert.strictEqual(out.draft.amount_source, 'user_statement');
  assert.strictEqual(out.confirm_in_app_url, 'https://cfo.example/receivables');
  assert.ok(out.warnings.some((x) => /without an invoice document/.test(x)));
  const [w] = writes(s);
  assert.strictEqual(w[1], 'biz-a');
  assert.strictEqual(w[2], OWNER);
  assert.strictEqual(w[4], 'receivable');
  assert.strictEqual(w[3].counterparty, 'PT Klien Maju');
  assert.strictEqual(w[3].amount, 7500000);
  assert.strictEqual(w[3].currency, 'IDR');
  assert.strictEqual(w[3].due_date, '2026-10-31');
  assert.strictEqual(w[3].description, 'Invoice HCP-77');
  assert.ok(!('approval_status' in w[3]), 'the write carried an approval decision');
});

test('from the user\'s words: customer and amount are required — nothing written without them', async () => {
  const s = fakeServices();
  assert.strictEqual(body(await call(s, { customer: 'PT Klien Maju' })).error, 'amount_missing');
  assert.strictEqual(body(await call(s, { amount: 1000000 })).error, 'customer_missing');
  assert.strictEqual((await call(s, { customer: 'X', amount: 1, due_date: '31-10-2026' })).isError, true);
  assert.strictEqual(writes(s).length, 0);
});

test('from an issued invoice: CFO reads client, total and due date; a conflicting amount is refused', async () => {
  const s = fakeServices();
  const r = await call(s, { invoice_text: ISSUED_INVOICE });
  assert.ok(!r.isError, JSON.stringify(body(r)));
  const out = body(r);
  assert.strictEqual(out.draft.amount, 12000000);
  assert.strictEqual(out.draft.amount_source, 'cfo_extraction');
  assert.strictEqual(out.draft.invoice_number, 'HCP-2026-0107');
  assert.match(writes(s)[0][3].counterparty, /Klien Maju/);

  const s2 = fakeServices();
  const bad = await call(s2, { invoice_text: ISSUED_INVOICE, amount: 1200000 });
  assert.strictEqual(body(bad).error, 'amount_mismatch');
  assert.strictEqual(writes(s2).length, 0);
});

test('an invoice billed TO this company is refused as a payable — nothing written', async () => {
  const s = fakeServices();
  const r = await call(s, { invoice_text: RECEIVED_BILL });
  assert.ok(r.isError);
  assert.strictEqual(body(r).error, 'looks_like_payable');
  assert.strictEqual(writes(s).length, 0);
});

test('non-IDR is refused before any write', async () => {
  const s = fakeServices();
  const r = await call(s, { customer: 'Acme Inc', amount: 1000, currency: 'USD' });
  assert.strictEqual(body(r).error, 'currency_not_supported');
  assert.strictEqual(writes(s).length, 0);
});

test('role and company isolation: auditor refused, foreign company refused', async () => {
  const s1 = fakeServices({ __role: 'auditor' });
  assert.strictEqual(body(await call(s1, { customer: 'A', amount: 5 })).error, 'forbidden_role');
  const s2 = fakeServices();
  assert.strictEqual(body(await call(s2, { customer: 'A', amount: 5, company_id: 'biz-other' })).error, 'workspace_not_accessible');
  assert.strictEqual(writes(s1).length + writes(s2).length, 0);
});

test('both invoice sources at once is invalid; duplicate and plan limit come back as clear errors', async () => {
  const s = fakeServices();
  assert.strictEqual(body(await call(s, { invoice_text: ISSUED_INVOICE, document_id: 'doc-1' })).error, 'invalid_arguments');
  assert.strictEqual(writes(s).length, 0);

  const dup = fakeServices({ createPendingDebtDraft: async () => ({ error: 'duplicate_receivable',
    existing: { id: 'debt-0', counterparty: 'PT Klien Maju', amount: 7500000, approval_status: 'approved' } }) });
  const r1 = await call(dup, { customer: 'PT Klien Maju', amount: 7500000 });
  assert.strictEqual(body(r1).error, 'duplicate_receivable');
  assert.strictEqual(body(r1).existing.id, 'debt-0');

  const lim = fakeServices({ createPendingDebtDraft: async () => ({ error: 'plan_limit_reached', limit: 10, usage: 10 }) });
  assert.strictEqual(body(await call(lim, { customer: 'A', amount: 5 })).error, 'plan_limit_reached');
});
