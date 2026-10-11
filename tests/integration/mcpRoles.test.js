// CFO Finance MCP — Batch R: what a manager / employee can do through the connector.
//
// Real MCP client (in-memory transport) against the real McpServer; real extraction,
// dates, intake orchestrator and settlement modules; fakes only for persistence and the
// company resolver. The contract pinned here:
//   * manager/employee can analyse an invoice and file it as a PENDING draft — as in the web
//     app and Telegram — but see a limited analysis: nothing derived from the company's books
//     (directory matches, package readiness, suggested record, duplicate details);
//   * a duplicate refusal tells them THAT a record exists, never which one;
//   * get_financial_summary stays finance-only; auditor stays read-only;
//   * a manager may analyse a stored document only if it is theirs (web visibility rule);
//   * the tool LIST follows the user's roles across companies; the per-call check still rules;
//   * owner/cfo responses are unchanged.

const { test } = require('node:test');
const assert = require('node:assert');

const ORCH = require('../../server/lib/documentIntakeOrchestrator');
const docExtract = require('../../server/lib/documentExtraction');
const docDates = require('../../server/lib/documentDates');
const SETTLE = require('../../server/lib/invoiceSettlement');
const CUR = require('../../server/lib/telegramCurrency');
const { buildServer } = require('../../server/mcp/server');

const ME = -7;
const COMPANIES = {
  'biz-a': { id: 'biz-a', name: 'Helm Care Indonesia', business_code: 'HF-BIZ-000002', base_currency: 'IDR', type: 'business' },
  'biz-b': { id: 'biz-b', name: 'Helm Care Pay', business_code: 'HF-BIZ-000004', base_currency: 'IDR', type: 'business' },
};

const SAMPLE_INVOICE = [
  'Invoice No: INV-2026-0012',
  'From: PT ABC Indonesia',
  'Bill to: PT Helm Care Indonesia',
  'Tanggal: 05-09-2026',
  'Jatuh Tempo: 05-10-2026',
  'Grand Total: 18.500.000',
].join('\n');

const readingOf = (text, readSource) => {
  const extraction = docExtract.extractFromText(text, { text_available: true });
  return { extraction, readSource, ocr: null,
    dates: docDates.extractDates(text, { document_type: extraction.document_type }), parties: null };
};
const previewOf = (fields = {}, tax = {}) => {
  const settlement = SETTLE.settlementOf({ invoice_total: fields.gross_amount, base_amount: fields.commercial_base_amount,
    tax_amount: tax.ppn_detected ? tax.ppn_amount : null, allocations: [] });
  const documents = { invoice: true };
  return { basis: 'preview_as_new_invoice', settlement, documents,
    closeout: SETTLE.closeoutState({ settlement, documents, has_tax: !!tax.ppn_detected }) };
};

// Role helpers copied from server/index.js (the MCP layer receives them injected).
const canViewBusinessFinance = (r) => ['owner', 'ceo', 'admin', 'cfo', 'accountant', 'auditor'].includes(r);
const canCreateFinancialRequest = (r) => ['owner', 'ceo', 'admin', 'cfo', 'accountant', 'manager', 'employee'].includes(r);
const canUploadDocument = (r) => canCreateFinancialRequest(r) && r !== 'auditor';
const canApproveFinancialRecord = (r) => ['owner', 'ceo', 'admin', 'cfo'].includes(r);

/**
 * @param roles  { 'biz-a': 'owner', 'biz-b': 'manager' } — the user's memberships
 * @param over   service overrides
 */
