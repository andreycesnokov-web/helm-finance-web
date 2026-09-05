// Native visual document understanding — the model reads the document, we validate it.
//
// ── WHY V3 EXISTS ────────────────────────────────────────────────────────────
// V2 already sent the original PDF to the model as a native `document` block. Then it
// threw the answer away: the transcript was flattened to text, re-parsed with regexes,
// and the regex verdict OVERRODE the model's own classification (documentOcr.js:238).
// So the same kwitansi came back as a receipt on one run and a faktur pajak on the next,
// a name from one party was paired with another party's NPWP, and DPP was read as total
// — all symptoms of reconstructing meaning from flattened text.
//
// V3 inverts that. The model returns a STRUCTURE, not prose:
//   · every value carries its own confidence and the printed text it came from;
//   · a party is one object — its name, NPWP and address cannot drift apart;
//   · the three dates are three fields, never one;
//   · DPP, PPN and total are separate fields that may each be null.
//
// ── HOW THE STRUCTURE IS ENFORCED ────────────────────────────────────────────
// Not by asking for JSON in the prompt. The installed SDK pins anthropic-version
// 2023-06-01, which does not carry the newer Structured Outputs parameter — but it does
// support TOOL USE with a JSON Schema, and the SDK passes unknown body params straight
// through. So the schema is declared as a tool and the model is forced to call it.
// Every field below is therefore shaped by the API, not by hope.
//
// ── WHAT THIS MODULE WILL NOT DO ─────────────────────────────────────────────
// It does not decide anything financial. It returns evidence. The validator judges it
// and the user confirms it; only then may a record be created.
'use strict';

const SCHEMA_VERSION = 'financial_document_extraction_v3';
const PROMPT_VERSION = 'fin-doc-id-v3.1';
const MODEL = 'claude-sonnet-4-5';

// Vision is billed per document, so the guards are size, pages and time.
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 20;
const TIMEOUT_MS = 90000;          // a multi-page PDF read visually is not a fast call
const MAX_OUTPUT_TOKENS = 8000;

const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const DOCUMENT_TYPES = [
  'invoice', 'faktur_pajak', 'receipt', 'kwitansi', 'payment_proof', 'bank_statement',
  'contract', 'tax_document', 'payroll_document', 'asset_purchase', 'funding_document',
  'company_document', 'unknown',
];

const PARTY_ROLES = [
  'supplier', 'seller', 'issuer', 'customer', 'buyer', 'payer', 'receiver',
  'taxable_entrepreneur_seller', 'taxable_entrepreneur_buyer', 'bank', 'unknown',
];

/* ── the schema the model must fill ────────────────────────────────────────── */

const evidenceSchema = {
  type: 'array',
  description: 'Where this value was read from. Empty when the value is null.',
  items: {
    type: 'object',
    properties: {
      page: { type: 'integer', description: '1-based page the value appears on' },
      printed_text: { type: 'string', description: 'The text exactly as printed' },
      section: { type: 'string', description: 'The area of the page, e.g. issuer_header' },
    },
    required: ['page', 'printed_text'],
  },
};

const field = (type, description) => ({
  type: 'object',
  description,
  properties: {
    value: { type: [type, 'null'], description: 'null when the document does not state it' },
    confidence: { type: 'number', description: '0..1' },
    evidence: evidenceSchema,
  },
  required: ['value', 'confidence', 'evidence'],
});

const dateField = (description) => ({
  type: 'object',
  description,
  properties: {
    value: { type: ['string', 'null'], description: 'ISO YYYY-MM-DD, or null if not stated or ambiguous' },
    printed_text: { type: ['string', 'null'], description: 'The date exactly as printed' },
    confidence: { type: 'number' },
    evidence: evidenceSchema,
  },
  required: ['value', 'printed_text', 'confidence', 'evidence'],
});

