# Indonesia Official Knowledge Base — v1 (first pass)

Collected **2026-09-02**. Jurisdiction: Indonesia.

This folder is a **research artifact**, not application data. Nothing here is wired into the
product, and nothing here may be treated as a statement of Indonesian law.

---

## Purpose

Assemble official Indonesian tax, compliance and accounting-evidence sources so that a licensed
reviewer can later turn a small number of them into **activated tax rules**. It is the raw material
for the Tax Engine and for a future Supabase RAG / knowledge base.

It exists because the product currently cannot say what tax applies, on what base, or what evidence
is required — and the honest reason is that **no verified official rule has ever been loaded**.

## Source hierarchy

Sources are ranked by `trust_level`. Higher beats lower whenever they disagree.

| trust_level | What it is | May a rule rest on it? |
|---|---|---|
| `law` | UU — statute | Yes |
| `regulation` | PP, PMK, PER — binding implementing rules | Yes |
| `official_guidance` | DJP/OSS/BKPM/BPJS explanatory pages, manuals | **Supporting only** — never the sole basis for a rate |
| `faq` | Official FAQ pages | Supporting only |
| `announcement` | Siaran pers, news from the authority | Context only; often period-specific |

Accepted domains in this pass: `pajak.go.id`, `jdih.kemenkeu.go.id`, `peraturan.bpk.go.id`,
`kemenkeu.go.id` (incl. `djpb.` and `klc2.`), `oss.go.id`, `bkpm.go.id`,
`bpjsketenagakerjaan.go.id`.

No blogs, consultant articles, SEO summaries or news outlets were used. `secondary_references/` is
empty by design — see its README.

## What is authoritative here

**Nothing yet.** Every registry entry is `status: collected`. Every rule candidate is
`status: under_review` with `needs_reviewer: true`.

Two distinct verification steps are still outstanding, and they are different things:

1. **URL verification** — only `DJP_PPN_001` was individually fetched and read. Every other entry
   was returned by a search restricted to official domains, so its title and URL come from that
   domain's own index, but the page content has not been read. Each entry records this in `notes`
   as either `fetch-verified` or `search-listed`.
2. **Legal verification** — a licensed Indonesian tax reviewer confirming rate, base, effective
   dates and applicability against the **primary regulation text**.

## What is under review

All of it. Concretely, the rates that appear anywhere in `rule_candidates/`:

- PPh 23 services `0.02` / `0.04` — from DJP guidance summaries, **not** from PMK-141/PMK.03/2015 text
- PPh 4(2) rental `0.10` final — from DJP guidance summaries, **not** from the governing PP
- PPN `0.12` with `11/12` DPP nilai lain — the DJP page for **PMK 11/2025** was fetch-verified, but an
  amendment exists that has not been read, so the *current* position is not established
- PPh Badan UMKM `0.005` — from DJP guidance; PP 55/2022 vs PP 20/2026 interaction unresolved
- PPh 21 — deliberately `null`; it is a TER **table**, not a scalar
- PPh Badan general — deliberately `null`; **no source collected**

> The existing codebase seeds `ID_PPN_MONTHLY` with `{"rate":0.11}` and `ID_PPH_BADAN_ANNUAL` with
> `{"rate":0.22}` in migration 020. Neither value has a verified source in this registry. They must
> be re-derived, not reused.

## How this connects to the Tax Engine

```
raw_sources/  ──▶  official_sources        (verified by a human)
summaries/    ──▶  knowledge_chunks + embeddings   (future RAG)
rule_candidates/ ─▶ tax_rules (status=draft)
                     └─▶ tax_rule_reviews (licensed reviewer)
                          └─▶ tax_rules.status = active   ← ONLY here does the engine use it
```

The application already enforces the last step. `server/lib/taxGate.js` blocks activation unless the
official source is verified *and* an approved review exists for that exact rule version, and the
database refuses to record an approved review without a reviewer name, licence number and a licence
verified by **someone other than the reviewer**.

**Nothing in this folder shortcuts that.** Copying a candidate straight into `tax_rules` with
`status='active'` via SQL would bypass the gate entirely and leave no audit trail. Don't.

## Layout

| Path | Contents |
|---|---|
| `source_registry.json` / `.csv` | All 66 sources, same data, generated together |
| `ingestion_plan.md` | How this becomes Supabase rows later |
| `reviewer_notes.md` | The questions for the Indonesian tax reviewer |
| `tax/`, `compliance/`, `accounting_evidence/` | Per-topic README with scope, sources, gaps |
| `rule_candidates/` | Draft candidates — all `under_review` |
| `raw_sources/` | Downloaded primary documents — **empty**, see `raw_sources/MANIFEST.md` |
| `summaries/` | Per-topic notes written from the sources |
| `secondary_references/` | Non-authoritative material — empty by design |

## Honest limits of this pass

- **No files were downloaded.** `raw_sources/` is empty and every `downloaded_file` is `""`.
  Retrieval here produced page text, not archived PDFs. `raw_sources/MANIFEST.md` lists the
  priority documents to download so the claim "we hold the primary text" is never made falsely.
- **Summaries are written from search-result content**, not from full regulation text. They are
  orientation for a reviewer, not a substitute for reading the PMK/PP.
- Regulation text is **not reproduced** here. Summaries paraphrase and cite; go to the source.
- BPJS Kesehatan, faktur pajak PER, and PT PMA-specific sources were **not** collected — see gaps.
