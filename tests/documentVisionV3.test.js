// Native visual extraction: what actually gets sent, and what comes back.
// The Anthropic client is a stub, so this runs anywhere with no key and no cost.
// Run: node tests/documentVisionV3.test.js
const assert = require('node:assert');
const V3 = require('../server/lib/documentVisionV3');
const modelPolicy = require('../server/lib/modelPolicy');

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

const PDF_BYTES = Buffer.from('%PDF-1.4 the original document bytes, not a transcript');
const JPG_BYTES = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]);

let SENT = [];
const stub = (input, opts = {}) => ({
  messages: {
    create(req) {
      SENT.push(req);
      if (opts.throws) {
        const e = new Error(opts.throws);
        if (opts.status) e.status = opts.status;
        return Promise.reject(e);
      }
      if (opts.hang) return new Promise(() => {});
      if (opts.noTool) return Promise.resolve({ content: [{ type: 'text', text: 'here you go' }] });
      return Promise.resolve({
        content: [{ type: 'tool_use', name: 'record_financial_document', input }],
        model: opts.respondedModel || V3.MODEL,
        usage: { input_tokens: 4210, output_tokens: 830 },
      });
    },
  },
});

const GOOD = {
  schema_version: V3.SCHEMA_VERSION,
  document_type: { value: 'faktur_pajak', confidence: 0.97, evidence: [{ page: 1, printed_text: 'Faktur Pajak' }] },
  document_number: { value: 'X2610001139', confidence: 0.95, evidence: [] },
  language: ['id'],
  parties: [], dates: {}, amounts: {},
  warnings: [], pages_analyzed: [1], analysis_complete: true,
};

const BUSINESS = { legal_name: 'PT Helm Care Indonesia', display_name: 'Helm Care Indonesia',
  npwp: '09.876.543.2-101.000', aliases: ['HELM CARE'] };

