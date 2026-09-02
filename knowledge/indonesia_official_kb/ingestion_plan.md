# Ingestion plan — from this folder into Supabase

**Status: plan only. Nothing here has been executed. No Supabase write has been made.**

This describes how the knowledge base would later become database rows. It deliberately stops at
the point where a licensed human takes over.

---

## What already exists in the schema

Most of the target tables are already defined in the repo's migrations. This plan reuses them
rather than proposing new ones.

| Target | Exists? | Origin |
|---|---|---|
| `official_sources` | Yes | migration 020, extended 023 + 024 |
| `tax_rules` | Yes | migration 020, extended 023 + 024 |
| `tax_rule_reviews` | Yes | migration 024, constrained 025 |
| `audit_events` | Yes | migration 023 (append-only, DB trigger) |
| `knowledge_chunks` | **No** | would be new — RAG only |
| `chunk_embeddings` | **No** | would be new — RAG only, needs pgvector |

> Applied state is unverified. `OPERATIONS.md` says migrations are run by hand in the Supabase SQL
> Editor with no ledger in the repo. Confirm with:
> `SELECT table_name FROM information_schema.tables WHERE table_schema='public'
> AND table_name IN ('official_sources','tax_rules','tax_rule_reviews','audit_events');`

## Stage 1 — `official_sources`

One row per registry entry. Field mapping is direct:

| Registry field | Column |
|---|---|
| `title`, `official_url`, `document_number` | same names |
| `authority` | `authority` |
| `source_type` | `source_type` |
| `language` | `language` |
| `effective_from` / `effective_to` | same names |
| `topic` / `subtopic` | `notes` or `relevant_sections` |

Set `status='draft'` on insert. **Never insert as `verified`.** Verification happens through
`POST /api/admin/official-sources/:id/verify`, which stamps `last_verified_at`,
`verified_by_user_id` and a `content_hash`, and writes an audit event.

`content_hash` matters: it is how a later re-verification detects that a regulation page changed
underneath an active rule.

## Stage 2 — knowledge chunks + embeddings (RAG)

Only worth doing once primary documents are actually downloaded into `raw_sources/`.

```
knowledge_chunks
  id, source_id → official_sources(id)
  chunk_index, content, content_hash
  page_or_section, language
  created_at

chunk_embeddings
  chunk_id → knowledge_chunks(id)
  embedding vector(...)   -- requires pgvector
  model, created_at
```

Rules for this stage:

- Chunk the **primary regulation text**, not our summaries. Summaries are orientation; embedding
  them would let a paraphrase answer a legal question.
- Every chunk keeps `source_id`, so any RAG answer can cite the instrument it came from.
- RAG output is **retrieval, never authority**. It may surface a passage; it may not set a rate.
- Do not embed anything whose licence or reproduction terms are unclear.

## Stage 3 — `tax_rules` as drafts

One row per candidate in `rule_candidates/tax_rule_candidates.json`.

| Candidate field | Column |
|---|---|
| `tax_type` | `obligation_type` |
| `rate`, `base`, `rate_variants` | `parameters` (JSONB) |
| `direction`, `transaction_type`, `service_category`, counterparty/company conditions | `applies_when` (JSONB) |
| `evidence_required` | `parameters.evidence[]` |
| `source_ids[0]` | `official_source_id` |
| `notes` | `interpretation_notes` |

Insert with `status='draft'` and `parameters_status='draft'`. The existing rule model supports the
whole candidate shape through its two JSONB columns — **no migration is needed for this stage.**

## Stage 4 — review and activation

This is the part that cannot be automated, and the part this whole folder exists to feed.

1. Create a `tax_rule_reviews` row for the exact `(tax_rule_id, rule_version)`.
2. Record reviewer name, licence number, licence type, issuing authority.
3. A **different** admin verifies the licence — the API returns 403 if reviewer and verifier are the
   same person.
4. Reviewer sets `review_status='approved'`. The database CHECK refuses this unless reviewer name,
   licence number, verified licence and `reviewed_at` are all present.
