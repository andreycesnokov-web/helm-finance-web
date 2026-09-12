#!/usr/bin/env node
'use strict';

/*
 * Planning model, not an invoice forecast.
 * Prices are public list prices checked on 2026-09-09 and are easy to replace.
 * Token counts, route shares, review rates, retries and infrastructure allowances are
 * assumptions until the offline/live benchmark records real distributions.
 */

const PRICES_PER_MILLION = {
  'openai:gpt-5.6-luna': { input: 0.20, output: 1.20 },
  'openai:gpt-5.6-terra': { input: 2.00, output: 12.00 },
  'openai:gpt-5.6-sol': { input: 4.00, output: 20.00 },
  'openai:gpt-6-astra': { input: 10.00, output: 50.00 },
  'google:gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
  'google:gemini-3.8-flash-promo-2026': { input: 0.75, output: 3.75 },
  'google:gemini-3.1-pro-preview': { input: 2.00, output: 12.00 },
  'anthropic:claude-haiku-4.5': { input: 1.00, output: 5.00 },
  'anthropic:claude-sonnet-5': { input: 2.00, output: 10.00 },
  'anthropic:claude-opus-5': { input: 5.00, output: 25.00 },
};

const ASSUMPTIONS = {
  input_tokens_per_model_read: 6000,
  output_tokens_per_model_read: 600,
  retry_rate: 0.05,
  persistent_result_cache_hit_rate: 0.20,
  deterministic_parser_and_storage_per_doc_usd: 0.003,
  specialized_parser_and_storage_per_doc_usd: 0.004,
  manual_review_minutes: 3,
  reviewer_hourly_usd: 8,
};

const modelCall = (model) => {
  const p = PRICES_PER_MILLION[model];
  if (!p) throw new Error(`Unknown model ${model}`);
  return ASSUMPTIONS.input_tokens_per_model_read * p.input / 1e6
    + ASSUMPTIONS.output_tokens_per_model_read * p.output / 1e6;
};

const billableMultiplier = (1 - ASSUMPTIONS.persistent_result_cache_hit_rate)
  * (1 + ASSUMPTIONS.retry_rate);
const manualCost = ASSUMPTIONS.manual_review_minutes / 60 * ASSUMPTIONS.reviewer_hourly_usd;

const variants = [
  {
    id: 'A',
    name: 'Strong model for every document',
    model_cost_per_doc: modelCall('anthropic:claude-opus-5') * billableMultiplier,
    infra_per_doc: ASSUMPTIONS.deterministic_parser_and_storage_per_doc_usd,
    manual_review_rate: 0.10,
    correct_rate: 0.97,
  },
  {
    id: 'B',
    name: 'Parser -> cheap vision -> strong escalation',
    model_cost_per_doc: (
      0.43 * modelCall('google:gemini-3.8-flash-promo-2026')
      + 0.12 * (modelCall('google:gemini-3.8-flash-promo-2026') + modelCall('anthropic:claude-opus-5'))
    ) * billableMultiplier,
    infra_per_doc: ASSUMPTIONS.deterministic_parser_and_storage_per_doc_usd,
    manual_review_rate: 0.10,
    correct_rate: 0.96,
  },
  {
    id: 'C',
    name: 'Format parser -> cheap specialist -> strong escalation -> review',
    model_cost_per_doc: (
      0.30 * modelCall('google:gemini-3.5-flash-lite')
      + 0.08 * (modelCall('google:gemini-3.5-flash-lite') + modelCall('anthropic:claude-opus-5'))
    ) * billableMultiplier,
    infra_per_doc: ASSUMPTIONS.specialized_parser_and_storage_per_doc_usd,
    manual_review_rate: 0.08,
    correct_rate: 0.97,
  },
];

console.log('CFO AI document cost model (USD)');
console.log('\nVisible assumptions:');
console.log(JSON.stringify(ASSUMPTIONS, null, 2));

console.log('\nTypical one-call model cost at the assumed 6,000 input / 600 output tokens:');
for (const [model] of Object.entries(PRICES_PER_MILLION)) {
  console.log(`${model.padEnd(43)} $${modelCall(model).toFixed(5)}`);
}

console.log('\nArchitecture projections (model + parser/storage allowance + manual review):');
for (const v of variants) {
  const perDoc = v.model_cost_per_doc + v.infra_per_doc + v.manual_review_rate * manualCost;
  const perCorrect = perDoc / v.correct_rate;
  console.log(`\n${v.id}. ${v.name}`);
  console.log(`   per document:           $${perDoc.toFixed(5)}`);
  console.log(`   per correct document:   $${perCorrect.toFixed(5)}`);
  for (const volume of [100, 1000, 10000]) {
    console.log(`   ${String(volume).padStart(5)} documents:        $${(perDoc * volume).toFixed(2)}`);
  }
}

console.log('\nSensitivity: every additional 1 percentage point of manual review costs '
  + `$${(manualCost * 0.01).toFixed(4)} per document under the current labor assumption.`);
console.log('Replace assumptions with benchmark and production telemetry before selecting a provider.');