function fakeServices(roles, over = {}) {
  const calls = [];
  const log = (name, ...args) => calls.push([name, ...args]);
  const bizFor = (id) => ({ business: COMPANIES[id], role: roles[id], ownerUserId: -1 });
  const DOCS = {
    'doc-mine': { id: 'doc-mine', created_by_user_id: ME, document_type: null, extracted_json: {}, archived_at: null },
    'doc-other': { id: 'doc-other', created_by_user_id: -99, document_type: null, extracted_json: {}, archived_at: null },
  };
  return {
    calls,
    listAccessibleWorkspaces: async () => Object.entries(roles).map(([id, role]) => ({ role, businesses: COMPANIES[id] })),
    findDefaultBusiness: async () => ({ business: COMPANIES[Object.keys(roles)[0]] }),
    resolveBusinessReadOnly: async (req) => {
      const id = (req.body && req.body.business_id) || Object.keys(roles)[0];
      if (!roles[id]) throw new Error('workspace_not_accessible');
      return bizFor(id);
    },
    canViewBusinessFinance, canCreateFinancialRequest, canUploadDocument, canApproveFinancialRecord,
    hasDocumentsAccess: async () => true,
    canAccessDocument: async (biz, userId, doc) => canViewBusinessFinance(biz.role) || doc.created_by_user_id === userId,
    isSupportedTelegramCurrency: CUR.isSupportedTelegramCurrency,
    normalizeCurrency: CUR.normalizeCurrency,
    buildAiCfoContext: async () => { log('buildAiCfoContext'); return { cash: { total_balance: 1, wallets_count: 1 } }; },
    buildRequiredDocuments: async () => ({ items: [] }),
    loadDocumentScoped: async (b, id) => DOCS[id] || null,
    readDocumentForIntake: async () => readingOf(SAMPLE_INVOICE, 'embedded_text'),
    readTextForIntake: (text) => readingOf(text, 'client_model_text'),
    analyzeDocumentReading: async (b, doc, read) => ORCH.processDocument({
      document: doc, extraction: read.extraction, businessName: b.business.name,
      counterparties: [{ id: 'cp-secret', legal_name: 'PT ABC Indonesia', display_name: 'PT ABC Indonesia', aliases: [], bank_accounts: [] }],
      existingLinks: {}, taxRules: [], readSource: read.readSource,
    }),
    findDocumentDuplicate: async () => ({ duplicate: true, reference: 'INV-2026-0012', match: { id: 'doc-of-someone-else' } }),
    linkedInvoiceSettlement: async () => null,
    invoiceReadinessPreview: (f, tax) => previewOf(f, tax),
    createPendingPayableDraft: async (b, uid, draft) => {
      log('createPendingPayableDraft', b.business.id, uid, draft);
      return { debt: { id: 'debt-1', counterparty: draft.counterparty, amount: draft.amount, currency: draft.currency,
        due_date: draft.due_date, description: draft.description, approval_status: 'pending_approval' }, telegram_notified: 1 };
    },
    ...over,
  };
}

async function connect(services, { write = true } = {}) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const server = await buildServer({ mcpUser: { userId: ME, via: 'dev_token' }, services, writeToolsEnabled: write, webAppUrl: 'https://cfo.example' });
  const [c, sv] = InMemoryTransport.createLinkedPair();
  await server.connect(sv);
  const client = new Client({ name: 'mcp-roles-test', version: '0' });
  await client.connect(c);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
const body = (r) => JSON.parse(r.content[0].text);
const writes = (s) => s.calls.filter((c) => c[0] === 'createPendingPayableDraft');
async function call(services, name, args = {}) {
  const { client, close } = await connect(services);
  try { return await client.callTool({ name, arguments: args }); } finally { await close(); }
}
const LIMITED_KEYS_ABSENT = ['package_readiness', 'counterparty', 'suggested_record', 'duplicate', 'tax', 'blockers', 'next_actions'];

