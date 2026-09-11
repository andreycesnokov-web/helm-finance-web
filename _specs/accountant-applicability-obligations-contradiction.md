# Defect: the Workbench states "0 obligations" while listing three of them

Raised: 2026-09-11, auditing `/business/accountant` before the design pass.
Status: **OPEN — not fixed. This is a data/server question, not a design one.**
Workspace type: Business.
Severity: **high — the page tells the user they have no tax obligations while
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

## What this report does NOT claim

Which endpoint is right. `applicable_rules` may legitimately be empty (no rule set
configured for this jurisdiction/entity) while `obligations` is a separate
deterministic list; or the applicability rule set may simply not have been seeded
for this business. Deciding that needs a look at the tax-rule tables and at
`/accountant/applicability`'s resolution, neither of which belongs in a design PR.

## What must happen

1. Establish which endpoint is authoritative for "how many obligations apply to
   this company", and whether an empty `applicable_rules` with a non-empty
   `obligations` list is an expected state or a seeding gap.
2. Until then the page must not state a count that contradicts the list beside
   it. Handled in the design PR as **copy only**: the Profile completeness card
   stops asserting an obligation count, and says what completeness actually
   measures (profile fields filled) plus the explicit warning that a complete
   profile is not a statement about tax risk. No figure, threshold, endpoint or
   rule is changed.
3. A check that the two sources agree, once step 1 settles which one leads.

## Not changed here

Tax calculations, deadlines, obligation rules, the API, roles, access, migrations
and the document-recognition engine are all untouched by the design PR.

## Related

- `_specs/business-premium-redesign.md` — the P1 spec this module was built from.
