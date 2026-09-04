// Counterparty Intelligence V1 — normalisation, matching, role detection, duplicates.
// Run: node tests/counterpartyIntelligence.test.js
const assert = require('node:assert');
const C = require('../server/lib/counterpartyIntelligence');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

const BUSINESS = 'PT Helm Care Indonesia';

// ── 1. normalisation ───────────────────────────────────────────────────────
t('1. the Circleka name variants all normalise together', () => {
  const forms = ['PT Circleka Indonesia Utama', 'PT. Circleka Indonesia Utama',
                 'CIRCLEKA INDONESIA UTAMA', 'pt circleka indonesia utama'];
  const normalised = forms.map(C.normalizeName);
  assert.strictEqual(new Set(normalised).size, 1, `got ${JSON.stringify(normalised)}`);
  assert.strictEqual(normalised[0], 'circleka indonesia utama');
});

t('the short form is recognised as highly similar, not identical', () => {
  const s = C.nameSimilarity('Circleka', 'PT Circleka Indonesia Utama');
  assert.ok(s >= 0.85, `similarity was ${s}`);
  assert.ok(s < 1, 'containment must not claim certainty');
});

t('legal forms alone never make two companies match', () => {
  assert.strictEqual(C.nameSimilarity('PT Alpha', 'PT Beta'), 0);
  assert.strictEqual(C.normalizeName('PT'), '');
});

t('NPWP and account numbers normalise to digits', () => {
  assert.strictEqual(C.normalizeNpwp('00.207.974.4-500.7000'), '0020797445007000');
  assert.strictEqual(C.normalizeNpwp('short'), null);
  assert.strictEqual(C.normalizeAccount('075-3020192'), '0753020192');
  assert.strictEqual(C.normalizeAccount('12'), null);
});

// ── 2 & 3. role detection ──────────────────────────────────────────────────
t('2. an invoice issued TO us makes the issuer a vendor / payable', () => {
  const r = C.detectRole({ issuer_name: 'PT Circleka Indonesia Utama',
    buyer_name: 'PT Helm Care Indonesia', business_name: BUSINESS });
  assert.strictEqual(r.role, 'vendor');
  assert.strictEqual(r.direction, 'payable');
  assert.strictEqual(r.confidence, 'high');
});

t('an invoice issued BY us makes the recipient a customer / receivable', () => {
  const r = C.detectRole({ issuer_name: 'PT Helm Care Indonesia',
    buyer_name: 'PT ABC Retail', business_name: BUSINESS });
  assert.strictEqual(r.role, 'customer');
  assert.strictEqual(r.direction, 'receivable');
});

t('3. incoming money suggests a customer, outgoing a vendor', () => {
  assert.strictEqual(C.detectRole({ payment_direction: 'incoming' }).role, 'customer');
  assert.strictEqual(C.detectRole({ payment_direction: 'incoming' }).direction, 'incoming_payment');
  assert.strictEqual(C.detectRole({ payment_direction: 'outgoing' }).role, 'vendor');
});

t('neither party being us is needs_review, never a guess', () => {
  const r = C.detectRole({ issuer_name: 'PT A', buyer_name: 'PT B', business_name: BUSINESS });
  assert.strictEqual(r.role, 'unknown');
  assert.strictEqual(r.confidence, 'needs_review');
});

// ── 4-8. matching ──────────────────────────────────────────────────────────
const EXISTING = [
  { id: 'cp-1', legal_name: 'PT Circleka Indonesia Utama', npwp: '00.207.974.4-500.7000',
    bank_accounts: [{ account_number: '075-3020192', bank_name: 'BCA' }],
    aliases: ['Circle K'], email: 'ap@circleka.co.id' },
  { id: 'cp-2', legal_name: 'PT Other Vendor', npwp: '11.111.111.1-111.111', bank_accounts: [] },
  { id: 'cp-3', legal_name: 'PT Archived Co', npwp: '22.222.222.2-222.222', status: 'archived' },
];