const amountField = (description) => ({
  type: 'object',
  description,
  properties: {
    value: { type: ['number', 'null'], description: 'digits only, no separators; null if not stated' },
    calculated: { type: 'boolean', description: 'true ONLY if you derived it rather than read it' },
    confidence: { type: 'number' },
    evidence: evidenceSchema,
  },
  required: ['value', 'calculated', 'confidence', 'evidence'],
});

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    schema_version: { type: 'string' },
    document_type: {
      type: 'object',
      properties: {
        value: { type: 'string', enum: DOCUMENT_TYPES },
        confidence: { type: 'number' },
        evidence: evidenceSchema,
      },
      required: ['value', 'confidence', 'evidence'],
    },
    document_number: field('string', 'The document/invoice/receipt number as printed'),
    language: { type: 'array', items: { type: 'string' }, description: 'ISO codes, e.g. ["id"]' },

    parties: {
      type: 'array',
      description: 'EVERY party named on the document. One object per party — never merge two.',
      items: {
        type: 'object',
        properties: {
          party_id: { type: 'string', description: 'party_1, party_2, …' },
          role: { type: 'string', enum: PARTY_ROLES },
          legal_name: field('string', 'The company name for THIS party only'),
          npwp: {
            type: 'object',
            properties: {
              value: { type: ['string', 'null'], description: 'as printed, or null' },
              normalized_value: { type: ['string', 'null'], description: 'digits only' },
              confidence: { type: 'number' },
              evidence: evidenceSchema,
            },
            required: ['value', 'normalized_value', 'confidence', 'evidence'],
          },
          address: field('string', 'This party\'s address'),
          bank_accounts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                bank_name: { type: ['string', 'null'] },
                account_number: { type: ['string', 'null'] },
                account_holder: { type: ['string', 'null'] },
              },
            },
          },
        },
        required: ['party_id', 'role', 'legal_name', 'npwp'],
      },
    },

    current_business_party_id: { type: ['string', 'null'], description: 'Which party is the user\'s own company, or null' },
    counterparty_candidate_party_id: { type: ['string', 'null'], description: 'The OTHER party, or null' },
    relationship_confidence: { type: 'number' },

    dates: {
      type: 'object',
      properties: {
        document_date: dateField('Issue date of the document itself'),
        due_date: dateField('Payment deadline. null on documents that have none'),
        payment_date: dateField('When money actually moved. null unless the document records a payment'),
      },
      required: ['document_date', 'due_date', 'payment_date'],
    },

    amounts: {
      type: 'object',
      properties: {
        currency: { type: ['string', 'null'], description: 'ISO code; IDR for Rp' },
        subtotal: amountField('Subtotal before tax, if printed'),
        dpp: amountField('Dasar Pengenaan Pajak — the taxable base'),
        ppn: amountField('PPN / VAT amount'),
        withholding_tax: amountField('PPh withheld, if printed'),
        total: amountField('The grand total payable'),
        amount_paid: amountField('Amount already paid, if the document states it'),
        amount_due: amountField('Amount still due, if the document states it'),
      },
      required: ['currency', 'dpp', 'ppn', 'total'],
    },

    payment_details: {
      type: 'object',
      properties: {
        method: { type: ['string', 'null'] },
        reference_number: { type: ['string', 'null'] },
        status: { type: ['string', 'null'] },
      },
    },
    tax_details: {
      type: 'object',
      properties: {
        faktur_serial: { type: ['string', 'null'], description: 'Kode dan Nomor Seri Faktur Pajak' },
        tax_period: { type: ['string', 'null'] },
      },
    },

    warnings: { type: 'array', items: { type: 'string' } },
    pages_analyzed: { type: 'array', items: { type: 'integer' } },
    page_count: { type: ['integer', 'null'] },
    analysis_complete: { type: 'boolean', description: 'false if you could not read the whole document' },
  },
  required: ['schema_version', 'document_type', 'parties', 'dates', 'amounts',
    'warnings', 'pages_analyzed', 'analysis_complete'],
};

