# MCP Identity Mapping Findings (required before PR2 OAuth)

Date: 2026-10-01. Status: **read-only investigation — no code/data changed.**
Question from the owner: does `current CFO user → Supabase auth.users → company membership → MCP OAuth identity` hold today?

## Verdict

**NO. Existing CFO users do NOT map to Supabase `auth.users`. There is a complete identity gap.**
CFO Finance runs its own identity system and does not use Supabase Auth (GoTrue) at all.

## Evidence (from code — authoritative, independent of the MCP/DB connection)

1. **The server never calls Supabase Auth.** A full scan of `server/` for `supabase.auth.*`,
   `auth.admin`, `createUser`, `signInWith`, `signUp`, `auth.getUser`, `admin.listUsers`, `GoTrue`
   returns **nothing**.
2. **Users are minted directly into `public.users`.** New accounts come from the `next_app_user_id()`
   RPC (negative ids for email-origin) or the Telegram id (positive) and a plain
   `supabase.from('users').insert(...)` (`server/index.js:193,200`). Nothing writes to `auth.users`.
3. **Email login is OTP in `public.user_email_identities`** (migration 042), not Supabase Auth —
   no password, no GoTrue user. The migration never references the `auth` schema.
4. **The Supabase client is service-role** (`createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)`,
   `server/index.js:98`), which bypasses Auth and RLS entirely. Authorization is done in app code.
5. **Auth tokens are custom JWTs** (`jsonwebtoken`, HS256, `{userId}`, 30-day) minted at login
   (`:132` Telegram, `:259` email). The frontend stores this in `localStorage('hf_token')` and sends
   it as `Authorization: Bearer` (`client/src/hooks/useAuth.jsx`). No supabase-js auth on the client.
6. **No migration touches the `auth` schema.** The only `[auth]` block is the default template in
   `supabase/config.toml` from `supabase init`; it is not used by the running app.

Confirmation the owner can run in the prod SQL editor (optional, since code is conclusive):
`SELECT count(*) FROM auth.users;` — expected ~0, and in any case unrelated to `public.users`.

## What this means for the architecture

The real identity chain today is:

```
custom JWT { userId }  →  public.users.id  →  business_members (user_id, business_id, role, status)  →  role gates
```

Supabase `auth.users` is simply **not in the picture**. So the chain the brief wants
(`CFO user → Supabase auth identity → OAuth identity → company → role`) requires a **new, explicit
link** between `public.users.id` and a future `auth.users.id`. We must not fabricate that link by
email.

## Recommended path (matches the owner's "do NOT auto-migrate" branch)

**Phase 1 (now): dev-only auth, no Supabase Auth dependency.**
- The `/mcp` endpoint accepts a **dev bearer token** (`MCP_DEV_TOKEN`) or the existing custom JWT,
  resolves `userId`, then reuses `resolveActiveBusiness` + role gates unchanged. This proves
  transport + tenant isolation without touching production auth. Flag `MCP_SERVER_ENABLED` default OFF.

**Phase 2 (PR2, after this is approved): explicit, user-controlled linking.**
- Stand up Supabase Auth as the OAuth 2.1 AS for MCP (Authorization Code + PKCE, discovery, refresh,
  consent, scopes).
- Add an **account-link table** (e.g. `user_auth_identities`: `app_user_id BIGINT → public.users.id`,
  `auth_user_id UUID → auth.users.id`, `linked_at`, `linked_by`, unique on each side) created only
  when a signed-in CFO user **explicitly** connects their OAuth identity from inside the existing web
  app (which already knows `req.user.userId`). The link is **user-initiated and audited**
  (`recordAudit`), never inferred from a matching email.
- MCP OAuth flow then resolves: `access_token → auth.users.id → user_auth_identities → public.users.id
  → business_members → role`. An OAuth identity with **no** link row gets **no** CFO access (it can
  only offer to start the linking flow).
- Keep the existing custom-JWT login fully working. No migration of the main auth system.

**Impact statement (per the owner's instruction "document the impact before any auth migration"):**
- No change to existing login, tokens, or `public.users` in Phase 1 or Phase 2.
- Phase 2 adds ONE additive table + an OAuth AS; it does not move existing users into `auth.users`.
- Linking is opt-in per user; unlinked users are unaffected.
- Risk is isolated to the new MCP surface, gated by `MCP_SERVER_ENABLED`.

Open decision for PR2 (not needed for PR1): confirm the account-link table shape above, and whether
the consent/link UI lives in the existing web app (recommended) vs a standalone page.
