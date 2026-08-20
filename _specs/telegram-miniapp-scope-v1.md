# Telegram Mini App Scope v1

Status: **APPROVED CONCEPT — BUILD DEFERRED**
Date: 2026-08-20
Type: Product / architecture scope specification
Implementation: none. This document authorises no code, no migration, no environment change.

---

## 1. Decision Summary

- The Telegram Mini App **concept is approved**.
- The **build is deferred** until the prerequisites in §12 and §17 are complete.
- It is a **Quick Finance Action Layer**.
- It is **not** a full CFO AI application inside Telegram.
- It is **not** a replacement for the future mobile app.
- It is **not** a billing, admin, accounting or compliance surface.

The core sentence, which governs every decision in this document:

> **Bot captures. Mini App decides. Web app configures.**

Whenever a proposed feature does not fit that sentence, the answer is no.

Why deferred rather than declined: the single advantage a Mini App has over simply opening the
web app in a mobile browser is **seamless authentication** — Telegram supplies a signed
`initData` payload, so the user never logs in. That is the entire product case. The
authentication model it would rest on is currently mid-replacement (see §12), so building now
would mean building the one thing the Mini App exists for on a foundation already scheduled for
removal.

---

## 2. Product Role

The Mini App exists to handle **fast operational finance actions inside Telegram**:

- review a captured draft;
- edit key fields;
- confirm or cancel;
- approve, reject, or request more information;
- see the status of submitted requests.

It should reduce friction for everyday finance operations:

- payments;
- expenses;
- invoices;
- receipts;
- quick approval flows.

It should **not** become a full finance management UI.

Positioning, to be quoted whenever scope is contested:

> **Telegram Mini App is not a product surface for finance management.
> It is an action surface for captured finance events.**

The practical test for whether something belongs here: *is it a decision a person makes in under
thirty seconds, on a phone, about something that already exists?* If yes, it may belong in the
Mini App. If it requires setup, configuration, reading history, or thought, it belongs in the web
app.

---

## 3. Core Invariant

This is the most important rule in this document.

> **The Mini App never originates a request.
> It only reviews, edits, or confirms a draft created from an inbound message or file.**

Allowed sources:

- Telegram text message;
- Telegram photo;
- Telegram document / file;
- a future supported channel capture event.

Every Mini App draft must carry a **source reference**:

| Field | Meaning |
|---|---|
| `channel` | `'telegram'` today; the schema is channel-agnostic by design |
| `external_message_id` / `external_file_id` | the inbound event this draft came from |
| `user_id` | the **resolved app user**, never the raw channel identifier |
| `business_id` | the workspace, once selected — may be null before selection |
| `source_timestamp` | when the capture event occurred |
| `extraction_metadata` | parser/classifier output and confidence, where applicable |

> **No source → no draft → the Mini App has nothing to show.**

This is a structural rule, not a guideline. It is what prevents blank-form creation, and it is
what prevents the Mini App from drifting into a second web app. It should be enforced server-side
and asserted in tests: a draft without a valid source reference is not renderable.

---

## 4. Example Workflow

A user writes in Telegram:

> "Pay 1000 dollars to China supplier of vending machine"

The system creates a draft:

- Amount: 1,000
- Currency: USD
- Vendor: China supplier
- Purpose: vending machine
- Company: Helm Care Indonesia
- Category / type: Supplier payment

The Mini App shows a structured review screen:

| Element | Behaviour |
|---|---|
| Amount | editable |
| Currency | editable |
| Vendor | editable |
| Purpose / note | editable |
| Category / type | editable |
| Company | visible, **initially read-only** (see §7) |
| Attachment | optional receipt / invoice / document |
| Actions | **Confirm / Cancel** |

Important:

- There is **no Edit button** inside the Mini App, because the fields are already editable. A
  mode toggle over directly editable fields is pure friction.
- There is **no Save changes button**.
- **Confirm is the only commit.**
- **Cancel discards the draft**, with a confirmation prompt if any field was edited.
- **Autosave may persist draft edits** so a dropped connection or a closed webview does not lose
  work — but autosave writes to the *draft* and **never creates a financial record**.

