// "What is this document?" — who decides the type, the fail-open contract, scans sent as files.
// No network: the Anthropic client is a stub. Run: node tests/documentIdentify.test.js
const assert = require('node:assert');
const ID = require('../server/lib/documentIdentify');
const docContent = require('../server/lib/documentContent');
const { INTAKE_TYPES } = require('../server/lib/documentIntake');

const TYPES = INTAKE_TYPES.map((x) => x.type);
let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};
const calls = [];
const stub = (payload, opts = {}) => ({
  messages: {
    create(args) {
      calls.push(args);
      if (opts.throws) return Promise.reject(new Error(opts.throws));
      return Promise.resolve({ content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }] });
    },
  },
});

// The owner's real case (2026-10-09): an AHU letter about a change of directors.
const AHU = `KEMENTERIAN HUKUM REPUBLIK INDONESIA DIREKTORAT JENDERAL ADMINISTRASI HUKUM UMUM
Nomor : AHU-AH.01.09-0108809 Perihal : Penerimaan Pemberitahuan Perubahan Data Perseroan PT HELM CARE INDONESIA
Sesuai dengan data dalam format Isian Perubahan ... Akta Notaris Nomor 40 Tanggal 20 Januari 2026 ... perubahan Direksi Dan Komisaris`;
const ANSWER = {
  title: 'Уведомление Минюста: смена директоров', summary: 'Минюст принял уведомление об изменении состава директоров и комиссаров PT Helm Care Indonesia.',
  issued_by: 'Kementerian Hukum RI (AHU)', issued_on: '2026-02-27', number: 'AHU-AH.01.09-0108809',
  purpose: 'Подтверждает, что изменения в руководстве зарегистрированы.', place: 'company_documents',
  next_step: 'Хранить в документах компании вместе с актом №40.', suggested_type: 'sk_kemenkumham', warnings: [],
};

(async () => {
  console.log('\nidentify — who decides');
  await t('classifier reads the AHU letter as a Kemenkumham document', () => {
    const v = docContent.classifyDocument({ file_name: 'cetak_sp_4026021851241389.pdf', text: AHU, text_available: true, method: 'embedded_text' });
    assert.ok(['sk_kemenkumham', 'akta'].includes(v.doc_type), v.doc_type);
  });
  await t('a confident classifier wins over the model', () => {
    const k = ID.suggestedKind({ doc_type: 'npwp', confidence: 'high' }, { suggested_type: 'invoice' });
    assert.deepStrictEqual(k, { type: 'npwp', source: 'classifier', confidence: 'high' });
  });
  await t('an unsure classifier: the model proposes, labelled as the model', () => {
    const k = ID.suggestedKind({ doc_type: 'unknown', confidence: 'unknown' }, { suggested_type: 'bank_statement' });
    assert.strictEqual(k.type, 'bank_statement'); assert.strictEqual(k.source, 'ai');
  });
  await t('model agreeing with a medium verdict → high', () => {
    assert.strictEqual(ID.suggestedKind({ doc_type: 'sk_kemenkumham', confidence: 'medium' }, { suggested_type: 'sk_kemenkumham' }).confidence, 'high');
  });
  await t('no model answer → the classifier verdict, or nothing', () => {
    assert.strictEqual(ID.suggestedKind({ doc_type: 'akta', confidence: 'low' }, null).type, 'akta');
    assert.strictEqual(ID.suggestedKind({ doc_type: 'unknown' }, null), null);
  });

  console.log('\nidentify — the model explains, in the user language');
  process.env.ANTHROPIC_API_KEY = 'test-key';
  await t('text document: one call, Russian requested, answer normalised', async () => {
    calls.length = 0;
    const r = await ID.explainDocument({ client: stub(ANSWER), text: AHU, verdict: { doc_type: 'sk_kemenkumham', confidence: 'medium' }, types: TYPES, lang: 'ru', file_name: 'x.pdf' });
    assert.ok(r.ok); assert.strictEqual(calls.length, 1);
    assert.ok(/Write in Russian/.test(calls[0].messages[0].content));
    assert.strictEqual(r.explanation.place, 'company_documents');
    assert.strictEqual(r.explanation.number, 'AHU-AH.01.09-0108809');
  });
  await t('invented type and bad date are dropped', async () => {
    const r = await ID.explainDocument({ client: stub({ ...ANSWER, suggested_type: 'passport', issued_on: '27 Feb', place: 'drawer' }), text: AHU, verdict: {}, types: TYPES });
    assert.strictEqual(r.explanation.suggested_type, null); assert.strictEqual(r.explanation.issued_on, ''); assert.strictEqual(r.explanation.place, 'other');
  });
  await t('a scan (no text) is sent as the file itself', async () => {
    calls.length = 0;
    const r = await ID.explainDocument({ client: stub(ANSWER), text: '', buffer: Buffer.from('%PDF-1.4 scan'), mime_type: 'application/pdf', file_name: '6.PDF', verdict: {}, types: TYPES });
    assert.ok(r.ok); assert.strictEqual(calls[0].messages[0].content[0].type, 'document');
  });
  await t('a photo with a generic MIME is sent as an image by its extension', async () => {
    calls.length = 0;
    await ID.explainDocument({ client: stub(ANSWER), text: '', buffer: Buffer.from('jpg'), mime_type: 'application/octet-stream', file_name: 'WhatsApp_Image.jpeg', verdict: {}, types: TYPES });
    assert.strictEqual(calls[0].messages[0].content[0].type, 'image');
  });

  console.log('\nidentify — fail-open');
  await t('unreadable file (no text, not pdf/image) → no call', async () => {
    calls.length = 0;
    const r = await ID.explainDocument({ client: stub(ANSWER), text: '', buffer: Buffer.from('x'), file_name: 'a.docx', verdict: {}, types: TYPES });
    assert.deepStrictEqual(r, { ok: false, reason: 'unreadable' }); assert.strictEqual(calls.length, 0);
  });
  await t('provider error / garbage → ok:false, never throws', async () => {
    assert.strictEqual((await ID.explainDocument({ client: stub(ANSWER, { throws: 'boom' }), text: AHU, verdict: {}, types: TYPES })).reason, 'ai_request_failed');
    assert.strictEqual((await ID.explainDocument({ client: stub('not json'), text: AHU, verdict: {}, types: TYPES })).reason, 'ai_unparseable');
  });
  await t('no API key → ai_unavailable', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    assert.strictEqual((await ID.explainDocument({ client: stub(ANSWER), text: AHU, verdict: {}, types: TYPES })).reason, 'ai_unavailable');
  });

  console.log('\nidentify — server wiring');
  const fs = require('node:fs');
  const server = fs.readFileSync(require('node:path').join(__dirname, '..', 'server', 'index.js'), 'utf8');
  await t('route exists, role- and access-checked', () => {
    const i = server.indexOf("app.post('/api/documents/:id/identify'");
    assert.ok(i > 0);
    const body = server.slice(i, server.indexOf('\napp.', i + 10));
    for (const s of ['canViewBusinessFinance', 'hasDocumentsAccess', 'loadDocumentScoped', 'userCanAccessDoc', 'archived_at']) assert.ok(body.includes(s), s);
    assert.ok(!/document_type:|gross_amount|rpc_document_link/.test(body), 'identify must not change type, amount or links');
  });
  await t('stored reading is whitelisted for the API (no classifier internals, no text)', () => {
    assert.ok(server.includes('ai_identify: publicIdentify(ej.ai_identify)'));
    assert.ok(!/IDENTIFY_FIELDS = \[[^\]]*classifier/.test(server));
  });

  console.log(`\nDOCUMENT IDENTIFY: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
