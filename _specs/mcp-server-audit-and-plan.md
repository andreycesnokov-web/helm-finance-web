# CFO Finance MCP Server — Architecture Audit & Implementation Plan

Status: **AUDIT + PLAN (no code written yet)**. Date: 2026-10-01.
Author: Claude (implementation agent). Awaiting owner/Codex validation before any build.

Guiding principle (from the brief): **ONE** CFO Finance MCP Server as a thin adapter over the
existing backend. The MCP layer must **not** become a second accounting engine. CFO Finance OS
stays the single source of truth; ChatGPT / Claude / API are just interfaces.

---

## A. What already exists and can be reused

The backend is a single Express app (`server/index.js`, ~14k lines, **252 routes**) over
Supabase (Postgres) using the **service-role** client, with domain logic factored into
`server/lib/*` (50+ modules). Almost everything the MCP tools need already exists as a service.

### Authentication (reuse the identity, replace the front door)
- `server/index.js:141` `function auth(req,res,next)` — reads `Authorization: Bearer <jwt>`,
  `jwt.verify(token, JWT_SECRET)` (HS256, `jsonwebtoken`), sets `req.user = { userId, ... }`.
- Tokens are minted at login: Telegram (`:132`) and email OTP (`emailJwt`, `:259`), `expiresIn: '30d'`.
- Identity model (already in prod): `users.id` = Telegram id (positive) **or** negative id for
  email-origin users (migration 042). Canonical pilot owner = `-1`.
- **Implication:** we already have a stable internal user identity. What is missing is an
  **OAuth 2.1 authorization server** in front of it (MCP remote requires OAuth). See §E.

### Tenant / company isolation (reuse as-is — this is the crown jewel)
- `server/lib/businessResolver.js:31` `resolveActiveBusiness(supabase, ensureDefaultBusiness, req)`
  — resolves the active company from `x-business-id` header / `business_id` query / body, then
  **verifies membership server-side** against `business_members` (`user_id` + `business_id` +
  `status='active'`), rejects personal workspaces for business routes, returns `{ business, role, ownerUserId }`.
- `server/index.js:900` `requireBusiness(req,res)` wraps it and is the gate used by every
  business route.
- Role gates: `canViewBusinessFinance` (`:807`), `canManageDocuments` (`:12700`),
  `canManagePayroll`, `canManageWallets`, `canManageCategories`, `canManageClassificationRules`.
- `workspaceAccess.js` / `businessAccess.js` provide `isBusinessMember`, `listAccessibleWorkspaces`,
  `computeBusinessAccess` (plan/trial gating).
- **This already implements exactly the chain the brief demands:** user → company → role → action,
  all enforced server-side, never trusting client-supplied ids beyond re-checking membership.

### AI Accountant (reuse — do NOT reimplement)
- Core: `server/lib/accountantAssistant.js` (+ `accountantContext.js`, `accountantKnowledge.js`).
- Endpoint `POST /api/accountant/ask` (`:2699`) is the canonical pattern:
  `requireBusiness` → role gate (`canViewBusinessFinance`) → scope guard (`isAccountingQuestion`)
  → **usage reservation** (`aiUsageLimit.reserve`, plan allowance) → build context **from the
  company's own records** (`buildAiCfoContext`, `buildAccountantData`, `computeAccountantObligations`)
  → model call → `composeAnswer` with grounded sources + disclaimer. Every figure is recomputed
  server-side; history is text-only, never a source of facts.
- Related read endpoints already exist: `/api/accountant/summary`, `/obligations`, `/applicability`,
  `/calendar`, `/knowledge`, `/rules`, `/sources`, `/status`, `/profile`.

### Invoice / document pipeline (reuse — mostly deterministic)
- Extraction is **deterministic**, not LLM-dependent: `documentExtraction.js`
  (`detectType`, `extractInvoiceFields`, `extractReceiptFields`, `extractPaymentProofFields`,
  `findDuplicateDocument`), fed by `documentOcr.js` + `pdfText.js`.
- Orchestration: `documentIntakeOrchestrator.js` `processDocument()` (pure) →
  `resolveDirection`, `assessTax`, `ocrBlockerFor`, duplicate detection → `toStoredIntake`.
- Settlement/readiness math: `invoiceSettlement.js` (`settlementOf`, `matchPaymentToInvoice`,
  `findDuplicateProof`, **`closeoutState`** — documents present/missing → the "package readiness"
  concept the brief wants). Supporting: `taxDocMath.js`, `taxSplit.js`, `taxGate.js`,
  `documentValidation.js`, `documentDates.js`, `dueDate.js`, `counterpartyIntelligence.js`.
- Storage: Supabase Storage `DOC_BUCKET` via **`createSignedUploadUrl`** (`:13257`) for uploads and
  **`createSignedUrl`** (TTL, `:13392`) for reads. Access control: `documentAccess.js`,
  `documentPublicView.js`. This signed-URL + `document_id` model is the **portable** ingestion path.

