// Unit tests for the deterministic tax due-date calculator.
// Run: node tests/dueDate.test.js
const assert = require('assert');
const { calculateDueDate, ymd } = require('../server/lib/dueDate');

let pass = 0, fail = 0;
const eq = (name, got, exp) => {
  try { assert.strictEqual(got, exp); console.log(`OK  ${name} -> ${got}`); pass++; }
  catch { console.log(`XX  ${name} -> got ${got}, expected ${exp}`); fail++; }
};
const throws = (name, fn) => {
  try { fn(); console.log(`XX  ${name} -> did not throw`); fail++; }
  catch { console.log(`OK  ${name} -> threw as expected`); pass++; }
};

const rDayNext = { due_date_rule_json: { type: 'day_of_next_month', day: 20 } };
const rEndNext = { due_date_rule_json: { type: 'end_of_next_month' } };
const rMonths4 = { due_date_rule_json: { type: 'months_after_period_end', months: 4, day_policy: 'same_day_or_month_end' } };

// day_of_next_month
eq('PPh21 May 2026 (20th of June)', calculateDueDate(rDayNext, '2026-05-01', '2026-05-31'), '2026-06-20');
eq('day_of_next_month across year end (Dec -> Jan)', calculateDueDate(rDayNext, '2026-12-01', '2026-12-31'), '2027-01-20');

// end_of_next_month — month-length edge cases
eq('end_of_next_month Jan->Feb non-leap (28)', calculateDueDate(rEndNext, '2026-01-01', '2026-01-31'), '2026-02-28');
eq('end_of_next_month Jan->Feb leap year (29)', calculateDueDate(rEndNext, '2024-01-01', '2024-01-31'), '2024-02-29');
eq('end_of_next_month Mar->Apr (30)', calculateDueDate(rEndNext, '2026-03-01', '2026-03-31'), '2026-04-30');
eq('end_of_next_month Dec->Jan (31, year rollover)', calculateDueDate(rEndNext, '2026-12-01', '2026-12-31'), '2027-01-31');

// months_after_period_end same_day_or_month_end
eq('PPh Badan FY2025 (Dec 31 + 4mo = Apr 30)', calculateDueDate(rMonths4, '2025-01-01', '2025-12-31'), '2026-04-30');
eq('months_after same-day clamp (Oct 31 + 4mo -> Feb 28)', calculateDueDate(rMonths4, '2025-10-01', '2025-10-31'), '2026-02-28');
eq('months_after same-day clamp leap (Oct 31 +4mo -> Feb 29 2024)', calculateDueDate(rMonths4, '2023-10-01', '2023-10-31'), '2024-02-29');

// months_after with explicit day
eq('months_after explicit day 15', calculateDueDate({ due_date_rule_json: { type: 'months_after_period_end', months: 3, day: 15 } }, '2026-01-01', '2026-03-31'), '2026-06-15');

// ymd clamp helper
eq('ymd clamps Feb 31 -> Feb 28 (2026)', ymd(2026, 1, 31), '2026-02-28');
eq('ymd month overflow (month 12 -> next Jan)', ymd(2026, 12, 10), '2027-01-10');

// errors — never guess
throws('missing due_date_rule_json', () => calculateDueDate({}, '2026-01-01', '2026-01-31'));
throws('unknown type', () => calculateDueDate({ due_date_rule_json: { type: 'full_moon' } }, '2026-01-01', '2026-01-31'));
throws('day_of_next_month without integer day', () => calculateDueDate({ due_date_rule_json: { type: 'day_of_next_month' } }, '2026-01-01', '2026-01-31'));
throws('months_after without day/policy', () => calculateDueDate({ due_date_rule_json: { type: 'months_after_period_end', months: 4 } }, '2026-01-01', '2026-12-31'));

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