The reason there is no separate Save: it would introduce a third state — *edited but not
confirmed* — which is an item that looks handled but is not, an extra state every list view must
represent, and a place for drafts to rot silently. Two states only: **draft**, or **confirmed**.

Note on the example: `Company: Helm Care Indonesia` is shown because it is the **current Telegram
active workspace**, and it must be labelled as such. It is not a parser result and must never be
presented as one.

---

## 5. v1 Screens

The intended screen set is deliberately narrow. Five screens, no more.

### 1. Home / Action Inbox
- active Telegram company, **always visible**;
- drafts needing review;
- approvals waiting for this user;
- recent submitted requests.

### 2. Draft Review
- structured draft fields;
- editable amount, currency, vendor, purpose, category;
- attachment area;
- Confirm / Cancel.

### 3. Approval Detail
- company;
- requested by;
- amount + currency;
- vendor;
- purpose;
- attachment;
- Approve / Reject / Request info.

### 4. My Request Status
- submitted;
- waiting approval;
- approved;
- rejected;
- needs info.

### 5. Blocked / Unlinked State
- explains that Telegram must be connected through the CFO AI web app;
- includes the web app URL;
- reached whenever linkage is unlinked or unverifiable (see §12).

---

## 6. Field Rules

### Amount
- editable;
- **always shown together with its currency**;
- **no bare numeric amount** anywhere in the UI, including summaries and confirmations.

### Currency
- editable;
- **high-risk field** — `1,000 USD` and `1,000 IDR` differ by roughly 15,000×, and that is one
  tap apart;
- **changing currency must never silently reinterpret the amount**;
- **preferred v1 behaviour: changing the currency clears the amount and requires re-entry**;
- alternative for a later phase: an explicit second confirmation showing the old and the new
  currency context side by side.

### Vendor
- editable free text;
- a **low-confidence parser value must render empty and required**, not as a confident-looking
  guess. A wrong value a user skims past is worse than a blank one they must fill. This is the
  same fail-closed principle applied elsewhere in the product.

### Purpose / note
- editable free text;
- lowest-risk field.

### Category / type
- editable / selectable;
- **options are per-company**;
- **must be re-derived if the company changes** — a type valid in one company may not exist in
  another.

### Attachment
- a receipt, invoice or document may be added to an **existing** draft;
- **chat remains the primary capture path** — sending a photo in the conversation is more natural
  than a file picker inside a webview;
- the attachment must be **scoped correctly to the draft and its company**, and re-scoped or
  cleared if the company changes.

### Company
- **not a normal field**;
- **company is scope**;
- see §7, which governs it exclusively.

---

## 7. Company / Workspace Rule

This section is strict, and is the section most likely to be under-implemented.

> **Company is not a value. Company is scope.**

Six of the seven editable elements are values. Company is the frame that gives all of them
meaning. Implemented casually — as a plain `<select>` with local state — it becomes the
mis-filing bug, on the one control whose failure mode is a payment landing in the wrong ledger.

Changing the company changes:

- who pays;
- the ledger;
- membership;
- role;
- approval routing;
- available categories;
- currency conventions;
- attachment ownership;
- duplicate and validity checks.

### Phase B — company read-only

- company is **visible but read-only**;
- it shows the **current Telegram active business**;
- **no silent guessing** — if there is no active company and multiple are available, the field is
  empty, it is required, and **Confirm is disabled**;
- switching company in Phase B happens through the existing bot mechanism (`/company` /
  `/workspace`), not inside the Mini App.

### Phase B2 — company editable

Company becomes editable **only after full backend revalidation is implemented**, behind its own
flag and its own review.

On company change, the **server** — never the client — must re-check:

- membership in the target company;
- role;
- the user's permission to submit in the target company;
- category / type validity;
- currency conventions;
- approval routing;
- attachment ownership and re-scoping;
- duplicate and validity checks;
- that the business is **active and not archived**.

Implementation consequence: **a company change is a server round-trip that returns a revalidated
draft**, not a local state update. Fields that became invalid come back **cleared and flagged**,
never silently carried across. The server response is authoritative — if it says the user may not
submit in the target company, the client shows that and does not re-enable the action.

### Selector list

The selector list must be **server-filtered**:

