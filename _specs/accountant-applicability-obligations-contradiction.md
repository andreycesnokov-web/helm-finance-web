# Defect: the Workbench states "0 obligations" while listing three of them

Raised: 2026-09-11, auditing `/business/accountant` before the design pass.
Status: **wording fixed in the design PR (#85). The underlying cause — zero
activated tax rules — is OPEN and belongs to the Tax Engine.**
Workspace type: Business.
Severity: **high as a communication defect — the page tells the user they have no tax obligations while
simultaneously showing three.**

## What the user sees

On the Workbench tab, side by side:

- **Profile completeness — 100%**, full green bar, and underneath:
  *"0 deterministic obligations identified from your profile."*
- **Tax obligations** — a card listing **PPH 21/26**, **PPH 23** and **PPN**.

A complete profile plus "0 obligations identified" reads as *nothing is owed*.
That is the reading the owner explicitly ruled out: insufficient data must not
turn into "no obligations", and a complete profile must not imply the absence of
tax risk.

## Why it happens

The two figures come from two different endpoints that do not agree.

Verified against production (business `b949966a-3988-47cb-9e7c-afad1423f4f8`,
both HTTP 200, the page's own token and `x-business-id`):

```
GET /api/accountant/applicability
  { applicable_rules: [], missing_profile_fields: [] }

GET /api/accountant/obligations
  { obligations: [ {obligation_type:'pph_21_26', status:'insufficient_data', amount:null},
                   {obligation_type:'pph_23',    status:'insufficient_data', amount:null},
                   {obligation_type:'ppn',       status:'unavailable',       amount:null} ],
    reserve: { amount: 0, currency:'IDR', lines: [] } }
```

`applicable_rules` is empty; `obligations` is not. The client renders each from
its own source and never reconciles them:

- `client/src/pages/business/AccountantPremium.jsx` — `rules = ap.applicable_rules || []`,
  then `` `${rules.length} deterministic obligation${…} identified from your profile` ``
  inside the Profile completeness card.
- the same file — the Tax obligations card renders `state.obligations.obligations`.

`missing_profile_fields` is also empty, which drives completeness to 100%. So the
completeness figure is *correct on its own terms* (every profile field is filled)
and still produces a false impression, because the sentence next to it reports a
rule count from an endpoint that returned nothing.

## Impact

A user with a complete profile is told they have no identified obligations. Three
obligations exist, two of them blocked only on missing payroll/service data — i.e.
amounts that will become real once data is recorded. Nothing on the page says the
zero is a *rule-resolution* zero rather than a *liability* zero.

## Resolved: the two endpoints are not measuring the same thing

**Correction, established after this report was first written.** The original
version left open which endpoint was wrong. Neither is.

`applicable_rules` counts rows in `tax_rules` that have passed the activation
gate in `server/lib/taxGate.js` — a verified official source plus an approved
review by a licensed reviewer whose licence was verified by someone else. Read
live from production through the app's own endpoints:

```
GET /api/accountant/rules    →  { jurisdiction: 'ID', rules: [] }      0 active rules
GET /api/accountant/sources  →  3 rows, every last_verified_at = null
GET /api/accountant/summary  →  applicable_rules: 0, active_unverified: 0
```

So `applicable_rules: []` is **correct and expected**: no tax rule has ever been
activated, and `knowledge/indonesia_official_kb/README.md` says so in its own
words — *"no verified official rule has ever been loaded"*.

`/accountant/obligations` is a different, later deterministic path that does not
read `tax_rules` at all. The three rows it returns are obligation *slots* with a
status, not activated rules.

The defect was therefore never a data inconsistency. It was **the sentence**: a
count of activated rules, rendered as "deterministic obligations identified from
your profile", sitting beside a list of obligations, under a 100% completeness
bar. Three true facts composed into a false impression.

## What must happen

1. **Done in the design PR, as copy only.** The Profile completeness card stops
   asserting an obligation count and says what completeness actually measures
   (profile fields filled), plus the explicit warning that a complete profile is
   not a statement about tax risk. No figure, threshold, endpoint or rule was
   changed.
2. **Still open, and larger than this page:** zero activated rules means the
   product cannot yet state what tax applies, on what base, or when. Every
   surface that reports a rule count — here, the Tax Profile readiness card, the
   Workbench — is reporting zero against a gate nothing has passed. That is the
   Tax Engine's activation backlog, not a UI question.
3. Anything that answers a user's tax question must carry this state honestly:
   it may cite a *collected* source as collected, and must never present one as
   settled law. See `_specs/ai-accountant-assistant-audit.md`.

## Not changed here

Tax calculations, deadlines, obligation rules, the API, roles, access, migrations
and the document-recognition engine are all untouched by the design PR.

## Related

- `_specs/business-premium-redesign.md` — the P1 spec this module was built from.
