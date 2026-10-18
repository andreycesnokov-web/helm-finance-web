'use strict';
/**
 * CFO AI V2 — Production Release Verification: MCP AI Assistants Connection Management
 *
 * Safe, non-destructive verification against live production:
 * - App URL: https://app.cfo-ai.site
 * - Protected Resources: /mcp, /api/account/integrations/ai-assistants
 * - OAuth Discovery: /.well-known/oauth-authorization-server, /.well-known/oauth-protected-resource/mcp
 * - Database State: Supabase (ihvciomcvadjdtskcekb)
 */

const assert = require('assert');
const { chromium } = require('playwright-core');

const APP_URL = 'https://app.cfo-ai.site';

async function run() {
  console.log('========================================================================');
  console.log('   CFO AI — MCP Connections Management Live Production Verification     ');
  console.log('========================================================================\n');

  let passed = 0;
  let total = 0;
  const check = async (desc, fn) => {
    total++;
    try {
      await fn();
      console.log(`  ✓ [PASS] ${desc}`);
      passed++;
    } catch (e) {
      console.error(`  ✗ [FAIL] ${desc}:`, e.message);
      throw e;
    }
  };

  // 1. Health Endpoint
  await check('1. GET /api/health responds with 200 OK and service=helm-finance-web', async () => {
    const res = await fetch(`${APP_URL}/api/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.service, 'helm-finance-web');
  });

  // 2. Authorization Guards on AI Assistants endpoints
  await check('2. GET /api/account/integrations/ai-assistants requires authentication (401)', async () => {
    const res = await fetch(`${APP_URL}/api/account/integrations/ai-assistants`);
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.error, 'No token');
  });

  await check('3. POST /api/account/integrations/ai-assistants/:id/revoke requires authentication (401)', async () => {
    const res = await fetch(`${APP_URL}/api/account/integrations/ai-assistants/any-grant-id/revoke`, {
      method: 'POST',
    });
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.error, 'No token');
  });

  // 3. MCP OAuth Discovery Metadata
  await check('4. OAuth 2.1 Authorization Server metadata is live', async () => {
    const res = await fetch(`${APP_URL}/.well-known/oauth-authorization-server`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.authorization_endpoint, `${APP_URL}/authorize`);
    assert.strictEqual(data.token_endpoint, `${APP_URL}/token`);
    assert.strictEqual(data.registration_endpoint, `${APP_URL}/register`);
    assert.deepStrictEqual(data.code_challenge_methods_supported, ['S256']);
  });

  await check('5. OAuth Protected Resource metadata for /mcp is live', async () => {
    const res = await fetch(`${APP_URL}/.well-known/oauth-protected-resource/mcp`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.resource, `${APP_URL}/mcp`);
    assert.deepStrictEqual(data.scopes_supported, ['cfo:read', 'cfo:drafts']);
  });

  // 4. Streamable HTTP /mcp Protocol Guard
  await check('6. POST /mcp unauthenticated returns 401 with resource metadata header', async () => {
    const res = await fetch(`${APP_URL}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      }),
    });
    assert.strictEqual(res.status, 401);
    const authHeader = res.headers.get('www-authenticate') || '';
    assert.ok(authHeader.includes('resource_metadata="https://app.cfo-ai.site/.well-known/oauth-protected-resource/mcp"'));
  });

  // 5. Client Frontend JS Bundle Inspection
  await check('7. Live client bundle includes AI Assistants Connection Management', async () => {
    const htmlRes = await fetch(`${APP_URL}/`);
    assert.strictEqual(htmlRes.status, 200);
    const html = await htmlRes.text();

    const scriptMatch = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
    assert.ok(scriptMatch, 'index.html must reference entry script');

    const indexRes = await fetch(`${APP_URL}${scriptMatch[1]}`);
    const indexText = await indexRes.text();

    const chunkMatch = indexText.match(/assets\/BusinessApp-[a-zA-Z0-9_\-\.]+\.js/);
    assert.ok(chunkMatch, 'Must reference BusinessApp chunk');

    const bizRes = await fetch(`${APP_URL}/${chunkMatch[0]}`);
    const bizText = await bizRes.text();
    assert.ok(bizText.includes('/account/integrations/ai-assistants'), 'BusinessApp chunk must query ai-assistants endpoint');

    const actionsMatch = indexText.match(/assets\/actions-[a-zA-Z0-9_\-\.]+\.js/);
    assert.ok(actionsMatch, 'Must reference actions chunk');

    const actRes = await fetch(`${APP_URL}/${actionsMatch[0]}`);
    const actText = await actRes.text();
    assert.ok(actText.includes('ChatGPT'), 'Actions/i18n chunk must include ChatGPT client support');
    assert.ok(actText.includes('Claude'), 'Actions/i18n chunk must include Claude client support');
  });

  // 6. Headless Browser Smoke Check
  await check('8. Browser loads production shell without client-side uncaught exceptions', async () => {
    const executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle' });
    const title = await page.title();
    assert.ok(title.includes('CFO AI'), 'Page title matches CFO AI');

    await browser.close();
    assert.strictEqual(errors.length, 0, `Browser encountered errors: ${errors.join(', ')}`);
  });

  console.log('\n========================================================================');
  console.log(`RESULTS: ${passed} / ${total} PRODUCTION RELEASE VERIFICATIONS PASSED (100% SUCCESS)`);
  console.log('========================================================================\n');
}

run().catch((e) => {
  console.error('\nProduction Verification Failed:', e);
  process.exit(1);
});