### Reconciliation (reuse — a real engine exists)
- `incomingPaymentMatching.js`, `incomingPayments.js`, `incomingPaymentsBridge.js`,
  `invoiceSettlement.js`, `gatewaySettlementImport.js` + routes under `/api/incoming-payments/*`
  (candidates, reconciliation, review-queue) and `/api/invoices/:debtId/{settlement,allocate}`.
  **Do not build a second reconciliation path.**

### Transactions / drafts / audit
- Transactions: `/api/transactions*`, `/api/parse` (NL→draft via Anthropic), `/api/transactions/batch`.
  Debts are the current MVP "invoice" proxy (`/api/debts*`), with approve/reject/request-info and a
  draft→confirm discipline already present.
- Audit: `recordAudit(...)` (`:830`) writes to append-only `audit_events` (trigger-guarded —
  migrations 023/030/035). Every consequential action already audits actor/role/channel.

### Supporting services
- `aiUsageLimit.js` (atomic monthly reservation, migration 056), `credentialVault.js` /
  `paymentCredentials.js` (encrypted secret storage — reusable for OAuth client secrets),
  `telegramNotifications.js` + `notificationPolicy.js` + `notificationGrants.js` (owner-only
  financial alerts), `fxProvider.js`, `financialInsights.js`.

---

## B. What is missing (the actual MCP work)

1. **OAuth 2.1 authorization server** — MCP remote clients (Claude.ai, ChatGPT) authenticate via
   OAuth with PKCE + dynamic client registration + protected-resource metadata. We currently only
   mint 30-day HS256 JWTs at login. **This is the single biggest new component.**
2. **MCP transport** — a Streamable HTTP endpoint (`POST/GET /mcp`) implementing the MCP protocol
   (initialize, tool discovery, tool calls, resources, prompts). None exists.
3. **MCP tool/resource layer** — thin handlers that map business-level tools to existing services.
4. **A `channel: 'mcp'` dimension** in audit + usage accounting (so MCP calls are traceable and
   metered the same way web/telegram are).
5. **A portable document-ingestion contract** for hosts (signed upload URL + `document_id`), since
   ChatGPT/Claude file APIs differ.
6. **Distributed rate limiting** — current `rateLimited()` (`:167`) is in-memory per instance; fine
   for one Railway instance, but MCP adds an unauthenticated-ish surface that deserves firmer limits.
7. **No AI-provider abstraction** (`anthropic.messages.create` is inline at `:2095/2835/6159/7914/12092`
   with hardcoded models). **Not on the MCP critical path** (see §F insight) but worth noting.
8. **No `helmet` / security headers**; CORS is single-origin. MCP endpoint needs its own hardening.

---

## C. Proposed MCP architecture

```
AI client (Claude.ai / ChatGPT / Claude Code / future)
      │  Streamable HTTP + OAuth 2.1 bearer
      ▼
CFO Finance MCP Server         ← NEW, thin adapter (own process or mounted sub-app)
  • OAuth resource server (verifies access token → internal user id)
  • MCP protocol (initialize / tools / resources / prompts)
  • Per-tool: authz via requireBusiness + role gate, usage reserve, audit(channel='mcp')
      │  in-process function calls (NOT HTTP round-trips)
      ▼
Existing server/lib/* services  ← UNCHANGED source of truth
  businessResolver · accountantAssistant · documentIntakeOrchestrator ·
  invoiceSettlement · incomingPaymentMatching · aiUsageLimit · recordAudit
      ▼
Supabase (Postgres + Storage)   ← single source of truth
```

**Deployment:** mount the MCP server as a **separate Express sub-app in the same Node process /
same Railway service**, reusing the one `supabase` client and all `server/lib` modules by direct
`require` (no internal HTTP hop, no second deploy to keep in sync). A standalone service is possible
later but adds ops cost and a network boundary for no benefit today. Endpoint: a path on the
existing service first (e.g. `https://app.cfo-ai.site/mcp`), with `mcp.cfofinance.ai` as a future
vanity CNAME — **do not assume that domain exists yet** (infra is Railway + custom domain today).

**Key rule:** MCP handlers call `server/lib/*` **functions**, not our own HTTP routes. They must
construct the same authorization context (`{ user, business, role }`) that `requireBusiness`
produces, by calling the same resolver — so a model can never widen its own scope.

---

## D. Proposed tools (smallest useful set first)

Phase-1 tools (read-heavy, low blast radius):

