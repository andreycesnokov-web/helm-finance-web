# Helm Finance — Security Fix Plan

Date: 2026-06-09
Status: PLANNING — no code changes made yet
Scope: Web server, Telegram Bot, Supabase, deployment

---

## Risk Classification

| Level | Meaning |
|-------|---------|
| CRITICAL | Exploitable now, data loss or full breach possible |
| HIGH | Significant exposure, must fix before public launch |
| MEDIUM | Real risk, fix before scaling to >10 users |
| LOW | Good practice, fix when convenient |

---

## Issue 1 — Service Role Key Used Everywhere

**Level:** CRITICAL
**Affects:** Both systems

### The Problem

Both the Telegram Bot and the Express web server connect to Supabase using
the **service role key** (`SUPABASE_SECRET_KEY`). The service role key bypasses
all Row Level Security (RLS) policies and grants unrestricted read, write,
update, and delete access to every row in every table.

**Current code (both systems):**
```javascript
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY   // ← service role key, no RLS
)
```

**What this means:**
- If the web server process is compromised, the attacker has full access to
  every user's financial data — not just the authenticated user.
- If the Supabase URL + service key are discovered in logs, environment dumps,
  or Railway dashboard, all data is exposed.
- There are no database-level guardrails. A bug in the server code (e.g., a
  missing `.eq('user_id', req.user.userId)` filter) silently leaks all users'
  data rather than failing safely.

### Required Fix (before production)

**Step 1:** Enable Row Level Security on all tables in Supabase:
```sql
ALTER TABLE users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE debts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders    ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll      ENABLE ROW LEVEL SECURITY;
```

**Step 2:** Create RLS policies scoped to `user_id`:
```sql
-- Example for transactions (repeat pattern for all tables)
CREATE POLICY "users can see own transactions"
  ON transactions FOR SELECT
  USING (user_id = auth.uid()::bigint);

CREATE POLICY "users can insert own transactions"
  ON transactions FOR INSERT
  WITH CHECK (user_id = auth.uid()::bigint);
```

**Step 3:** Switch the web server to the **anon key** (not service role):
```javascript
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY     // ← anon key, RLS enforced
)
```

