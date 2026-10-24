# CFO AI V2 — Hosted Supabase Auth configuration checklist (AUTH-CFG-01)

**Branch:** `feat/v2-email-password-auth` · **Prepared:** 2026-10-17 · **Status:** checklist ready; **not applied anywhere**.
No live Supabase project, SMTP account, DNS record or Railway variable was read or changed to write this. Every item
below is a step for the owner (or someone the owner authorizes) on the **new** production project created for the
clean install. Items marked **VERIFY** depend on the hosted dashboard at configuration time and must be checked there,
not assumed from this document.

AUTH-CFG-01 stays **OPEN** until this checklist has been applied to a hosted project and the end-to-end check in §8
has passed against it. That requires an owner-authorized **separate test project** (or the new production project
before sign-up opens) and permission to send real email to a test inbox.

## 1. What the backend needs (code facts)

| Item | Value | Source |
|---|---|---|
| Server env | `PASSWORD_AUTH_ENABLED=true`, `EMAIL_AUTH_ENABLED=true`, `APP_BASE_URL=https://<app domain>`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (a **secret** key, never the publishable/anon key), `JWT_SECRET` | `server/lib/passwordAuth.js:60` refuses to start the routes without them |
| Optional | `AUTH_FORWARD_CLIENT_IP=true` — send the end user's IP to Auth in `Sb-Forwarded-For` (§5) | `server/lib/passwordAuth.js:50` |
| Must stay unset in production | `EMAIL_MAGIC_LINK_LOGIN_ENABLED` (passwordless fallback), `ADMIN_TELEGRAM_IDS` | runbook §3 |
| Client build | `VITE_PASSWORD_AUTH_ENABLED=true`, `VITE_EMAIL_AUTH_ENABLED=true`, `VITE_DESIGN_V2=true` | `client/src/App.jsx:574` |
| Email links land on | `APP_BASE_URL/auth/confirmed` (sign-up confirmation, resend) and `APP_BASE_URL/auth/reset` (password reset) | `passwordAuth.js:94,113` |
| Password rule (server) | ≥ 10 characters, ≤ 72 bytes (bcrypt), not equal to the email | `passwordAuth.js` `passwordProblem` |
| Server-side throttles (per instance, in memory) | register/resend/forgot 5 per email per hour, 20 per IP; login 10 **failed** attempts per account per 15 min, 60 per IP; reset 10/h; confirmed 30/h | `passwordAuth.js:24` |

## 2. Authentication → Providers → Email

- [ ] Email provider **enabled**.
- [ ] **Confirm email: ON.** The backend also refuses an unconfirmed account (`email_not_confirmed`), but the
      provider setting is what stops GoTrue from issuing a session at sign-up.
- [ ] **Secure email change: ON** (both addresses confirm).
- [ ] Minimum password length **10** (matches the server rule; the server check stays authoritative). **VERIFY**
      the field name in the dashboard.
- [ ] Leaked-password protection: ON if the plan offers it (**VERIFY** availability on the chosen plan).
- [ ] **Magic link / OTP as a sign-in method:** the backend no longer calls `/otp` or `/magiclink` for sign-in when
      `PASSWORD_AUTH_ENABLED=true` (those routes answer 404). Do **not** disable the email confirmation and recovery
      templates — they are the verification and reset links.

## 3. Authentication → URL Configuration

- [ ] **Site URL** = `APP_BASE_URL` exactly (scheme + host, no trailing slash).
- [ ] **Redirect URLs** allow-list: `APP_BASE_URL/auth/confirmed` and `APP_BASE_URL/auth/reset` (or
      `APP_BASE_URL/auth/**`). Nothing else — no wildcard hosts, no `localhost` in the production project.

## 4. Authentication → SMTP (custom SMTP is mandatory)

The built-in sender is limited to about **2 emails per hour per project** and is not for production use; with it,
registrations after the second in an hour get no confirmation email.

- [ ] Custom SMTP configured with a sender on the company domain (e.g. `no-reply@<domain>`).
- [ ] SPF, DKIM and DMARC records for that sender domain published and passing (**DNS change = separate owner approval**).
- [ ] Sender name set; reply-to an address someone reads.
- [ ] Email templates: confirmation and recovery templates keep `{{ .ConfirmationURL }}`; subject/body wording
      approved in EN (RU/ID templates are not supported per user language by GoTrue — the app shows localized
      instructions on the landing screens).
- [ ] After SMTP is on, raise **Rate limits → emails sent per hour** to the volume the SMTP provider allows.

## 5. Authentication → Rate Limits and the shared backend IP

