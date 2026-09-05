// One PDF is not always one document.
//
// A scanned Indonesian rental packet routinely arrives as a single file holding a
// kwitansi, a faktur pajak and the underlying agreement. Each is a different document
// with its own number, its own date and its own accounting meaning. Reading the packet
// as one thing produces the worst kind of wrong answer: a plausible one. The parties get
// merged, the faktur's tax figures attach to the kwitansi's payment, and a receipt for
// money already paid becomes a bill.
//
// So the packet is segmented first and each child is read on its own terms. Two stages,
// both on Opus, because deciding how many documents a file contains is itself a reading
// of a financial document and does not get a cheaper model.
//
// What this module will NOT do:
//   · flatten a bundle into one record. Three documents stay three.
//   · create anything. It returns children for a person to confirm, one at a time.
//   · split, re-render or rewrite the file. The stored bytes are what the model sees.
'use strict';

const modelPolicy = require('./modelPolicy');
const visionV3 = require('./documentVisionV3');

const MODEL = modelPolicy.modelFor('bundle_segmentation');

/* Off until switched on, like every other reading capability before it. Segmentation is
   a second Opus call per multi-page document, so turning it on is a cost decision as much
   as a behavioural one and belongs to whoever pays the bill. */
const bundleDetectionEnabled = () => process.env.DOCUMENT_BUNDLE_DETECTION_ENABLED === 'true';
const SEGMENTATION_VERSION = 'bundle-seg-v1';
const MAX_CHILDREN = 10;          // beyond this it is an archive, not a document
const TIMEOUT_MS = 60000;
const MAX_OUTPUT_TOKENS = 2000;

/** What Stage A must return. Page ranges and identifiers only — no figures. Amounts are
 *  Stage B's job, and asking for them here would invite a guess from a glance. */
const SEGMENTATION_SCHEMA = {
  type: 'object',
  properties: {
    is_bundle: {
      type: 'boolean',
      description: 'True only if this file contains two or more SEPARATE documents. '
        + 'A multi-page single document (an invoice with a continuation page, an agreement '
        + 'with signature pages) is NOT a bundle.',
    },
    documents: {
      type: 'array',
      description: 'One entry per separate document, in page order.',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: '1-based position in the file.' },
          document_type: { type: 'string', enum: visionV3.DOCUMENT_TYPES },
          title_printed_text: {
            type: 'string',
            description: 'The heading exactly as printed, e.g. "KWITANSI", "Faktur Pajak", '
              + '"Surat Kesepakatan Sewa Tempat".',
          },
          page_start: { type: 'integer' },
          page_end: { type: 'integer' },
          identifier: {
            type: ['string', 'null'],
            description: 'The document number printed on THIS document — its kwitansi number, '
              + 'faktur serial, or agreement reference. Null if none is printed. Never copy '
              + 'a number from a neighbouring document.',
          },
          confidence: { type: 'number' },
        },
        required: ['index', 'document_type', 'title_printed_text', 'page_start', 'page_end',
          'identifier', 'confidence'],
      },
    },
    shared_reference: {
      type: ['string', 'null'],
      description: 'A reference printed on several of these documents that ties them together '
        + '(a contract or transaction number). Null if there is none. This is a RELATIONSHIP, '
        + 'not a merge: the documents remain separate.',
    },
    reasoning: {
      type: 'string',
      description: 'One or two sentences on how you decided where each document begins.',
    },
  },
  required: ['is_bundle', 'documents', 'shared_reference', 'reasoning'],
};

const SEGMENTATION_PROMPT = `You are looking at a scanned file that may contain more than one
financial document.

Your only job is to say how many SEPARATE documents it holds and where each one begins and ends.

HOW TO TELL DOCUMENTS APART
A new document starts where a new heading, a new document number, a new issuer letterhead or a
new signature block starts. Common Indonesian headings: KWITANSI, FAKTUR PAJAK, INVOICE,
SURAT KESEPAKATAN, PERJANJIAN, BUKTI POTONG, NOTA.

A single document that simply runs over several pages is NOT a bundle. An agreement with
signature pages, an invoice with a line-item continuation, a faktur with an attachment page:
each is one document.

DO NOT MERGE
If a kwitansi and a faktur pajak sit in the same file, they are two documents even when they
concern the same transaction and even when they share a contract reference. Report the shared
reference in shared_reference and keep the documents separate.

IDENTIFIERS
Give each document the number printed ON THAT DOCUMENT. Never carry a number across a boundary.
If a document shows no number, use null — do not construct one.

Report using the segment_documents tool.`;