| Tool | Type | Wraps | Notes |
|---|---|---|---|
| `get_company_context` | READ | `workspaceAccess.listAccessibleWorkspaces` + resolver | returns only the caller's companies + current selection; never another tenant |
| `get_financial_summary` | READ | `buildAccountantData` / `/accountant/summary` | period summary |
| `get_period_readiness` | READ | `invoiceSettlement.closeoutState` + obligations | "how ready is August?" |
| `get_missing_documents` | READ | `closeoutState` / document services | per invoice/period gaps |
| `ask_accountant` | READ | `accountantAssistant` (`/accountant/ask` path) | the canonical grounded Q&A, usage-metered |
| `analyze_invoice` | READ | `documentExtraction` + `documentIntakeOrchestrator.processDocument` + `invoiceSettlement` | structured fields + treatment + readiness; **no DB write** |

Phase-2 tools (writes, behind explicit confirmation — §G):

| Tool | Type | Wraps |
|---|---|---|
| `upload_document` | WRITE | `createSignedUploadUrl` → `document_id` (portable ingestion) |
| `create_draft_transaction` | WRITE (draft) | existing draft/transaction services |
| `get_transaction` / `update_transaction` | READ / WRITE | transaction services |
| `prepare_accounting_package` | WRITE | package/readiness services |
| reconciliation actions (`match_payment_to_invoice`, …) | WRITE | `incomingPaymentMatching` / `invoiceSettlement` |

`analyze_invoice` structured output (from existing extractors, no hardcoded tax): supplier,
invoice_number, invoice_date, due_date, currency, subtotal, tax, total, payment_status,
suggested_treatment (from CFO knowledge engine), confidence, missing_information,
duplicate_suspicion, required_supporting_documents, package_readiness.

**Expose business concepts, not tables** — no `query_transactions_sql`, no `update_invoice_row`.
Tool descriptions stay short and state side-effects + whether confirmation is required.

**Resources / prompts:** defer. Candidates once tools land: a `company://{id}/period/{month}`
readiness resource; prompts like "Prepare monthly accounting review". Only if a real host flow needs them.

---

## E. Authentication model

- Implement an **OAuth 2.1 Authorization Server** (or adopt a managed one) exposing:
  `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`,
  `/authorize`, `/token`, dynamic client registration, **PKCE required**.
- The authorize step authenticates the human via the **existing** email-OTP / Telegram login, then
  issues a short-lived **access token** (minutes) + refresh token — replacing the 30-day JWT for
  this surface. Store client secrets in `credentialVault`.
- MCP requests: `Authorization: Bearer <access_token>` → resource server verifies → resolves
  internal `userId` → from there the **existing** `resolveActiveBusiness` + role gates apply unchanged.
- **Never trust** model-supplied `company_id` / `user_id` / `document_id` / `transaction_id`: every
  object is re-authorized server-side via membership + ownership checks (exactly as today).
- Token revocation + expiry must be enforced (tested in §security).

