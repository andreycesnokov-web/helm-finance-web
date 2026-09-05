// One PDF, several documents. Three stay three.
// Run: node tests/documentBundle.test.js
const assert = require('node:assert');
const B = require('../server/lib/documentBundle');
const V3 = require('../server/lib/documentVisionV3');
const modelPolicy = require('../server/lib/modelPolicy');

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

process.env.DOCUMENT_OCR_VISION_ENABLED = 'true';
const PDF = Buffer.from('%PDF-1.4 three documents in one scan');

// The real packet this was built for: a kwitansi, the faktur pajak for the same rent,
// and the agreement they both refer to.
const KWT_BUNDLE = {
  is_bundle: true,
  shared_reference: 'TC-2607-0342',
  reasoning: 'Three headings, three issuers, three numbers.',
  documents: [
    { index: 1, document_type: 'kwitansi', title_printed_text: 'KWITANSI', page_start: 1, page_end: 1,
      identifier: 'SAT/Z001/K-P/26/VIII/0133', confidence: 0.96 },
    { index: 2, document_type: 'faktur_pajak', title_printed_text: 'Faktur Pajak', page_start: 2, page_end: 2,
      identifier: '04002600300202886', confidence: 0.97 },
    { index: 3, document_type: 'contract', title_printed_text: 'Surat Kesepakatan Sewa Tempat', page_start: 3, page_end: 3,
      identifier: 'TC-2607-0342', confidence: 0.93 },
  ],
};

const SENT = [];
const stub = (segInput, opts = {}) => ({
  messages: {
    create: async (req) => {
      SENT.push(req);
      if (opts.throws) { const e = new Error(opts.throws); e.status = opts.status; throw e; }
      const isSegmentation = req.tool_choice?.name === 'segment_documents';
      if (isSegmentation) {
        if (opts.segNoTool) return { content: [{ type: 'text', text: 'nope' }] };
        return {
          content: [{ type: 'tool_use', name: 'segment_documents', input: segInput }],
          model: opts.respondedModel || B.MODEL,
          usage: { input_tokens: 2500, output_tokens: 400 },
        };
      }
      return {
        content: [{ type: 'tool_use', name: 'record_financial_document', input: { schema_version: V3.SCHEMA_VERSION, parties: [] } }],
        model: V3.MODEL,
        usage: { input_tokens: 3000, output_tokens: 600 },
      };
    },
  },
});

