// Deterministic tax due-date calculator.
// Works on plain 'YYYY-MM-DD' strings using UTC component math so results are
// timezone-stable (tax due dates are whole calendar dates). Indonesia fallback
// timezone for any wall-clock decision is Asia/Jakarta, but pure date math here
// needs no timezone. Unknown rule types THROW — we never guess a date.

// Build 'YYYY-MM-DD' for year/month(0-based)/day, clamping day to month end.
function ymd(year, month0, day) {
  const monthsOver = Math.floor(month0 / 12);
  const y = year + monthsOver;
  const m0 = ((month0 % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
  const d = Math.min(Math.max(1, day), lastDay);
  return `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseYmd(s) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(s || ''))) throw new Error(`Invalid date: ${s}`);
  const d = new Date(String(s).slice(0, 10) + 'T00:00:00Z');
  return { y: d.getUTCFullYear(), m0: d.getUTCMonth(), day: d.getUTCDate() };
}

// calculateDueDate(rule, periodStart, periodEnd) → 'YYYY-MM-DD'
// Supported due_date_rule_json shapes:
//   { type:'day_of_next_month', day:20 }
//   { type:'end_of_next_month' }
//   { type:'months_after_period_end', months:4, day_policy:'same_day_or_month_end' }
//   { type:'months_after_period_end', months:4, day:30 }
function calculateDueDate(rule, periodStart, periodEnd) {
  const ddr = rule && rule.due_date_rule_json;
  if (!ddr || typeof ddr !== 'object' || !ddr.type)
    throw new Error('Missing structured due_date_rule_json');
  const end = parseYmd(periodEnd);

  switch (ddr.type) {
    case 'day_of_next_month': {
      if (!Number.isInteger(ddr.day)) throw new Error('day_of_next_month requires integer "day"');
      return ymd(end.y, end.m0 + 1, ddr.day);
    }
    case 'end_of_next_month':
      return ymd(end.y, end.m0 + 1, 31); // ymd clamps to the real month end
    case 'months_after_period_end': {
      if (!Number.isInteger(ddr.months)) throw new Error('months_after_period_end requires integer "months"');
      if (ddr.day_policy === 'same_day_or_month_end') return ymd(end.y, end.m0 + ddr.months, end.day);
      if (Number.isInteger(ddr.day)) return ymd(end.y, end.m0 + ddr.months, ddr.day);
      throw new Error('months_after_period_end requires "day" or day_policy:"same_day_or_month_end"');
    }
    default:
      throw new Error(`Unknown due_date_rule type: ${ddr.type}`);
  }
}

module.exports = { calculateDueDate, ymd };
