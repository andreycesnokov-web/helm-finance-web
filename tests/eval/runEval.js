// Field-level evaluation of the native-vision pipeline.
//
// Two things it refuses to do:
//   · report one average. An 85% mean hides which field is wrong, and "usually gets the
//     counterparty right" is not a property an accounting system can be built on.
//   · pass on absence. A fabricated PPN and a missed PPN are different failures, and the
//     critical rates below count the fabrications separately.
//
//   node tests/eval/runEval.js            # offline: replays recorded model answers
//   node tests/eval/runEval.js --live     # calls the provider (costs money)
'use strict';

const path = require('path');
const fs = require('fs');
const { CASES, US } = require('./fixtures');
const V3 = require('../../server/lib/documentVisionV3');
const { validateExtraction } = require('../../server/lib/documentExtractionValidator');

const LIVE = process.argv.includes('--live');
const GOLDEN = path.join(__dirname, 'golden');

const digits = (v) => String(v ?? '').replace(/\D/g, '');
const norm = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/* ── scoring ───────────────────────────────────────────────────────────────
   Each field scores hit / miss / fabricated / n-a:
     hit        got the expected value (or correctly reported nothing)
     miss       expected a value, got nothing or the wrong one
     fabricated expected NOTHING, and a value was produced — the dangerous case */
const FIELDS = ['document_type', 'document_number', 'current_business', 'counterparty_name',
  'counterparty_npwp', 'document_date', 'due_date', 'dpp', 'ppn', 'total', 'direction'];

function scoreField(name, expected, actual, cmp) {
  const wantNothing = expected === null || expected === undefined;
  const gotNothing = actual === null || actual === undefined || actual === '';
  if (wantNothing && gotNothing) return 'hit';
  if (wantNothing && !gotNothing) return 'fabricated';
  if (gotNothing) return 'miss';
  return cmp(expected, actual) ? 'hit' : 'miss';
}

const eqExact = (a, b) => a === b;
const eqNum = (a, b) => Number(a) === Number(b);
const eqName = (a, b) => {
  const x = norm(a); const y = norm(b);
  return x === y || (x.length > 8 && (y.includes(x) || x.includes(y)));
};
const eqNpwp = (a, b) => digits(a) === digits(b);
const eqType = (list, a) => (Array.isArray(list) ? list : [list]).includes(a);