(async () => {
  console.log('\nSegmentation');

  await t('the reference packet is read as three documents, not one', async () => {
    SENT.length = 0;
    const r = await B.segmentDocuments(PDF, { mime_type: 'application/pdf', client: stub(KWT_BUNDLE), pageCount: 3 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.is_bundle, true);
    assert.strictEqual(r.documents.length, 3);
    assert.deepStrictEqual(r.documents.map((d) => d.identifier),
      ['SAT/Z001/K-P/26/VIII/0133', '04002600300202886', 'TC-2607-0342']);
    assert.strictEqual(r.shared_reference, 'TC-2607-0342');
    assert.deepStrictEqual(r.problems, []);
  });

  await t('segmentation runs on Opus, like every other reading', async () => {
    assert.ok(modelPolicy.isOpus(B.MODEL), B.MODEL);
    SENT.length = 0;
    await B.segmentDocuments(PDF, { mime_type: 'application/pdf', client: stub(KWT_BUNDLE), pageCount: 3 });
    assert.ok(modelPolicy.isOpus(SENT[0].model), SENT[0].model);
    // and the ORIGINAL bytes travel, not a transcript
    const doc = SENT[0].messages[0].content.find((c) => c.type === 'document');
    assert.strictEqual(doc.source.data, PDF.toString('base64'));
  });

  await t('a multi-page single document is not a bundle', async () => {
    const r = await B.segmentDocuments(PDF, {
      mime_type: 'application/pdf', pageCount: 4,
      client: stub({ is_bundle: false, documents: [], shared_reference: null, reasoning: 'One agreement over four pages.' }),
    });
    assert.strictEqual(r.is_bundle, false);
    assert.deepStrictEqual(r.documents, []);
  });

  await t('a claimed bundle with only one document is not a bundle', async () => {
    const r = await B.segmentDocuments(PDF, {
      mime_type: 'application/pdf', pageCount: 1,
      client: stub({ is_bundle: true, shared_reference: null, reasoning: 'x',
        documents: [{ index: 1, document_type: 'invoice', title_printed_text: 'INVOICE', page_start: 1, page_end: 1, identifier: 'A1', confidence: 0.9 }] }),
    });
    assert.strictEqual(r.is_bundle, false);
  });

  await t('overlapping page ranges are reported, not quietly resolved', async () => {
    const r = await B.segmentDocuments(PDF, {
      mime_type: 'application/pdf', pageCount: 3,
      client: stub({ is_bundle: true, shared_reference: null, reasoning: 'x',
        documents: [
          { index: 1, document_type: 'kwitansi', title_printed_text: 'KWITANSI', page_start: 1, page_end: 2, identifier: 'K1', confidence: 0.9 },
          { index: 2, document_type: 'faktur_pajak', title_printed_text: 'Faktur Pajak', page_start: 2, page_end: 3, identifier: 'F1', confidence: 0.9 },
        ] }),
    });
    assert.ok(r.problems.some((p) => /page 2 is claimed by more than one/.test(p)), r.problems.join('|'));
    // A segmentation we cannot trust is not acted on. Reading the file whole is the safe
    // default; reading it as children whose boundaries are doubtful is not.
    assert.strictEqual(r.is_bundle, false);
  });

  await t('a page range past the end of the file is caught', async () => {
    const problems = B.validateSegments([{ index: 1, page_start: 1, page_end: 9 }], 3);
    assert.ok(problems.some((p) => /9 of a 3-page file/.test(p)), problems.join('|'));
  });

  await t('an answer from a non-Opus model is refused here too', async () => {
    const r = await B.segmentDocuments(PDF, {
      mime_type: 'application/pdf', pageCount: 3,
      client: stub(KWT_BUNDLE, { respondedModel: 'claude-sonnet-5' }),
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'model_policy_violation');
    assert.strictEqual(r.is_bundle, false);
  });

  await t('a provider failure is a reason, never a crash', async () => {
    const r = await B.segmentDocuments(PDF, {
      mime_type: 'application/pdf', client: stub(KWT_BUNDLE, { throws: 'busy', status: 529 }),
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'provider_overloaded');
  });

  await t('an image is never treated as a bundle', async () => {
    const r = await B.segmentDocuments(Buffer.from('jpegbytes'), { mime_type: 'image/jpeg', client: stub(KWT_BUNDLE) });
    assert.strictEqual(r.is_bundle, false);
    assert.strictEqual(r.skipped, 'not_a_pdf');
  });

  console.log('\nPer-child extraction');

  await t('each child is extracted separately and scoped to its own pages', async () => {
    SENT.length = 0;
    const r = await B.extractBundle(PDF, { mime_type: 'application/pdf', client: stub(KWT_BUNDLE), pageCount: 3 });
    assert.strictEqual(r.is_bundle, true);
    assert.strictEqual(r.children.length, 3);
    // one segmentation call plus one per child
    assert.strictEqual(SENT.length, 4);
    const childPrompts = SENT.slice(1).map((req) => req.messages[0].content.find((c) => c.type === 'text').text);
    assert.ok(/ONLY the one on page 1/.test(childPrompts[0]), childPrompts[0]);
    assert.ok(/ONLY the one on page 2/.test(childPrompts[1]), childPrompts[1]);
    assert.ok(/ONLY the one on page 3/.test(childPrompts[2]), childPrompts[2]);
    for (const p of childPrompts) {
      assert.ok(/Ignore every other page/.test(p), 'a child must not absorb its neighbours');
    }
  });

  await t('the children keep their own identities — nothing is flattened', async () => {
    const r = await B.extractBundle(PDF, { mime_type: 'application/pdf', client: stub(KWT_BUNDLE), pageCount: 3 });
    const ids = r.children.map((c) => c.segment.identifier);
    assert.deepStrictEqual(ids, ['SAT/Z001/K-P/26/VIII/0133', '04002600300202886', 'TC-2607-0342']);
    assert.strictEqual(new Set(ids).size, 3, 'three documents must stay three');
    const types = r.children.map((c) => c.segment.document_type);
    assert.deepStrictEqual(types, ['kwitansi', 'faktur_pajak', 'contract']);
  });

  await t('a shared reference relates the documents without merging them', async () => {
    const r = await B.extractBundle(PDF, { mime_type: 'application/pdf', client: stub(KWT_BUNDLE), pageCount: 3 });
    assert.strictEqual(r.shared_reference, 'TC-2607-0342');
    assert.strictEqual(r.children.length, 3, 'a shared reference is a relationship, not a merge');
  });

  await t('a bundle creates nothing on its own', async () => {
    const r = await B.extractBundle(PDF, { mime_type: 'application/pdf', client: stub(KWT_BUNDLE), pageCount: 3 });
    assert.strictEqual(r.requires_confirmation, true);
    // The result carries suggestions only. Nothing in it may read as a created record.
    const json = JSON.stringify(r);
    for (const forbidden of ['"created"', '"debt_id"', '"transaction_id"', '"counterparty_id"']) {
      assert.ok(!json.includes(forbidden), `${forbidden} must not appear in a bundle result`);
    }
  });

  await t('a file that is not a bundle returns no children and costs one call', async () => {
    SENT.length = 0;
    const r = await B.extractBundle(PDF, {
      mime_type: 'application/pdf', pageCount: 2,
      client: stub({ is_bundle: false, documents: [], shared_reference: null, reasoning: 'One invoice.' }),
    });
    assert.strictEqual(r.is_bundle, false);
    assert.deepStrictEqual(r.children, []);
    assert.strictEqual(SENT.length, 1, 'no per-child calls for a single document');
  });

  await t('a failed segmentation does not invent children', async () => {
    const r = await B.extractBundle(PDF, {
      mime_type: 'application/pdf', client: stub(KWT_BUNDLE, { throws: 'down', status: 500 }),
    });
    assert.strictEqual(r.is_bundle, false);
    assert.deepStrictEqual(r.children, []);
    assert.strictEqual(r.segmentation.ok, false);
  });

  console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
