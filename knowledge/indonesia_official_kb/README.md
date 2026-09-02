# Indonesia Official Knowledge Base — v1

Jurisdiction: Indonesia. Last pass: **2026-09-02, Phase 2 (source verification + currentness evidence)**.

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

**No legal conclusion is authoritative.** Every registry entry is `status: collected`. Every rule
candidate is `status: under_review`, `legal_verified: false`, `active: false`.

Three distinct things are tracked separately, and they are **not** the same:

1. **Retrieval** (`verification_status`) — 31 sources are `fetch_verified`: bytes downloaded,
   SHA-256 recorded, title confirmed. The remaining entries are `search_listed` (found on an
   official domain, page never opened) or `unreachable`.
2. **Currentness** (`currentness_result`) — what an official status page *said* on
   `currentness_checked_at`. Evidence of publication status only. It never sets `legal_verified`.
3. **Legal verification** — a licensed Indonesian reviewer confirming rate, base, effective dates
   and applicability against primary text. **This has not happened for anything here.**

## What is under review

All of it. The position after Phase 2:

| Candidate | Rate | Base | Grounding |
|---|---|---|---|
| PPh 23 services | `0.02` | gross **excl. PPN** | **Primary text** — PMK 141/2015 Pasal 1(1); *Jasa hukum* is item (d) |
| PPh 4(2) rental | `0.10` final | gross **incl.** service/facility charges | **Primary text** — PP 34/2017 Pasal 4(1)–(2) |
| PPN output | `null` | `needs_reviewer` | PMK 11/2025 primary text states **no rate**; 11/12 applies per enumerated category only |
| PPh Badan UMKM | `0.005` | monthly gross turnover | DJP guidance only — content not mined |
| PPh 21 | `null` | `needs_reviewer` | TER is a **table**, not a scalar — out of v1 scope |
| PPh Badan general | `null` | `needs_reviewer` | **No source collected** |

> The codebase seeds `ID_PPN_MONTHLY` with `{"rate":0.11}` and `ID_PPH_BADAN_ANNUAL` with
> `{"rate":0.22}` in migration 020. **Neither has a verified source in this registry.** They must be
> re-derived, not reused.

Open gaps, with severity and next step, are tracked in `gap_register.md`.

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

## Evidence precedence — the rule for this KB

Two directories look similar and are **not** equal in authority:

| Directory | What it is | Authority |
|---|---|---|
| `raw_sources/` | The archived official bytes, exactly as retrieved, with SHA-256 in `raw_sources/MANIFEST.json` | **Authoritative archived evidence** |
| `summaries/_extracted/` | Text mechanically derived *from* those bytes (HTML tags stripped, PDF text pulled) | **Derived review text — not a legal source of truth** |

`_extracted/` exists for traceability: it is what lets a reviewer see the sentence a grounded
summary rests on without re-downloading anything. It is kept in the repository deliberately, as a
review artifact rather than a build artifact.

**If the two ever disagree, `raw_sources/` plus the SHA-256 manifest wins.** The extraction is
lossy by construction — tag stripping, PDF encodings, whitespace collapsing — so a discrepancy
means the extraction is wrong, never that the archived bytes are.

Consequences, enforced by `tools/validate_kb.py`:

- A rule candidate's `source_ids` must name a **registry source**, never an `_extracted` file.
- RAG ingestion, when it happens, chunks `raw_sources/` — never `_extracted/` and never `summaries/`.
- A hash is always computed over `raw_sources/` bytes. `_extracted/` is never hashed as evidence.

## Layout

| Path | Contents |
|---|---|
| `source_registry.json` / `.csv` | All 75 sources, same data, generated together |
| `ingestion_plan.md` | How this becomes Supabase rows later |
| `reviewer_notes.md` | The questions for the Indonesian tax reviewer |
| `tax/`, `compliance/`, `accounting_evidence/` | Per-topic README with scope, sources, gaps |
| `rule_candidates/` | Draft candidates — all `under_review` |
| `raw_sources/` | **31 archived official documents (~14 MB), SHA-256 in `MANIFEST.json`** |
| `summaries/` | Grounded summaries + `_extracted/` derived review text |
| `gap_register.md` | Open gaps with severity and next step |
| `tools/validate_kb.py` | Integrity validator — 12 checks |
| `secondary_references/` | Non-authoritative material — empty by design |

## Honest limits

- **Nothing is legally verified.** No licensed reviewer has approved anything here.
- **7 archived sources are `not_chunkable`** — bytes preserved and hashed, but no readable text
  (2 scanned/encoded PDFs, 2 image PDFs, 3 client-rendered SPAs). **No fact in this KB derives from
  them**, and `tools/validate_kb.py` enforces that no rate rests solely on one.
- **Currentness is evidence, not proof.** For PMK 141/2015, BPK holds no relationship data
  (`STATUS PERATURAN: Belum Tersedia`), so the absence of a recorded amendment is not proof of none.
- Regulation text is **not reproduced** here. Summaries paraphrase and cite; go to the archived bytes.
- **RAG is not ready.** Only three instruments have usable primary text.
- Not collected: faktur pajak PER, PT PMA, BPJS Kesehatan content (host confirmed as
  `www.bpjs-kesehatan.go.id`), general corporate PPh Badan rate.