function scoreCase(c, v3, validation) {
  const ex = v3?.extraction || null;
  const n = validation?.normalized || {};
  const parties = Array.isArray(ex?.parties) ? ex.parties : [];
  const byId = (id) => parties.find((p) => p.party_id === id) || null;

  if (c.expect.unreadable) {
    // For an unreadable page the ONLY correct behaviour is to report that.
    const readable = !!ex && (parties.length > 0 || n.total !== null);
    return {
      id: c.id, fields: {}, critical: {},
      unreadable_handled: !readable,
      note: readable ? 'claimed to read an image-only page' : 'correctly reported nothing',
    };
  }

  const cpName = n.counterparty?.legal_name ?? null;
  const cpNpwp = n.counterparty?.npwp ?? null;
  const usParty = byId(ex?.current_business_party_id);
  const e = c.expect;

  const fields = {
    document_type: scoreField('document_type', e.document_type, n.document_type, eqType),
    document_number: scoreField('document_number', e.document_number, n.document_number, eqExact),
    current_business: e.must_self_match
      // The requirement is that our own company is never OFFERED as the counterparty.
      // Both a self_match verdict and simply returning no candidate satisfy it; scoring
      // only the first was too narrow and marked a correct refusal as a miss.
      ? ((validation.counterparty_status === 'self_match' || !cpName)
        && validation.can_create_counterparty === false ? 'hit' : 'miss')
      : scoreField('current_business', US.legal_name, usParty?.legal_name?.value ?? null, eqName),
    counterparty_name: scoreField('counterparty_name', e.counterparty_name, cpName, eqName),
    counterparty_npwp: scoreField('counterparty_npwp', e.counterparty_npwp, cpNpwp, eqNpwp),
    document_date: scoreField('document_date', e.document_date, n.document_date, eqExact),
    due_date: scoreField('due_date', e.due_date, n.due_date, eqExact),
    dpp: scoreField('dpp', e.dpp, n.dpp, eqNum),
    ppn: scoreField('ppn', e.ppn, n.ppn, eqNum),
    total: scoreField('total', e.total, n.total, eqNum),
    direction: (() => {
      if (e.direction === 'blocked') return validation.can_create_financial_record === false ? 'hit' : 'miss';
      if (e.direction === 'not_payable') return validation.can_create_financial_record === false ? 'hit' : 'miss';
      // payable/receivable: judged by which side we are on
      const buyerRoles = ['buyer', 'customer', 'payer', 'taxable_entrepreneur_buyer'];
      const weAreBuyer = buyerRoles.includes(usParty?.role);
      return weAreBuyer === !!e.current_business_is_buyer ? 'hit' : 'miss';
    })(),
  };

  // ── the five rates that must be zero ────────────────────────────────────
  const usNpwp = digits(US.npwp);
  const critical = {
    // our own company offered as the counterparty
    self_match: !!cpName && (eqName(cpName, US.legal_name) || digits(cpNpwp) === usNpwp),
    // a name carrying a different party's number
    cross_party_mixing: parties.some((p) => {
      const nm = p?.legal_name?.value; const np = digits(p?.npwp?.value);
      if (!nm || !np) return false;
      const other = parties.find((q) => q !== p && digits(q?.npwp?.value) === np);
      return !!other;      // two parties sharing one number means one of them borrowed it
    }) || (!!cpName && eqName(cpName, US.legal_name) && !!cpNpwp),
    // a settled document permitting a bill
    receipt_to_payable: ['receipt', 'kwitansi', 'payment_proof'].includes(n.document_type)
      && validation.can_create_financial_record === true,
    fabricated_tax: fields.ppn === 'fabricated',
    fabricated_date: fields.document_date === 'fabricated' || fields.due_date === 'fabricated',
  };

  return { id: c.id, label: c.label, fields, critical, unreadable_handled: null };
}

/* ── running ───────────────────────────────────────────────────────────────*/

async function runCase(c) {
  const goldenPath = path.join(GOLDEN, `${c.id}.json`);
  if (!LIVE) {
    if (!fs.existsSync(goldenPath)) return { skipped: 'no recorded answer — run with --live first' };
    const rec = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
    return { v3: { ok: true, extraction: rec.extraction }, usage: rec.usage || null, replayed: true };
  }
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  process.env.DOCUMENT_OCR_VISION_ENABLED = 'true';
  const v3 = await V3.extractDocumentV3(c.bytes, {
    mime_type: c.mime, file_name: `${c.id}.pdf`, business: US, client,
  });
  if (v3.ok) {
    fs.mkdirSync(GOLDEN, { recursive: true });
    fs.writeFileSync(goldenPath, JSON.stringify({ extraction: v3.extraction, usage: v3.usage }, null, 1));
  }
  return { v3, usage: v3.usage || null };
}

