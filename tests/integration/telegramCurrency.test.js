// Telegram payables are IDR-only, and both Telegram doors enforce it.
//
// P0 found in live smoke: "Pay 1000$ to China supplier" created debts(amount=1000,
// currency='USD'). The row itself was right — but no consumer reads debts.currency, so the
// Payables UI showed "Rp 1 000" and POST /api/debts/:id/pay would have written
// currency_original:'IDR', amount_idr:1000. A US$1,000 obligation settled by moving Rp 1,000.
//
// Until multi-currency payables exist end to end (FX conversion at the payment and
// aggregation boundaries — no live rate source today), the only safe answer is to refuse the
// record rather than store one nothing can read correctly.
//
//   Run: node --test tests/integration/telegramCurrency.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../../server/lib/telegramCurrency');

// ── normalisation ───────────────────────────────────────────────────────────
test('an absent currency still means IDR, exactly as before', () => {
  // This default predates the bug and must not change: the bot has always omitted currency
  // for plain "оплатить поставщику 5 млн" messages.
  for (const v of [undefined, null, '', '   ']) assert.strictEqual(C.normalizeCurrency(v), 'IDR', JSON.stringify(v));
});

test('casing and padding do not create a second spelling', () => {
  for (const v of ['idr', 'IDR', ' Idr ', 'iDr']) assert.strictEqual(C.normalizeCurrency(v), 'IDR', v);
  assert.strictEqual(C.normalizeCurrency('usd'), 'USD');
  assert.strictEqual(C.normalizeCurrency(' eur '), 'EUR');
});

// ── the gate ────────────────────────────────────────────────────────────────
test('IDR is accepted in every spelling', () => {
  for (const v of ['IDR', 'idr', ' Idr ', undefined, null, '']) assert.ok(C.isSupportedTelegramCurrency(v), JSON.stringify(v));
});

test('every other currency is refused', () => {
  for (const v of ['USD', 'usd', 'EUR', 'SGD', 'MYR', 'AUD', 'JPY', 'CNY', 'GBP', 'Rp', 'BTC', '$'])
    assert.ok(!C.isSupportedTelegramCurrency(v), `${v} must not be accepted`);
});

test('junk is refused rather than coerced to IDR', () => {
  // A non-string must never fall through to the IDR default and become a wrong row.
  for (const v of [0, 1, {}, [], true, 'IDR IDR', 'IDRX'])
    assert.ok(!C.isSupportedTelegramCurrency(v), `${JSON.stringify(v)} must not be accepted`);
});

test('the supported list is exactly IDR — this is the one place that grows later', () => {
  assert.deepStrictEqual(C.TELEGRAM_SUPPORTED_CURRENCIES, ['IDR']);
});

// ── the 422 body ────────────────────────────────────────────────────────────
test('the rejection names the currency so the bot can localise its message', () => {
  const body = C.currencyNotSupported('usd');
  assert.strictEqual(body.error, 'currency_not_supported');
  assert.strictEqual(body.currency, 'USD', 'echoed back normalised');
  assert.match(body.message, /IDR/);
});

test('the rejection body carries no user data and no internals', () => {
  assert.deepStrictEqual(Object.keys(C.currencyNotSupported('EUR')).sort(),
    ['currency', 'error', 'message']);
});

// ── both doors are gated, in the right order ────────────────────────────────
const SERVER = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'index.js'), 'utf8');

function handlerBody(startMarker, endMarker) {
  const a = SERVER.indexOf(startMarker);
  assert.ok(a > -1, `${startMarker} not found`);
  const b = SERVER.indexOf(endMarker, a);
  return SERVER.slice(a, b > a ? b : a + 9000);
}

const DOORS = [
  ['text path',    "app.post('/api/debts/from-telegram'",          '// ── POST /api/debts/:id'],
  ['receipt path', "app.post('/api/telegram/debts/from-receipt'",  '// ── GET /api/debts/:id/receipt'],
];

