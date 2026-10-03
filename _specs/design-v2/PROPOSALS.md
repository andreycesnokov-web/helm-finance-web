# Design v2 — proposals that need owner approval

Nothing in this file is implemented. Each entry is something a v2 screen would need
that does not exist today (a table, a column, a setting, an endpoint shape). Until it
is approved, the screen shows an honest empty / "not set up yet" state or a documented
default. Migrations are NOT written; AGENTS.md requires explicit approval first.

Format: what · fields · why · risk · what the UI does meanwhile.

## P-01 · Per-business runway target (batch 2)

- **What:** a runway target in days, per business.
- **Fields:** `businesses.runway_target_days int null` (or a row in an existing settings
  table), editable in Settings by owner/CFO.
- **Why:** Pulse compares runway with a target ("Target 60 days") and the hero status
  depends on it.
- **Risk:** low — additive nullable column, no financial meaning; needs a migration and a
  write path with the usual role check.
- **Meanwhile:** `RUNWAY_TARGET_DAYS = 60` in `client/src/v2/lib/pulseModel.js` (the design
  default), shown openly as "Target 60 days".

## P-02 · Structured context for the AI CFO (batch 2 → 5)

- **What:** an optional `context` object on `POST /api/ai-cfo/ask` (page, period, filters).
- **Why:** "Looking at: …" should reach the model as data, not as text in the question.
- **Risk:** backend change to the AI route (not auth); prompt-injection review needed.
- **Meanwhile:** context is prepended to the question text on the client.
