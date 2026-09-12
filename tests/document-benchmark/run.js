#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function present(v) {
  return v !== null && v !== undefined && v !== '';
}

function normalize(v) {
  if (typeof v === 'string') return v.trim().replace(/\s+/g, ' ').toLowerCase();
  return v;
}

function equalValue(actual, expected) {
  if (typeof expected === 'number') {
    const n = Number(actual);
    return Number.isFinite(n) && Math.abs(n - expected) <= Math.max(0.01, Math.abs(expected) * 1e-8);
  }
  return normalize(actual) === normalize(expected);
}

function loadCandidate(file) {
  const raw = fs.readFileSync(path.resolve(file), 'utf8').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) return JSON.parse(raw);
  return raw.split(/\r?\n/).filter(Boolean).map((line, i) => {
    try { return JSON.parse(line); }
    catch (e) { throw new Error(`Invalid JSON on candidate line ${i + 1}: ${e.message}`); }
  });
}

function currentBaseline() {
  const X = require(path.join(ROOT, 'server', 'lib', 'documentExtraction'));
  const results = [];
  const prior = [];

  for (const c of manifest.cases) {
    const hasText = present(c.source_text);
    const extraction = X.extractFromText(c.source_text || '', {
      text_available: hasText,
      file_name: c.file_name,
      extraction_reason: hasText ? null : 'offline_fixture_has_no_text',
    });
    const duplicate = X.findDuplicateDocument(extraction.fields || {}, prior);
    const result = {
      id: c.id,
      route: hasText ? 'deterministic_text' : 'manual_review',
      document_type: extraction.document_type,
      fields: extraction.fields || {},
      line_items: [],
      evidence: {},
      review_required: extraction.status === 'needs_manual_review' || extraction.confidence !== 'high',
      duplicate_of: duplicate.duplicate ? duplicate.match?._benchmark_id || 'unresolved_prior_match' : null,
      latency_ms: 0,
      retries: 0,
      cost_usd: 0,
    };
    results.push(result);
    prior.push({ ...result.fields, _benchmark_id: c.id });
  }
  return results;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

function itemMatches(a, e) {
  if (!a || !e) return false;
  const descOk = e.description ? normalize(a.description) === normalize(e.description) : true;
  const amountOk = e.amount === undefined ? true : equalValue(a.amount, e.amount);
  const qtyOk = e.quantity === undefined ? true : equalValue(a.quantity, e.quantity);
  const unitOk = e.unit_price === undefined ? true : equalValue(a.unit_price, e.unit_price);
  return descOk && amountOk && qtyOk && unitOk;
}

function lineItemScore(actual = [], expected = []) {
  const used = new Set();
  let matched = 0;
  for (const e of expected) {
    const index = actual.findIndex((a, i) => !used.has(i) && itemMatches(a, e));
    if (index >= 0) { used.add(index); matched++; }
  }
  return {
    matched,
    expected: expected.length,
    actual: actual.length,
    precision: actual.length ? matched / actual.length : (expected.length ? 0 : 1),
    recall: expected.length ? matched / expected.length : (actual.length ? 0 : 1),
  };
}

function evidenceMatches(actual, expected) {
  if (!actual || !expected) return false;
  if (expected.page !== undefined && Number(actual.page) !== Number(expected.page)) return false;
  if (expected.cell !== undefined && normalize(actual.cell) !== normalize(expected.cell)) return false;
  if (expected.quote) {
    const a = normalize(actual.quote || '');
    const e = normalize(expected.quote);
    if (!a || (!a.includes(e) && !e.includes(a))) return false;
  }
  return true;
}

function criticalPass(key, actual, expected, lineScore) {
  if (key === 'document_type') return actual.document_type === expected.document_type;
  if (key === 'review_required') return Boolean(actual.review_required) === Boolean(expected.review_required);
  if (key === 'duplicate_of') return (actual.duplicate_of || null) === (expected.duplicate_of || null);
  if (key === 'line_items') return lineScore.recall === 1 && lineScore.precision === 1;
  return equalValue(actual.fields?.[key], expected.fields?.[key]);
}

function score(results) {
  const byId = new Map(results.map((r) => [r.id, r]));
  const totals = {
    cases: manifest.cases.length,
    returned: 0,
    route_correct: 0,
    type_correct: 0,
    review_correct: 0,
    field_correct: 0,
    field_expected: 0,
    fabricated_fields: 0,
    forbidden_field_checks: 0,
    evidence_correct: 0,
    evidence_expected: 0,
    line_matched: 0,
    line_expected: 0,
    line_actual: 0,
    duplicate_correct: 0,
    correct_processed: 0,
    unsafe_auto_accepts: 0,
    total_cost_usd: 0,
    retries: 0,
    latencies: [],
    details: [],
  };

  for (const c of manifest.cases) {
    const a = byId.get(c.id);
    const e = c.expected;
    if (!a) {
      totals.details.push({ id: c.id, status: 'missing_candidate_result' });
      continue;
    }
    totals.returned++;
    const routeOk = a.route === e.route;
    const typeOk = a.document_type === e.document_type;
    const reviewOk = Boolean(a.review_required) === Boolean(e.review_required);
    if (routeOk) totals.route_correct++;
    if (typeOk) totals.type_correct++;
    if (reviewOk) totals.review_correct++;
    if (e.review_required && !a.review_required) totals.unsafe_auto_accepts++;

    const fieldFailures = [];
    for (const [key, value] of Object.entries(e.fields || {})) {
      totals.field_expected++;
      if (equalValue(a.fields?.[key], value)) totals.field_correct++;
      else fieldFailures.push(key);
    }
    for (const key of e.forbidden_fields || []) {
      totals.forbidden_field_checks++;
      if (present(a.fields?.[key])) totals.fabricated_fields++;
    }

    const evidenceFailures = [];
    for (const [key, value] of Object.entries(e.evidence || {})) {
      totals.evidence_expected++;
      if (evidenceMatches(a.evidence?.[key], value)) totals.evidence_correct++;
      else evidenceFailures.push(key);
    }

    const lines = lineItemScore(a.line_items || [], e.line_items || []);
    totals.line_matched += lines.matched;
    totals.line_expected += lines.expected;
    totals.line_actual += lines.actual;
    const duplicateOk = (a.duplicate_of || null) === (e.duplicate_of || null);
    if (duplicateOk) totals.duplicate_correct++;

    const criticalFailures = (e.critical_fields || [])
      .filter((key) => !criticalPass(key, a, e, lines));
    const correct = typeOk && reviewOk && criticalFailures.length === 0;
    if (correct) totals.correct_processed++;

    const latency = Number(a.latency_ms);
    if (Number.isFinite(latency) && latency >= 0) totals.latencies.push(latency);
    const retries = Number(a.retries);
    if (Number.isFinite(retries) && retries >= 0) totals.retries += retries;
    const cost = Number(a.cost_usd);
    if (Number.isFinite(cost) && cost >= 0) totals.total_cost_usd += cost;

    totals.details.push({
      id: c.id,
      status: correct ? 'correct' : 'review',
      route_ok: routeOk,
      type_ok: typeOk,
      review_ok: reviewOk,
      critical_failures: criticalFailures,
      field_failures: fieldFailures,
      evidence_failures: evidenceFailures,
      line_precision: lines.precision,
      line_recall: lines.recall,
    });
  }
  return totals;
}

const pct = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : 'n/a';
const money = (n) => `$${n.toFixed(4)}`;

function print(s) {
  console.log(`\nCFO AI document benchmark ${manifest.benchmark_version}`);
  console.log(`Cases returned:              ${s.returned}/${s.cases}`);
  console.log(`Routing accuracy:            ${pct(s.route_correct, s.cases)}`);
  console.log(`Document-type accuracy:      ${pct(s.type_correct, s.cases)}`);
  console.log(`Review-decision accuracy:    ${pct(s.review_correct, s.cases)}`);
  console.log(`Scalar-field accuracy:       ${pct(s.field_correct, s.field_expected)}`);
  console.log(`Line-item precision:         ${pct(s.line_matched, s.line_actual)}`);
  console.log(`Line-item recall:            ${pct(s.line_matched, s.line_expected)}`);
  console.log(`Evidence accuracy:           ${pct(s.evidence_correct, s.evidence_expected)}`);
  console.log(`Duplicate accuracy:          ${pct(s.duplicate_correct, s.cases)}`);
  console.log(`Fabricated forbidden fields: ${s.fabricated_fields}/${s.forbidden_field_checks}`);
  console.log(`Unsafe auto-accepts:         ${s.unsafe_auto_accepts}`);
  console.log(`Manual-review rate:          ${pct(s.details.filter((d) => {
    const r = results.find((x) => x.id === d.id); return r && r.review_required;
  }).length, s.returned)}`);
  console.log(`Correctly processed docs:    ${s.correct_processed}/${s.cases}`);
  console.log(`Latency p50 / p95:           ${percentile(s.latencies, 0.5)?.toFixed(1) ?? 'n/a'} / ${percentile(s.latencies, 0.95)?.toFixed(1) ?? 'n/a'} ms`);
  console.log(`Retries:                     ${s.retries}`);
  console.log(`Total reported cost:         ${money(s.total_cost_usd)}`);
  console.log(`Cost / correct document:     ${s.correct_processed ? money(s.total_cost_usd / s.correct_processed) : 'n/a'}`);

  const failures = s.details.filter((d) => d.status !== 'correct');
  if (failures.length) {
    console.log('\nCases requiring attention:');
    for (const f of failures) console.log(`- ${f.id}: ${JSON.stringify(f)}`);
  }
}

const candidateFile = argValue('--candidate');
const baseline = process.argv.includes('--baseline-current');
if ((candidateFile ? 1 : 0) + (baseline ? 1 : 0) !== 1) {
  console.error('Usage: node tests/document-benchmark/run.js --baseline-current');
  console.error('   or: node tests/document-benchmark/run.js --candidate path/to/results.jsonl');
  process.exit(2);
}

const results = baseline ? currentBaseline() : loadCandidate(candidateFile);
print(score(results));