const failure = (reason, extra = {}) => ({
  ok: false, reason, is_bundle: false, model: MODEL,
  segmentation_version: SEGMENTATION_VERSION, ...extra,
});

/**
 * How many pages does this PDF have?
 *
 * Needed for one decision only: a bundle needs at least two pages, so a single-page file
 * can skip segmentation entirely and cost nothing. Counting page objects directly is
 * exact on every document checked (both real customer scans and every fixture); the
 * /Count fallback covers files whose page objects sit inside compressed object streams.
 *
 * @returns the count, or null when it cannot be established.
 */
function countPdfPages(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  const s = buffer.toString('latin1');
  const direct = (s.match(/\/Type\s*\/Page[^sA-Za-z]/g) || []).length;
  if (direct > 0) return direct;
  const counts = [...s.matchAll(/\/Type\s*\/Pages\b[\s\S]{0,300}?\/Count\s+(\d+)/g)]
    .map((m) => Number(m[1])).filter((n) => Number.isFinite(n) && n > 0);
  return counts.length ? Math.max(...counts) : null;
}

/** Pages must be real, in order, inside the file, and must not overlap another child. */
function validateSegments(docs, pageCount) {
  const problems = [];
  const seen = new Set();
  for (const d of docs) {
    const a = Number(d.page_start);
    const b = Number(d.page_end);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a) {
      problems.push(`document ${d.index} has an unusable page range`);
      continue;
    }
    if (pageCount && b > pageCount) {
      problems.push(`document ${d.index} claims page ${b} of a ${pageCount}-page file`);
    }
    for (let pg = a; pg <= b; pg += 1) {
      // Overlap is reported, not silently resolved. Two documents claiming one page is a
      // segmentation the user should see rather than one this code quietly picks between.
      if (seen.has(pg)) problems.push(`page ${pg} is claimed by more than one document`);
      seen.add(pg);
    }
  }
  return problems;
}

/**
 * Stage A — how many documents, and where.
 * @returns never rejects; { ok:false, reason } on any failure.
 */
