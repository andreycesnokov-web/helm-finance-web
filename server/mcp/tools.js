// CFO Finance MCP — Phase-1 tools (READ-ONLY).
//
// Every handler is a thin adapter over an existing CFO Finance service, injected from
// server/index.js (ctx.services). The MCP layer contains NO accounting logic: it resolves
// the company server-side, applies the SAME role/plan gates as the matching web route,
// calls the service, and selects fields for the response. Nothing here writes anything.
//
// Design rule (from the brief): expose BUSINESS capabilities, not database tables.
//
// Not exposed yet, on purpose:
//   - get_period_readiness — CFO Finance has no period-readiness engine (only per-invoice
//     closeout and the company document checklist). Building the month rollup here would be
//     a second accounting engine; it needs a CFO service first.

const { z } = require('zod');
const { ToolError, guarded, resolveCompany, companyRef } = require('./context');

const COMPANY_ID = z.string().min(1).max(64).optional()
  .describe('CFO company id from get_company_context. Omit to use the default company.');
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/* ── get_company_context ─────────────────────────────────────────────────── */
async function getCompanyContext(_args, ctx) {
  const userId = ctx.mcpUser.userId;
  const [memberships, def] = await Promise.all([
    ctx.services.listAccessibleWorkspaces(userId),
    ctx.services.findDefaultBusiness(userId),
  ]);
  const companies = (memberships || []).map((m) => {
    const b = m.businesses || {};
    const isPersonal = b.type === 'personal';
    return {
      company_id: b.id,
      name: b.name || null,
      business_code: b.business_code || null,
      kind: isPersonal ? 'personal_workspace' : 'company',
      role: m.role,
      // Personal workspaces are not available through the company tools.
      usable_with_tools: !isPersonal,
    };
  });
  return {
    companies,
    default_company_id: (def && def.business && def.business.id) || null,
    note: 'Pass company_id to other tools to choose a company. If omitted, the default company '
      + 'is used. Only companies listed here can be used; access is checked on every call.',
  };
}

/* ── get_financial_summary ───────────────────────────────────────────────── */
async function getFinancialSummary(args, ctx) {
  const biz = await resolveCompany(ctx, args.company_id);
  if (!ctx.services.canViewBusinessFinance(biz.role)) {
    throw new ToolError('forbidden_role', 'Your role in this company cannot view business finance.');
  }
  // The same engine as Pulse / AI CFO / Radar — one source of truth for these figures.
  const c = await ctx.services.buildAiCfoContext(ctx.mcpUser.userId, 'en', biz);
  const comp = c.compliance || {};
  return {
    company: companyRef(biz),
    as_of: new Date().toISOString(),
    period: 'current_month',
    base_currency: biz.business.base_currency || 'IDR',
    cash: c.cash ? { total_balance: c.cash.total_balance, business_wallets_count: c.cash.wallets_count } : null,
    current_month: c.current_month || null,
    runway_days: c.runway_days ?? null,
    receivables: c.receivables || null,
    payables: c.payables || null,
    // Unconfirmed submissions are NOT included in the totals above.
    pending_unconfirmed: c.pending_submissions ? {
      count: c.pending_submissions.count,
      receivables_total: c.pending_submissions.receivables_total,
      payables_total: c.pending_submissions.payables_total,
    } : null,
    risks: c.risks || [],
    cfo_score: c.cfo_score ?? null,
    compliance: {
      overdue_count: comp.overdue_count ?? 0,
      upcoming_7d: comp.upcoming_7d ?? null,
      upcoming_30d: comp.upcoming_30d ?? null,
      upcoming_90d: comp.upcoming_90d ?? null,
      owner_approval_pending: comp.owner_approval_pending ?? null,
      missing_profile_fields: comp.missing_profile_fields || [],
    },
    next_actions: c.next_actions || [],
    notes: ['Figures are computed by CFO Finance from confirmed records (same engine as Pulse and AI CFO). '
      + 'Do not recompute them.'],
  };
}