This is the only place real new security-sensitive code lives — it needs Codex + a security pass
(the brief's §9/§16) before go-live.

## F. Document upload / invoice parsing architecture

Key insight: **the MCP server does not need to call an LLM itself.** The host (Claude/ChatGPT) is
the model. Two complementary modes:

1. **Host-extracts, CFO-validates (recommended default):** the host's strong vision model reads the
   invoice image/PDF and calls `analyze_invoice`/`create_draft_transaction` with proposed fields;
   CFO **re-validates** (`documentValidation`, duplicate check, settlement math, tax engine) and is
   the one that books anything. The model proposes, CFO disposes.
2. **CFO-extracts (portable, no host vision needed):** host uploads bytes via a signed upload URL →
   gets a `document_id` → calls `analyze_invoice(document_id)`; CFO runs its own
   OCR + deterministic extraction. Works on any MCP host regardless of file API.

Portable ingestion contract: `upload_document` returns `{ document_id, upload_url }`
(`createSignedUploadUrl`); all later tools reference `document_id`; reads go through TTL
`createSignedUrl`. No dependency on ChatGPT-specific file APIs.

**Why this helps the invoice problem (owner's question):** today Telegram invoice reading leans on
OCR + regex, which is brittle on messy real invoices. Routing through a top-tier host vision model
(mode 1) is dramatically better at reading them — while CFO keeps ownership of truth, tax treatment,
duplicates and booking. So MCP is both a *new distribution channel* (CFO inside Claude/ChatGPT) and
a *quality upgrade* for extraction — without forking the accounting engine.

## G. Write-action safety

- Tools are explicitly tagged READ vs WRITE. WRITE tools default to **draft** + require explicit
  user confirmation for consequential effects (mirrors the existing debts draft→approve discipline).
- Confirmation is enforced **server-side** (a two-step `create_draft` → `confirm` contract), never
  left to the model. Annotate tools with `readOnlyHint` / `destructiveHint` so hosts surface intent,
  but treat those as UX hints only.
- Phase 1 ships READ-only + `analyze_invoice` (no writes) to de-risk.

## G2. Security concerns (ranked)

1. **OAuth implementation correctness** (token issuance/verification/revocation, PKCE) — highest risk.
2. **Cross-tenant / IDOR** via model-supplied ids — mitigated by reusing `requireBusiness` +
   per-object ownership checks; must be explicitly tested.
3. **Prompt-injection from document contents** leading to unintended tool calls — writes gated +
   confirmed server-side; `analyze_invoice` is read-only.
4. **Rate-limit/DoS** on the MCP endpoint — needs per-token + per-IP limits (current limiter is
   in-memory/per-instance).
5. **Secret hygiene** — never expose Supabase/service creds or `ANTHROPIC_API_KEY` in MCP metadata;
   keep structured audit without logging tokens, passwords, or raw financial payloads.
6. **Observability** — correlation id, user, tenant, tool, latency, success/failure per call.

---

## H. Exact files/modules to create or modify

**Create (new, additive — no migration needed for Phase 1):**
- `server/mcp/server.js` — MCP protocol handler (Streamable HTTP), mounted by `index.js`.
- `server/mcp/auth.js` — OAuth 2.1 resource-server + `.well-known` metadata; bearer→userId.
- `server/mcp/context.js` — builds `{ user, business, role }` by calling existing resolver/role gates.
- `server/mcp/tools/*.js` — one file per tool (read tools first), each a thin wrapper.
- `server/mcp/audit.js` — `channel: 'mcp'` wrapper over `recordAudit` + `aiUsageLimit`.
- `tests/mcp/*.test.js` — protocol, security (cross-tenant/IDOR/expired/revoked), accounting cases.
- `_specs/mcp-tool-schemas.md` — frozen tool schemas (reviewable before coding handlers).

**Modify (minimal):**
- `server/index.js` — mount `app.use('/mcp', mcpServer)` and the `.well-known` routes; add `helmet`
  on the MCP paths; nothing else touched.
- `package.json` — add `@modelcontextprotocol/sdk` (+ OAuth lib if not hand-rolled).
- Possibly one additive migration later for OAuth client/token storage (Phase 2), or reuse
  `credentialVault`.

**Do NOT touch:** the accounting engine, extraction, reconciliation, migrations for Phase 1, or any
feature flags. MCP is adapters around existing services.

## I. Implementation sequence (small PR-sized steps)

0. **(this doc)** Audit + plan → owner/Codex validation. ← we are here.
1. **PR1 — skeleton (flagged OFF):** mount `/mcp` Streamable HTTP, `initialize` + tool discovery
   only, behind `MCP_SERVER_ENABLED` (default OFF). No auth-sensitive surface yet. Health check.
2. **PR2 — OAuth resource server:** `.well-known` metadata + token verification against a short-lived
   token issued through existing login. Security review gate.
3. **PR3 — read tools:** `get_company_context`, `get_financial_summary`, `get_period_readiness`,
   `get_missing_documents`. Full cross-tenant test suite.
4. **PR4 — `ask_accountant` + `analyze_invoice`:** reuse accountant engine + extractors; usage-metered;
   still read-only. This is the demo that answers the owner's invoice question end-to-end.
5. **PR5 — portable `upload_document`:** signed-URL ingestion + `document_id`.
6. **PR6 — write tools (draft + confirm):** `create_draft_transaction`, `update_transaction`,
   reconciliation actions, `prepare_accounting_package`. Confirmation enforced server-side.
7. **PR7 — hardening/observability:** distributed rate limiting, correlation ids, dashboards, docs;
   connect Claude.ai + ChatGPT in staging; then production enable.

## J. Complexity / risk per stage

| Stage | Complexity | Risk | Notes |
|---|---|---|---|
| PR1 skeleton | Low | Low | additive, flag-gated |
| PR2 OAuth | **High** | **High** | security-critical; needs Codex + security pass |
| PR3 read tools | Medium | Medium | isolation tests are the real work |
| PR4 accountant/invoice | Medium | Medium | reuse engine; metering + scope guard |
| PR5 upload | Medium | Medium | signed-URL contract portability |
| PR6 writes | **High** | **High** | consequential actions; confirm + audit |
| PR7 hardening | Medium | Medium | ops + multi-host testing |

---

## Open decisions for the owner (needed before PR2)

1. **OAuth approach:** hand-roll a minimal OAuth 2.1 AS, or adopt a managed provider
   (e.g. an existing IdP / Supabase Auth / a library)? This gates the hardest PR.
2. **Deployment shape:** confirm "same Railway service, mounted `/mcp`" (recommended) vs a
   standalone service + `mcp.cfofinance.ai` domain.
3. **Scope of first demo:** confirm Phase-1 = READ + `analyze_invoice` only (no writes) for the
   first Claude/ChatGPT connection.

No code will be written until these are answered and the plan is validated (per the brief and the
Claude-implements → Codex-reviews → owner-go/no-go model).
