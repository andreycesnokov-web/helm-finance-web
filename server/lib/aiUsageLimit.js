// Monthly AI question limit — the enforcement half of a policy that already
// exists.
//
// `plan_limits.max_ai_questions_per_month` has been defined since the plan
// tables were introduced and has never been checked. This module checks it. It
// does not set it, change it, or interpret it beyond the one convention the
// column already carries: NULL means unlimited.
//
// THE RACE IS THE POINT. A limiter that reads a count, compares it, and then
// writes is wrong under concurrency: N requests arriving together all read the
// same number, all pass, and the limit is exceeded by N-1. So there is no read
// here. reserve() performs one atomic UPSERT..RETURNING and is handed back the
// value AFTER its own increment — a number no other caller can also receive.
// The caller whose number exceeds the limit is the caller that is refused.
//
// GRACEFUL WHEN THE TABLE IS ABSENT. Migration 056 is prepared for review and
// deliberately not applied, so in production today the counter does not exist.
// The module reports that state as `enforced: false` with a reason, rather than
// pretending to enforce or refusing every request. What it must never do is
// silently report success — a caller can see exactly which of the two happened.
'use strict';

/** First day of the current UTC month, as a DATE string. */
function currentPeriod(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString().slice(0, 10);
}

/** A missing relation or function, rather than a real database failure. */
function isMissingSchema(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '');
  // 42P01 undefined_table, 42883 undefined_function, PGRST202 unknown RPC.
  return code === '42P01' || code === '42883' || code === 'PGRST202'
    || /does not exist|could not find the function|schema cache/i.test(msg);
}

/**
 * Reserve one question against this business's monthly allowance.
 *
 * @returns {Promise<{allowed, enforced, limit, used, remaining, period, reason}>}
 *   allowed  may this request proceed
 *   enforced whether a counter was actually moved (false = not countable here)
 *   used     the value this caller was given by the atomic increment
 */
async function reserve(supabase, {
  businessId, feature, limit, userId = null, now = new Date(),
}) {
  const period = currentPeriod(now);

  // NULL / undefined is the plan's own encoding of "unlimited". An explicit 0
  // is a real limit of zero and is NOT unlimited — the difference matters and a
  // `!limit` test would collapse them.
  const unlimited = limit === null || limit === undefined;

  if (unlimited) {
    return { allowed: true, enforced: false, limit: null, used: null, remaining: null, period, reason: 'unlimited' };
  }
  if (!businessId) {
    return { allowed: true, enforced: false, limit, used: null, remaining: null, period, reason: 'no_business_scope' };
  }

  let used;
  try {
    const { data, error } = await supabase.rpc('reserve_ai_usage', {
      p_business_id: businessId, p_feature: feature, p_period: period, p_user_id: userId,
    });
    if (error) {
      if (isMissingSchema(error)) {
        // Migration 056 not applied. Fail OPEN and say so: refusing every
        // question because a counter is missing would take a working feature
        // away over bookkeeping the user cannot see or fix.
        return { allowed: true, enforced: false, limit, used: null, remaining: null, period, reason: 'counter_unavailable' };
      }
      throw error;
    }
    used = Number(Array.isArray(data) ? data[0] : data);
  } catch (e) {
    if (isMissingSchema(e)) {
      return { allowed: true, enforced: false, limit, used: null, remaining: null, period, reason: 'counter_unavailable' };
    }
    return { allowed: true, enforced: false, limit, used: null, remaining: null, period, reason: 'counter_error' };
  }

  if (!Number.isFinite(used)) {
    return { allowed: true, enforced: false, limit, used: null, remaining: null, period, reason: 'counter_error' };
  }

  if (used > limit) {
    // Over the line. Hand the slot straight back so a refused question does not
    // consume allowance, and so the counter keeps describing questions actually
    // answered rather than attempts.
    await release(supabase, { businessId, feature, now }).catch(() => {});
    return { allowed: false, enforced: true, limit, used: limit, remaining: 0, period, reason: 'limit_reached' };
  }

  return { allowed: true, enforced: true, limit, used, remaining: Math.max(0, limit - used), period, reason: 'reserved' };
}

/** Give a reserved slot back — the answer never happened. */
async function release(supabase, { businessId, feature, now = new Date() }) {
  const period = currentPeriod(now);
  if (!businessId) return { released: false, reason: 'no_business_scope' };
  try {
    const { error } = await supabase.rpc('release_ai_usage', {
      p_business_id: businessId, p_feature: feature, p_period: period,
    });
    if (error) return { released: false, reason: isMissingSchema(error) ? 'counter_unavailable' : 'counter_error' };
    return { released: true, reason: 'released' };
  } catch (e) {
    return { released: false, reason: isMissingSchema(e) ? 'counter_unavailable' : 'counter_error' };
  }
}

/** Read the current usage without spending any. */
async function peek(supabase, { businessId, feature, limit, now = new Date() }) {
  const period = currentPeriod(now);
  const unlimited = limit === null || limit === undefined;
  if (unlimited) return { enforced: false, limit: null, used: null, remaining: null, period, reason: 'unlimited' };
  if (!businessId) return { enforced: false, limit, used: null, remaining: null, period, reason: 'no_business_scope' };
  try {
    const { data, error } = await supabase.rpc('get_ai_usage', {
      p_business_id: businessId, p_feature: feature, p_period: period,
    });
    if (error) return { enforced: false, limit, used: null, remaining: null, period, reason: isMissingSchema(error) ? 'counter_unavailable' : 'counter_error' };
    const used = Number(Array.isArray(data) ? data[0] : data) || 0;
    return { enforced: true, limit, used, remaining: Math.max(0, limit - used), period, reason: 'ok' };
  } catch (e) {
    return { enforced: false, limit, used: null, remaining: null, period, reason: isMissingSchema(e) ? 'counter_unavailable' : 'counter_error' };
  }
}

module.exports = { reserve, release, peek, currentPeriod, isMissingSchema };
