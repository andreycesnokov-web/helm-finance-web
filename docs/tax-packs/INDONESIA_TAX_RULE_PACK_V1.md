# Indonesia Tax Rule Pack V1

> **STATUS: Ready for professional verification.** No rule in this pack is
> active or legally confirmed. A licensed Indonesian tax professional must
> review and approve each rule, and its official source must be verified, before
> activation. Until then rules stay `draft` / `under_review` and do not generate
> confirmed obligations, AI answers, or CFO/Decision cash pressure.

| Field | Value |
|---|---|
| Scope | Country: Indonesia · Jurisdiction: Indonesia national |
| Pilot rule | `ID_PPN_MONTHLY` (PPN monthly compliance obligation) |
| Migrations | 023 (foundation), 024 (review + content), 025 (DB approval guards) |
| Status | Ready for professional verification |

## Supported rules (candidates)
| rule_code | obligation | status | note |
|---|---|---|---|
| `ID_PPN_MONTHLY` | VAT monthly | draft v2 (pilot) | [rule card](indonesia/ID_PPN_MONTHLY_V1.md) |
| `ID_PPH21_MONTHLY` | payroll withholding | under_review v1 | progressive schedule — later |
| `ID_PPH_BADAN_ANNUAL` | corporate income | under_review v1 | PP23 exceptions — later |

## Source list (to be verified)
| source | authority | status |
|---|---|---|
| DJP — PPN | Direktorat Jenderal Pajak | draft (unverified) |
| DJP — PPh Badan | DJP | draft (unverified) |
| DJP — PPh 21 | DJP | draft (unverified) |

Only official government portals / regulations / DJP publications are acceptable
sources. Blogs, SEO articles, forums and AI output are not sources of truth.

## Two-level verification
1. **Source verification** (platform editor): URL is official, document exists,
   relevant to topic, in effect for the period, not replaced, content hash
   recorded, verification date saved.
2. **Professional review** (licensed specialist): applicability, due date,
   parameters and exceptions correctly interpreted; effective dates correct.

An official link alone does **not** make a rule ready. Both levels are required.

## Activation gate (§15)
A rule may become `active` only when: source verified, professional review
`approved` (license verified, not expired, matches the rule version), effective
dates set, `due_date_rule_json` valid, applicability complete, no unresolved
blockers. The backend is the source of truth; the UI button cannot bypass it.

## Pilot workflow (PPN)
official source → source verification → rule draft → structured applicability →
structured due date → draft parameters → professional review → activation →
compliance event → AI explanation → CFO future pressure. The pilot reaches
**draft + pending review + blockers**; activation awaits a licensed professional.

## Known limitations
No full tax calculation, no filing/Coretax integration, no Partner Portal, no
automatic source monitoring, Indonesia only, three rules currently unverified.
