// AI CFO's client-side derivations — pinned.
//
// The design migration's central claim is that it moved no number and no
// boundary. Every financial figure on the page is computed server-side, so the
// only things the migration COULD have moved are the display thresholds and the
// remaining-questions arithmetic. Those live in client/src/lib/aiCfoFigures.js
// precisely so this file can assert them directly, without a JSX transform.
//
// Run: node tests/design/aiCfoFigures.test.mjs
import assert from 'node:assert';
import {
  FACTOR_ORDER, aiQuestionsLeft, scoreBand, factorBand, runwayBand, signBand,
  hasNoFinancialData,
} from '../../client/src/lib/aiCfoFigures.js';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

console.log('\nAI CFO figures — the five factors');

t('the factor order is the one the page has always shown', () => {
  assert.deepStrictEqual(FACTOR_ORDER,
    ['cash_health', 'runway', 'payables', 'receivables', 'expense_control']);
});

console.log('\nAI CFO figures — CFO Score bands');

/* The two boundaries the page has always coloured on, and the same two the
   server uses to set cfo_score.status. Asserted ON the boundary and one either
   side, because an off-by-one here silently recolours a verdict. */
t('75 and above is healthy, and 75 itself is healthy', () => {
  assert.strictEqual(scoreBand(100), 'healthy');
  assert.strictEqual(scoreBand(80), 'healthy');
  assert.strictEqual(scoreBand(75), 'healthy');
});

t('50 to 74 is attention, and 50 itself is attention', () => {
  assert.strictEqual(scoreBand(74), 'attention');
  assert.strictEqual(scoreBand(72), 'attention');
  assert.strictEqual(scoreBand(50), 'attention');
});

t('below 50 is critical', () => {
  assert.strictEqual(scoreBand(49), 'critical');
  assert.strictEqual(scoreBand(41), 'critical');
  assert.strictEqual(scoreBand(0), 'critical');
});

console.log('\nAI CFO figures — a factor follows its impact, never its score');

t('impact decides the band, not the number beside it', () => {
  assert.strictEqual(factorBand('positive'), 'healthy');
  assert.strictEqual(factorBand('warning'), 'attention');
  assert.strictEqual(factorBand('negative'), 'critical');
  assert.strictEqual(factorBand('neutral'), 'neutral');
});

t('an unknown or missing impact is neutral, never healthy', () => {
  // Fail quiet, not green: a factor whose impact the engine did not send must
  // not be painted as a positive one.
  assert.strictEqual(factorBand(undefined), 'neutral');
  assert.strictEqual(factorBand(null), 'neutral');
  assert.strictEqual(factorBand('something_new'), 'neutral');
});

t('"No payables" scores 90 and is healthy; "Runway adequate" scores 70 and is not', () => {
  // The exact pair that makes colouring-by-score wrong. Both are real engine
  // outputs (calculateCfoScore): the first is 90/positive, the second 70/neutral.
  // A score-based rule would paint the second green at 70.
  assert.strictEqual(factorBand('positive'), 'healthy');
  assert.strictEqual(factorBand('neutral'), 'neutral');
});

console.log('\nAI CFO figures — runway bands');

t('under 7 days is critical', () => {
  assert.strictEqual(runwayBand(0), 'critical');
  assert.strictEqual(runwayBand(6), 'critical');
});

t('7 to 13 days is attention — 7 is the boundary and is NOT critical', () => {
  assert.strictEqual(runwayBand(7), 'attention');
  assert.strictEqual(runwayBand(8), 'attention');
  assert.strictEqual(runwayBand(13), 'attention');
});

t('14 days and above is adequate — 14 is the boundary and is NOT attention', () => {
  assert.strictEqual(runwayBand(14), 'adequate');
  assert.strictEqual(runwayBand(37), 'adequate');
  assert.strictEqual(runwayBand(999), 'adequate');
});

t('an unknown runway is unknown, never adequate', () => {
  assert.strictEqual(runwayBand(null), 'unknown');
  assert.strictEqual(runwayBand(undefined), 'unknown');
});

console.log('\nAI CFO figures — signed money');

t('zero is neither positive nor negative', () => {
  // The rule PR #80 set on Pulse's KPIs: green only for something genuinely
  // positive, red only for a real negative, and neither at zero.
  assert.strictEqual(signBand(0), 'neutral');
  assert.strictEqual(signBand(null), 'neutral');
  assert.strictEqual(signBand(undefined), 'neutral');
  assert.strictEqual(signBand('0'), 'neutral');
});