test('BOTH Telegram doors are gated — patching only one leaves the bug open', () => {
  for (const [name, start, end] of DOORS) {
    const body = handlerBody(start, end);
    assert.match(body, /isSupportedTelegramCurrency\(/, `${name} has no currency gate`);
    assert.match(body, /return res\.status\(422\)\.json\(currencyNotSupported\(/,
      `${name} must answer 422 currency_not_supported`);
  }
});

test('the gate runs BEFORE any database write', () => {
  for (const [name, start, end] of DOORS) {
    const body = handlerBody(start, end);
    const gate = body.indexOf('isSupportedTelegramCurrency');
    for (const write of ['.insert(', '.update(', '.upsert(']) {
      let at = body.indexOf(write);
      while (at > -1) {
        assert.ok(gate < at, `${name}: ${write} happens before the currency gate`);
        at = body.indexOf(write, at + 1);
      }
    }
  }
});

test('the gate runs AFTER authentication — it is not an unauthenticated oracle', () => {
  for (const [name, start, end] of DOORS) {
    const body = handlerBody(start, end);
    const auth = body.search(/requireBotSecret|x-bot-secret/);
    assert.ok(auth > -1, `${name} has no bot-secret check`);
    assert.ok(auth < body.indexOf('isSupportedTelegramCurrency'),
      `${name}: currency is evaluated before the caller is authenticated`);
  }
});

test('the gate runs after membership resolution, so it leaks nothing to a non-member', () => {
  for (const [name, start, end] of DOORS) {
    const body = handlerBody(start, end);
    const gate = body.indexOf('isSupportedTelegramCurrency');
    const notMember = body.indexOf("'not_member'");
    assert.ok(notMember > -1 && notMember < gate,
      `${name}: membership must be settled before the currency answer is given`);
  }
});

test('no notification or approval is sent on the refused path', () => {
  // The 422 returns before every side effect, not merely before the insert.
  for (const [name, start, end] of DOORS) {
    const body = handlerBody(start, end);
    const gate = body.indexOf('isSupportedTelegramCurrency');
    for (const effect of ['notifyBusinessAdminsViaTelegram', 'approval_status']) {
      const at = body.indexOf(effect);
      if (at === -1) continue;
      assert.ok(gate < at, `${name}: ${effect} would run before the currency gate`);
    }
  }
});

// ── the stored value is canonical ───────────────────────────────────────────
test('a stored currency is normalised, so no lowercase idr row can appear', () => {
  for (const [name, start, end] of DOORS) {
    const body = handlerBody(start, end);
    assert.ok(!/currency:\s*(currency|ocr\.currency)\s*\|\|\s*'IDR'/.test(body),
      `${name} still stores the raw value instead of the normalised one`);
    assert.match(body, /currency:\s*normalizeCurrency\(/, `${name} must store the canonical form`);
  }
});

// ── IDR behaviour is untouched ──────────────────────────────────────────────
test('the IDR path is unchanged: default, insert and amount handling all survive', () => {
  const body = handlerBody(DOORS[0][1], DOORS[0][2]);
  assert.match(body, /const amountNum = Number\(amount\);/, 'amount handling must be untouched');
  assert.match(body, /from\('debts'\)\.insert/, 'IDR requests must still insert a debt');
  // The gate is a guard clause, not a rewrite of the insert.
  assert.match(body, /original_amount:\s*amountNum/);
  assert.match(body, /paid_amount:\s*0/);
});

test('nothing in this patch touches payment or wallet accounting', () => {
  // Explicitly out of scope: the pay endpoint stays exactly as it was. It is still wrong for
  // non-IDR debts — which is precisely why none may be created.
  const pay = handlerBody("app.post('/api/debts/:id/pay'", '// 2. Update debt');
  assert.ok(!/isSupportedTelegramCurrency|currencyNotSupported/.test(pay),
    'the payment endpoint must not be modified by this hotfix');
  assert.match(pay, /currency_original:\s*'IDR'/,
    'the known-wrong line stays until multi-currency work lands; the fix is upstream');
});