- business workspaces only;
- **no personal workspace**;
- **no archived workspace**;
- only memberships the user can actually access.

> **Never send personal or archived workspaces to the client and filter client-side.**
> Client-side filtering ships the excluded workspaces to the device.

> **Never guess company silently.**

---

## 8. Bot / Mini App / Web Responsibilities

### Bot
- onboarding;
- quick text capture;
- photo / document capture;
- notifications — the **only** surface that can reach a user unprompted;
- opening the Mini App;
- fallback commands;
- `/company` or `/workspace`.

### Mini App
- draft review;
- structured editing;
- Confirm / Cancel;
- approval review;
- Approve / Reject / Request info;
- status of submitted requests;
- attaching evidence to an **existing** draft.

### Web app
- primary identity;
- email login;
- Telegram linking;
- workspace setup;
- billing;
- admin;
- business settings;
- members and roles;
- accountant workflows;
- compliance / tax profile;
- full document center;
- reporting;
- audit and history.

The web app remains **canonical**. Anything ambiguous belongs there.

---

## 9. What Is Explicitly Out of Scope

Hard exclusions. Adding any of these requires re-opening this spec, not a pull request.

- blank request creation;
- billing;
- subscriptions;
- admin dashboard;
- tax profile;
- accountant workspace;
- company setup;
- member management;
- full document center;
- full reports;
- full Finance OS dashboard;
- personal finance;
- personal workspaces;
- free-text AI chat inside the Mini App;
- bulk actions;
- editing already-approved items;
- writes without explicit confirmation;
- mobile app replacement.

Two notes on the reasoning:

- **Personal workspaces are excluded entirely**, not merely discouraged. Business and personal
  money must not mix, and the way to guarantee that on a compact surface is to make personal
  unreachable — the same approach the existing Telegram active-business resolution already takes.
- **Bulk actions are excluded** because "approve all" on a phone is how mistakes happen at scale.

---

## 10. Inline Bot Editor Retirement

When the Mini App draft editor ships:

- the bot card becomes **summary + "Review in app"**;
- the **bot inline edit callbacks are retired in the same release**;
- **do not run two editors for the same draft**;
- keep only a **plain-text confirm fallback** for the case where the Mini App genuinely cannot
  open;
- **no inline edit fallback**.

Reason: two editors create divergent state, duplicated logic, and additional permission and
security risk. Running both during a transition period keeps every problem of the old path alive
while adding the new one.

---

## 11. Approval Flow

The Mini App should eventually **replace the forwardable inline approval buttons**.

This is one of the stronger arguments for building it at all. A Telegram message carrying inline
buttons can be forwarded, and the buttons travel with it. A Mini App session authenticated by
verified `initData` is a materially stronger control on a flow that moves money.

Approval actions must:

- validate the Mini App session;
- **re-check membership and role at action time** — the list was rendered at page load, and role
  can have changed since;
- confirm the request is **still pending**;
- be **idempotent**;
- write an **audit event**;
- **never rely only on stale rendered state**.

For money-moving or otherwise high-risk actions, consider a two-step confirmation:

> Approve → Confirm approval of amount / currency / vendor / company.

---

## 12. Authentication / Identity Prerequisites

> **The Mini App must not be built on the `users.id = telegram_id` conflation.**

Required before implementation:

- `user_channel_links`;
- `channel_link_tokens`;
- `user_channel_state`;
- `resolveTelegramUser()`;
- the `link_<token>` web connection flow;
- Telegram `initData` validation;
- a **short-lived Mini App session token**;
- **no asserted `telegram_user_id` accepted from a request body**.

### Correct auth model

```
Telegram initData
  → backend verifies the Telegram signature
  → extract telegram_user_id from the VERIFIED initData only
  → resolveTelegramUser(telegram_user_id)
  → app user_id
  → workspace membership
  → active_business_id
  → allowed actions
```

Non-negotiables within that flow:

- the `telegram_user_id` comes from **verified `initData` only** — never from a request body;
- **`auth_date` freshness must be enforced**, or a captured `initData` string becomes a permanent
  credential;
- session tokens are **short-lived**, not the long-lived token the web app issues — a phone
  inside a chat app is a different threat model;