async function segmentDocuments(buffer, opts = {}) {
  if (!visionV3.visionEnabled()) return failure('vision_disabled');
  const client = opts.client;
  if (!client || typeof client?.messages?.create !== 'function') return failure('vision_not_configured');
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return failure('empty_file');
  if (buffer.length > visionV3.MAX_BYTES) return failure('file_too_large');

  const mime = String(opts.mime_type || '').toLowerCase();
  const isPdf = /pdf/.test(mime) || /\.pdf$/i.test(opts.file_name || '');
  // A single image cannot hold two documents in the sense that matters here.
  if (!isPdf) return { ok: true, is_bundle: false, documents: [], skipped: 'not_a_pdf' };

  const started = Date.now();
  let resp;
  try {
    resp = await Promise.race([
      client.messages.create({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        // NO temperature. Opus 5 rejects the field outright — `temperature is deprecated for
        // this model`, HTTP 400 — so setting it does not make extraction more deterministic,
        // it stops the request happening at all. Verified live on 2026-09-05: identical
        // requests differing only in this field returned 400 with it and stop_reason
        // "tool_use" without it. Do not re-add it.
        system: SEGMENTATION_PROMPT,
        tools: [{
          name: 'segment_documents',
          description: 'Report the separate documents contained in the file you were shown.',
          input_schema: SEGMENTATION_SCHEMA,
        }],
        tool_choice: { type: 'tool', name: 'segment_documents' },
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } },
            { type: 'text', text: 'How many separate documents does this file contain?' },
          ],
        }],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('vision_timeout')), TIMEOUT_MS)),
    ]);
  } catch (e) {
    return failure(visionV3.classifyProviderError(e), {
      duration_ms: Date.now() - started,
      provider_message: String(e?.message || '').slice(0, 200),
    });
  }

  // Same policy as primary extraction: an answer from anything but Opus is refused.
  const answeredBy = resp?.model || null;
  if (answeredBy && !modelPolicy.isOpus(answeredBy)) {
    return failure('model_policy_violation', { responded_model: answeredBy });
  }

  const block = (resp?.content || []).find((c) => c.type === 'tool_use');
  if (!block?.input) return failure('no_tool_output', { duration_ms: Date.now() - started });
  // Same wrapper-key defence as primary extraction; see documentVisionV3.unwrapToolInput.
  const { value: seg, unwrapped_from } = visionV3.unwrapToolInput(block.input,
    ['is_bundle', 'documents', 'shared_reference', 'reasoning']);

  const docs = Array.isArray(seg.documents) ? seg.documents : [];
  const problems = validateSegments(docs, opts.pageCount || null);

  // One document, or a claim of a bundle that only found one: not a bundle.
  const isBundle = seg.is_bundle === true && docs.length > 1;

  return {
    ok: true,
    is_bundle: isBundle && problems.length === 0,
    unwrapped_from,
    // A segmentation we could not trust is reported as a single document with the reason
    // attached, rather than acted on. Reading the file whole is the safe default; reading
    // it as children whose boundaries we doubt is not.
    documents: isBundle && problems.length === 0 ? docs.slice(0, MAX_CHILDREN) : [],
    shared_reference: seg.shared_reference ?? null,
    reasoning: String(seg.reasoning || '').slice(0, 500),
    problems,
    truncated: docs.length > MAX_CHILDREN,
    model: MODEL,
    responded_model: answeredBy,
    segmentation_version: SEGMENTATION_VERSION,
    duration_ms: Date.now() - started,
    usage: resp?.usage
      ? { input_tokens: resp.usage.input_tokens ?? null, output_tokens: resp.usage.output_tokens ?? null }
      : null,
  };
}

/**
 * Stage A then Stage B — segment, then read each child on its own.
 *
 * @returns { ok, is_bundle, segmentation, children[] } where each child carries its own
 *          extraction. Nothing is merged, and nothing is created.
 */
async function extractBundle(buffer, opts = {}) {
  const segmentation = await segmentDocuments(buffer, opts);
  if (!segmentation.ok || !segmentation.is_bundle) {
    return { ok: segmentation.ok !== false, is_bundle: false, segmentation, children: [] };
  }

  const children = [];
  for (const seg of segmentation.documents) {
    // Sequential, not parallel: a bundle is already several calls, and firing them at
    // once is how a rate limit turns one slow document into several failed ones.
    const extraction = await visionV3.extractDocumentV3(buffer, {
      ...opts,
      pageRange: { start: Number(seg.page_start), end: Number(seg.page_end) },
      childLabel: seg.title_printed_text || seg.document_type,
    });
    children.push({
      index: seg.index,
      segment: {
        document_type: seg.document_type,
        title_printed_text: seg.title_printed_text,
        page_start: seg.page_start,
        page_end: seg.page_end,
        identifier: seg.identifier ?? null,
        confidence: seg.confidence ?? null,
      },
      extraction,
    });
  }

  return {
    ok: true,
    is_bundle: true,
    segmentation,
    children,
    shared_reference: segmentation.shared_reference ?? null,
    // Stated so no caller can read this as permission. Each child is a suggestion that a
    // person confirms separately; three documents never become three records on their own.
    requires_confirmation: true,
  };
}

module.exports = {
  segmentDocuments, extractBundle, validateSegments, countPdfPages, bundleDetectionEnabled,
  SEGMENTATION_SCHEMA, SEGMENTATION_PROMPT, SEGMENTATION_VERSION,
  MODEL, MAX_CHILDREN,
};
