// CFO Finance MCP — Phase-1 tool registry.
//
// ALL Phase-1 tools are READ-ONLY (readOnlyHint: true) and NEVER write financial data.
// In PR1 the handlers are deliberate STUBS: they prove MCP transport, tool discovery,
// input-schema validation, annotations, and the authenticated-identity path, and return
// a structured "not_implemented_in_pr1" result. The real handlers — which call the
// EXISTING services (businessResolver, accountantAssistant, documentIntakeOrchestrator,
// invoiceSettlement, …) behind requireBusiness + role gates — land in PR3/PR4.
//
// Design rule (from the brief): expose BUSINESS capabilities, not database tables.

const { z } = require('zod');

const PERIOD = z.string().regex(/^\d{4}-\d{2}$/, 'period must be YYYY-MM');

function phase1Tools(ctx) {
  const stub = (name) => async (args) => ({
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'not_implemented_in_pr1',
        tool: name,
        authenticated_user: ctx.mcpUser ? { userId: ctx.mcpUser.userId, via: ctx.mcpUser.via } : null,
        received_args: args || {},
        note: 'PR1 proves MCP transport + discovery + schema + auth. The real handler, '
            + 'calling the existing CFO Finance services behind requireBusiness + role gates, '
            + 'lands in PR3/PR4. No data was read or written.',
      }, null, 2),
    }],
  });

  const ro = { readOnlyHint: true, openWorldHint: false };

  return [
    {
      name: 'get_company_context',
      config: {
        title: 'Get company context',
        description: 'Return the CFO Finance companies the authenticated user can access and the '
          + 'currently selected company. Never returns another tenant\'s data. Call this FIRST to '
          + 'discover which company_id values are valid before calling other tools.',
        inputSchema: {},
        annotations: { ...ro, title: 'Get company context' },
      },
      handler: stub('get_company_context'),
    },
    {
      name: 'get_financial_summary',
      config: {
        title: 'Get financial summary',
        description: 'Return a financial summary for a company and period (totals, cash position). '
          + 'Read-only. Use get_company_context first to obtain a valid company_id.',
        inputSchema: {
          company_id: z.string().optional().describe('CFO company id; defaults to the user\'s active company'),
          period: PERIOD.optional().describe('Month as YYYY-MM; defaults to the current month'),
        },
        annotations: { ...ro, title: 'Get financial summary' },
      },
      handler: stub('get_financial_summary'),
    },
    {
      name: 'get_period_readiness',
      config: {
        title: 'Get period readiness',
        description: 'Return how ready a company\'s accounting is for a given month: percent ready, '
          + 'count of transactions needing review, unmatched payments, and document gaps. Read-only.',
        inputSchema: {
          company_id: z.string().optional().describe('CFO company id; defaults to the active company'),
          period: PERIOD.describe('Month as YYYY-MM'),
        },
        annotations: { ...ro, title: 'Get period readiness' },
      },
      handler: stub('get_period_readiness'),
    },
    {
      name: 'get_missing_documents',
      config: {
        title: 'Get missing documents',
        description: 'List supporting documents missing for a company\'s invoices/transactions in a '
          + 'period (e.g. payment proof, tax document). Read-only.',
        inputSchema: {
          company_id: z.string().optional().describe('CFO company id; defaults to the active company'),
          period: PERIOD.optional().describe('Month as YYYY-MM; defaults to the current month'),
        },
        annotations: { ...ro, title: 'Get missing documents' },
      },
      handler: stub('get_missing_documents'),
    },
    {
      name: 'analyze_invoice',
      config: {
        title: 'Analyze an invoice',
        description: 'Analyze an invoice through the CFO Finance document pipeline and return structured '
          + 'fields (supplier, invoice number, invoice/due dates, currency, subtotal, tax, total), payment '
          + 'status, suggested accounting treatment, duplicate suspicion, missing supporting documents, and '
          + 'accounting-package readiness. READ-ONLY: never creates or modifies any record. Provide exactly '
          + 'one of document_id (a document already stored in CFO Finance), file_url (a temporary fetchable '
          + 'URL — the portable option across MCP hosts), or invoice_text (already-extracted text).',
        inputSchema: {
          company_id: z.string().optional().describe('CFO company id; defaults to the active company'),
          document_id: z.string().optional().describe('Id of a document already stored in CFO Finance'),
          file_url: z.string().url().optional().describe('Temporary, fetchable URL to the invoice file'),
          invoice_text: z.string().max(20000).optional().describe('Raw extracted invoice text, if the host has it'),
        },
        annotations: { ...ro, title: 'Analyze an invoice' },
      },
      handler: stub('analyze_invoice'),
    },
  ];
}

module.exports = { phase1Tools };