(async () => {
  const rows = [];
  let inTok = 0, outTok = 0, skipped = 0;

  for (const c of CASES) {
    const r = await runCase(c);
    if (r.skipped) { skipped++; rows.push({ id: c.id, skipped: r.skipped }); continue; }
    if (!r.v3?.ok) { rows.push({ id: c.id, failed: r.v3?.reason || 'no result' }); continue; }
    inTok += r.usage?.input_tokens || 0;
    outTok += r.usage?.output_tokens || 0;
    const validation = validateExtraction(r.v3.extraction, { business: US, pagesProvided: c.expect.pages || 1 });
    rows.push(scoreCase(c, r.v3, validation));
  }

  // ── field-level scorecard, never one average ──────────────────────────────
  const scored = rows.filter((r) => r.fields && Object.keys(r.fields).length);
  console.log('\n── FIELD ACCURACY ' + '─'.repeat(46));
  console.log('field'.padEnd(20) + 'hit'.padStart(5) + 'miss'.padStart(6) + 'fabricated'.padStart(12) + '   accuracy');
  const perField = {};
  for (const f of FIELDS) {
    const vals = scored.map((r) => r.fields[f]).filter(Boolean);
    const hit = vals.filter((v) => v === 'hit').length;
    const miss = vals.filter((v) => v === 'miss').length;
    const fab = vals.filter((v) => v === 'fabricated').length;
    const acc = vals.length ? (hit / vals.length * 100).toFixed(0) + '%' : '—';
    perField[f] = { hit, miss, fabricated: fab, accuracy: acc };
    console.log(f.padEnd(20) + String(hit).padStart(5) + String(miss).padStart(6)
      + String(fab).padStart(12) + '   ' + acc.padStart(5));
  }

  console.log('\n── CRITICAL RATES (must all be 0) ' + '─'.repeat(30));
  const criticalKeys = ['self_match', 'cross_party_mixing', 'receipt_to_payable', 'fabricated_tax', 'fabricated_date'];
  const criticals = {};
  for (const k of criticalKeys) {
    const n = scored.filter((r) => r.critical[k]).length;
    criticals[k] = n;
    console.log(`${k.padEnd(24)} ${n}   ${n === 0 ? 'PASS' : 'FAIL'}`);
  }

  const unreadable = rows.filter((r) => r.unreadable_handled !== null && r.unreadable_handled !== undefined);
  for (const u of unreadable) {
    console.log(`${'unreadable_handled'.padEnd(24)} ${u.unreadable_handled ? '1   PASS' : '0   FAIL'}  (${u.note})`);
  }

  console.log('\n── PER DOCUMENT ' + '─'.repeat(48));
  for (const r of rows) {
    if (r.skipped) { console.log(`${r.id.padEnd(26)} SKIPPED — ${r.skipped}`); continue; }
    if (r.failed) { console.log(`${r.id.padEnd(26)} FAILED  — ${r.failed}`); continue; }
    if (!r.fields || !Object.keys(r.fields).length) { console.log(`${r.id.padEnd(26)} ${r.note}`); continue; }
    const bad = Object.entries(r.fields).filter(([, v]) => v !== 'hit');
    console.log(`${r.id.padEnd(26)} ${bad.length === 0 ? 'all fields correct'
      : bad.map(([k, v]) => `${k}:${v}`).join(', ')}`);
  }

  const cost = (inTok / 1e6 * 3 + outTok / 1e6 * 15);
  console.log('\n── COST ' + '─'.repeat(56));
  console.log(`documents scored ${scored.length}${skipped ? ` (${skipped} skipped)` : ''}`
    + ` · input ${inTok} tok · output ${outTok} tok · $${cost.toFixed(4)}`
    + (LIVE ? '' : '  (replayed — no provider calls)'));

  const failedCritical = criticalKeys.filter((k) => criticals[k] > 0);
  const allUnreadableOk = unreadable.every((u) => u.unreadable_handled);
  // Zero documents scored is not a pass. An empty run reporting PASS is exactly the kind
  // of green tick that hides an unevaluated system.
  if (scored.length === 0 && unreadable.length === 0) {
    console.log('\nCRITICAL CRITERIA: NOT EVALUATED — no documents were scored.');
    process.exitCode = 1;
    return;
  }
  console.log(`\n${failedCritical.length === 0 && allUnreadableOk
    ? 'CRITICAL CRITERIA: PASS' : `CRITICAL CRITERIA: FAIL — ${failedCritical.join(', ')}`}`);
  process.exitCode = failedCritical.length === 0 && allUnreadableOk ? 0 : 1;
})();
