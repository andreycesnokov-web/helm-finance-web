# MCP OAuth — "Sign in with CFO Finance" for AI clients

Status: implemented on `claude/mcp-oauth`. Off by default (`MCP_OAUTH_ENABLED`). Needs migration
`057_mcp_oauth.sql` applied before it is switched on.

## What it gives the user
Claude → Settings → **Connectors** → **Add custom connector** → URL `https://app.cfo-ai.site/mcp`
→ Connect → the **CFO Finance** page opens → sign in with the normal CFO login (email code) →
"Claude wants to access your CFO Finance account — read only" → **Allow** → connected. Because
claude.ai connectors sync, this then works in Claude on the desktop, the web and the phone.
ChatGPT connectors and Claude Code (`claude mcp add --transport http cfo-finance <url>`, no header)
use the same flow.

## Decision (owner, 2026-10-01): sign in through CFO, not Supabase Auth
Supabase Auth has 0 users in production (the app never used it), so using it as the authorization
server would mean a second account for every CFO user plus account linking. Instead the official
MCP SDK's authorization server (`@modelcontextprotocol/sdk/server/auth`) implements the protocol and
the **existing CFO login** is the sign-in + consent step. The OAuth identity *is* the CFO user
(`public.users.id`) — no identity gap, no linking, no auth migration, existing login unchanged.

## How it works
| Step | Who | Code |
|---|---|---|
| Discovery | SDK | `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`; `/mcp` 401 carries `WWW-Authenticate: Bearer resource_metadata=…` |
| Client registration (RFC 7591) | SDK + `provider.registerClient` | redirect-URI allowlist; client forced **public** (no secret issued or stored) |
| Authorize | SDK validates client, redirect, PKCE S256 → `provider.authorize` | request parked 10 min → redirect to `/oauth/consent?request=…` |
| Sign in + consent | web app `OAuthConsent.jsx` → `POST /api/mcp-oauth/requests/:id/decision` (CFO JWT) | one-time code (5 min) bound to the approving user |
| Token | SDK verifies PKCE → `provider.exchangeAuthorizationCode` | code consumed once; redirect_uri must match; access 1 h + refresh 30 d |
| Refresh | `provider.exchangeRefreshToken` | rotated every use; replay of an old one revokes the whole grant |
| Call `/mcp` | `auth.js resolveMcpUser` → `provider.verifyAccessToken` | needs `cfo:read` and a token issued for this resource |
| Revoke | SDK `/revoke` → `provider.revokeToken` | revokes the whole grant |

Files: `server/mcp/oauth/{index,provider,store,consent}.js`, `server/mcp/{index,auth}.js`,
`client/src/pages/OAuthConsent.jsx`, `migrations/057_mcp_oauth.sql`.

## Security properties
- Redirect URIs allowed at registration: `https://claude.ai`, `https://claude.com`, `https://chatgpt.com`,
  `https://chat.openai.com`, and loopback (`localhost`, `127.0.0.1`, `[::1]`, any port) for native clients.
- No client secrets; PKCE S256 mandatory (SDK).
- Codes and tokens stored as SHA-256 hashes only; codes single-use; conditional UPDATEs make every
  "at most once" transition race-safe.
- Consent requires the CFO login (JWT in the Authorization header → not CSRF-able); the consent page
  is served with `X-Frame-Options: DENY` and `frame-ancestors 'none'`.
- Tokens are bound to `https://…/mcp` (RFC 8707); scope is `cfo:read` only — every tool is read-only.
- Deleting a CFO user cascades their codes and tokens.
- Rate limits (SDK) keyed on the proxy-appended client IP (right-most `X-Forwarded-For`), IPv6 per /64.
- Audit: `audit_events` rows with `channel='mcp'`, `entity_type='mcp_oauth'` for client registration,
  consent granted/denied, tokens issued, refresh reuse detected, grant revoked. No secrets in audit.

## Configuration (Railway)
| Variable | Value |
|---|---|
| `MCP_SERVER_ENABLED` | `true` (already set) |
| `MCP_OAUTH_ENABLED` | `true` — only after migration 057 is applied |
| `MCP_PUBLIC_BASE_URL` | `https://app.cfo-ai.site` (falls back to `APP_BASE_URL`; must be https) |
`MCP_DEV_TOKEN` / `MCP_DEV_USER_ID` keep working for header-based clients and can be removed later.

## Rollout
1. Merge + deploy (flag OFF → nothing changes).
2. Apply `057_mcp_oauth.sql` in production.
3. Set `MCP_OAUTH_ENABLED=true` and `MCP_PUBLIC_BASE_URL`, redeploy.
4. Claude → Connectors → Add custom connector → `https://app.cfo-ai.site/mcp`.
Rollback: unset `MCP_OAUTH_ENABLED` (endpoints disappear; issued tokens stop being accepted).

## Not in this PR
A "connected apps" page in CFO settings to list and revoke grants (today: `/revoke` when a client
calls it, natural expiry — access 1 h, refresh 30 d — and the `MCP_OAUTH_ENABLED` kill switch);
cleanup job for expired rows; per-user tool-call metering.

## Open risk to verify on first real connection
Registration always answers as a **public** client (`token_endpoint_auth_method: none`, no secret),
which the MCP spec recommends and the SDK allows. If a client insists on a confidential
registration, the fallback is to issue a secret and store it encrypted (the SDK compares secrets in
clear, so it cannot be hashed). Verify with Claude Connectors on the first rollout.