t('a positive figure is positive and a negative one is negative', () => {
  assert.strictEqual(signBand(36295000), 'positive');
  assert.strictEqual(signBand(-22700000), 'negative');
  assert.strictEqual(signBand('65850000'), 'positive');
});

console.log('\nAI CFO figures — the AI question allowance');

t('the allowance arithmetic is the page\'s original expression', () => {
  assert.strictEqual(
    aiQuestionsLeft({ limits: { max_ai_questions_per_month: 200 }, usage: { ai_questions_this_month: 0 } }),
    200);
  assert.strictEqual(
    aiQuestionsLeft({ limits: { max_ai_questions_per_month: 200 }, usage: { ai_questions_this_month: 30 } }),
    170);
});

t('an uncapped plan returns null, not Infinity and not zero', () => {
  assert.strictEqual(aiQuestionsLeft({ limits: { max_ai_questions_per_month: null } }), null);
  assert.strictEqual(aiQuestionsLeft({ limits: {} }), null);
  assert.strictEqual(aiQuestionsLeft(null), null);
  assert.strictEqual(aiQuestionsLeft(undefined), null);
});

t('it never goes below zero', () => {
  assert.strictEqual(
    aiQuestionsLeft({ limits: { max_ai_questions_per_month: 10 }, usage: { ai_questions_this_month: 40 } }),
    0);
});

t('missing usage is treated as zero used — which is what the server always sends', () => {
  // Not a quirk of this helper: usage.ai_questions_this_month is hardcoded to 0
  // server-side, so this subtraction never decrements in production. That is why
  // the card labels the figure a monthly allowance and not a remaining count.
  assert.strictEqual(aiQuestionsLeft({ limits: { max_ai_questions_per_month: 10 } }), 10);
  assert.strictEqual(aiQuestionsLeft({ limits: { max_ai_questions_per_month: 10 }, usage: {} }), 10);
});

console.log('\nAI CFO figures — is there anything to assess?');

const EMPTY_CTX = {
  cash: { total_balance: 0, wallets_count: 0 },
  current_month: { transactions_count: 0 },
  receivables: { total_remaining: 0 },
  payables: { total_remaining: 0 },
};

t('a workspace with nothing in it is empty', () => {
  assert.strictEqual(hasNoFinancialData(EMPTY_CTX), true);
});

t('any single signal of activity means it is NOT empty', () => {
  // One of these is enough. The page must show real figures the moment there is
  // one real thing behind them.
  const cases = [
    ['a wallet', { cash: { total_balance: 0, wallets_count: 1 } }],
    ['a transaction', { current_month: { transactions_count: 1 } }],
    ['a balance', { cash: { total_balance: 25000, wallets_count: 0 } }],
    ['a receivable', { receivables: { total_remaining: 5000 } }],
    ['a payable', { payables: { total_remaining: 5000 } }],
    ['a negative balance', { cash: { total_balance: -25000, wallets_count: 0 } }],
  ];
  for (const [what, patch] of cases) {
    assert.strictEqual(hasNoFinancialData({ ...EMPTY_CTX, ...patch }), false,
      `${what} was treated as an empty workspace`);
  }
});

t('a missing count is not read as a zero', () => {
  // Absence of a field means the payload was not the shape we expected, which is
  // not the same as proof that the workspace is empty. Claiming emptiness there
  // would hide real figures behind a "nothing here yet" screen.
  for (const patch of [
    { cash: { total_balance: 0 } },                 // no wallets_count
    { current_month: {} },                          // no transactions_count
    { cash: {} },
  ]) {
    assert.strictEqual(hasNoFinancialData({ ...EMPTY_CTX, ...patch }), false);
  }
  assert.strictEqual(hasNoFinancialData({}), false);
  assert.strictEqual(hasNoFinancialData(null), false);
  assert.strictEqual(hasNoFinancialData(undefined), false);
});

t('a partially populated workspace is not empty', () => {
  // Wallets and transactions, but no receivable or payable ever entered. There
  // is real cash and a real burn behind the score, so the score is shown.
  assert.strictEqual(hasNoFinancialData({
    cash: { total_balance: 41500000, wallets_count: 1 },
    current_month: { transactions_count: 7 },
    receivables: { total_remaining: 0 },
    payables: { total_remaining: 0 },
  }), false);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
