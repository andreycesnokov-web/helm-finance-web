// Counterparty Intelligence V1 — who is this party, and do we already know them?
//
// ── WHAT THIS IS ─────────────────────────────────────────────────────────────
// Matching and suggestion logic over counterparties the business already has, plus
// the fields a document extraction produced. Pure: no DB, no network, no writes.
//
// ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
//   * NOT a creator. Every result is a SUGGESTION. Creating a counterparty is an
//     explicit user action; nothing here writes, and nothing may be created on the
//     strength of a match alone.
//   * NOT an identity authority. A name match is a hint. NPWP and bank account are
//     strong because they are registered identifiers, but even those are reported
//     with their reason so a person can disagree.
//   * NOT a deduplicator that acts. It reports likely duplicates and refuses to
//     call them certain; the caller decides.
//
// The rule throughout: strong signals (NPWP, bank account) can carry a match on
// their own. Name similarity alone never reaches "matched" — it can only ever be a
// possible_match, because two real companies can share a word.
'use strict';

/* ── normalisation ─────────────────────────────────────────────────────────
   Indonesian legal forms and punctuation carry no identity: "PT. Circleka
   Indonesia Utama", "CIRCLEKA INDONESIA UTAMA" and "Circleka" must all reduce to
   comparable text. Legal-form tokens are removed rather than kept, because they
   are the single most common source of false differences. */
const LEGAL_FORMS = [
  'pt', 'cv', 'ud', 'pd', 'firma', 'persero', 'tbk', 'perum', 'koperasi',
  'ltd', 'limited', 'inc', 'llc', 'plc', 'gmbh', 'bv', 'pte', 'sdn', 'bhd', 'co',
];

