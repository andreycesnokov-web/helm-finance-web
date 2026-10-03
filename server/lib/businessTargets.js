// Business targets and alerts (Design v2 P-01 + P-08; migrations 058, 059).
//
// Three owner-chosen thresholds on the businesses row:
//   runway_target_days  1..730, NULL = product default (60)
//   min_cash_idr        >= 0,   NULL = not set
//   weekly_brief_cron   "m h * * dow" (once a week), NULL = no brief
//
// NO FINANCIAL EFFECT: these colour status and copy; nothing creates or moves money.
// THE BRIEF IS NOT SENT HERE. There is no scheduler in this repo; when one exists it must
// pick recipients through notificationPolicy ('ai_cfo_summary'), never from this module.
//
// Pure — validation and shaping only. Tested in tests/businessTargets.test.js.
'use strict';

const DEFAULT_RUNWAY_TARGET_DAYS = 60;
const RUNWAY_MIN = 1, RUNWAY_MAX = 730;
const COLUMNS = ['runway_target_days', 'min_cash_idr', 'weekly_brief_cron'];
// Same people who manage wallets and payroll. Accountant, manager, employee: read only.
const EDIT_ROLES = ['owner', 'ceo', 'admin', 'cfo'];
// Mirrors the CHECK in migration 059.
const CRON_RE = /^([0-5]?[0-9]) ([01]?[0-9]|2[0-3]) \* \* [0-6]$/;

const canEditTargets = (role) => EDIT_ROLES.includes(role);
// A number, or a string of digits. Never a boolean, array or object (Number(true) === 1).
const intOrNaN = (v) => (typeof v === 'number' || (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) ? Number(v) : NaN);

/** { day 0-6 (0 = Sunday), hour 0-23, minute 0-59 } → "m h * * d", or null. */
function briefToCron(brief) {
  if (brief == null) return null;
  if (typeof brief !== 'object') return undefined;
  const day = intOrNaN(brief.day), hour = intOrNaN(brief.hour), minute = intOrNaN(brief.minute ?? 0);
  if (![day, hour, minute].every(Number.isInteger)) return undefined;
  if (day < 0 || day > 6 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return `${minute} ${hour} * * ${day}`;
}

/** "m h * * d" → { day, hour, minute }, or null for anything else. */
function cronToBrief(cron) {
  if (typeof cron !== 'string' || !CRON_RE.test(cron)) return null;
  const [minute, hour, , , day] = cron.split(' ');
  return { day: Number(day), hour: Number(hour), minute: Number(minute) };
}

/**
 * Validate a PATCH body. Only keys present are returned; null clears a value.
 * Accepts `weekly_brief` as { day, hour, minute } or null, or `weekly_brief_cron` as a string.
 * @returns {{ patch: object, error?: string, field?: string }}
 */
function targetsPatchFromBody(b = {}) {
  const patch = {};
  if (b.runway_target_days !== undefined) {
    const v = b.runway_target_days;
    if (v === null || v === '') patch.runway_target_days = null;
    else {
      const n = intOrNaN(v);
      if (!Number.isInteger(n) || n < RUNWAY_MIN || n > RUNWAY_MAX)
        return { patch: {}, error: 'invalid_runway_target_days', field: 'runway_target_days' };
      patch.runway_target_days = n;
    }
  }
  if (b.min_cash_idr !== undefined) {
    const v = b.min_cash_idr;
    if (v === null || v === '') patch.min_cash_idr = null;
    else {
      // Decimal string or number, at most 2 decimals; kept as a string so no float rounding.
      if (typeof v !== 'number' && typeof v !== 'string') return { patch: {}, error: 'invalid_min_cash_idr', field: 'min_cash_idr' };
      const str = String(v).trim();
      if (!/^\d{1,18}(\.\d{1,2})?$/.test(str)) return { patch: {}, error: 'invalid_min_cash_idr', field: 'min_cash_idr' };
      patch.min_cash_idr = str;
    }
  }
  if (b.weekly_brief !== undefined) {
    const cron = briefToCron(b.weekly_brief);
    if (cron === undefined) return { patch: {}, error: 'invalid_weekly_brief', field: 'weekly_brief' };
    patch.weekly_brief_cron = cron;
  } else if (b.weekly_brief_cron !== undefined) {
    const v = b.weekly_brief_cron;
    if (v !== null && v !== '' && !(typeof v === 'string' && CRON_RE.test(v)))
      return { patch: {}, error: 'invalid_weekly_brief', field: 'weekly_brief_cron' };
    patch.weekly_brief_cron = v || null;
  }
  return { patch };
}

/** What the API returns. Missing columns (migration not applied) read as null. */
function publicTargets(row = {}) {
  const r = row || {};
  const cron = r.weekly_brief_cron ?? null;
  return {
    runway_target_days: r.runway_target_days ?? null,
    min_cash_idr: r.min_cash_idr == null ? null : String(r.min_cash_idr),
    weekly_brief_cron: cron,
    weekly_brief: cronToBrief(cron),
    default_runway_target_days: DEFAULT_RUNWAY_TARGET_DAYS,
  };
}

/** True when an error from the database means "this column does not exist yet". */
function isMissingColumn(err) {
  const m = String(err?.message || '');
  return err?.code === '42703' || err?.code === 'PGRST204' || /column .* does not exist|could not find the '.*' column/i.test(m);
}

module.exports = {
  DEFAULT_RUNWAY_TARGET_DAYS, COLUMNS, EDIT_ROLES, CRON_RE,
  canEditTargets, briefToCron, cronToBrief, targetsPatchFromBody, publicTargets, isMissingColumn,
};
