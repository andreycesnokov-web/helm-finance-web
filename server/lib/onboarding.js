// Onboarding — locale resolution, progress arithmetic and validation (pure, no I/O).
//
// FOUNDATION ONLY. Nothing here calls an AI, sends anything, or touches financial data.
// Onboarding describes the product; it never operates it on the user's behalf.
//
// LOCALIZATION IS FALLBACK-FIRST. `title`/`description` hold English; the `*_i18n` JSONB
// columns hold per-locale overrides. A missing locale, a missing key, or an unsupported
// locale all resolve to English rather than rendering blank. That property is what lets a
// flow be translated incrementally instead of all-or-nothing.
//
// This is NOT platform-wide i18n. The rest of the product keeps its existing approach; a
// full i18n milestone is separate work.

const SUPPORTED_LOCALES = ['en', 'id', 'ru'];
const FALLBACK_LOCALE = 'en';

const FLOW_MODES = ['quick_setup', 'full_tour', 'feature_tour'];
const PROGRESS_STATUSES = ['not_started', 'in_progress', 'completed', 'skipped', 'dismissed'];
const STEP_STATUSES = ['not_started', 'viewed', 'completed', 'skipped'];
const COMPLETION_SOURCES = ['user', 'system', 'admin', 'event'];

/**
 * Normalise a requested locale.
 *
 * Accepts `ru`, `RU`, `ru-RU` and similar; anything unsupported becomes English. Never
 * throws: a bad `?locale=` must degrade to readable content, not to an error page.
 */
function resolveLocale(requested) {
  if (!requested || typeof requested !== 'string') return FALLBACK_LOCALE;
  const base = requested.trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(base) ? base : FALLBACK_LOCALE;
}

/**
 * Pick the best available text for a locale.
 *
 * Order: requested locale → English inside the i18n map → the plain English column. The last
 * step matters: a flow seeded before translations existed has an empty i18n map and must
 * still render.
 */
function pick(i18n, fallbackText, locale) {
  const map = (i18n && typeof i18n === 'object' && !Array.isArray(i18n)) ? i18n : {};
  const localised = map[locale];
  if (typeof localised === 'string' && localised.trim()) return localised;
  const english = map[FALLBACK_LOCALE];
  if (typeof english === 'string' && english.trim()) return english;
  return fallbackText ?? null;
}

/**
 * A flow as a user should see it: resolved text, no raw i18n maps.
 *
 * Raw maps are withheld from user routes deliberately — they are content-management data,
 * and shipping every translation of every string to every client is payload with no purpose.
 * Admin routes may ask for them explicitly.
 */
function toFlowDto(flow = {}, locale = FALLBACK_LOCALE, { includeRaw = false } = {}) {
  const dto = {
    id: flow.id,
    flow_key: flow.flow_key,
    title: pick(flow.title_i18n, flow.title, locale),
    description: pick(flow.description_i18n, flow.description, locale),
    mode: flow.mode,
    audience: flow.audience,
    is_active: flow.is_active,
    sort_order: flow.sort_order,
    metadata: flow.metadata ?? {},
    locale,
  };
  if (includeRaw) {
    dto.title_i18n = flow.title_i18n ?? {};
    dto.description_i18n = flow.description_i18n ?? {};
  }
  return dto;
}

function toStepDto(step = {}, locale = FALLBACK_LOCALE, { includeRaw = false } = {}) {
  const dto = {
    id: step.id,
    flow_id: step.flow_id,
    step_key: step.step_key,
    title: pick(step.title_i18n, step.title, locale),
    description: pick(step.description_i18n, step.description, locale),
    // Instructions have no plain-text column: they are optional detail, so an untranslated
    // step simply has none rather than falling back to a duplicate of the description.
    instructions: pick(step.instructions_i18n, null, locale),
    page_path: step.page_path ?? null,
    target_selector: step.target_selector ?? null,
    action_type: step.action_type,
    product_area: step.product_area,
    required: step.required === true,
    skippable: step.skippable !== false,
    sort_order: step.sort_order,
    metadata: step.metadata ?? {},
  };
  if (includeRaw) {
    dto.title_i18n = step.title_i18n ?? {};
    dto.description_i18n = step.description_i18n ?? {};
    dto.instructions_i18n = step.instructions_i18n ?? {};
  }
  return dto;
}

/**
 * Recompute a flow's completion.
 *
 * A skipped step counts as resolved: the user made a decision about it, and leaving it
 * pending forever would mean a flow with one optional step could never reach 100%.
 *
 * A flow is complete when every REQUIRED step is completed AND nothing is left unresolved.
 * Required steps are not skippable in the seeds, so "skipped required" cannot normally
 * arise; it is still excluded from completion rather than trusted.
 */
function computeProgress(steps = [], stepProgress = []) {
  const byStep = new Map(stepProgress.map((p) => [p.step_id, p]));
  const total = steps.length;
  if (!total) return { progress_percent: 0, completed: false, resolved: 0, total: 0 };

  let resolved = 0;
  let requiredOutstanding = 0;
  for (const s of steps) {
    const st = byStep.get(s.id)?.status || 'not_started';
    if (st === 'completed' || st === 'skipped') resolved++;
    if (s.required === true && st !== 'completed') requiredOutstanding++;
  }

  const pct = Math.round((resolved / total) * 10000) / 100;   // 2dp, no float drift
  return {
    progress_percent: pct,
    completed: requiredOutstanding === 0 && resolved === total,
    resolved,
    total,
  };
}

/** The next step a user should be pointed at: first unresolved, in order. */
function nextStepId(steps = [], stepProgress = []) {
  const byStep = new Map(stepProgress.map((p) => [p.step_id, p]));
  const ordered = [...steps].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const next = ordered.find((s) => {
    const st = byStep.get(s.id)?.status || 'not_started';
    return st !== 'completed' && st !== 'skipped';
  });
  return next ? next.id : null;
}

/**
 * Is this step-status transition allowed?
 *
 * `viewed` never overwrites a decision: re-opening a step you already completed or skipped
 * must not quietly undo it. Everything else is permitted, because a user revisiting a step
 * and changing their mind is normal.
 */
function canTransitionStep(current, next) {
  if (!STEP_STATUSES.includes(next)) return false;
  if (next === 'viewed' && (current === 'completed' || current === 'skipped')) return false;
  return true;
}

module.exports = {
  SUPPORTED_LOCALES, FALLBACK_LOCALE, FLOW_MODES,
  PROGRESS_STATUSES, STEP_STATUSES, COMPLETION_SOURCES,
  resolveLocale, pick, toFlowDto, toStepDto,
  computeProgress, nextStepId, canTransitionStep,
};