for (const role of ['manager', 'employee']) {
  test(`${role}: submit_invoice_draft files a PENDING request; the reply says it needs approval`, async () => {
    const s = fakeServices({ 'biz-a': role });
    const r = await call(s, 'submit_invoice_draft', { invoice_text: SAMPLE_INVOICE });
    assert.ok(!r.isError, JSON.stringify(body(r)));
    const out = body(r);
    assert.strictEqual(out.draft.approval_status, 'pending_approval');
    assert.strictEqual(out.submitted_as, 'request');
    assert.match(out.request_note, /owner, admin or CFO/);
    assert.strictEqual(writes(s).length, 1);
    assert.strictEqual(writes(s)[0][2], ME, 'the draft is attributed to the caller (creator notifications)');
    assert.ok(!('approval_status' in writes(s)[0][3]), 'the write carried an approval decision');
    // Warnings carry nothing from the company's records.
    assert.ok(!JSON.stringify(out.warnings).includes('cp-secret'));
    assert.ok(out.warnings.some((w) => /may already be recorded/.test(w)), 'generic duplicate line');
  });

  test(`${role}: analyze_invoice returns the invoice's own fields only`, async () => {
    const out = body(await call(fakeServices({ 'biz-a': role }), 'analyze_invoice', { invoice_text: SAMPLE_INVOICE }));
    assert.strictEqual(out.view, 'limited_for_role');
    assert.strictEqual(out.invoice.total, 18500000);
    assert.strictEqual(out.invoice.currency, 'IDR');
    assert.strictEqual(out.invoice.invoice_number, 'INV-2026-0012');
    for (const k of LIMITED_KEYS_ABSENT) assert.ok(!(k in out), `${k} leaked to ${role}`);
    const raw = JSON.stringify(out);
    assert.ok(!raw.includes('cp-secret') && !raw.includes('doc-of-someone-else'), raw);
  });
}

test('manager: get_financial_summary is refused and never touches the finance engine', async () => {
  // Manager everywhere: the tool is not even registered, so the call fails at the protocol.
  const s = fakeServices({ 'biz-a': 'manager' });
  const r = await call(s, 'get_financial_summary', {});
  assert.strictEqual(r.isError, true);
  assert.ok(!s.calls.some((c) => c[0] === 'buildAiCfoContext'));
  // Manager in a company while owner in another: listed, but refused in the manager's company.
  const s2 = fakeServices({ 'biz-a': 'owner', 'biz-b': 'manager' });
  assert.strictEqual(body(await call(s2, 'get_financial_summary', { company_id: 'biz-b' })).error, 'forbidden_role');
  assert.ok(!s2.calls.some((c) => c[0] === 'buildAiCfoContext'));
});

test('manager: a duplicate payable is reported without the existing record', async () => {
  const s = fakeServices({ 'biz-a': 'manager' }, { createPendingPayableDraft: async () => ({ error: 'duplicate_payable',
    existing: { id: 'debt-0', counterparty: 'PT ABC Indonesia', amount: 18500000, approval_status: 'approved' } }) });
  const out = body(await call(s, 'submit_invoice_draft', { invoice_text: SAMPLE_INVOICE }));
  assert.strictEqual(out.error, 'duplicate_payable');
  assert.ok(out.message);
  assert.deepStrictEqual(Object.keys(out).sort(), ['error', 'message']);
});

test('owner: a duplicate payable still carries the existing record (unchanged)', async () => {
  const s = fakeServices({ 'biz-a': 'owner' }, { createPendingPayableDraft: async () => ({ error: 'duplicate_payable',
    existing: { id: 'debt-0', counterparty: 'PT ABC Indonesia', amount: 18500000, approval_status: 'approved' } }) });
  const out = body(await call(s, 'submit_invoice_draft', { invoice_text: SAMPLE_INVOICE }));
  assert.strictEqual(out.existing.id, 'debt-0');
});

test('auditor: read-only — submit is refused, nothing written', async () => {
  const s = fakeServices({ 'biz-a': 'auditor' });
  assert.strictEqual((await call(s, 'submit_invoice_draft', { invoice_text: SAMPLE_INVOICE })).isError, true);
  // Auditor in B while owner in A: the tool is listed, the call in B is refused.
  const s2 = fakeServices({ 'biz-a': 'owner', 'biz-b': 'auditor' });
  const r = await call(s2, 'submit_invoice_draft', { invoice_text: SAMPLE_INVOICE, company_id: 'biz-b' });
  assert.strictEqual(body(r).error, 'forbidden_role');
  assert.strictEqual(writes(s).length + writes(s2).length, 0);
});