/* ── the prompt ────────────────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `You extract evidence from Indonesian business documents for an accounting system.

Read the COMPLETE visual document before classifying it. Look at layout, headings, tables
and stamps — not only the words.

Identify ALL parties before deciding which is the counterparty. Keep each legal name,
NPWP, address and bank account attached to the SAME visual party block. A name from one
block must never be paired with an NPWP from another block. A missing NPWP is safer than
a wrong one.

Never treat a reference number, invoice code, document title or heading as a company name.

Distinguish carefully, and return each separately:
- document date (when it was issued)
- due date (payment deadline)
- payment date (when money actually moved)
- DPP (taxable base), PPN (VAT), total, amount paid, amount due

Do not infer a field merely because such a field usually exists. If the document does not
show it, return null. Do not calculate a figure and present it as printed: set
"calculated": true if you derived it at all.

For dates, return ISO YYYY-MM-DD in "value" and the exact printed form in "printed_text".
Indonesian documents are day-first: 04/08/2026 is 4 August 2026. If a date is genuinely
ambiguous or unreadable, return null and say so in warnings.

Document type guidance:
- KWITANSI / KUITANSI (often "Sudah terima dari", "Berupa", "Terbilang") is a RECEIPT for
  money already handed over — not an invoice.
- "Faktur Pajak" with a Kode dan Nomor Seri is faktur_pajak.
- "Invoice"/"Tagihan" asking for payment is invoice.
- A bank transfer slip / "Bukti Transfer" is payment_proof.
- "Rekening Koran"/"Mutasi Rekening" is bank_statement.

You are told which company the user is. Decide which party on the document is that
company, and which is the counterparty. If every party on the document appears to BE the
user's company, set counterparty_candidate_party_id to null — never return the user's own
company as its own counterparty.

Record which pages you actually read in pages_analyzed, and set analysis_complete to false
if any page could not be read.

Accuracy matters more than completeness. Return null rather than guessing.`;

/** The user-turn text: weak context only. Never authoritative. */
function contextBlock(business = {}, opts = {}) {
  const lines = ['This document belongs to the following business (the "current business"):'];
  if (business.legal_name) lines.push(`  legal name: ${business.legal_name}`);
  if (business.display_name) lines.push(`  display name: ${business.display_name}`);
  if (business.npwp) lines.push(`  NPWP: ${business.npwp}`);
  if (business.aliases?.length) lines.push(`  aliases: ${business.aliases.join(', ')}`);
  // A file name is a hint about intent, never about content. Labelled as such.
  if (opts.file_name) lines.push(`\nFile name (WEAK hint only — never classify from it): ${opts.file_name}`);
  if (opts.embedded_text) {
    lines.push('\nText extracted from the file, as SUPPLEMENTARY evidence only. The visual '
      + 'document above is the source of truth; use this only to confirm characters you '
      + 'can already see:\n' + String(opts.embedded_text).slice(0, 4000));
  }
  lines.push('\nExtract the document using the record_financial_document tool.');
  return lines.join('\n');
}

/* ── failure shapes ────────────────────────────────────────────────────────── */

const failure = (reason, warning) => ({
  ok: false, reason,
  schema_version: SCHEMA_VERSION, prompt_version: PROMPT_VERSION, model: MODEL,
  warnings: warning ? [warning] : [],
});

/* ── the call ──────────────────────────────────────────────────────────────── */

const visionEnabled = () => process.env.DOCUMENT_OCR_VISION_ENABLED === 'true';

/**
 * Read a document natively and return the structured extraction.
 *
 * @param buffer  the verified stored bytes — the ORIGINAL file, never a re-render
 * @param opts    { mime_type, file_name, business, embedded_text, client, pageCount }
 * @returns       never rejects; { ok:false, reason } on any failure.
 */