All Auth calls come from the CFO AI backend, so without forwarding every user shares **one IP** (the backend's).
Hosted defaults per IP are about **30 sign-up/sign-in requests per 5 minutes** and **150 token requests per
5 minutes**; at launch a burst of registrations from many people would hit the per-IP limit for everyone.

Choose one, record the choice in the runbook:

- **A (recommended): forward the client IP.** Set `AUTH_FORWARD_CLIENT_IP=true`. The backend sends the end user's
  IP (right-most `X-Forwarded-For` hop added by the platform proxy) in `Sb-Forwarded-For`; GoTrue only honours that
  header on requests authenticated with a **secret** API key, which is what the backend uses. **VERIFY** in the
  hosted project that IP forwarding is honoured (dashboard/docs at configuration time), then run §8 step 7.
  Requires that the platform edge (Railway/Cloudflare) appends the real client address as the **right-most**
  `X-Forwarded-For` hop: the backend reads that hop directly (`passwordAuth.js:67`, no Express `trust proxy`), so
  **VERIFY** on the deployed platform which hop carries the client IP before enabling forwarding — a wrong hop would
  put every user behind the edge's own IP again (fails safe to today's behaviour, not open).
- **B: raise the per-IP limits** to the expected peak (e.g. sign-ups/sign-ins 300 per 5 min, token 600 per 5 min).
  Weaker against credential stuffing; the server's own per-account failed-login lockout still applies.

- [ ] Option chosen: ____ ; values set: ____.
- [ ] Token refresh limit sized (the backend does not refresh GoTrue sessions; it issues its own app JWT and discards
      the GoTrue session after sign-in, so token traffic is sign-in + reset only).

## 6. Sessions and security

- [ ] JWT expiry: default (1 h) is fine — the backend uses the GoTrue token only once, at sign-in/reset.
- [ ] **Refresh token rotation ON**, reuse interval default.
- [ ] CAPTCHA: leave OFF (the server calls Auth; a CAPTCHA would need a client token passed through — not built).
- [ ] Sign-ups: **allowed** (email is the free identity entry; product usage is gated by plan/trial).
- [ ] Anonymous sign-ins: OFF. Phone/SMS: OFF. Social providers: OFF (not part of this release).

## 7. Keys

- [ ] Create a **secret** API key for the backend (`SUPABASE_SECRET_KEY`); store it only in the deployment
      secret store; never in Git, the Vault, reports or chat.
- [ ] The browser never receives a secret key; the client build uses only the publishable key, if any.

## 8. End-to-end check on the hosted project (needs owner authorization: test project + test inbox)

Run against the hosted project with the candidate backend pointed at it, from outside the backend host:

1. Register `t1@<test inbox>` → one confirmation email arrives from the custom sender within 1 minute; link opens
   `APP_BASE_URL/auth/confirmed`.
2. Sign in before confirming → refused (`email_not_confirmed`); after confirming → signed in, `/api/me` works.
3. Register the same address again → the same neutral answer, **no** second account, no access change.
4. Forgot password → reset email → `/auth/reset` → new password works, old one fails, other sessions revoked.
5. Wrong password ×11 → the account is locked for 15 minutes; a different account from the same IP still works.
6. Logout → the app token is rejected afterwards.
7. With option A: 35 sign-in attempts from **two different client IPs** within 5 minutes — the second IP is not
   throttled by the first one's attempts (proves `Sb-Forwarded-For` is honoured). With option B: the configured
   limit is reached only above the chosen threshold.
8. Mail headers show SPF/DKIM pass for the sender domain.

Local evidence already gathered (disposable GoTrue v2.195.0, Mailpit, no real email): the tests in
`tests/passwordAuth.test.js` (11) and the rehearsal `tests/rehearsal/auth_e2e.cjs` cover 1–6 against a real GoTrue;
forwarding on/off is covered by the rehearsal (see `V2_BILLING_TEST_REPORT.md`). Local evidence does **not** close
AUTH-CFG-01 — the hosted settings are what production depends on.

Release candidate 2026-10-24 (branch `claude/v2-stabilization-20261024`), NON-production evidence against a real
GoTrue v2.197.0 behind the candidate backend (local isolated stack, auto-confirm, no mail server):
- `tests/integration/rcAcceptance/auth-password-http.cjs` (7): neutral registration answer and password rules,
  `email_not_confirmed` for an unconfirmed account, identical `invalid_credentials` for wrong password and unknown
  email, the existing email user keeps the same app identity, no Supabase token in any response, logout revokes the
  server session, reset answers identical for known/unknown addresses, lockout after 10 failures (429, even with the
  right password).
- `tests/integration/rcAcceptance/browser-auth-password.cjs` (4): release build screens on desktop and phone,
  register → "Confirm your email" without a session, wrong/right password, sign-out revokes the token.
- Fixed in this candidate: `/api/auth/password/forgot` and `/resend` answered 503 when Auth failed to SEND the email
  (only possible for a real account) and 200 for unknown addresses — account enumeration. They now answer the same
  and log the failure; a hosted SMTP outage therefore shows in the backend log (`[password-auth] forgot failed`),
  not to the user. Alert on that log line (runbook Section 10).
Still required before production (needs the owner): steps 1–8 above on the hosted project with a real test inbox.