for (const role of ['owner', 'cfo']) {
  test(`${role}: full analysis and a plain draft (regression)`, async () => {
    const a = body(await call(fakeServices({ 'biz-a': role }), 'analyze_invoice', { invoice_text: SAMPLE_INVOICE }));
    assert.ok(a.package_readiness && a.counterparty && a.suggested_record && a.duplicate, JSON.stringify(Object.keys(a)));
    assert.strictEqual(a.view, undefined);
    const d = body(await call(fakeServices({ 'biz-a': role }), 'submit_invoice_draft', { invoice_text: SAMPLE_INVOICE }));
    assert.strictEqual(d.draft.approval_status, 'pending_approval');
    assert.strictEqual(d.submitted_as, undefined);
  });
}

test('tools/list follows the roles: a manager has no get_financial_summary, an owner has everything', async () => {
  const list = async (roles) => {
    const { client, close } = await connect(fakeServices(roles));
    try { return (await client.listTools()).tools.map((t) => t.name).sort(); } finally { await close(); }
  };
  const mgr = await list({ 'biz-a': 'manager' });
  assert.ok(!mgr.includes('get_financial_summary'), mgr.join());
  assert.ok(mgr.includes('analyze_invoice') && mgr.includes('submit_invoice_draft'));
  assert.deepStrictEqual(await list({ 'biz-a': 'owner' }),
    ['analyze_invoice', 'get_company_context', 'get_financial_summary', 'get_missing_documents', 'link_document',
      'list_documents', 'submit_invoice_draft', 'upload_document']);
  const aud = await list({ 'biz-a': 'auditor' });
  assert.ok(aud.includes('get_financial_summary') && !aud.includes('submit_invoice_draft'), aud.join());
});

test('owner in A and manager in B: full answers in A, limited in B; the list is the union', async () => {
  const roles = { 'biz-a': 'owner', 'biz-b': 'manager' };
  const inA = body(await call(fakeServices(roles), 'analyze_invoice', { invoice_text: SAMPLE_INVOICE, company_id: 'biz-a' }));
  const inB = body(await call(fakeServices(roles), 'analyze_invoice', { invoice_text: SAMPLE_INVOICE, company_id: 'biz-b' }));
  assert.ok(inA.package_readiness);
  assert.strictEqual(inB.view, 'limited_for_role');
  assert.ok(!('package_readiness' in inB));
  // Listed (owner in A) but refused where the role does not allow it.
  assert.strictEqual(body(await call(fakeServices(roles), 'get_financial_summary', { company_id: 'biz-b' })).error, 'forbidden_role');
});

test('a foreign company is refused and nothing is written', async () => {
  const s = fakeServices({ 'biz-a': 'manager' });
  const r = await call(s, 'submit_invoice_draft', { invoice_text: SAMPLE_INVOICE, company_id: 'biz-zzz' });
  assert.strictEqual(body(r).error, 'workspace_not_accessible');
  assert.strictEqual(writes(s).length, 0);
});

test('manager: a stored document is readable only if it is theirs (web visibility rule)', async () => {
  const s = fakeServices({ 'biz-a': 'manager' });
  assert.strictEqual(body(await call(s, 'analyze_invoice', { document_id: 'doc-other' })).error, 'document_not_found');
  assert.strictEqual(body(await call(s, 'submit_invoice_draft', { document_id: 'doc-other' })).error, 'document_not_found');
  assert.strictEqual(writes(s).length, 0);
  const own = body(await call(s, 'analyze_invoice', { document_id: 'doc-mine' }));
  assert.strictEqual(own.view, 'limited_for_role');
  // Fails closed when the visibility service is missing.
  const noSvc = fakeServices({ 'biz-a': 'manager' }, { canAccessDocument: undefined });
  assert.strictEqual(body(await call(noSvc, 'analyze_invoice', { document_id: 'doc-mine' })).error, 'document_not_found');
  // Owners are not affected.
  assert.ok(!body(await call(fakeServices({ 'biz-a': 'owner' }), 'analyze_invoice', { document_id: 'doc-other' })).error);
});