t('4. an exact NPWP match resolves to matched, on its own', () => {
  const r = C.matchCounterparty({ legal_name: 'Totally Different Name', npwp: '0020797445007000' }, EXISTING);
  assert.strictEqual(r.status, 'matched');
  assert.strictEqual(r.matched_counterparty_id, 'cp-1');
  assert.ok(r.match_reasons.some((x) => /Same NPWP/.test(x)));
});

t('5. an exact bank account match resolves to matched', () => {
  const r = C.matchCounterparty({ legal_name: 'Unknown Co',
    bank_accounts: [{ account_number: '0753020192' }] }, EXISTING);
  assert.strictEqual(r.status, 'matched');
  assert.strictEqual(r.matched_counterparty_id, 'cp-1');
  assert.ok(r.match_reasons.some((x) => /Same bank account/.test(x)));
});

t('6. an alias match is found', () => {
  const r = C.matchCounterparty({ legal_name: 'Circle K' }, EXISTING);
  assert.ok(['matched', 'possible_match'].includes(r.status));
  assert.strictEqual(r.possible_matches.concat([{ counterparty_id: r.matched_counterparty_id }])
    .some((p) => p.counterparty_id === 'cp-1'), true);
});

t('7. a similar name is only ever a possible_match, never matched', () => {
  const r = C.matchCounterparty({ legal_name: 'PT. Circleka Indonesia Utama' }, EXISTING);
  assert.strictEqual(r.status, 'possible_match');
  assert.strictEqual(r.matched_counterparty_id, null, 'a name must not auto-link');
  assert.ok(r.warnings.some((w) => /not proof of identity/i.test(w)));
});

t('8. an unrelated party is not_found', () => {
  const r = C.matchCounterparty({ legal_name: 'PT Zeta Logistics Nusantara', npwp: '99.999.999.9-999.999' }, EXISTING);
  assert.strictEqual(r.status, 'not_found');
  assert.strictEqual(r.matched_counterparty_id, null);
  assert.strictEqual(r.possible_matches.length, 0);
});

t('16. an archived counterparty is never matched', () => {
  const r = C.matchCounterparty({ legal_name: 'PT Archived Co', npwp: '222222222222222' }, EXISTING);
  assert.strictEqual(r.status, 'not_found');
});

// ── suggestion from the Circleka document ──────────────────────────────────
const CIRCLEKA_EXTRACTION = {
  fields: {
    issuer_name: 'PT Circleka Indonesia Utama',
    buyer_name: 'PT Helm Care Indonesia',
    issuer_npwp: '00.207.974.4-500.7000',
    description: 'Rent space / placement of Helm Care machines in 36 Circle K stores',
    commercial_base_amount: 129600000, commercial_tax_amount: 14256000, gross_amount: 143856000,
    bank_name: 'BCA', to_account_number: '075-3020192', to_account_name: 'CIRCLEKA INDONESIA UTAMA',
    currency: 'IDR',
  },
};

t('suggests Circleka as a vendor with the right defaults', () => {
  const s = C.suggestFromDocument(CIRCLEKA_EXTRACTION, { business_name: BUSINESS });
  const p = s.suggested_counterparty;
  assert.strictEqual(p.legal_name, 'PT Circleka Indonesia Utama');
  assert.strictEqual(p.role, 'vendor');
  assert.strictEqual(s.direction, 'payable');
  assert.strictEqual(p.npwp, '00.207.974.4-500.7000');
  assert.strictEqual(p.pkp_status, 'pkp', 'PPN on the document implies a PKP vendor');
  assert.strictEqual(p.bank_accounts[0].account_number, '075-3020192');
  assert.ok(/rent/i.test(p.default_category), p.default_category);
  assert.ok(/4\(2\)/.test(p.default_tax_treatment), p.default_tax_treatment);
  assert.strictEqual(s.requires_confirmation, true, 'suggestion must never self-apply');
});

