# Decision — Email Provider for Magic-Link Delivery

Status: DECISION (doc-only). No code/env/prod changes. Unblocks Step 5 of
[042_email_auth_runbook.md](042_email_auth_runbook.md) (real email delivery is the hard
prerequisite before `VITE_EMAIL_AUTH_ENABLED` in prod). Backend `issueEmailSecret`
currently only `console.log`s the link/code — a provider must be wired before launch.

## Use case
Low-volume, high-importance **transactional magic links** (primary) + 6-digit code
(fallback), sent from a Railway-hosted Express backend. Priorities: easiest Railway
integration, a free/cheap start, strong deliverability, simple API, production safety.

## Comparison (summary)
| | Resend | Postmark | SendGrid | AWS SES |
|---|---|---|---|---|
| Railway setup | easiest (1 key, plain fetch) | easy | easy | hardest (IAM, region, sandbox, SigV4) |
| Free/cheap | free start, cheap scale | no free tier, priciest | free start | cheapest at scale, no real free tier |
| Deliverability | very good | best-in-class transactional | good (varies on low tiers) | excellent IF self-managed |
| Domain verify | SPF+DKIM | DKIM+Return-Path | domain auth CNAMEs | DKIM+SPF + production-access request |
| API simplicity | simplest | simple | more ceremony | most complex (SDK + signing) |
| Prod safety | good | excellent (message streams) | OK (suspension risk low tiers) | strong once configured |

## Decision: **Resend** (primary); Postmark = deliverability-max alternative
Best fit for magic links on Railway with minimal setup + free start + simplest API (=
smallest code change when wiring `issueEmailSecret`). Switch to Postmark only if
deliverability must be maximal and paid-from-day-one is acceptable. Avoid SES for now
(most setup, self-managed reputation, sandbox). SendGrid offers no advantage here.

## Required env vars (Resend)
```
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxx              # sending-only API key
EMAIL_FROM=CFO AI <login@auth.cfo-ai.site>       # verified sender on a verified (sub)domain
EMAIL_PROVIDER=resend                                # provider selector (future-proof)
APP_BASE_URL=https://app.cfo-ai.site   # builds the absolute magic-link URL
```
- DNS on the sending domain: SPF `TXT`, DKIM (`CNAME`/`TXT`), optional DMARC — per the
  Resend dashboard. Use a **subdomain** (e.g. `auth.cfo-ai.site`) to isolate auth-mail
  reputation from any future marketing mail.
- `EMAIL_AUTH_DEV_RETURN_CODE` must remain **unset** in production (dev-only).

## Future implementation note (NOT now)
When approved, wire `issueEmailSecret` to send via `EMAIL_PROVIDER`:
- Resend: `POST https://api.resend.com/emails` with `Authorization: Bearer $RESEND_API_KEY`,
  body `{ from: EMAIL_FROM, to, subject, html }`; magic link =
  `${APP_BASE_URL}/login/email/callback?token=…` → resolves to
  `https://app.cfo-ai.site/login/email/callback?token=…`.
- Keep send failures non-fatal to the start endpoint's anti-enumeration contract (still
  return `{ ok:true }`); log/alert on provider errors. Verify in staging/local first.

## Verify before committing
Free-tier sizes and prices change — confirm current Resend (and Postmark/SES) pricing
pages at decision time. The relative ranking above is stable.