5. Verify the official source.
6. `POST /api/admin/tax-rules/:id/activate`. `computeActivationBlockers()` re-checks everything and
   returns 422 with a blocker list if anything is missing.

Only after step 6 does the engine treat the rule as official.

All of this is already implemented and has a UI at `/admin/tax-rules`
(`client/src/pages/TaxRulesAdmin.jsx`). **Nothing new needs building for governance.**

## Stage 5 — engine consumption

`GET /api/accountant/rules` returns `status='active'` rules only. It currently returns `[]`, which
is why the product says "Tax review needed". After Stage 4 the Tax Engine can cite a real rule.

## What must never happen

- Inserting a candidate directly as `status='active'`. The activation gate lives in the API route,
  **not** in a database constraint on `tax_rules.status`, so a manual `UPDATE` in the SQL Editor
  would bypass source verification, licensed review and the audit trail — silently.
- Treating a `summaries/` file as a citation.
- Letting a RAG retrieval populate a rate.
- Marking a source `verified` because it loaded successfully. Verification is a legal judgement, not
  an HTTP 200.

## Suggested order

1. Download primary documents into `raw_sources/` (see its MANIFEST).
2. Load `official_sources` as drafts.
3. Get a licensed reviewer for **one** rule — PPh 23 services.
4. Run that one rule end to end through review and activation.
5. Only then consider RAG, and only then the remaining rules.

---

## Update — source verification pass v1 (2026-09-02)

**Stage 1 readiness changed.** 22 sources now have archived bytes with recorded SHA-256 hashes, so
`official_sources.content_hash` can be populated from real data rather than left null. That matters:
the hash is how a later re-verification detects that a regulation page changed underneath an active
rule.

### What is now ready to load as `official_sources` drafts

The 22 `verification_status: fetch_verified` rows. Each carries `official_url`, `downloaded_file`,
`sha256`, `retrieved_at` and a `verified_excerpt_notes` recording what was actually confirmed.
Load them with `status='draft'` and `content_hash` set. **Still not `verified`** — that remains a
licensed-reviewer judgement, not an HTTP 200.

### What is NOT ready, and must not be ingested

1. **The 43 `search_listed` rows.** Title and URL come from an official domain's index, but the page
   was never opened. Loading them would put unchecked claims into the registry.
2. **`BKPM_OSS_001`** — `unreachable` (DNS failure for `www4.bkpm.go.id`).
3. **`DJP_BUPOT_001` and `KEMENKEU_PPH21_001`** — bytes archived and hashed, but **no embedded text
   layer**. They can be stored as `official_sources` rows, but they must **never** be chunked for RAG:
   there is no text to chunk, and no fact in this KB derives from them.
4. **`OSS_001`, `OSS_003`, `OSS_KBLI_001`** — client-rendered SPAs. The archived HTML contains page
   chrome only. Chunking them would embed navigation text as if it were regulation.

### Consequence for Stage 2 (RAG)

Only **one** document in the whole KB currently has usable primary text: `KEMENKEU_PPN_002`
(PMK 11/2025, 103,878 characters extracted). Everything else is either guidance HTML or unreadable.

**A RAG index built today would be one regulation plus a pile of DJP explainer pages.** That is not
worth building yet. Close gaps 1, 2 and 4 in `reviewer_notes.md` first — the PPh 4(2) PP, the faktur
pajak PER, and PMK-141/PMK.03/2015 — then reconsider.

### Consequence for Stage 3 (rule drafts)

Two candidates were **corrected downward** by this pass, which is the system working as intended:

- `TAX_ID_PPH23_LEGAL_001.base` → `needs_reviewer` (the archived page says *jumlah bruto*, not
  ex-VAT, as we had assumed).
- `TAX_ID_PPN_OUTPUT_001.rate` → `null` (the primary text states no rate and applies 11/12 only to
  enumerated categories, so the blanket effective rate we had drafted was unsupported).

Loading these as drafts is fine. **Activating either would be wrong**, and the gate would refuse it
anyway: neither has a verified source or an approved licensed review.