function normalizeName(v) {
  const base = String(v || '')
    .toLowerCase()
    .replace(/[.,''`"()]/g, ' ')
    .replace(/[^a-z0-9\s&-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = base.split(' ').filter((t) => t && !LEGAL_FORMS.includes(t));
  return tokens.join(' ');
}

const nameTokens = (v) => normalizeName(v).split(' ').filter(Boolean);

/** Digits only. An NPWP is written 01.234.567.8-091.000 or 012345678091000. */
const normalizeNpwp = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 12 ? d : null;
};

/** Bank accounts appear as 075-3020192, 075 3020192 or 0753020192. */
const normalizeAccount = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 6 ? d : null;
};

/* ── similarity ────────────────────────────────────────────────────────────
   Token-based and explainable, not an opaque edit distance. Containment is
   treated separately from overlap because "Circleka" inside "Circleka Indonesia
   Utama" is a much stronger signal than a shared common word. */
function nameSimilarity(a, b) {
  const A = nameTokens(a); const B = nameTokens(b);
  if (!A.length || !B.length) return 0;
  const setA = new Set(A); const setB = new Set(B);
  const shared = [...setA].filter((t) => setB.has(t));
  if (!shared.length) return 0;

  const small = A.length <= B.length ? setA : setB;
  const contained = [...small].every((t) => (small === setA ? setB : setA).has(t));
  const jaccard = shared.length / new Set([...setA, ...setB]).size;
  // Full containment of the shorter name is worth more than raw overlap, but is
  // capped below 1 so it can never masquerade as an identifier-grade match.
  return contained ? Math.max(0.85, jaccard) : jaccard;
}

/* ── role and direction ────────────────────────────────────────────────────
   Decided by who issued the document and who received it — never by what the
   user called it. */
function detectRole({ issuer_name, buyer_name, business_name, payment_direction } = {}) {
  const isUs = (n) => {
    if (!n || !business_name) return false;
    const s = nameSimilarity(n, business_name);
    return s >= 0.85;
  };
  const issuerIsUs = isUs(issuer_name);
  const buyerIsUs = isUs(buyer_name);

  if (payment_direction === 'incoming') {
    return { role: 'customer', direction: 'incoming_payment', confidence: 'medium',
      reason: 'Money arrived from this party, so they are a payer/customer.' };
  }
  if (payment_direction === 'outgoing') {
    return { role: 'vendor', direction: 'outgoing_payment', confidence: 'medium',
      reason: 'Money was sent to this party, so they are a payee/vendor.' };
  }
  if (buyerIsUs && !issuerIsUs) {
    return { role: 'vendor', direction: 'payable', confidence: 'high',
      reason: `${issuer_name} issued the document to this business, so they are a vendor and this business owes the money.` };
  }
  if (issuerIsUs && !buyerIsUs) {
    return { role: 'customer', direction: 'receivable', confidence: 'high',
      reason: `This business issued the document to ${buyer_name}, so they are a customer.` };
  }
  return { role: 'unknown', direction: 'unknown', confidence: 'needs_review',
    reason: 'Neither party could be matched to this business. Confirm who issued the document.' };
}

/* ── matching ──────────────────────────────────────────────────────────────*/
const ROLES = ['vendor', 'customer', 'both', 'tax_authority', 'bank', 'employee', 'other'];

/**
 * @param candidate { legal_name, npwp, bank_accounts:[{account_number,...}], aliases:[] }
 * @param existing  counterparty rows for THIS business
 */
function matchCounterparty(candidate = {}, existing = []) {
  const reasons = [];
  const possible = [];
  const cNpwp = normalizeNpwp(candidate.npwp);
  const cAccounts = (candidate.bank_accounts || [])
    .map((a) => normalizeAccount(a && (a.account_number || a))).filter(Boolean);
  const cName = normalizeName(candidate.legal_name || candidate.display_name);
  const cAliases = (candidate.aliases || []).map(normalizeName).filter(Boolean);

  let best = null;
  for (const row of existing || []) {
    if (row.status === 'archived' || row.is_active === false) continue;
    const hits = [];
    let strength = 0;

    // Registered identifiers: strong enough to carry a match alone.
    const rNpwp = normalizeNpwp(row.npwp);
    if (cNpwp && rNpwp && cNpwp === rNpwp) { strength = Math.max(strength, 1.0); hits.push(`Same NPWP (${row.npwp}).`); }

    const rAccounts = (row.bank_accounts || []).map((a) => normalizeAccount(a && (a.account_number || a))).filter(Boolean);
    const sharedAcct = cAccounts.find((a) => rAccounts.includes(a));
    if (sharedAcct) { strength = Math.max(strength, 0.98); hits.push(`Same bank account (${sharedAcct}).`); }

    // Names and aliases: supporting evidence.
    const rNames = [row.legal_name, row.display_name, row.name].filter(Boolean);
    const rAliases = (row.aliases || []).map(normalizeName).filter(Boolean);
    const allCandidateNames = [cName, ...cAliases].filter(Boolean);
    const allRowNames = [...rNames.map(normalizeName), ...rAliases].filter(Boolean);

    if (allCandidateNames.some((n) => allRowNames.includes(n))) {
      strength = Math.max(strength, 0.9); hits.push('Exact name or alias match.');
    } else {
      let bestSim = 0;
      for (const a of allCandidateNames) for (const b of allRowNames) bestSim = Math.max(bestSim, nameSimilarity(a, b));
      if (bestSim >= 0.5) {
        strength = Math.max(strength, Math.min(0.8, bestSim));
        hits.push(`Similar name (${Math.round(bestSim * 100)}%).`);
      }
    }

    if (candidate.email && row.email && String(candidate.email).toLowerCase() === String(row.email).toLowerCase()) {
      strength = Math.max(strength, 0.7); hits.push('Same email address.');
    }

    if (!hits.length) continue;
    const entry = { counterparty_id: row.id, name: row.legal_name || row.display_name || row.name, strength, reasons: hits };
    possible.push(entry);
    if (!best || strength > best.strength) best = entry;
  }

  possible.sort((a, b) => b.strength - a.strength);

  if (!best) {
    return { status: 'not_found', confidence: 'high', matched_counterparty_id: null,
      match_reasons: ['No existing counterparty shares this NPWP, bank account, name or alias.'],
      possible_matches: [], warnings: [] };
  }

  // An identifier match may auto-resolve. A name match, however close, may not:
  // two different companies can legitimately share words in their names.
  const identifierMatch = best.reasons.some((r) => /Same NPWP|Same bank account/.test(r));
  if (identifierMatch) {
    return { status: 'matched', confidence: 'high', matched_counterparty_id: best.counterparty_id,
      match_reasons: best.reasons, possible_matches: possible.slice(1),
      warnings: [] };
  }
  const conf = best.strength >= 0.9 ? 'medium' : 'low';
  return {
    status: 'possible_match', confidence: conf, matched_counterparty_id: null,
    match_reasons: best.reasons, possible_matches: possible,
    warnings: ['Matched on name only. Confirm before linking — a name match is not proof of identity.'],
  };
}

/* ── suggestion ────────────────────────────────────────────────────────────*/

/** Default accounting/tax hints. Suggestions only; the accountant decides. */
function suggestDefaults(description = '') {
  const d = String(description || '');
  if (/\b(sewa|rent|lease|persewaan)\b/i.test(d)) {
    return { default_category: 'Location rent / operating expense',
      default_tax_treatment: 'PPh Final Pasal 4(2) candidate — needs accountant review' };
  }
  if (/\b(jasa|service|consult|konsultan)\b/i.test(d)) {
    return { default_category: 'Services / operating expense',
      default_tax_treatment: 'Possibly PPh 23 — needs accountant review' };
  }
  return { default_category: null, default_tax_treatment: null };
}

/**
 * Build a suggested profile from an extraction result.
 * @param extraction fields from server/lib/documentExtraction.js
 * @param opts { business_name }
 */
function suggestFromDocument(extraction = {}, opts = {}) {
  const f = extraction.fields || extraction;
  const role = detectRole({
    issuer_name: f.issuer_name, buyer_name: f.buyer_name, business_name: opts.business_name,
  });

  // The counterparty is whichever party is NOT this business.
  const isVendorSide = role.role === 'vendor';
  const name = isVendorSide ? f.issuer_name : role.role === 'customer' ? f.buyer_name : (f.issuer_name || f.buyer_name);
  const npwp = isVendorSide ? f.issuer_npwp : role.role === 'customer' ? f.buyer_npwp : (f.issuer_npwp || null);

  const warnings = [];
  if (!name) warnings.push('No counterparty name could be read from the document.');
  if (role.role === 'unknown') warnings.push(role.reason);

  const accounts = [];
  // On a payment proof the payee account belongs to the counterparty.
  if (f.to_account_number && role.direction !== 'incoming_payment') {
    accounts.push({ bank_name: f.bank_name || null, account_number: f.to_account_number,
      account_name: f.to_account_name || null, currency: f.currency || 'IDR', is_primary: true });
  }
  if (f.from_account_number && role.direction === 'incoming_payment') {
    accounts.push({ bank_name: f.bank_name || null, account_number: f.from_account_number,
      account_name: f.from_account_name || null, currency: f.currency || 'IDR', is_primary: true });
  }

  const defaults = suggestDefaults(f.description);
  const aliases = [...new Set([name, f.to_account_name, f.from_account_name]
    .filter(Boolean)
    .filter((n) => normalizeName(n) && normalizeName(n) !== normalizeName(name)))];

  return {
    suggested_counterparty: {
      legal_name: name || null,
      display_name: name || null,
      role: role.role === 'unknown' ? 'other' : role.role,
      npwp: npwp || null,
      pkp_status: f.commercial_tax_amount ? 'pkp' : 'unknown',
      bank_accounts: accounts,
      aliases,
      address: null,
      email: null,
      phone: null,
      default_category: defaults.default_category,
      default_tax_treatment: defaults.default_tax_treatment,
      source_system: null,
      external_id: null,
    },
    direction: role.direction,
    role_reason: role.reason,
    warnings,
    // Nothing is created here. The caller must ask the user.
    requires_confirmation: true,
  };
}

/** Suggest from a bank payment where we know which way the money went. */
function suggestFromPayment(proof = {}, opts = {}) {
  const incoming = opts.direction === 'incoming';
  const role = detectRole({ payment_direction: incoming ? 'incoming' : 'outgoing' });
  const name = incoming ? proof.from_account_name : proof.to_account_name;
  const number = incoming ? proof.from_account_number : proof.to_account_number;
  return {
    suggested_counterparty: {
      legal_name: name || null, display_name: name || null, role: role.role,
      npwp: null, pkp_status: 'unknown',
      bank_accounts: number ? [{ bank_name: proof.bank_name || null, account_number: number,
        account_name: name || null, currency: proof.currency || 'IDR', is_primary: true }] : [],
      aliases: [], address: null, email: null, phone: null,
      default_category: null, default_tax_treatment: null,
      source_system: null, external_id: null,
    },
    direction: role.direction, role_reason: role.reason,
    warnings: name ? [] : ['No account holder name on the payment proof.'],
    requires_confirmation: true,
  };
}

/* ── duplicate protection ──────────────────────────────────────────────────
   Runs before a create. A likely duplicate is reported, never merged and never
   silently allowed through. */
function findDuplicates(candidate = {}, existing = []) {
  const m = matchCounterparty(candidate, existing);
  if (m.status === 'matched') {
    return { duplicate: true, blocking: true, matched_counterparty_id: m.matched_counterparty_id,
      reasons: m.match_reasons,
      message: 'A counterparty with this NPWP or bank account already exists. Link to it instead of creating a second record.' };
  }
  if (m.status === 'possible_match') {
    return { duplicate: true, blocking: true, matched_counterparty_id: null,
      possible_matches: m.possible_matches, reasons: m.match_reasons,
      message: 'A similar counterparty already exists. Confirm before creating a new one.' };
  }
  return { duplicate: false, blocking: false, reasons: [] };
}

module.exports = {
  ROLES, LEGAL_FORMS,
  normalizeName, nameTokens, normalizeNpwp, normalizeAccount, nameSimilarity,
  detectRole, matchCounterparty, suggestFromDocument, suggestFromPayment,
  suggestDefaults, findDuplicates,
};