- the **Mini App URL is public**. Anyone can open it. All authorisation is server-side.
  "`initData` is present, therefore trust" is not a check;
- **no `business_id` anywhere in the identity path**. The model is
  `channel + external_user_id → user_id → membership`, every time.

### Fail closed

- **unlinked** → onboarding message + web app URL;
- **unverifiable** → temporary-unavailable message + web app URL;
- in both cases: **no parser access, no draft access, no action access.**

The Mini App must not become a way around the fail-closed guard that already governs the bot. It
should **share** the linkage classifier rather than reimplement it.

---

## 13. Workspace Routing

The Telegram channel has its **own active workspace, separate from the web active workspace**. A
user working at a desk and a user answering on a phone are legitimately in different contexts.

But the **bot and the Mini App share one Telegram active workspace**:

- `/company` in the bot changes the Telegram active company;
- the Mini App sees the same active company;
- later, the Mini App company selector updates **the same Telegram channel state**.

Separate selections for the bot and the Mini App would be a genuine mis-filing trap: change the
company in the app, send a photo in the chat, and watch it land in the previous one.

Rules, unchanged from the identity contract:

- business workspaces only;
- **no personal workspace**;
- **no archived workspace**;
- **membership checked live**, not cached in a binding;
- **no silent guessing** — multiple candidates means an explicit choice.

---

## 14. Multilingual Behaviour

Language resolution rule:

1. detect the language from the **current message**;
2. else the Telegram `language_code`;
3. else a saved user / channel preference, if available;
4. else English.

The **draft screen language follows the captured message language**.

Examples:

| Input | Expected |
|---|---|
| "Pay 1000 dollars to China supplier of vending machine" | English labels and buttons |
| "Оплатил бензин 50000 рупий" | Russian labels and buttons |
| "Bayar supplier 2 juta IDR" | Indonesian labels and buttons |

Implementation notes for whoever picks this up:

- Cyrillic script detection is near-perfect and deterministic for Russian versus English, and
  requires no additional AI call.
- Indonesian versus English is harder, since both use Latin script. The parser already processes
  the message text, so returning a detected-language field from it is close to free.
- A one-word reply ("ok", "да") is not reliably detectable — hence step 3. Once a language is
  established for a user, remember it and switch only on a clear signal.

> **The bot language consistency fix is required before Mini App implementation.**

This is a live defect today, not a future concern: the bot currently answers an English message in
Russian. The onboarding and temporary-unavailable messages are localised, but the draft cards,
progress messages, confirmations and error strings are hardcoded Russian. Extracting them into the
existing localisation module and routing every reply through the resolved language is
**PR5a.2**, and it is the first item in Phase 0.

---

## 15. Security / Privacy Risks

Ranked, most consequential first.

1. **Building Mini App auth on the identity conflation.** The single reason the build is
   deferred. Every session token minted against `users.id = telegram_id` is a credential that
   must later be re-issued.
2. **`initData` replay.** Without `auth_date` freshness enforcement, a captured `initData` string
   is a permanent login.
3. **Long-lived session tokens** on a device that lives in a pocket.
4. **A public Mini App URL** — anyone can open it; the URL is not a secret and is not a control.
5. **Client-side-only authorisation.** Every gate must be re-evaluated server-side on every
   action.
6. **Company mis-filing.** The highest-consequence functional error: a payment recorded against
   the wrong legal entity. Addressed by §7.
7. **Currency and amount mistakes.** One tap between `1,000 USD` and `1,000 IDR`. Addressed by
   §6.
8. **Personal / business mixing** on a compact surface where the active workspace is easy to lose
   track of. Addressed by excluding personal entirely.
9. **Forwarded inline buttons.** The existing exposure the Mini App is intended to remove — which
   only happens if the old path is retired rather than run alongside (§10).
10. **Approval actions without a re-check at action time**, acting on state rendered minutes
    earlier.
11. **Third-client security drift.** A new client is a new place to reintroduce a leak of the kind
    already caught once in this codebase — raw row pass-through instead of an explicit field
    whitelist. Every Mini App response needs the same whitelist discipline.