t('a payee name that normalises to the same thing is NOT stored as a noise alias', () => {
  // "CIRCLEKA INDONESIA UTAMA" and "PT Circleka Indonesia Utama" already normalise
  // together, so an alias row would add nothing and would have to be maintained.
  const s = C.suggestFromDocument(CIRCLEKA_EXTRACTION, { business_name: BUSINESS });
  assert.deepStrictEqual(s.suggested_counterparty.aliases, []);
  // and matching still resolves the account-name form without needing that alias
  const m = C.matchCounterparty({ legal_name: 'CIRCLEKA INDONESIA UTAMA' }, EXISTING);
  assert.ok(['matched', 'possible_match'].includes(m.status));
});

t('a genuinely different payee name IS captured as an alias', () => {
  const s = C.suggestFromDocument({ fields: {
    ...CIRCLEKA_EXTRACTION.fields, to_account_name: 'CIRCLE K INDONESIA',
  } }, { business_name: BUSINESS });
  assert.ok(s.suggested_counterparty.aliases.includes('CIRCLE K INDONESIA'),
    JSON.stringify(s.suggested_counterparty.aliases));
});

t('3b. an incoming payment suggests a customer with their account', () => {
  const s = C.suggestFromPayment({ bank_name: 'BCA', from_account_number: '111-2223334',
    from_account_name: 'PT ABC RETAIL' }, { direction: 'incoming' });
  assert.strictEqual(s.suggested_counterparty.role, 'customer');
  assert.strictEqual(s.direction, 'incoming_payment');
  assert.strictEqual(s.suggested_counterparty.bank_accounts[0].account_number, '111-2223334');
  assert.strictEqual(s.requires_confirmation, true);
});

t('17. vendor, customer and both are all valid roles', () => {
  for (const r of ['vendor', 'customer', 'both']) assert.ok(C.ROLES.includes(r), r);
});

// ── 9 & 10. duplicate protection ───────────────────────────────────────────
t('9. creating a counterparty that shares an NPWP is blocked', () => {
  const d = C.findDuplicates({ legal_name: 'PT Circleka Ind. Utama', npwp: '0020797445007000' }, EXISTING);
  assert.strictEqual(d.duplicate, true);
  assert.strictEqual(d.blocking, true);
  assert.strictEqual(d.matched_counterparty_id, 'cp-1');
  assert.ok(/already exists/i.test(d.message));
});

t('a similar name is blocked as a possible duplicate, needing confirmation', () => {
  const d = C.findDuplicates({ legal_name: 'PT Circleka Indonesia Utama' }, EXISTING);
  assert.strictEqual(d.duplicate, true);
  assert.strictEqual(d.blocking, true);
  assert.ok(d.possible_matches.length > 0);
});

t('a genuinely new counterparty is not blocked', () => {
  const d = C.findDuplicates({ legal_name: 'PT Brand New Supplier', npwp: '55.555.555.5-555.555' }, EXISTING);
  assert.strictEqual(d.duplicate, false);
  assert.strictEqual(d.blocking, false);
});

// ── invariants ─────────────────────────────────────────────────────────────
t('19. nothing in this module ever creates or mutates anything', () => {
  const before = JSON.stringify(EXISTING);
  C.matchCounterparty({ legal_name: 'PT Circleka Indonesia Utama', npwp: '0020797445007000' }, EXISTING);
  C.suggestFromDocument(CIRCLEKA_EXTRACTION, { business_name: BUSINESS });
  C.findDuplicates({ legal_name: 'X' }, EXISTING);
  assert.strictEqual(JSON.stringify(EXISTING), before, 'inputs must not be mutated');
});

t('an empty directory yields not_found, never an error', () => {
  const r = C.matchCounterparty({ legal_name: 'PT Anything' }, []);
  assert.strictEqual(r.status, 'not_found');
  const s = C.suggestFromDocument({ fields: {} }, { business_name: BUSINESS });
  assert.strictEqual(s.suggested_counterparty.legal_name, null);
  assert.ok(s.warnings.length > 0);
});

console.log(`\n${pass} passed`);