(async () => {
  process.env.DOCUMENT_OCR_VISION_ENABLED = 'true';

  console.log('\n1-4. what is actually sent');
  await t('1. the ORIGINAL PDF bytes go as a native document block', async () => {
    SENT = [];
    await V3.extractDocumentV3(PDF_BYTES, { mime_type: 'application/pdf', business: BUSINESS, client: stub(GOOD) });
    const media = SENT[0].messages[0].content[0];
    assert.strictEqual(media.type, 'document', `content block was ${media.type}`);
    assert.strictEqual(media.source.media_type, 'application/pdf');
    assert.strictEqual(media.source.type, 'base64');
    // byte-for-byte the file we were given — not a re-render, not a transcript
    assert.strictEqual(Buffer.from(media.source.data, 'base64').toString(), PDF_BYTES.toString());
  });

  await t('2. an image goes as a native image block', async () => {
    SENT = [];
    await V3.extractDocumentV3(JPG_BYTES, { mime_type: 'image/jpeg', client: stub(GOOD) });
    const media = SENT[0].messages[0].content[0];
    assert.strictEqual(media.type, 'image');
    assert.strictEqual(media.source.media_type, 'image/jpeg');
    assert.deepStrictEqual(Buffer.from(media.source.data, 'base64'), JPG_BYTES);
  });

  await t('3/4. embedded text NEVER replaces the visual document', async () => {
    SENT = [];
    await V3.extractDocumentV3(PDF_BYTES, {
      mime_type: 'application/pdf', embedded_text: 'Invoice INV-1 Netto 5.000',
      business: BUSINESS, client: stub(GOOD),
    });
    const content = SENT[0].messages[0].content;
    assert.strictEqual(content[0].type, 'document', 'the document block still comes first');
    const text = content[1].text;
    assert.ok(/SUPPLEMENTARY evidence only/i.test(text), 'text is labelled supplementary');
    assert.ok(/visual document above is the source of truth/i.test(text), text.slice(0, 200));
  });

  await t('the file name is passed as a WEAK hint, never as a classification', async () => {
    SENT = [];
    await V3.extractDocumentV3(PDF_BYTES, {
      mime_type: 'application/pdf', file_name: 'NPWP_PT_SOMETHING.pdf', client: stub(GOOD),
    });
    const text = SENT[0].messages[0].content[1].text;
    assert.ok(/WEAK hint only/i.test(text), text);
    assert.ok(/never classify from it/i.test(text), text);
  });

  console.log('\n5/6. the output is a structure, not prose');
  await t('5. the schema is forced through tool use', async () => {
    SENT = [];
    await V3.extractDocumentV3(PDF_BYTES, { mime_type: 'application/pdf', client: stub(GOOD) });
    const req = SENT[0];
    assert.ok(Array.isArray(req.tools) && req.tools.length === 1, 'a tool must be declared');
    assert.strictEqual(req.tools[0].name, 'record_financial_document');
    assert.strictEqual(req.tool_choice.type, 'tool', 'the tool must be FORCED, not offered');
    assert.strictEqual(req.tool_choice.name, 'record_financial_document');
    assert.strictEqual(req.temperature, 0, 'extraction is not a creative task');
    assert.ok(req.tools[0].input_schema.required.includes('parties'));
  });

  console.log('\nModel policy — every document is read by Opus');
  await t('POLICY: primary extraction resolves to Opus, never anything cheaper', () => {
    assert.strictEqual(V3.MODEL, modelPolicy.PRIMARY_EXTRACTION_MODEL);
    assert.ok(modelPolicy.isOpus(V3.MODEL), `primary extraction used ${V3.MODEL}`);
    assert.ok(/^claude-opus-/.test(V3.MODEL));
    // and the module must not carry a hard-coded model of its own
    const src = require('fs').readFileSync(require.resolve('../server/lib/documentVisionV3'), 'utf8');
    assert.ok(!/claude-sonnet|claude-haiku|claude-fable/.test(src),
      'no non-Opus model name may appear in the primary extraction path');
  });

  await t('POLICY: every Opus-required task really resolves to Opus', () => {
    for (const task of modelPolicy.OPUS_REQUIRED_TASKS) {
      assert.ok(modelPolicy.isOpus(modelPolicy.modelFor(task)), `${task} must use Opus`);
    }
    assert.throws(() => modelPolicy.modelFor('nonexistent_task'), /unknown task/);
  });

  await t('POLICY: an auxiliary model can never satisfy primary extraction', () => {
    for (const m of modelPolicy.AUXILIARY_MODELS) {
      assert.strictEqual(modelPolicy.isOpus(m), false, `${m} must not pass as Opus`);
    }
  });

  // ── proven against the live API, 2026-09-05 ───────────────────────────────
  // Probe run inside the production container: SDK 0.20.9 accepted the PDF document
  // block, the tools array and a forced tool_choice, answering with stop_reason
  // "tool_use". These assertions encode that contract so a regression in the request
  // shape fails here rather than in production.
  await t('LIVE-VERIFIED: the request shape the provider accepted', async () => {
    SENT = [];
    await V3.extractDocumentV3(PDF_BYTES, { mime_type: 'application/pdf', business: BUSINESS, client: stub(GOOD) });
    const req = SENT[0];
    assert.ok(modelPolicy.isOpus(req.model), `the request went out with ${req.model}`);
    assert.strictEqual(req.messages[0].content[0].type, 'document');
    assert.strictEqual(req.messages[0].content[0].source.media_type, 'application/pdf');
    assert.ok(Array.isArray(req.tools) && req.tools[0].input_schema, 'tools[] with a JSON Schema');
    assert.deepStrictEqual(req.tool_choice, { type: 'tool', name: 'record_financial_document' });
    assert.ok(typeof req.max_tokens === 'number' && req.max_tokens > 0);
  });

  await t('LIVE-VERIFIED: schema_version is stamped by us, not by the model', async () => {
    // The first live run returned "1.0" for schema_version, because the field was a free
    // string. It is pinned in the schema now AND overwritten on the way out.
    const wrong = { ...GOOD, schema_version: '1.0' };
    const r = await V3.extractDocumentV3(PDF_BYTES, { mime_type: 'application/pdf', client: stub(wrong) });
    assert.strictEqual(r.extraction.schema_version, V3.SCHEMA_VERSION, 'ours wins');
    assert.strictEqual(r.model_reported_schema_version, '1.0', 'what the model said is kept, separately');
    const enumField = V3.EXTRACTION_SCHEMA.properties.schema_version;
    assert.deepStrictEqual(enumField.enum, [V3.SCHEMA_VERSION], 'and the schema pins it');
  });

  await t('the returned tool input is handed back as the extraction', async () => {
    const r = await V3.extractDocumentV3(PDF_BYTES, { mime_type: 'application/pdf', client: stub(GOOD) });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.source, 'native_pdf_vision');
    assert.strictEqual(r.extraction.document_type.value, 'faktur_pajak');
    assert.strictEqual(r.model, V3.MODEL);
    assert.strictEqual(r.schema_version, V3.SCHEMA_VERSION);
    assert.ok(typeof r.duration_ms === 'number');
    assert.deepStrictEqual(r.usage, { input_tokens: 4210, output_tokens: 830 });
  });

  await t('6. an answer with no tool call is rejected, not parsed out of prose', async () => {
    const r = await V3.extractDocumentV3(PDF_BYTES, { mime_type: 'application/pdf', client: stub(GOOD, { noTool: true }) });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no_tool_output');
  });

  console.log('\nGuards and failure');
  await t('the flag gates every call — nothing is sent when it is off', async () => {
    delete process.env.DOCUMENT_OCR_VISION_ENABLED;
    SENT = [];
    const r = await V3.extractDocumentV3(PDF_BYTES, { mime_type: 'application/pdf', client: stub(GOOD) });
    assert.strictEqual(r.reason, 'vision_disabled');
    assert.strictEqual(SENT.length, 0, 'a disabled feature must not call a paid API');
    process.env.DOCUMENT_OCR_VISION_ENABLED = 'true';
  });

  await t('an oversized file is refused before it is sent', async () => {
    SENT = [];
    const r = await V3.extractDocumentV3(Buffer.alloc(V3.MAX_BYTES + 1), { mime_type: 'application/pdf', client: stub(GOOD) });
    assert.strictEqual(r.reason, 'file_too_large');
    assert.strictEqual(SENT.length, 0);
  });

  await t('too many pages is refused rather than partly analysed', async () => {
    SENT = [];
    const r = await V3.extractDocumentV3(PDF_BYTES, {
      mime_type: 'application/pdf', pageCount: V3.MAX_PAGES + 5, client: stub(GOOD) });
    assert.strictEqual(r.reason, 'too_many_pages');
    assert.strictEqual(SENT.length, 0, 'never analyse part of a document and call it the document');
    assert.ok(/up to 20/.test(r.warnings[0]), r.warnings[0]);
  });

  await t('an unsupported media type is refused', async () => {
    const r = await V3.extractDocumentV3(Buffer.from('a,b'), { mime_type: 'text/csv', file_name: 'x.csv', client: stub(GOOD) });
    assert.strictEqual(r.reason, 'unsupported_media_type');
  });

  await t('21. a provider failure never throws and never loses the document', async () => {
    const r = await V3.extractDocumentV3(PDF_BYTES, { mime_type: 'application/pdf', client: stub(GOOD, { throws: 'overloaded' }) });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'vision_request_failed');
    assert.ok(typeof r.duration_ms === 'number');
    // The document is not analysed, the user is told so, and the failure is retryable.
    assert.strictEqual(r.analyzed, false);
    assert.strictEqual(r.retryable, true);
    assert.ok(/retry/i.test(r.user_message), r.user_message);
  });

  await t('a retryable failure is told apart from a permanent one', async () => {
    const retryable = await V3.extractDocumentV3(PDF_BYTES,
      { mime_type: 'application/pdf', client: stub(GOOD, { throws: 'overloaded', status: 529 }) });
    assert.strictEqual(retryable.reason, 'provider_overloaded');
    assert.strictEqual(retryable.retryable, true);

    const permanent = await V3.extractDocumentV3(Buffer.alloc(V3.MAX_BYTES + 1, 1),
      { mime_type: 'application/pdf', client: stub(GOOD) });
    assert.strictEqual(permanent.reason, 'file_too_large');
    assert.strictEqual(permanent.retryable, false,
      'retrying an oversized file forever is not a plan');
  });

  await t('the model being unreachable is named, not folded into a generic error', async () => {
    const r = await V3.extractDocumentV3(PDF_BYTES,
      { mime_type: 'application/pdf', client: stub(GOOD, { throws: 'not_found', status: 404 }) });
    assert.strictEqual(r.reason, 'model_unavailable');
    assert.strictEqual(r.retryable, true);
  });

  await t('an answer from a non-Opus model is refused, not stored', async () => {
    // The single guarantee the whole policy rests on: even if the provider answered with
    // something else, that answer never becomes an extraction.
    const r = await V3.extractDocumentV3(PDF_BYTES,
      { mime_type: 'application/pdf', client: stub(GOOD, { respondedModel: 'claude-sonnet-5' }) });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'model_policy_violation');
    assert.strictEqual(r.analyzed, false);
    assert.strictEqual(r.retryable, false);
    assert.strictEqual(r.extraction, undefined, 'no extraction may survive a policy violation');
    assert.strictEqual(r.responded_model, 'claude-sonnet-5');
  });

  await t('a successful reading records which model actually answered', async () => {
    const r = await V3.extractDocumentV3(PDF_BYTES, { mime_type: 'application/pdf', client: stub(GOOD) });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.analyzed, true);
    assert.ok(modelPolicy.isOpus(r.responded_model), r.responded_model);
  });

  await t('no user-facing message mentions a model, a provider or a cost', async () => {
    for (const [reason, msg] of Object.entries(V3.USER_MESSAGE)) {
      for (const leak of [/opus/i, /sonnet/i, /claude/i, /anthropic/i, /token/i, /[$]/]) {
        assert.ok(!leak.test(msg), `${reason} leaks ${leak} to the customer: ${msg}`);
      }
    }
  });

  await t('no client configured is a reason, not a crash', async () => {
    const r = await V3.extractDocumentV3(PDF_BYTES, { mime_type: 'application/pdf', client: null });
    assert.strictEqual(r.reason, 'vision_not_configured');
  });

  console.log('\nThe business profile is given, never assumed');
  await t('9/10/11. the current business identity is passed into the request', async () => {
    SENT = [];
    await V3.extractDocumentV3(PDF_BYTES, { mime_type: 'application/pdf', business: BUSINESS, client: stub(GOOD) });
    const text = SENT[0].messages[0].content[1].text;
    assert.ok(text.includes('PT Helm Care Indonesia'), 'legal name');
    assert.ok(text.includes('09.876.543.2-101.000'), 'npwp');
    assert.ok(text.includes('HELM CARE'), 'alias');
  });

  await t('12. the prompt states the rules the pipeline depends on', () => {
    // The prompt is wrapped text, so match on words rather than on layout.
    const flat = V3.SYSTEM_PROMPT.replace(/\s+/g, ' ');
    assert.ok(/never return the user's own company as its own counterparty/i.test(flat),
      'self-match rule must be stated');
    assert.ok(/name from one block must never be paired with an NPWP from another block/i.test(flat),
      'cross-party pairing rule must be stated');
    assert.ok(/reference number, invoice code, document title or heading as a company name/i.test(flat),
      'reference codes must not become companies');
    assert.ok(/missing NPWP is safer than a wrong one/i.test(flat));
    assert.ok(/Return null rather than guessing/i.test(flat));
    assert.ok(/KWITANSI .* is a RECEIPT/i.test(flat), 'kwitansi guidance must be present');
  });

  await t('the schema keeps each party whole', () => {
    const party = V3.EXTRACTION_SCHEMA.properties.parties.items;
    assert.ok(party.properties.legal_name && party.properties.npwp,
      'name and npwp live on the same object');
    assert.ok(party.required.includes('legal_name') && party.required.includes('npwp'));
    const d = V3.EXTRACTION_SCHEMA.properties.dates.properties;
    assert.ok(d.document_date && d.due_date && d.payment_date, 'three dates, three fields');
    const a = V3.EXTRACTION_SCHEMA.properties.amounts.properties;
    assert.ok(a.dpp && a.ppn && a.total, 'DPP, PPN and total are separate');
    assert.ok(a.ppn.properties.calculated, 'a derived figure must declare itself');
  });

  delete process.env.DOCUMENT_OCR_VISION_ENABLED;
  console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
