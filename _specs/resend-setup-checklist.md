# Owner Checklist — Resend Setup for CFO AI Magic Links

Non-technical, do-it-once setup. NOTHING is enabled by this checklist: no code, no
migrations, no Railway env vars, no flags. You prepare Resend + DNS + an API key, then
report back. Enabling email auth happens later via the 042 runbook.

Provider decision: Resend (see [email-provider-decision.md](email-provider-decision.md)).
Sending domain: **auth.cfo-ai.site** (a subdomain — isolates login email from any
future marketing mail).

---

## 1) Create a Resend account
- Sign up at resend.com (free tier is fine to start). Use a company email you control.
- Turn on 2FA on the Resend account.

## 2) Add the sending domain
- Resend dashboard → **Domains → Add Domain** → enter **`auth.cfo-ai.site`**.
- Resend will then show a set of DNS records to add (next step). Keep that page open.

## 3) DNS records to add (use the EXACT values Resend shows — don't copy from here)
Resend generates these for your domain; add them at your DNS provider:
- **DKIM** — usually 1–3 `CNAME` (or `TXT`) records (e.g. `resend._domainkey…`). Required.
- **SPF / sending TXT** — a `TXT` (and/or an MX for the mail subdomain) that Resend lists.
  Add it if Resend provides one for `auth.cfo-ai.site`. Required if shown.
- **DMARC (recommended, optional)** — a `TXT` at `_dmarc.auth.cfo-ai.site`, start
  gentle: `v=DMARC1; p=none; rua=mailto:dmarc@cfo-ai.site`. Tighten to `p=quarantine`
  later once mail flows cleanly.
> Always use the literal values from the Resend dashboard. Record names/types only (never
> paste secrets). TTL: default/automatic is fine.

## 4) Where to add DNS records (by provider)
Find where `cfo-ai.site` is managed and open its DNS editor:
- **Cloudflare:** Dashboard → your domain → **DNS → Records → Add record**. For DKIM
  `CNAME`s set **Proxy status = DNS only (grey cloud)**, not proxied.
- **Namecheap:** Domain List → Manage → **Advanced DNS → Add New Record**.
- **GoDaddy:** My Products → Domain → **DNS → Add**.
- **Google Domains / Squarespace:** Domain → **DNS → Custom records**.
- **Route 53 (AWS):** Hosted zone for the domain → **Create record**.
Match record **type** (CNAME/TXT) and **name/host** exactly. If the host field expects a
relative name, enter e.g. `resend._domainkey.auth` (provider-dependent) — copy what
Resend shows.

## 5) Verify the domain in Resend
- After adding the records, in Resend → **Domains → auth.cfo-ai.site → Verify**.
- DNS can take minutes to a few hours to propagate. Re-check until status = **Verified**.
- Do not send real login email until the domain is Verified.

## 6) Create a sending API key
- Resend → **API Keys → Create API Key**.
- Name it e.g. `cfo-ai-prod-magiclink`. Permission: **Sending access only** (not full
  access) if the option is available.
- Copy the key into your password manager. **Do NOT paste the key into this chat or any
  doc/commit.** It is shown once.

## 7) Prepare the Railway env vars (PREPARE ONLY — do NOT set yet)
These will be added in the 042 runbook later, not now:
```
EMAIL_PROVIDER=resend
RESEND_API_KEY=<your sending-only key>     # from step 6 — keep in your password manager
EMAIL_FROM=CFO AI <login@auth.cfo-ai.site>
APP_BASE_URL=https://app.cfo-ai.site
```

## 8) ⚠️ Production safety
- **`EMAIL_AUTH_DEV_RETURN_CODE` must NEVER be set in production.** It returns the login
  link/code in the API response and is for local development only. Leave it unset.
- Only the four vars in step 7 are needed in prod. The dev var is not one of them.

## 9) Readiness criteria (all must be true before enabling later)
- [ ] Domain `auth.cfo-ai.site` shows **Verified** in Resend.
- [ ] A **test email from the Resend dashboard** (Domains/Emails → send test) arrives in a
      real inbox (check spam too).
- [ ] Sending-only **API key created** and stored in your password manager.
- [ ] The four **env vars are ready** (written down securely) but **NOT applied** to Railway.

---

## STOP conditions (do not proceed / report back)
- Domain stuck **Not Verified** after a few hours → re-check the DNS records match exactly
  (type/name); on Cloudflare confirm DKIM CNAMEs are **DNS-only (grey cloud)**.
- The Resend test email does **not** arrive (or lands in spam consistently) → don't enable;
  may need the SPF/DMARC records or domain-reputation time.
- You can't create a **sending-only** key → a full key works but flag it so we rotate to a
  scoped key later.
- You're unsure which DNS provider hosts `cfo-ai.site` → stop and find that first
  (check the domain registrar / `whois`).

## What to report back (no secrets)
- Resend domain status for `auth.cfo-ai.site`: **Verified / Not verified**.
- Which **DNS provider** hosts the domain (Cloudflare / Namecheap / GoDaddy / Route 53 / …).
- Did the **Resend test email arrive?** yes/no (and inbox vs spam).
- API key **created?** yes/no (do NOT share the key).
- Any DNS records you could **not** add, and why.
Do NOT paste the API key or any DNS secret values into chat — names/types/status only.