async function extractDocumentV3(buffer, opts = {}) {
  const started = Date.now();
  if (!visionEnabled()) return failure('vision_disabled');
  const client = opts.client;
  if (!client || typeof client?.messages?.create !== 'function') return failure('vision_not_configured');
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return failure('empty_file');
  if (buffer.length > MAX_BYTES) {
    return failure('file_too_large',
      'This document is too large to analyse automatically. Enter the values manually.');
  }
  if (opts.pageCount && opts.pageCount > MAX_PAGES) {
    // Refused outright rather than analysing part of it and calling that the document.
    return failure('too_many_pages',
      `This document has ${opts.pageCount} pages; automatic analysis covers up to ${MAX_PAGES}. `
      + 'Split it or enter the values manually.');
  }

  const mime = String(opts.mime_type || '').toLowerCase();
  const isPdf = /pdf/.test(mime) || /\.pdf$/i.test(opts.file_name || '');
  const imageMime = IMAGE_MIME.find((m) => mime === m);
  if (!isPdf && !imageMime) return failure('unsupported_media_type');

  // THE ORIGINAL BYTES. A PDF goes as a document block so the model sees the page as
  // laid out; an image goes as an image block. Neither is a text transcript.
  const media = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } }
    : { type: 'image', source: { type: 'base64', media_type: imageMime, data: buffer.toString('base64') } };

  const request = {
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0,              // extraction is not a creative task
    system: SYSTEM_PROMPT,
    tools: [{
      name: 'record_financial_document',
      description: 'Record the structured contents of the financial document you were shown.',
      input_schema: EXTRACTION_SCHEMA,
    }],
    // Forcing the tool is what makes the output a STRUCTURE rather than prose that
    // happens to look like JSON. Without it we are back to parsing text.
    tool_choice: { type: 'tool', name: 'record_financial_document' },
    messages: [{ role: 'user', content: [media, { type: 'text', text: contextBlock(opts.business, opts) }] }],
  };

  let resp;
  try {
    resp = await Promise.race([
      client.messages.create(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('vision_timeout')), TIMEOUT_MS)),
    ]);
  } catch (e) {
    const timedOut = /vision_timeout/.test(e.message || '');
    return {
      ...failure(timedOut ? 'vision_timeout' : 'vision_request_failed',
        'Automatic analysis did not finish. Try again or enter the values manually.'),
      duration_ms: Date.now() - started,
      provider_message: String(e.message || '').slice(0, 200),
    };
  }

  const block = (resp?.content || []).find((c) => c.type === 'tool_use');
  if (!block || !block.input) return { ...failure('no_tool_output'), duration_ms: Date.now() - started };

  return {
    ok: true,
    source: isPdf ? 'native_pdf_vision' : 'native_image_vision',
    schema_version: SCHEMA_VERSION,
    prompt_version: PROMPT_VERSION,
    model: MODEL,
    duration_ms: Date.now() - started,
    usage: resp?.usage
      ? { input_tokens: resp.usage.input_tokens ?? null, output_tokens: resp.usage.output_tokens ?? null }
      : null,
    extraction: block.input,
  };
}

/** The request that WOULD be sent — used by tests to prove the original bytes travel. */
function buildRequestForInspection(buffer, opts = {}) {
  const mime = String(opts.mime_type || '').toLowerCase();
  const isPdf = /pdf/.test(mime) || /\.pdf$/i.test(opts.file_name || '');
  const imageMime = IMAGE_MIME.find((m) => mime === m) || 'image/jpeg';
  const media = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } }
    : { type: 'image', source: { type: 'base64', media_type: imageMime, data: buffer.toString('base64') } };
  return { model: MODEL, media, tool_forced: 'record_financial_document' };
}

module.exports = {
  extractDocumentV3, buildRequestForInspection, visionEnabled,
  EXTRACTION_SCHEMA, SYSTEM_PROMPT, contextBlock,
  SCHEMA_VERSION, PROMPT_VERSION, MODEL,
  DOCUMENT_TYPES, PARTY_ROLES, MAX_BYTES, MAX_PAGES, TIMEOUT_MS,
};
