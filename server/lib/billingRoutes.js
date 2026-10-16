'use strict';
// Business + Platform/admin. Route policy for commercial_v2 companies: what each API request needs from the
// company's plan. First match wins. Every route registered by the server must match a rule here
// (tests/billingRouteCoverage.test.cjs fails otherwise), so a new endpoint cannot bypass billing.
//
//   open     — never gated by plan or by expiry: identity, account, billing, recovery, Personal, and
//              reading or exporting the company's OWN data (own-data reads stay available after expiry).
//   channel  — a channel with its own commercial gate (Telegram: telegramPaidGate refuses commercial_v2).
//   features — the plan must include every listed feature; [] = any active plan (core company settings).
//   resource — metered through rpc_billing_quota (reserve → commit on success / release on failure).
const ID = '[^/]+';
const OPEN = { open: true };
const CORE = { features: [] };
const need = (...features) => ({ features });
const meter = (features, resource, extra = {}) => ({ features, resource, ...extra });
const rule = (methods, path, policy) => ({ methods: methods === '*' ? null : methods.split(','), re: new RegExp('^/api' + path + '/?$'), policy });
const READ = 'GET,HEAD,OPTIONS';

// Units for metered requests (bounded; the quota RPC rejects anything outside 1..1000 via admission).
const rowsOf = (req) => { const b = req.body; const rows = Array.isArray(b) ? b : Array.isArray(b?.transactions) ? b.transactions : []; return Math.max(1, rows.length) };
const mib = (req) => Math.max(1, Math.ceil(Number(req.body?.file_size || 0) / 1048576));