**Step 4:** Pass the user context to Supabase via JWT or set the auth header
per-request so RLS policies can evaluate `auth.uid()`:
```javascript
// Per-request Supabase client with user context
function getSupabaseForUser(userJwt) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${userJwt}` }
    }
  })
}
```

**Step 5:** Keep the service role key ONLY for:
- Database migrations
- Admin scripts
- The Telegram Bot (until bot gets its own auth model)

### Interim Mitigation (if full fix is not immediate)

Until RLS is implemented, verify that every single Supabase query in
`server/index.js` includes `.eq('user_id', req.user.userId)`. Current audit:

| Route | Has user_id filter | Safe |
|-------|--------------------|------|
| GET /api/pulse | ✅ line 77 | ✅ |
| GET /api/transactions | ✅ line 209 | ✅ |
| POST /api/transactions/batch | ✅ row mapping line 266 | ✅ |
| GET /api/debts | ✅ line 177 | ✅ |
| POST /api/debts | ✅ line 185 | ✅ |
| PATCH /api/debts/:id/settle | ✅ line 192 | ✅ |
| POST /api/debts/:id/pay | ✅ line 366 | ✅ |
| POST /api/reminders | ✅ line 224 | ✅ |
| PATCH /api/reminders/:id/done | ✅ line 229 | ✅ |
| GET /api/profile | ✅ line 350 | ✅ |
| POST /api/profile | ✅ line 357 | ✅ |
| POST /api/accounts/* | ✅ all four routes | ✅ |

Current state: all routes do include user_id filters. The risk is latent
(a future route omitting the filter would silently expose all data) rather
than an active exploit today. This makes RLS a defense-in-depth requirement,
not an emergency.

---

## Issue 2 — JWT Secret Has Hardcoded Insecure Default

**Level:** HIGH
**Affects:** Web server

### The Problem

```javascript
// server/index.js line 14
const JWT_SECRET = process.env.JWT_SECRET || 'helm-finance-secret'
```

If `JWT_SECRET` is not set in the environment, every JWT is signed with the
public string `'helm-finance-secret'`. This string is in the git repository.
Anyone who reads the source code can:

1. Craft a valid JWT for any `userId` they choose.
2. Make authenticated requests as any user on the system.
3. Read, write, or delete any data belonging to any user.

**Impact:** Full account takeover for any user whose Telegram ID is known or
guessable (Telegram IDs are sequential integers, publicly visible in groups).

### Required Fix (before any users are added)

**Remove the default value entirely.** Fail fast at startup if the secret
is missing:

```javascript
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required')
  process.exit(1)
}
```

Generate a secure secret (at least 32 random bytes):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set this value in Railway environment variables. Never commit it to git.

### Current Risk Assessment

If the server is currently running without `JWT_SECRET` set, the system is
actively exploitable by anyone who can read the source code.

Check: `railway variables list` or inspect the Railway dashboard to confirm
`JWT_SECRET` is set.

---

## Issue 3 — JWT Tokens Cannot Be Revoked

**Level:** HIGH
**Affects:** Web server authentication

### The Problem

JWTs are issued with a 30-day expiry. Once issued, there is no way to invalidate
a token before it expires. If:
- A user's Telegram account is compromised
- The user wants to log out of all devices
- The bot token is rotated (invalidating Telegram's auth chain)
- A JWT is stolen from localStorage via XSS

...the attacker retains valid access for up to 30 days.

### Required Fix (before production with multiple users)

**Option A (Recommended for MVP):** Reduce JWT expiry to 7 days and implement
a token refresh endpoint. Shorter-lived tokens reduce the attack window.

**Option B (Full solution):** Maintain a `jwt_invalidation` table or Redis set
of revoked token JTIs. Check on every auth middleware call.

**Option C (Simplest):** Store a `session_version` integer in the users table.
Embed it in the JWT. If the JWT's version != the DB version, reject the token.
Logout or password reset increments the version, invalidating all old tokens.

### Interim Mitigation

Change JWT expiry from `'30d'` to `'7d'`:
```javascript
jwt.sign({ userId, firstName }, JWT_SECRET, { expiresIn: '7d' })
```

---

## Issue 4 — Telegram Login Widget auth_date Window Is 24 Hours

**Level:** MEDIUM
**Affects:** Web server `/api/auth/telegram`

### The Problem

```javascript
if (Date.now() / 1000 - parseInt(rest.auth_date) > 86400) return false;
```

The Telegram Login Widget produces a signed auth payload with an `auth_date`
timestamp. The server accepts this payload for 24 hours after it was created.

If a user's Telegram data is intercepted (e.g. via a phishing page that
replays the auth flow), the attacker has a 24-hour window to use it.

### Required Fix

Reduce the auth_date window to 5 minutes (300 seconds) for new logins:
```javascript
if (Date.now() / 1000 - parseInt(rest.auth_date) > 300) return false;
```

The widget always generates fresh auth_date on each click, so legitimate
users are unaffected. Only replayed/stolen credentials are blocked.

---

## Issue 5 — No Input Validation on Parse Endpoint

**Level:** MEDIUM
**Affects:** `POST /api/parse`

### The Problem

```javascript
app.post('/api/parse', auth, async (req, res) => {
  const { text } = req.body
  // text is passed directly to Anthropic with no length limit
  const response = await anthropic.messages.create({
    ...
    content: `... Текст: "${text}"`
  })
```

No server-side validation of `text`:
- No maximum length check (Express body limit is 10mb — enough for a 10MB
  string that would generate a massive Anthropic API bill in one request).
- No minimum length check.
- Template literal injection: a user could input text containing `"` to break
  the prompt structure (though since they only see their own results, practical
  impact is self-harm only at this stage).

### Required Fix

```javascript
app.post('/api/parse', auth, async (req, res) => {
  const { text } = req.body
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' })
  }
  if (text.length > 2000) {
    return res.status(400).json({ error: 'text too long (max 2000 characters)' })
  }
  // continue...
```

Also add per-user rate limiting:
- Max 20 parse requests per hour per user
- Use in-memory counter (acceptable for single instance) or Redis for HA

---

## Issue 6 — Photo Stored as Base64 in Database

**Level:** MEDIUM
**Affects:** `POST /api/profile`, users table `photo_url` column

### The Problem

```javascript
// Settings.jsx
canvas.toDataURL('image/jpeg', 0.8)  // → 15–20KB base64 string
// stored in users.photo_url
```

Profile photos are stored as full base64 JPEG strings in the database.

Problems:
- Every SELECT from `users` transfers 15–20KB of binary data even when only
  `first_name` or `id` is needed.
- At scale, this bloats the users table and slows all user lookups.
- Supabase Storage exists specifically for this use case.

### Required Fix (before scaling)

Upload photos to Supabase Storage and store only the public URL:
```javascript
// server: upload to storage, store URL
const { data } = await supabase.storage
  .from('avatars')
  .upload(`${userId}.jpg`, fileBuffer, { contentType: 'image/jpeg', upsert: true })
const url = supabase.storage.from('avatars').getPublicUrl(`${userId}.jpg`).data.publicUrl
await supabase.from('users').update({ photo_url: url }).eq('id', userId)
```

---

## Issue 7 — CORS Allows Only One Origin

**Level:** LOW (now) / MEDIUM (at scale)
**Affects:** Express server

### The Problem

```javascript
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }))
```

A single origin. Railway preview deployments, staging environments, or
a separate admin dashboard would all be blocked by CORS.

### Required Fix

```javascript
const ALLOWED_ORIGINS = [
  process.env.CLIENT_URL,
  process.env.CLIENT_URL_STAGING,
  'http://localhost:5173',
  'http://localhost:5174',
].filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) callback(null, true)
    else callback(new Error('Not allowed by CORS'))
  }
}))
```

---

## Issue 8 — JWT Stored in localStorage (XSS Risk)

**Level:** LOW
**Affects:** React client

### The Problem

```javascript
localStorage.setItem('hf_token', data.token)
```

`localStorage` is accessible to any JavaScript running on the page. A successful
XSS attack could steal the token and authenticate as the user.

### Why This Is Acceptable for Now

- The app has no user-generated HTML rendered as markup.
- No third-party scripts are loaded except `telegram-widget.js` from `telegram.org`.
- PWA-first apps commonly use localStorage for tokens because HttpOnly cookies
  require same-site deployment, which adds complexity.
- The attack surface for XSS in this codebase is currently low.

### Future Fix

When the product scales: move the JWT to an `HttpOnly`, `SameSite=Strict`,
`Secure` cookie. The web server would need to set the cookie on login and
read it from `req.cookies` in the auth middleware instead of
`req.headers.authorization`.

---

## Required Environment Variables — Complete Reference

### Web Server

| Variable | Required | Secure default? | Notes |
|----------|----------|-----------------|-------|
| `SUPABASE_URL` | ✅ | N/A | Project URL from Supabase dashboard |
| `SUPABASE_SECRET_KEY` | ✅ | N/A | Service role key — treat as root password |
| `BOT_TOKEN` | ✅ | N/A | Telegram BotFather token |
| `JWT_SECRET` | ✅ | ❌ has insecure default | Must be set; generate with crypto.randomBytes(32) |
| `PORT` | optional | ✅ (3001) | |
| `CLIENT_URL` | optional | ✅ (localhost) | CORS origin; set to Railway domain in production |

### Telegram Bot

| Variable | Required | Secure default? | Notes |
|----------|----------|-----------------|-------|
| `SUPABASE_URL` | ✅ | N/A | Same as web server |
| `SUPABASE_SECRET_KEY` | ✅ | N/A | Same key as web server |
| `BOT_TOKEN` | ✅ | N/A | Same bot token as web server |
| `ANTHROPIC_API_KEY` | ✅ | N/A | Used for AI parsing |

### Web Client (Vite build-time)

| Variable | Required | Notes |
|----------|----------|-------|
| `VITE_BOT_USERNAME` | ✅ | Bot username for Login Widget (without @). e.g. `HCfinance_Bot` |

---

## Fix Priority Queue

### Must fix before any real users

| # | Issue | File(s) | Effort |
|---|-------|---------|--------|
| 1 | Set JWT_SECRET in Railway, remove default | `server/index.js` | 10 min |
| 2 | Add startup crash if JWT_SECRET missing | `server/index.js` | 5 min |
| 3 | Add startup crash if BOT_TOKEN missing | `server/index.js` | 5 min |
| 4 | Add startup crash if SUPABASE vars missing | `server/index.js` | 5 min |
| 5 | Reduce auth_date window to 5 min | `server/index.js` | 5 min |
| 6 | Add text length validation on /api/parse | `server/index.js` | 10 min |

### Must fix before scaling past 10 users

| # | Issue | Effort |
|---|-------|--------|
| 7 | Enable RLS on all Supabase tables | 1 hour |
| 8 | Switch web server to anon key + per-request user context | 2 hours |
| 9 | Reduce JWT expiry to 7d | 5 min |
| 10 | Add rate limiting on /api/parse | 30 min |

### Fix before Series A / enterprise

| # | Issue | Effort |
|---|-------|--------|
| 11 | Move photos to Supabase Storage | 2 hours |
| 12 | Implement JWT revocation (session_version) | 3 hours |
| 13 | Switch localStorage → HttpOnly cookies | 4 hours |
| 14 | CORS allow-list | 15 min |

---

## What NOT to Fix Right Now

These are real issues but changing them now would be premature:

- **Service role key in Telegram Bot:** The bot has no user auth context to
  pass to Supabase. Moving to RLS for the bot requires designing a bot auth
  model (service account per bot, or Telegram ID → Supabase JWT bridge).
  This is a Phase 2 architecture decision.

- **localStorage → cookies:** Requires server-side session changes, CSRF token
  handling, and cookie domain configuration. High complexity, low current risk.

- **Anthropic API rate limiting:** No billing impact until there are real users
  making real requests. Add when approaching 10 active users.
