// Which model may do which job. One place, so it cannot drift.
//
// The rule this exists to enforce: EVERY uploaded financial document is read by Opus 5.
// Not "usually", not "when the document looks hard", not "unless a cheaper model seems
// sufficient" — every one. A weaker model deciding whether the strong model is needed is
// itself a judgement about a financial document, so that decision is not delegated
// either.
//
// The identifier below was verified against this account's /v1/models on 2026-09-05:
//   opus:   claude-opus-5, claude-opus-4-8, claude-opus-4-7, claude-opus-4-6, …
//   sonnet: claude-sonnet-5, claude-sonnet-4-6, …
// It is not guessed from a naming convention.
//
// If Opus cannot answer, the correct outcome is a VISIBLE, RETRYABLE failure. Falling
// back to a lesser model, to regex parsing, or to the legacy OCR path would quietly
// produce a worse reading under the same label — which is precisely the confusion this
// architecture was built to end.
'use strict';

/** The only model permitted to perform primary extraction from a financial document. */
const PRIMARY_EXTRACTION_MODEL = 'claude-opus-5';

/** Models acceptable for auxiliary, non-authoritative work: summaries, titles, search
 *  phrasing, conversational replies. Nothing here may read a document for its figures. */
const AUXILIARY_MODELS = ['claude-sonnet-5', 'claude-haiku-4-5-20251001'];

/** Anything matching this is Opus. Kept as a family test rather than an equality check so
 *  a future pinned build (claude-opus-5-20260401) still satisfies the policy. */
const OPUS_FAMILY = /^claude-opus-/;

const TASKS = {
  // Reading a document for its parties, dates and figures.
  primary_extraction: { model: PRIMARY_EXTRACTION_MODEL, requiresOpus: true },
  // Deciding how many documents a PDF contains and where each begins. This is still a
  // reading of a financial document, so it does not get a cheaper model either.
  bundle_segmentation: { model: PRIMARY_EXTRACTION_MODEL, requiresOpus: true },
};

/**
 * The model for a task.
 * @throws if a task would resolve to a non-Opus model for work that requires Opus —
 *         a misconfiguration must fail loudly at the call site, not silently downgrade.
 */
function modelFor(task) {
  const t = TASKS[task];
  if (!t) throw new Error(`modelPolicy: unknown task "${task}"`);
  if (t.requiresOpus && !OPUS_FAMILY.test(t.model)) {
    throw new Error(`modelPolicy: task "${task}" requires Opus but is configured with "${t.model}"`);
  }
  return t.model;
}

/** Does this model satisfy the primary-extraction policy? */
const isOpus = (model) => OPUS_FAMILY.test(String(model || ''));

/** Tasks that may never be answered by a non-Opus model. */
const OPUS_REQUIRED_TASKS = Object.keys(TASKS).filter((k) => TASKS[k].requiresOpus);

module.exports = {
  PRIMARY_EXTRACTION_MODEL, AUXILIARY_MODELS, OPUS_FAMILY,
  TASKS, OPUS_REQUIRED_TASKS, modelFor, isOpus,
};
