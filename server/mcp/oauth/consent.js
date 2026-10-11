// CFO Finance MCP OAuth — consent API used by the web app's /oauth/consent page.
//
// The user is authenticated by the EXISTING CFO login (the same `auth` middleware and JWT the
// rest of the web app uses), so "Sign in with CFO Finance" needs no second identity system:
// the code issued here is bound to req.user.userId, i.e. the CFO user who clicked Allow.
//
// CSRF: the JWT travels in the Authorization header (from localStorage), never in a cookie, so
// a third-party page cannot make the browser approve on the user's behalf. Clickjacking is
// handled on the page itself (frame-ancestors 'none', set in mcp/index.js).

const express = require('express');
const { sha256 } = require('./store');
const { TTL, randomToken } = require('./provider');

const SCOPE_TEXT = {
  'cfo:read': 'Read your companies, financial summary, missing documents and invoice analyses.',
  'cfo:drafts': 'Create payable drafts from invoices you send. A draft waits for your approval in '
    + 'CFO AI: nothing is paid, and cash, payables and runway do not change until you approve it.',
};

function createConsentRouter({ store, auth, now = () => Date.now(), onEvent = () => {} }) {
  const router = express.Router();
  const live = (row) => row && !row.decided_at && new Date(row.expires_at).getTime() > now();

  // What the consent page shows. 410 for anything not decidable, without saying why.
  router.get('/requests/:id', auth, async (req, res) => {
    try {
      const row = await store.getRequest(String(req.params.id));
      if (!live(row)) return res.status(410).json({ error: 'request_expired_or_used' });
      const client = await store.getClient(row.client_id);
      if (!client) return res.status(410).json({ error: 'request_expired_or_used' });
      res.json({
        client_name: client.client_name || 'An AI client',
        redirect_host: new URL(row.redirect_uri).host,
        scopes: (row.scopes || []).map((s) => ({ scope: s, description: SCOPE_TEXT[s] || s })),
        expires_at: row.expires_at,
      });
    } catch (e) {
      console.error('[mcp-oauth] consent read failed:', e.message, e.cause || '');
      res.status(500).json({ error: 'consent_unavailable' });
    }
  });

  // Allow / Deny. Decided at most once (conditional update in the store).
  router.post('/requests/:id/decision', auth, async (req, res) => {
    try {
      const userId = req.user && req.user.userId;
      if (userId == null) return res.status(401).json({ error: 'unauthorized' });
      const approve = !!(req.body && req.body.approve === true);
      const row = await store.decideRequest(String(req.params.id),
        { decision: approve ? 'approved' : 'denied', userId, now: now() });
      if (!row) return res.status(410).json({ error: 'request_expired_or_used' });

      const target = new URL(row.redirect_uri);
      if (approve) {
        const code = randomToken();
        await store.insertCode({
          code_hash: sha256(code),
          client_id: row.client_id,
          user_id: userId,
          redirect_uri: row.redirect_uri,
          code_challenge: row.code_challenge,
          scopes: row.scopes,
          resource: row.resource,
          expires_at: new Date(now() + TTL.codeSeconds * 1000).toISOString(),
        });
        target.searchParams.set('code', code);
      } else {
        target.searchParams.set('error', 'access_denied');
      }
      if (row.state) target.searchParams.set('state', row.state);
      onEvent({ action: approve ? 'consent_granted' : 'consent_denied', client_id: row.client_id, user_id: userId });
      res.json({ redirect_to: target.href });
    } catch (e) {
      console.error('[mcp-oauth] consent decision failed:', e.message, e.cause || '');
      res.status(500).json({ error: 'consent_unavailable' });
    }
  });

  return router;
}

module.exports = { createConsentRouter, SCOPE_TEXT };