/* ── get_missing_documents ───────────────────────────────────────────────── */
async function getMissingDocuments(args, ctx) {
  const biz = await resolveCompany(ctx, args.company_id);
  const s = ctx.services;
  if (!s.canViewBusinessFinance(biz.role) && !s.canUploadDocument(biz.role)) {
    throw new ToolError('forbidden_role', 'Your role in this company cannot view documents.');
  }
  if (!await s.hasDocumentsAccess(biz)) {
    throw new ToolError('document_center_not_enabled',
      'Document Center is not enabled for this company.', { upgrade_required: true });
  }
  // Same checklist as the web app's required-documents view, same visibility filtering.
  const r = await s.buildRequiredDocuments(biz, ctx.mcpUser.userId);
  return { company: companyRef(biz), ...r };
}

/* ── analyze_invoice ─────────────────────────────────────────────────────── */
async function analyzeInvoice(args, ctx) {
  const hasDoc = !!args.document_id;
  const hasText = typeof args.invoice_text === 'string' && args.invoice_text.trim().length > 0;
  if (hasDoc === hasText) {
    throw new ToolError('invalid_arguments', 'Provide exactly one of document_id or invoice_text.');
  }
  const s = ctx.services;
  const biz = await resolveCompany(ctx, args.company_id);
  // Same gates as the web app's zero-write extraction (/api/documents/:id/extract).
  if (!s.canViewBusinessFinance(biz.role)) {
    throw new ToolError('forbidden_role', 'Your role in this company cannot view business finance.');
  }
  if (!await s.hasDocumentsAccess(biz)) {
    throw new ToolError('document_center_not_enabled',
      'Document Center is not enabled for this company.', { upgrade_required: true });
  }

  let doc;
  let read;
  if (hasDoc) {
    // Business-scoped load: a document from another company is simply not found.
    doc = await s.loadDocumentScoped(biz, String(args.document_id));
    if (!doc) throw new ToolError('document_not_found', 'No such document in this company.');
    if (doc.archived_at) throw new ToolError('document_archived', 'That document has been archived.');
    read = await s.readDocumentForIntake(biz, doc);
    if (read.error) throw new ToolError(read.error, 'The document file could not be read.');
  } else {
    // Text the AI client read itself. Marked as a model reading so tax figures get the
    // same caution as OCR/Vision (see documentIntakeOrchestrator.assessTax).
    doc = { id: null, document_type: null, extracted_json: {} };
    read = s.readTextForIntake(args.invoice_text);
  }

  const intake = await s.analyzeDocumentReading(biz, doc, read);
  const ex = read.extraction || {};
  const f = ex.fields || {};
  const duplicate = await s.findDocumentDuplicate(biz, doc.id, f);

  // Package readiness from the CFO settlement/closeout engine: the REAL state when the
  // document is already attached to an invoice record, otherwise a preview of the invoice
  // as if it were entered now with nothing paid.
  const linked = doc.id ? await s.linkedInvoiceSettlement(biz, doc.id) : null;
  const readinessSrc = linked
    ? { basis: 'linked_invoice', invoice_id: linked.invoice.debt_id, settlement: linked.settlement,
        documents: linked.documents, closeout: linked.closeout }
    : s.invoiceReadinessPreview(f, intake.tax || {});
  const close = readinessSrc.closeout || {};
  const checklist = close.checklist || [];
  const required = checklist.filter((d) => d.required);

  const dates = read.dates || {};
  const dateOf = (d) => (d && d.value ? { value: d.value, status: d.status } : { value: null, status: (d && d.status) || 'not_found' });

  return {
    company: companyRef(biz),
    source: hasDoc ? 'stored_document' : 'client_text',
    document_id: doc.id || null,
    written: false, // nothing was stored or changed
    intake_status: intake.status,
    document: intake.document,
    invoice: {
      supplier: f.issuer_name ?? null,
      buyer: f.buyer_name ?? null,
      supplier_npwp: f.issuer_npwp ?? null,
      buyer_npwp: f.buyer_npwp ?? null,
      invoice_number: f.document_number ?? null,
      tax_invoice_serial: f.tax_invoice_serial ?? null,
      invoice_date: dateOf(dates.document_date),
      due_date: dateOf(dates.due_date),
      currency: f.currency || (intake.financial_record && intake.financial_record.currency) || null,
      subtotal: f.commercial_base_amount ?? null,
      tax_amount_read: f.commercial_tax_amount ?? null,
      total: f.gross_amount ?? null,
      description: f.description ?? null,
    },
    extraction_confidence: ex.confidence || null,
    tax: intake.tax,
    counterparty: intake.counterparty,
    suggested_record: intake.financial_record,
    duplicate,
    package_readiness: {
      basis: readinessSrc.basis,
      invoice_id: readinessSrc.invoice_id || null,
      payment_status: (readinessSrc.settlement && readinessSrc.settlement.status) || null,
      state: close.state || null,
      can_close: !!close.can_close,
      required_documents_present: required.filter((d) => d.present).length,
      required_documents_total: required.length,
      checklist,
      missing_documents: close.missing_documents || [],
      blockers: close.blockers || [],
    },
    missing_fields: intake.missing_fields || [],
    blockers: intake.blockers || [],
    warnings: intake.warnings || [],
    next_actions: intake.next_actions || [],
    requires_confirmation: true,
  };
}

