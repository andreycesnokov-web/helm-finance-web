// PATCH /api/business/targets body from the Settings → Targets form (review 8.2 #13).
// Only fields that changed are sent, so saving one value never rewrites the others, and
// the stored brief minute is kept (the form picks day and hour only). Null clears a value.
// Pure; tested in tests/design/v2TargetsForm.test.mjs.
const numOrNull = (v) => (v === '' || v == null ? null : Number(v))

export function targetsPatch(tg, form) {
  const out = {}
  const runway = numOrNull(form.runway)
  if (runway !== numOrNull(tg?.runway_target_days)) out.runway_target_days = runway
  const cash = numOrNull(form.minCash)
  if (cash !== numOrNull(tg?.min_cash_idr)) out.min_cash_idr = cash == null ? null : String(form.minCash)
  const brief = tg?.weekly_brief || null
  if (form.day === '') { if (brief) out.weekly_brief = null }
  else {
    const day = Number(form.day), hour = Number(form.hour)
    if (!brief || brief.day !== day || brief.hour !== hour) out.weekly_brief = { day, hour, minute: brief?.minute ?? 0 }
  }
  return out
}