12. **Third-party Telegram webview context.** The page renders inside a client controlled by
    Telegram. Not a leak in itself, but an argument against putting anything there that is not
    operationally necessary.
13. **Screenshots and shoulder-surfing** of financial data — amounts and counterparties displayed
    on a phone screen inside a chat app.

---

## 16. Maintenance / Product Risks

- **Scope creep into a full web app copy.** The dominant risk. Every Mini App drifts toward
  becoming a small web app — "just add the checklist", "just add reporting". §9 exists so that
  additions require re-opening this document rather than a pull request.
- **A third frontend / client surface**, on top of the web app and the bot.
- **Contract drift between web, bot and Mini App.** Every backend change becomes a
  three-way coordination with three deploys and three skew windows. This is already felt with two
  repositories and no shared contract tests.
- **Extra CI, testing and deploy complexity.** The Telegram stack currently has no CI at all; a
  Mini App would need its own pipeline from day one.
- **The Mini App cannibalising the future mobile app.** Users will treat whatever works on their
  phone as the mobile app. If the Mini App is good, mobile gets deprioritised; if it is bad, it
  colours the perception of mobile. This needs a deliberate decision, not a drift.
- **Platform dependency on Telegram** — its Mini App API, its policies, its distribution — for a
  workflow inside a finance product.
- **Concentration risk if WhatsApp matters more for Indonesia.** The channel-agnostic identity
  schema anticipates other channels, but a Telegram *Mini App* is Telegram-specific UI that
  WhatsApp cannot reuse. This is the one place where "channel-agnostic schema, Telegram-only
  code" stops being cheap.

---

## 17. Phasing

### Phase 0 — prerequisites (blocking)

- **PR5a.2** — bot language consistency;
- **PR0.5** — secret unification across repositories;
- **PR5c** — remove the service key and direct DB reads from the bot;
- **PR1–PR4** — channel identity and linking (`user_channel_links`, `resolveTelegramUser()`,
  archived-workspace handling, `link_<token>` and the Integrations UI);
- **PR6** — Telegram document ingestion;
- **outstanding smoke tests completed.**

PR6 also serves a second purpose: it produces the usage evidence needed to decide whether the
Mini App is worth building at all. If nobody captures finance events via Telegram, this document
should be closed rather than executed.

### Phase A — read-only
- Mini App auth / session;
- context (user, active workspace, role);
- approvals list;
- my request statuses;
- **no writes.**

Proves the authentication path end to end with zero blast radius, and is useful on its own.

### Phase B — draft review / editor
- review and edit a captured draft;
- Confirm / Cancel;
- **company read-only.**

### Phase B2 — company editable
- full server-side revalidation per §7;
- **separate flag**;
- **separate review.**

Separated deliberately: this is the one field that can move money into the wrong ledger.

### Phase C — approvals
- Approve / Reject / Request info;
- **retire the inline approval buttons and the bot inline editor** in the same release.

### Phase D — attachments
- attach a receipt, invoice or document to an existing draft;
- **chat remains the primary file capture path.**

Each phase ships behind its own flag and is independently revertible.

---

## 18. Open Questions

1. **Is the Mini App only a Telegram convenience layer, or part of the long-term mobile
   strategy?** These imply materially different scopes. Should be answered before Phase A.
2. **Should company edit wait until Phase B2?** Current recommendation: yes.
3. **Should inline approval buttons be retired at Phase C?** Current recommendation: yes, in the
   same release, with no overlap period.
4. **What language persistence model should be used** — per user, per channel, or per workspace?
5. **How much Telegram investment is justified if WhatsApp is more important in Indonesia?** The
   sharpest strategic question in this document.
6. **Should high-value approvals require two-step confirmation**, and if so, above what
   threshold and in which currency?

---

## 19. Final Recommendation

**Concept approved.**
**Build deferred.**
**Spec now.**

**No implementation until the identity, linking, security and language prerequisites in §12 and
Phase 0 of §17 are complete.**

The concept is sound and the scope in this document is the right scope. Built after the
prerequisites, it will be a better product than it would be today — and it will not require
re-issuing its own authentication model six weeks after launch.

---

*This document is a scope specification. It authorises no code, no migration, no environment
change and no deployment.*