const ROUTES = [
  // ── Always open: identity, account, onboarding, invitations, company creation, billing, admin, recovery ──
  rule('*', '/(?:auth|me|account|support|onboarding|invite|invites|businesses|business-creation|billing|admin|mcp-oauth|bot)(?:/.*)?', OPEN),
  rule('*', '/personal(?:/.*)?', OPEN),                       // Personal workspace has no commercial plan
  rule('*', '/financial-operations(?:/.*)?', OPEN),           // recovery receipts of submitted operations
  rule('*', '/telegram(?:/.*)?', { channel: 'telegram' }),
  rule('POST', '/debts/from-telegram', { channel: 'telegram' }),
  rule('POST', `/documents/${ID}/signed-url`, OPEN),          // download of own documents
  rule('POST', `/wallets/${ID}/reanchor-opening`, OPEN),      // D4 repair of the company's own history
  rule('POST', `/bank-imports/${ID}/reanchor-preview`, OPEN), // read-only preview

  // ── Gated reads: AI and advanced computation (not the client's own records) ──
  rule(READ, '/ai-cfo/context', need('cfo_ai')),
  rule(READ, '/ai-accountant/(?:document-intake|required-documents)', need('ai_accountant')),
  rule(READ, '/pulse/advanced-insights', need('radar')),
  rule(READ, '/accountant/(?:tax-knowledge/cards|rules|sources|applicability)', need('tax_compliance')),
  // ── Own data and basic views: always readable (incl. tax obligations, deadlines, history, export package) ──
  rule(READ, '/(?:health|access/status|profile|pulse|transactions|wallets|debts|documents|bank-import|bank-imports|cashflow-categories|classification-rules|counterparties|pnl-mapping|reminders|assets|business-funding|business|team|payroll|incoming-payments|payment-connections|invoices|decisions|withholding-slips|audit)(?:/.*)?', OPEN),
  rule(READ, '/accountant/(?:obligations|calendar|tax-calendar|summary|status|profile(?:/requests/[^/]+)?|operation-documents(?:/package)?)', OPEN),

  // ── Transactions ──
  rule('POST', '/transactions/batch', meter(['transactions'], 'transactions', { units: rowsOf })),
  rule('PATCH', `/transactions/${ID}`, need('transactions')),
  // ── Accounts ──
  rule('POST', '/wallets/transfer', meter(['accounts'], 'transactions')),
  rule('POST', `/wallets/${ID}/adjust-balance`, meter(['accounts'], 'transactions')),
  rule('POST', '/wallets(?:/backfill)?', need('accounts')),
  rule('PUT,DELETE', `/wallets/${ID}`, need('accounts')),
  // ── Invoices / bills (approvals need both) ──
  rule('POST', `/debts/${ID}/pay`, meter(['bills'], 'transactions')),
  rule('POST', `/decisions/debts/${ID}/payment`, meter(['bills'], 'transactions')),
  rule('PATCH,POST', `/debts/${ID}/(?:approve|reject)`, need('bills', 'approvals')),
  rule('POST', `/debts/${ID}/request-info`, need('bills', 'approvals')),
  rule('POST', '/debts', need('bills')),
  rule('PATCH', `/debts/${ID}(?:/checklist|/settle)?`, need('bills')),
  rule('POST', `/debts/${ID}/withholding`, need('bills')),
  rule('POST', `/invoices/${ID}/allocate`, need('bills')),
  // ── Bank statement import (parsing is metered as imports; confirmed rows as transactions) ──
  rule('POST', '/bank-import/read', meter(['import'], 'imports')),
  rule('POST', `/bank-imports?/(?:${ID}/)?(?:parse|upload|extract)`, meter(['import'], 'imports')),
  rule('POST', `/bank-imports/${ID}/confirm`, meter(['import'], 'transactions', { units: 'import_rows' })),
  rule('POST', `/bank-import/batches/${ID}/confirm`, meter(['import'], 'transactions', { units: 'import_rows' })),
  rule('POST,PATCH', '/bank-imports?/.+', need('import')),
  // ── Documents (upload counts documents and storage) ──
  rule('POST', '/documents/upload-init', meter(['documents'], 'documents', { phase: 'init', storage: mib })),
  rule('POST', '/documents/upload-complete', meter(['documents'], 'documents', { phase: 'complete' })),
  // Only routes that always call an LLM are metered as AI. extract may use Vision OCR (flag-gated, only for
  // documents without text) — gated by feature, not metered; see the enforcement report.
  rule('POST', `/documents/${ID}/identify`, meter(['documents', 'ai'], 'ai', { requireKey: true })),
  rule('POST', `/documents/${ID}/tax-obligation`, need('documents', 'tax_compliance')),
  rule('POST,PATCH,DELETE', '/documents(?:/.*)?', need('documents')),
  rule('POST', '/upload-link/session', need('documents')),
  // ── Payroll ──
  rule('POST', '/payroll/payments', meter(['payroll'], 'transactions')),
  rule('POST,PATCH,DELETE', '/payroll/.+', need('payroll')),
  // ── Team (other member management is core) ──
  rule('POST', '/team/invite', meter(['team'], 'users', { units: (req) => Number(req.body?.max_uses ?? 1) })),
  rule('*', '/team(?:/.*)?', CORE),
  // ── CFO AI / AI Accountant (each call is one AI request; replay with the same key is free) ──
  rule('POST', '/ai-cfo/ask', meter(['cfo_ai', 'ai'], 'ai', { requireKey: true })),
  rule('POST', '/accountant/ask', meter(['ai_accountant', 'ai'], 'ai', { requireKey: true })),
  rule('POST', '/accountant/profile/from-documents', meter(['ai_accountant', 'ai'], 'ai')),
  rule('POST', '/ai-accountant/documents/(?:classify|[^/]+/reclassify)', need('ai_accountant')), // rule-based intake, no LLM
  rule('PATCH', `/ai-accountant/documents/${ID}/classification`, need('ai_accountant')),
  rule('POST', '/parse', meter(['ai'], 'ai')),
  // ── Tax & compliance: calculations, automation, verification; reporting preparation = accounting export ──
  rule('POST', '/tax-split/(?:suggest|review)', need('tax_compliance')),
  rule('POST', '/accountant/(?:calendar/remind|telegram/test|profile/verify)', need('tax_compliance')),
  rule('POST', '/accountant/operation-documents/action', need('accounting_export')),
  rule('PUT', '/accountant/profile', CORE),
  // ── Integrations (payment providers and incoming payments) ──
  rule('POST', '/payment-connections', meter(['integrations'], 'integrations')),
  rule('POST,PATCH,DELETE', '/payment-connections/.+', need('integrations')),
  rule('POST,PATCH', '/incoming-payments(?:/.*)?', need('integrations')),
  // ── Core company settings and registers: any active plan ──
  rule('POST,PATCH,DELETE', '/(?:business|cashflow-categories|classification-rules|counterparties|pnl-mapping|reminders|assets|business-funding)(?:/.*)?', CORE),
  rule('POST', '/(?:profile)', CORE),
  rule('DELETE', '/user/reset-data', CORE),
];

function classify(method, path) {
  const m = String(method || 'GET').toUpperCase();
  for (const r of ROUTES) if ((!r.methods || r.methods.includes(m)) && r.re.test(path)) return { ...r.policy, classified: true };
  // Unlisted: reads stay open (own data is never blocked); writes need an active plan. The coverage test
  // makes sure no registered route lands here.
  return READ.split(',').includes(m) ? { open: true, classified: false } : { features: [], classified: false };
}

// MCP / external API: every tool needs the 'api' feature plus the feature of what it touches.
const MCP_TOOLS = {
  get_company_context: [], get_financial_summary: [], list_documents: ['documents'], get_missing_documents: ['documents'],
  analyze_invoice: ['ai'], submit_invoice_draft: ['bills'], upload_document: ['documents'], link_document: ['documents'],
};
const MCP_METERED = { analyze_invoice: 'ai' };

module.exports = { ROUTES, classify, MCP_TOOLS, MCP_METERED, rowsOf, mib };