/* ── registry ────────────────────────────────────────────────────────────── */
function phase1Tools(ctx) {
  return [
    {
      name: 'get_company_context',
      config: {
        title: 'Get company context',
        description: 'List the CFO Finance companies the signed-in user belongs to, with their role and '
          + 'the default company. Call this FIRST to learn which company_id values are valid; never '
          + 'guess a company_id. Read-only.',
        inputSchema: {},
        annotations: { ...RO, title: 'Get company context' },
      },
      handler: guarded('get_company_context', ctx, getCompanyContext),
    },
    {
      name: 'get_financial_summary',
      config: {
        title: 'Get financial summary',
        description: 'Current financial position of one company, computed by CFO Finance: cash, this '
          + 'month\'s income/expenses/burn, runway, receivables, payables, risks, compliance pressure and '
          + 'recommended next actions. Current month only. Read-only. Do not recompute the figures.',
        inputSchema: { company_id: COMPANY_ID },
        annotations: { ...RO, title: 'Get financial summary' },
      },
      handler: guarded('get_financial_summary', ctx, getFinancialSummary),
    },
    {
      name: 'get_missing_documents',
      config: {
        title: 'Get missing documents',
        description: 'The company\'s required-documents checklist from CFO Finance: which accounting and '
          + 'tax documents apply to its profile and which are still missing. Read-only. Requires '
          + 'Document Center for the company.',
        inputSchema: { company_id: COMPANY_ID },
        annotations: { ...RO, title: 'Get missing documents' },
      },
      handler: guarded('get_missing_documents', ctx, getMissingDocuments),
    },
    {
      name: 'analyze_invoice',
      config: {
        title: 'Analyze an invoice',
        description: 'Run an invoice through the CFO Finance document pipeline and return what it says: '
          + 'supplier, buyer, invoice number, dates, currency, subtotal, tax, total; tax assessment; '
          + 'counterparty match; duplicate check; and package readiness (payment status, required '
          + 'documents present/missing, blockers). READ-ONLY — nothing is saved. Provide EXACTLY ONE of: '
          + 'document_id (a document already stored in CFO Finance) or invoice_text (the invoice text you '
          + 'read from the file). Text you supply is treated as a model reading, so tax figures need '
          + 'confirmation.',
        inputSchema: {
          company_id: COMPANY_ID,
          document_id: z.string().min(1).max(64).optional()
            .describe('Id of a document already stored in CFO Finance for this company'),
          invoice_text: z.string().max(20000).optional()
            .describe('Full text of the invoice as read from the file (keep labels, numbers and dates)'),
        },
        annotations: { ...RO, title: 'Analyze an invoice' },
      },
      handler: guarded('analyze_invoice', ctx, analyzeInvoice),
    },
  ];
}

module.exports = { phase1Tools };
