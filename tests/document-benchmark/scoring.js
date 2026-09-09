'use strict';

const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const present = (v) => v !== undefined && v !== null && v !== '';
const norm = (v) => typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').toLowerCase() : v;
function equal(actual, expected) {
  if (expected === null) return actual === null;
  if (typeof expected === 'number') {
    if (typeof actual !== 'number' && (typeof actual !== 'string' || !actual.trim())) return false;
    const n = Number(actual);
    return Number.isFinite(n) && Math.abs(n - expected) <= 0.01;
  }
  return norm(actual) === norm(expected);
}
function items(actual, expected) {
  const a = Array.isArray(actual) ? actual : [];
  const used = new Set();
  let matched = 0;
  for (const e of expected) {
    const i = a.findIndex((v, i) => !used.has(i) && v &&
      Object.keys(e).every(k => own(v, k) && equal(v[k], e[k])) &&
      Object.keys(v).every(k => own(e, k) || !present(v[k])));
    if (i >= 0) { used.add(i); matched++; }
  }
  return { matched, expected: expected.length, actual: a.length,
    exact: Array.isArray(actual) && matched === expected.length && matched === a.length };
}

// Only actual source content is authoritative, never expected.evidence quotes.
// Plain parser input cannot prove PDF page or spreadsheet cell provenance.
function evidence(entry, value, source) {
  if (!source) return 'unverifiable_source';
  if (!entry || typeof entry.quote !== 'string' || !entry.quote.trim()) return 'missing';
  let text = source.text;
  if (entry.page !== undefined) {
    if (!source.pages) return 'unverifiable_location';
    text = source.pages[entry.page];
  }
  if (entry.cell !== undefined) {
    if (!source.cells) return 'unverifiable_location';
    text = source.cells[entry.cell];
  }
  if (typeof text !== 'string' || !norm(text).includes(norm(entry.quote))) return 'quote_not_in_source';
  if (typeof value === 'number') {
    const numbers = entry.quote.match(/-?\d+(?:[.,]\d+)*/g) || [];
    const supported = numbers.some(raw => {
      const normalized = raw.replace(/[.,](?=\d{3}(?:[.,]|$))/g, '').replace(',', '.');
      return equal(Number(normalized), value);
    });
    return supported ? 'supported' : 'value_not_supported';
  }
  if (typeof value === 'string' && value.trim()) {
    return norm(entry.quote).includes(norm(value)) ? 'supported' : 'value_not_supported';
  }
  // Absence, inferred periods, formulas, and compound line arrays require human
  // ground-truth review; a scalar quote checker must not certify them.
  return 'unverifiable_value';
}

function score(cases, results) {
  const ids = new Set(cases.map(c => c.id));
  const byId = new Map();
  for (const r of results) {
    if (!r || !ids.has(r.id) || byId.has(r.id)) throw new Error('Unknown or repeated candidate ID');
    byId.set(r.id, r);
  }
  return cases.map(c => {
    const a = byId.get(c.id) || {};
    const e = c.expected;
    const missing = !byId.has(c.id);
    const fields = Object.entries(e.fields).map(([k, v]) => ({key:k,
      correct: own(a.fields, k) && equal(a.fields[k], v)}));
    const extra = Object.keys(a.fields || {}).filter(k => !own(e.fields, k) && present(a.fields[k]));
    const forbidden = (e.forbidden_fields || []).filter(k => present(a.fields?.[k]));
    const line = items(a.line_items, e.line_items);
    const source = typeof c.source_text === 'string' ? {text:c.source_text} : null;
    const proofs = Object.keys(e.evidence || {}).map(k => ({key:k,
      status:evidence(a.evidence?.[k], a.fields?.[k] ?? a[k], source)}));
    const duplicate = own(a,'duplicate_of') && a.duplicate_of === e.duplicate_of;
    return { id:c.id, missing, source_kind:c.fixture_kind,
      type_ok:a.document_type === e.document_type,
      purpose_ok:own(e,'purpose') ? a.purpose === e.purpose : null,
      route_ok:e.technical_routes.includes(a.route),
      review_ok:a.review_required === true,
      fields, extra_unscored_fields:extra, forbidden_fields:forbidden, line_items:line, evidence:proofs,
      duplicate_ok:duplicate, duplicate_positive:e.duplicate_of !== null,
      duplicate_false_positive:present(a.duplicate_of) && e.duplicate_of === null,
      latency_ms:typeof a.latency_ms === 'number' && a.latency_ms >= 0 ? a.latency_ms : null,
      cost_usd:typeof a.cost_usd === 'number' && a.cost_usd >= 0 ? a.cost_usd : null,
      // Expected fields are intentionally partial. Extra values need adjudication,
      // not automatic labeling as hallucinations or acceptance as correct.
      fully_verified:!missing && a.document_type === e.document_type && a.purpose === e.purpose &&
        a.review_required === true && fields.every(f => f.correct) && !extra.length && !forbidden.length &&
        line.exact && duplicate && proofs.length > 0 && proofs.every(p => p.status === 'supported') };
  });
}
module.exports = { equal, items, evidence, score };
