// PATCH /api/debts/:id — clearing a text field stores NULL, never the literal text "null".
// Before the fix `String(req.body.description)` turned a null (the edit form sends null for an
// empty description) into "null", which then showed on the bill page as "Rp 12,000,000 · null".
// Run: node tests/integration/debtPatchNullText.test.js
const path = require('path');
const Module = require('module');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const mem = require('./_memorySupabase');

const ROOT = path.join(__dirname, '..', '..');
Object.assign(process.env, {
  SUPABASE_URL: 'http://localhost:0/fake', SUPABASE_SECRET_KEY: 'fake', BOT_TOKEN: 'fake',
  JWT_SECRET: 'debt-patch-test-secret', TELEGRAM_WEBHOOK_SECRET: 'fake', PORT: '5641', NODE_ENV: 'test', FX_PROVIDER: 'mock',
});
const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') return mem;
  return origLoad.apply(this, arguments);
};

const BIZ = '7e1b8f0c-1111-4a2b-9c3d-000000000641';
const OWNER = 96410;
mem.__seed('businesses', [{ id: BIZ, name: 'Patch Co', type: 'business', owner_user_id: OWNER, base_currency: 'IDR', created_at: '2026-01-01' }]);
mem.__seed('business_members', [{ id: 641, user_id: OWNER, business_id: BIZ, role: 'owner', status: 'active' }]);
mem.__seed('debts', [{ id: 6401, business_id: BIZ, user_id: OWNER, type: 'payable', counterparty: 'PT Vendor', description: 'Logistics', amount: 12000000,
  original_amount: 12000000, paid_amount: 0, currency: 'IDR', status: 'open', approval_status: 'approved', created_at: '2026-10-05' }]);

require(path.join(ROOT, 'server', 'index.js'));
const BASE = `http://127.0.0.1:${process.env.PORT}/api`;
const tok = jwt.sign({ userId: OWNER }, process.env.JWT_SECRET);
const patch = (body) => fetch(`${BASE}/debts/6401`, {
  method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}`, 'x-business-id': BIZ }, body: JSON.stringify(body),
});
const row = () => mem.__db.debts.find((d) => d.id === 6401);

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('OK  ' + name); pass++ } catch (e) { console.error('FAIL ' + name + ' — ' + e.message); fail++ } }

(async () => {
  await new Promise((r) => setTimeout(r, 300));
  await t('description: null clears the field (stored NULL, not "null")', async () => {
    const r = await patch({ description: null });
    assert.equal(r.status, 200, await r.text());
    assert.equal(row().description, null);
  });
  await t('description: "" and spaces clear the field', async () => {
    await patch({ description: 'temp' });
    assert.equal(row().description, 'temp');
    await patch({ description: '   ' });
    assert.equal(row().description, null);
  });
  await t('description text is trimmed and kept', async () => {
    await patch({ description: '  Legal services, September  ' });
    assert.equal(row().description, 'Legal services, September');
  });
  await t('counterparty: null is stored as NULL, not "null"', async () => {
    await patch({ counterparty: null });
    assert.equal(row().counterparty, null);
  });
  await t('a field that is not sent is not touched', async () => {
    await patch({ counterparty: 'PT Vendor' });
    await patch({ due_date: '2026-10-19' });
    assert.equal(row().counterparty, 'PT Vendor');
  });
  console.log(`\nDEBT PATCH NULL TEXT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
