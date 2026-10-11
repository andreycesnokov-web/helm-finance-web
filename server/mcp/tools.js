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
const { ToolError, guarded, resolveCompany, companyRef, memberships } = require('./context');

const COMPANY_ID = z.string().min(1).max(64).optional()
  .describe('CFO company id from get_company_context. Omit to use the default company.');
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/* ── get_company_context ─────────────────────────────────────────────────── */
async function getCompanyContext(_args, ctx) {
  const userId = ctx.mcpUser.userId;
  const [rows, def] = await Promise.all([
    memberships(ctx),
    ctx.services.findDefaultBusiness(userId),
  ]);
  const companies = (rows || []).map((m) => {
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
function invoiceSource(args) {
  const hasDoc = !!args.document_id;
  const hasText = typeof args.invoice_text === 'string' && args.invoice_text.trim().length > 0;
  if (hasDoc === hasText) {
    throw new ToolError('invalid_arguments', 'Provide exactly one of document_id or invoice_text.');
  }
  return { hasDoc, hasText };
}

// Two levels of access to an invoice, mirroring the web app:
//   * FULL — roles that can view business finance (owner/ceo/admin/cfo/accountant/auditor):
//     the whole analysis, including what CFO derives from the company's OTHER records
//     (counterparty directory matches, package readiness, other documents).
//   * SUBMIT-ONLY — roles that may only file requests (manager/employee): they can read the
//     invoice they hold and file it as a draft, exactly as in the web app and Telegram, but
//     see nothing derived from the company's books.
const fullView = (biz, s) => s.canViewBusinessFinance(biz.role);
const canSubmitRequests = (biz, s) => s.canCreateFinancialRequest(biz.role) && s.canUploadDocument(biz.role);

async function requireDocumentsAccess(biz, s) {
  if (!await s.hasDocumentsAccess(biz)) {
    throw new ToolError('document_center_not_enabled',
      'Document Center is not enabled for this company.', { upgrade_required: true });
  }
}

async function requireInvoiceGates(biz, s) {
  if (!fullView(biz, s) && !canSubmitRequests(biz, s)) {
    throw new ToolError('forbidden_role', 'Your role in this company cannot read invoices.');
  }
  await requireDocumentsAccess(biz, s);
}

// What a submit-only role sees: the invoice's own fields and the extraction's own warnings.
// Warnings from the counterparty matcher can name directory entries, and the duplicate check
// can point at another user's document, so both are reduced to a generic line.
const GENERIC_DUPLICATE = 'This invoice may already be recorded in CFO AI. Your approver will check before approving.';
function restrictedAnalysis(a) {
  const warnings = [...(a.extractionWarnings || [])];
  if (a.duplicate && a.duplicate.duplicate) warnings.push(GENERIC_DUPLICATE);
  return {
    company: a.company,
    source: a.source,
    document_id: a.document_id,
    written: false,
    view: 'limited_for_role',
    document: a.document ? { type: a.document.type || null, direction: a.document.direction || null } : null,
    invoice: a.invoice,
    extraction_confidence: a.extraction_confidence,
    missing_fields: a.missing_fields,
    warnings,
    requires_confirmation: true,
    note: 'Limited view for your role: the invoice\'s own fields only. You can file it as a draft '
      + 'for approval with submit_invoice_draft.',
  };
}

async function analyzeInvoice(args, ctx) {
  invoiceSource(args);
  const biz = await resolveCompany(ctx, args.company_id);
  await requireInvoiceGates(biz, ctx.services);
  const a = await runInvoiceAnalysis(args, ctx, biz);
  return fullView(biz, ctx.services) ? a : restrictedAnalysis(a);
}

// The CFO reading of an invoice. Shared by analyze_invoice (read-only) and
// submit_invoice_draft, so a draft is built from exactly the analysis the user saw.
async function runInvoiceAnalysis(args, ctx, biz) {
  const { hasDoc } = invoiceSource(args);
  const s = ctx.services;
  let doc;
  let read;
  if (hasDoc) {
    // Business-scoped load: a document from another company is simply not found.
    doc = await s.loadDocumentScoped(biz, String(args.document_id));
    if (!doc) throw new ToolError('document_not_found', 'No such document in this company.');
    if (doc.archived_at) throw new ToolError('document_archived', 'That document has been archived.');
    // Business scoping alone is not the web rule: a manager/employee may only open their own
    // uploads or documents linked to their own requests. Anything else is "not found" — and
    // the check fails closed if the visibility service is not wired.
    if (!fullView(biz, s)
      && !(s.canAccessDocument && await s.canAccessDocument(biz, ctx.mcpUser.userId, doc))) {
      throw new ToolError('document_not_found', 'No such document in this company.');
    }
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

  const result = {
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
  // The extraction's own warnings — about this document only, nothing from the company's
  // records. Non-enumerable, so it is never serialised into a full response; the limited
  // view for submit-only roles is built from it.
  Object.defineProperty(result, 'extractionWarnings', { value: [...(ex.warnings || [])], enumerable: false });
  return result;
}

/* ── submit_invoice_draft (WRITE — pending draft only) ───────────────────── */
// The ONE write the connector can make: a payable DRAFT built from the CFO reading of an
// invoice. It never creates a confirmed record (approval_status is always
// 'pending_approval', whatever the caller's role), never moves cash and never pays anything.
// Until a human approves it in CFO AI (Payables, or the Telegram Approve button) it is
// excluded from cash, payables, runway and Radar.
//
// "The model proposes, CFO disposes": amount, supplier, currency and due date come from the
// CFO extraction pipeline. Values the model supplies only fill gaps CFO could not read, and a
// model amount that disagrees with CFO's reading is refused rather than silently chosen.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pickAmount(cfoTotal, proposed) {
  const cfo = cfoTotal == null || cfoTotal === '' ? null : Number(cfoTotal);
  const model = proposed == null ? null : Number(proposed);
  if (cfo != null && Number.isFinite(cfo) && cfo > 0) {
    if (model != null && Number.isFinite(model)) {
      const tolerance = Math.max(1, cfo * 0.005);
      if (Math.abs(cfo - model) > tolerance) {
        throw new ToolError('amount_mismatch',
          'The amount you supplied does not match the total CFO read from the invoice. '
          + 'Check the invoice with the user and resend with the correct amount, or omit amount.',
          { cfo_total: cfo, supplied_amount: model });
      }
    }
    return { amount: cfo, amount_source: 'cfo_extraction' };
  }
  if (model != null && Number.isFinite(model) && model > 0) {
    return { amount: model, amount_source: 'model_reading' };
  }
  throw new ToolError('amount_unreadable',
    'CFO could not read the invoice total. Ask the user for the total and pass it as amount.');
}

async function submitInvoiceDraft(args, ctx) {
  invoiceSource(args);
  const s = ctx.services;
  const biz = await resolveCompany(ctx, args.company_id);
  // The same gate as filing a request in the web app or Telegram: anyone who may create a
  // financial request and upload a document. Viewing the company's finances is NOT required —
  // a manager/employee files drafts too; they just see less (see restrictedAnalysis).
  if (!canSubmitRequests(biz, s)) {
    throw new ToolError('forbidden_role', 'Your role in this company cannot submit payables.');
  }
  await requireDocumentsAccess(biz, s);
  const full = fullView(biz, s);
  // Approver roles approve; everyone else's draft is a REQUEST (e.g. a reimbursement).
  const isRequest = s.canApproveFinancialRecord ? !s.canApproveFinancialRecord(biz.role)
    : !['owner', 'ceo', 'admin', 'cfo'].includes(biz.role);

  const analysis = await runInvoiceAnalysis(args, ctx, biz);
  const inv = analysis.invoice;

  const { amount, amount_source } = pickAmount(inv.total, args.amount);

  const counterparty = String(inv.supplier || args.counterparty || '').trim();
  if (!counterparty) {
    throw new ToolError('counterparty_missing',
      'CFO could not read the supplier. Ask the user who issued the invoice and pass it as counterparty.');
  }

  // Same rule as the Telegram channel: payables downstream are IDR-only until FX lands.
  // Never reinterpret an amount across currencies. CFO may default to IDR when the text names
  // no currency, so EVERY source is checked: if the model read USD, that is not overridden.
  const seen = [inv.currency, args.currency].filter(Boolean).map((c) => s.normalizeCurrency(c));
  const unsupported = seen.find((c) => !s.isSupportedTelegramCurrency(c));
  if (unsupported) {
    throw new ToolError('currency_not_supported',
      `Payable drafts currently support IDR only; this invoice is in ${unsupported}.`, { currency: unsupported });
  }
  const currency = seen[0] || s.normalizeCurrency(biz.business.base_currency || 'IDR');
  if (!s.isSupportedTelegramCurrency(currency)) {
    throw new ToolError('currency_not_supported',
      `Payable drafts currently support IDR only; this company's base currency is ${currency}.`, { currency });
  }

  const dueDate = (inv.due_date && inv.due_date.value) || args.due_date || null;
  if (dueDate && !DATE_RE.test(String(dueDate))) {
    throw new ToolError('invalid_due_date', 'due_date must be YYYY-MM-DD.');
  }

  const descParts = [];
  if (inv.invoice_number) descParts.push(`Invoice ${inv.invoice_number}`);
  if (inv.description || args.description) descParts.push(String(inv.description || args.description).slice(0, 200));

  const conf = analysis.extraction_confidence;
  const r = await s.createPendingPayableDraft(biz, ctx.mcpUser.userId, {
    counterparty: counterparty.slice(0, 200),
    amount,
    amount_source,
    currency,
    due_date: dueDate,
    description: descParts.join(' — ') || null,
    invoice_number: inv.invoice_number || null,
    raw_input_text: args.invoice_text ? String(args.invoice_text).slice(0, 4000) : null,
    confidence_score: conf === 'high' ? 0.9 : conf === 'medium' ? 0.6 : conf ? 0.3 : null,
  });

  if (r.error === 'duplicate_payable') {
    // A submit-only role learns THAT it exists, never its id, amount or counterparty — those
    // are another record of the company's books.
    if (!full) {
      throw new ToolError('duplicate_payable',
        'A matching open payable already exists in this company, so no draft was created. '
        + 'Ask your approver if you think this invoice is new.');
    }
    throw new ToolError('duplicate_payable',
      'An open payable for this supplier and amount already exists in this company. No draft was created.',
      { existing: r.existing });
  }
  if (r.error === 'plan_limit_reached') {
    throw new ToolError('plan_limit_reached',
      'The company has reached its monthly invoice limit on its current plan. No draft was created.',
      { upgrade_required: true, limit: r.limit, usage: r.usage });
  }
  if (r.error) throw new ToolError('draft_not_created', 'CFO Finance could not create the draft.');

  const d = r.debt;
  // A stored document the draft was built from is attached to it, so the draft and its
  // evidence travel together (the invoice "folder"). Best effort: the draft stands either way.
  let documentLinked = null;
  if (analysis.document_id && s.linkDocument) {
    try {
      const lr = await s.linkDocument(biz, { id: analysis.document_id }, 'debt', d.id, ctx.mcpUser.userId);
      documentLinked = lr && lr.ok ? { ok: true, document_id: analysis.document_id }
        : { ok: false, document_id: analysis.document_id, error: (lr && lr.error) || 'link_failed' };
    } catch {
      documentLinked = { ok: false, document_id: analysis.document_id, error: 'link_failed' };
    }
  }
  const warnings = full ? [...(analysis.warnings || [])] : [...(analysis.extractionWarnings || [])];
  if (analysis.duplicate && analysis.duplicate.duplicate) {
    warnings.push(full
      ? 'A document with the same invoice number is already stored in CFO Finance — check before approving.'
      : GENERIC_DUPLICATE);
  }
  if (amount_source === 'model_reading') {
    warnings.push('The amount was read by the AI assistant, not by CFO. Verify it before approving.');
  }

  return {
    company: companyRef(biz),
    written: true,
    ...(isRequest ? {
      submitted_as: 'request',
      request_note: 'This is your request (for example a reimbursement). An owner, admin or CFO of the '
        + 'company must approve it in CFO AI; you will be notified when it is approved or rejected.',
    } : {}),
    draft: {
      id: d.id,
      type: 'payable',
      approval_status: 'pending_approval',
      counterparty: d.counterparty,
      amount: Number(d.amount),
      amount_source,
      currency: d.currency,
      due_date: d.due_date || null,
      invoice_number: inv.invoice_number || null,
      description: d.description || null,
    },
    confirm_in_app_url: ctx.webAppUrl ? `${ctx.webAppUrl}/payables` : null,
    telegram_approval_sent: (r.telegram_notified || 0) > 0,
    counts_in_cash_flow: false,
    document_attached: documentLinked,
    warnings,
    next_step: 'The draft is waiting for approval in CFO AI. It does not affect cash, payables or '
      + 'runway until an owner/admin approves it (Payables screen or the Telegram Approve button). '
      + 'Nothing has been paid.',
  };
}

/* ── documents (Phase 2 · B) ─────────────────────────────────────────────── */
// Thin adapters over the Document Center's own functions (listDocumentsForUser,
// storeDocumentBytes, linkDocument, signedDocumentUrl in server/index.js). Same role, plan and
// visibility rules as the web app. Responses carry structured metadata only — never document
// text, storage paths, hashes or uploader ids.
const DOCUMENT_TYPES = ['vendor_invoice', 'customer_invoice', 'tax_invoice', 'bukti_potong',
  'tax_billing', 'payment_proof', 'filing_confirmation', 'bank_document', 'other'];
const LINK_TYPES = ['payable', 'receivable', 'transaction'];
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
// The JSON body limit is 10 MB, and base64 is 4/3 of the bytes. Bigger files use the link.
const MAX_INLINE_BYTES = 7 * 1024 * 1024;

async function requireDocumentsView(biz, s) {
  if (!s.canViewBusinessFinance(biz.role) && !s.canUploadDocument(biz.role)) {
    throw new ToolError('forbidden_role', 'Your role in this company cannot view documents.');
  }
  await requireDocumentsAccess(biz, s);
}

// One document as the connector shows it. Review metadata from the intake summary, never text.
function documentView(d) {
  const ej = d.extracted_json || {};
  const v2 = ej.ai_intake_v2 || null;
  const v1 = ej.ai_intake || null;
  return {
    document_id: d.id,
    document_type: d.document_type || null,
    file: d.file ? { name: d.file.file_name || null, mime_type: d.file.mime_type || null, size: d.file.file_size ?? null,
      channel: d.file.upload_channel || null } : null,
    uploaded_at: d.created_at || null,
    document_number: d.document_number || null,
    document_date: d.document_date || null,
    amount: d.gross_amount == null ? null : Number(d.gross_amount),
    currency: d.currency || null,
    archived: !!d.archived_at,
    links: (d.links || []).map((l) => ({ target_type: l.target_type, target_id: l.target_id })),
    classification: v1 ? { type: v1.doc_type || null, confidence: v1.confidence || null, status: v1.classification_status || null } : null,
    intake: v2 ? {
      status: v2.status || null, type: v2.document_type || null, direction: v2.direction || null,
      suggested_record_type: v2.suggested_record_type || null, amount: v2.amount ?? null, currency: v2.currency || null,
      counterparty_status: v2.counterparty_status || null, missing_fields: v2.missing_fields || [],
    } : null,
  };
}

async function listDocuments(args, ctx) {
  const s = ctx.services;
  const biz = await resolveCompany(ctx, args.company_id);
  await requireDocumentsView(biz, s);
  if (args.period && !PERIOD_RE.test(args.period)) throw new ToolError('invalid_period', 'period must be YYYY-MM.');
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
  const filters = {
    status: args.status === 'archived' ? 'archived' : undefined,
    linked_status: args.status === 'linked' || args.status === 'unlinked' ? args.status : undefined,
    review: args.status === 'needs_review' ? 'needs_review' : undefined,
    counterparty: args.counterparty_id || undefined,
    document_id: args.document_id || undefined,
    uploaded_after: args.uploaded_after || undefined,
    // A period is filtered below on the document's own date (or its upload date when the
    // document has none), so fetch the full window first.
    limit: args.period ? 200 : limit,
  };
  const r = await s.listDocumentsForUser(biz, ctx.mcpUser.userId, filters);
  if (r.error) throw new ToolError('documents_unavailable', 'CFO Finance could not list the documents.');
  let docs = r.documents || [];
  if (args.period) {
    docs = docs.filter((d) => String(d.document_date || d.created_at || '').slice(0, 7) === args.period);
  }
  if (args.document_id && !docs.length) throw new ToolError('document_not_found', 'No such document in this company.');
  const truncated = docs.length > limit;
  docs = docs.slice(0, limit);

  const out = docs.map(documentView);
  // Download links are issued one by one (each is audited) and only for a short list.
  if (args.include_download_url) {
    if (out.length > 5) {
      throw new ToolError('too_many_for_download_links', 'Download links are issued for at most 5 documents at a time. '
        + 'Narrow the list (document_id, period, status) and ask again.');
    }
    for (let i = 0; i < out.length; i++) {
      const u = await s.signedDocumentUrl(biz, ctx.mcpUser.userId, docs[i]);
      out[i].download_url = u && u.url ? u.url : null;
      out[i].download_url_expires_in_seconds = u && u.url ? u.expires_in : null;
    }
  }
  return {
    company: companyRef(biz),
    count: out.length,
    truncated,
    filters: { status: args.status || null, period: args.period || null, counterparty_id: args.counterparty_id || null,
      document_id: args.document_id || null, uploaded_after: args.uploaded_after || null },
    period_basis: args.period ? 'document date, or upload date when the document has none' : null,
    documents: out,
  };
}

// A link target in THIS company, checked before anything is written. payable/receivable are
// debts of that type; a restricted role may only attach to a request it created itself.
async function resolveLinkTarget(biz, s, userId, linkTo, { manage }) {
  if (!linkTo) return null;
  if (!LINK_TYPES.includes(linkTo.type)) throw new ToolError('invalid_link_target', `link type must be one of ${LINK_TYPES.join(', ')}.`);
  if (linkTo.type === 'transaction') {
    if (!manage) throw new ToolError('forbidden_role', 'Your role cannot attach documents to transactions.');
    return { target_type: 'transaction', target_id: String(linkTo.id) };
  }
  const debt = await s.loadDebtScoped(biz, linkTo.id);
  if (!debt || debt.type !== linkTo.type) throw new ToolError('link_target_not_found', `No such ${linkTo.type} in this company.`);
  if (!manage && String(debt.created_by_user_id) !== String(userId)) {
    throw new ToolError('link_target_not_found', `No such ${linkTo.type} in this company.`);
  }
  return { target_type: 'debt', target_id: String(debt.id) };
}

const BASE64_RE = /^[A-Za-z0-9+/\r\n]+={0,2}\s*$/;

async function uploadDocument(args, ctx) {
  const s = ctx.services;
  const biz = await resolveCompany(ctx, args.company_id);
  if (!s.canUploadDocument(biz.role)) throw new ToolError('forbidden_role', 'Your role in this company cannot upload documents.');
  await requireDocumentsAccess(biz, s);
  if (args.document_type && !DOCUMENT_TYPES.includes(args.document_type)) {
    throw new ToolError('invalid_document_type', `document_type must be one of ${DOCUMENT_TYPES.join(', ')}.`);
  }
  const manage = s.canManageDocuments(biz.role);
  const link = await resolveLinkTarget(biz, s, ctx.mcpUser.userId, args.link_to, { manage });

  // ── Mode 2: no bytes → a 15-minute upload link for this user and company ─────────────────
  if (!args.file_base64) {
    if (args.file_name || args.mime_type) {
      throw new ToolError('invalid_arguments', 'file_name and mime_type go with file_base64. Omit all three to get an upload link.');
    }
    const l = s.issueUploadLink(biz, ctx.mcpUser.userId, { documentType: args.document_type || null, link });
    return {
      company: companyRef(biz),
      mode: 'upload_link',
      written: false,
      upload_url: l.url,
      expires_at: l.expires_at,
      instructions: 'Give the user this link. It opens a CFO AI page where they drop the file; they must be '
        + 'signed in to CFO AI with the same account. The link works for 15 minutes and only uploads into '
        + `${biz.business.name || 'this company'}.`,
      next_step: `When the user says the file is uploaded, call list_documents with uploaded_after="${l.issued_at}" `
        + 'to find it, then analyze_invoice with its document_id.',
    };
  }

  // ── Mode 1: the bytes are in the call ─────────────────────────────────────────────────────
  if (!args.file_name || !args.mime_type) {
    throw new ToolError('invalid_arguments', 'file_name and mime_type are required with file_base64.');
  }
  const b64 = String(args.file_base64).replace(/^data:[^;]+;base64,/, '');
  if (!BASE64_RE.test(b64)) throw new ToolError('invalid_file', 'file_base64 is not valid base64.');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw new ToolError('invalid_file', 'The file is empty.');
  if (buf.length > MAX_INLINE_BYTES) {
    throw new ToolError('file_too_large_for_inline', 'Files over 7 MB cannot be sent inside the chat. Call upload_document '
      + 'without file_base64 to get an upload link instead.');
  }

  const r = await s.storeDocumentBytes(biz, ctx.mcpUser.userId, {
    buf, fileName: String(args.file_name).slice(0, 200), mimeType: args.mime_type,
    documentType: args.document_type || null, link: link ? { target_type: link.target_type, target_id: link.target_id } : null,
  });
  if (r.error === 'duplicate') {
    return {
      company: companyRef(biz), mode: 'inline', written: false,
      duplicate: true, existing_document_id: r.existing_document_id || null,
      next_step: 'This exact file is already stored in CFO AI. Use existing_document_id with analyze_invoice.',
    };
  }
  if (r.error) {
    const known = { mime_not_allowed: 'This file type is not accepted. Use PDF, JPG, PNG, CSV or Excel.',
      file_too_large: 'The file is larger than 20 MB.', invalid_file_name: 'The file name is not valid.',
      documents_unavailable: 'Document storage is temporarily unavailable. Try again later.',
      storage_unavailable: 'Document storage is temporarily unavailable. Try again later.' };
    throw new ToolError(r.error in known ? r.error : 'upload_failed', known[r.error] || 'CFO AI could not store the file.');
  }

  const doc = r.doc;
  const i = r.intake || null;
  const full = fullView(biz, s);
  return {
    company: companyRef(biz),
    mode: 'inline',
    written: true,
    duplicate: false,
    document_id: doc.id,
    document_type: doc.document_type || null,
    linked: r.link_result ? !!r.link_result.ok : false,
    link_error: r.link_result && !r.link_result.ok ? r.link_result.error : null,
    // The intake ran on upload (same as the web app). Finance roles see its summary; a
    // submit-only role sees the document's own reading only.
    intake: i ? {
      status: i.status,
      type: i.document && i.document.type,
      direction: i.document && i.document.direction,
      suggested_record_type: i.financial_record && i.financial_record.suggested_record_type,
      amount: i.financial_record ? i.financial_record.amount : null,
      currency: i.financial_record ? i.financial_record.currency : null,
      missing_fields: i.missing_fields || [],
      ...(full ? { counterparty_status: i.counterparty && i.counterparty.status } : {}),
    } : null,
    next_step: 'The document is stored in the Document Center. Call analyze_invoice with this document_id for the full '
      + 'reading, or submit_invoice_draft with it to file a draft (the document is attached automatically).',
  };
}

async function linkDocumentTool(args, ctx) {
  const s = ctx.services;
  const biz = await resolveCompany(ctx, args.company_id);
  if (!s.canManageDocuments(biz.role)) throw new ToolError('forbidden_role', 'Your role in this company cannot link documents.');
  await requireDocumentsAccess(biz, s);
  const doc = await s.loadDocumentScoped(biz, String(args.document_id));
  if (!doc) throw new ToolError('document_not_found', 'No such document in this company.');
  if (doc.archived_at) throw new ToolError('document_archived', 'That document has been archived.');
  const target = await resolveLinkTarget(biz, s, ctx.mcpUser.userId, { type: args.target_type, id: args.target_id }, { manage: true });

  if (args.unlink) {
    const links = await s.documentLinks(biz, doc);
    const hit = links.find((l) => l.target_type === target.target_type && String(l.target_id) === target.target_id);
    if (!hit) throw new ToolError('link_not_found', 'This document is not attached to that record.');
    const r = await s.unlinkDocument(biz, doc, hit.link_id, ctx.mcpUser.userId);
    if (!r.ok) throw new ToolError(r.error || 'unlink_failed', 'CFO AI could not detach the document.');
    return { company: companyRef(biz), written: true, action: 'unlinked', document_id: doc.id,
      target: { type: args.target_type, id: target.target_id } };
  }

  const r = await s.linkDocument(biz, doc, target.target_type, target.target_id, ctx.mcpUser.userId);
  if (!r.ok) {
    const map = { already_linked: 'The document is already attached to that record.',
      cross_business_link_forbidden: 'That record belongs to another company.',
      target_not_found: `No such ${args.target_type} in this company.` };
    throw new ToolError(r.error in map ? r.error : 'link_failed', map[r.error] || 'CFO AI could not attach the document.');
  }
  return { company: companyRef(biz), written: true, action: 'linked', document_id: doc.id,
    target: { type: args.target_type, id: target.target_id },
    note: 'Attaching a document records evidence only. It does not approve, pay or settle anything.' };
}

/* ── registry ────────────────────────────────────────────────────────────── */
function phase1Tools(ctx) {
  return [
    {
      name: 'get_company_context',
      availableFor: () => true,
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
      availableFor: (role, s) => s.canViewBusinessFinance(role),
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
      availableFor: (role, s) => s.canViewBusinessFinance(role) || s.canUploadDocument(role),
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
      availableFor: (role, s) => s.canViewBusinessFinance(role)
        || (s.canCreateFinancialRequest(role) && s.canUploadDocument(role)),
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
    {
      name: 'list_documents',
      availableFor: (role, s) => s.canViewBusinessFinance(role) || s.canUploadDocument(role),
      config: {
        title: 'List documents',
        description: 'Documents stored in the company\'s CFO Document Center: type, file name, number, date, '
          + 'amount, what they are attached to, and the intake review status. Read-only. Use it to find a '
          + 'document_id (e.g. after the user uploads a file through an upload link: uploaded_after), to see '
          + 'what still needs review (status="needs_review") or what is not attached yet (status="unlinked"). '
          + 'Managers/employees see only their own uploads. include_download_url adds a 10-minute view link '
          + '(at most 5 documents). Never returns document text.',
        inputSchema: {
          company_id: COMPANY_ID,
          status: z.enum(['needs_review', 'unlinked', 'linked', 'archived']).optional()
            .describe('needs_review = not attached and not ready; unlinked/linked = attachment state; archived'),
          period: z.string().regex(PERIOD_RE).optional().describe('Month YYYY-MM (document date, else upload date)'),
          counterparty_id: z.string().min(1).max(64).optional().describe('Only documents of this counterparty'),
          document_id: z.string().min(1).max(64).optional().describe('One document'),
          uploaded_after: z.string().datetime({ offset: true }).optional()
            .describe('ISO timestamp — documents uploaded after it (use the issued time of an upload link)'),
          limit: z.number().int().min(1).max(50).optional().describe('Default 20'),
          include_download_url: z.boolean().optional().describe('Add short-lived view links (max 5 documents)'),
        },
        annotations: { ...RO, title: 'List documents' },
      },
      handler: guarded('list_documents', ctx, listDocuments),
    },
  ];
}

// Write tools — registered ONLY when MCP_WRITE_TOOLS_ENABLED=true (read per request).
function writeTools(ctx) {
  return [
    {
      name: 'submit_invoice_draft',
      availableFor: (role, s) => s.canCreateFinancialRequest(role) && s.canUploadDocument(role),
      config: {
        title: 'Submit invoice as payable draft',
        description: 'Create a PAYABLE DRAFT in CFO Finance from an invoice the user wants to pay. '
          + 'The draft is always "pending approval": it does not pay anything and does not affect cash, '
          + 'payables or runway until the user approves it in CFO AI (Payables screen or Telegram). '
          + 'Use it only when the user asks to send/upload/record an invoice to CFO. Run analyze_invoice '
          + 'first and show the user the result. Provide EXACTLY ONE of document_id or invoice_text. '
          + 'Amount, supplier, currency and due date are taken from CFO\'s own reading; counterparty, '
          + 'amount and due_date you pass only fill gaps CFO could not read, and a conflicting amount is '
          + 'refused. IDR invoices only for now. For a manager or employee the draft is a request (e.g. a '
          + 'reimbursement) that an owner, admin or CFO must approve.',
        inputSchema: {
          company_id: COMPANY_ID,
          document_id: z.string().min(1).max(64).optional()
            .describe('Id of a document already stored in CFO Finance for this company'),
          invoice_text: z.string().max(20000).optional()
            .describe('Full text of the invoice as read from the file (keep labels, numbers and dates)'),
          counterparty: z.string().min(1).max(200).optional()
            .describe('Supplier name as you read it — used only if CFO cannot read it'),
          amount: z.number().positive().optional()
            .describe('Invoice total as you read it — must match CFO\'s reading if CFO can read one'),
          currency: z.string().min(3).max(3).optional()
            .describe('ISO currency code as you read it, e.g. IDR'),
          due_date: z.string().regex(DATE_RE).optional()
            .describe('Due date YYYY-MM-DD as you read it — used only if CFO cannot read it'),
          description: z.string().max(200).optional()
            .describe('Short description of what the invoice is for'),
        },
        annotations: {
          title: 'Submit invoice as payable draft',
          readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false,
        },
      },
      handler: guarded('submit_invoice_draft', ctx, submitInvoiceDraft),
    },
    {
      name: 'upload_document',
      availableFor: (role, s) => s.canUploadDocument(role),
      config: {
        title: 'Upload a document to CFO',
        description: 'Store a file (invoice, receipt, payment proof, tax document, contract…) in the company\'s CFO '
          + 'Document Center; CFO reads and classifies it on upload. Use it when the user asks to upload/save a '
          + 'document to CFO. Two modes: (1) pass file_base64 + file_name + mime_type (PDF/JPG/PNG/CSV/Excel, up '
          + 'to 7 MB); (2) if you cannot pass the file bytes, call it WITHOUT file_base64 to get a 15-minute '
          + 'upload link for the user (they must be signed in to CFO AI). An identical file is never stored twice '
          + '(duplicate + existing_document_id). Optional link_to attaches it to a payable/receivable/transaction. '
          + 'Nothing is approved or paid.',
        inputSchema: {
          company_id: COMPANY_ID,
          file_base64: z.string().max(10 * 1024 * 1024).optional().describe('The file bytes, base64-encoded'),
          file_name: z.string().min(1).max(200).optional().describe('File name with extension, e.g. invoice-832.pdf'),
          mime_type: z.string().min(3).max(120).optional().describe('e.g. application/pdf, image/jpeg'),
          document_type: z.enum(DOCUMENT_TYPES).optional()
            .describe('Only if the user said what it is; CFO classifies the content anyway'),
          link_to: z.object({
            type: z.enum(LINK_TYPES),
            id: z.union([z.string().min(1).max(64), z.number().int()]),
          }).optional().describe('Attach to an existing payable / receivable / transaction of this company'),
        },
        annotations: {
          title: 'Upload a document to CFO',
          readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false,
        },
      },
      handler: guarded('upload_document', ctx, uploadDocument),
    },
    {
      name: 'link_document',
      availableFor: (role, s) => s.canManageDocuments(role),
      config: {
        title: 'Attach or detach a document',
        description: 'Attach a stored document to a payable, receivable or transaction of the same company (e.g. a '
          + 'payment proof to the invoice it pays), or detach it with unlink=true. Evidence only: it never '
          + 'approves, pays or settles anything. Owner/admin/CFO/accountant roles.',
        inputSchema: {
          company_id: COMPANY_ID,
          document_id: z.string().min(1).max(64).describe('Document id from list_documents / upload_document'),
          target_type: z.enum(LINK_TYPES).describe('payable, receivable or transaction'),
          target_id: z.union([z.string().min(1).max(64), z.number().int()]).describe('Id of that record'),
          unlink: z.boolean().optional().describe('true = detach instead of attach'),
        },
        annotations: {
          title: 'Attach or detach a document',
          readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false,
        },
      },
      handler: guarded('link_document', ctx, linkDocumentTool),
    },
  ];
}

module.exports = { phase1Tools, writeTools };
