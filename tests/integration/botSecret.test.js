// One secret authenticates the Telegram bot: TELEGRAM_WEBHOOK_SECRET.
//
// PR0.5. Before it the two services disagreed about which variable held that secret:
//
//   bot:  TELEGRAM_WEBHOOK_SECRET || WEBHOOK_SECRET || BOT_TOKEN
//   web:  TELEGRAM_WEBHOOK_SECRET || BOT_TOKEN
//
// The middle link existed on one side only, so a bot that fell through to WEBHOOK_SECRET
// sent a value this service could not accept under ANY configuration — every call 401s and
// the fail-closed guard tells every user their Telegram cannot be verified, which looks
// exactly like the guard working correctly. The bot repo's local .env was in that state.
//
// The BOT_TOKEN fallback was worse in a quieter way: it made backend authentication depend
// on the Telegram bot token, so revoking or regenerating that token in BotFather silently
// broke the API, and it reused a credential that appears in BotFather, in every Telegram API
// URL and in webhook config as though it were a private API secret.
//
//   Run: node --test tests/integration/botSecret.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SERVER_PATH = path.join(__dirname, '..', '..', 'server', 'index.js');
const SERVER = fs.readFileSync(SERVER_PATH, 'utf8');

// The shipped implementation, lifted from source so these are not a paraphrase of it.
function loadRequireBotSecret() {
  const start = SERVER.indexOf('function requireBotSecret(req) {');
  assert.ok(start > -1, 'requireBotSecret not found');
  const end = SERVER.indexOf('\n}', start) + 2;
  // eslint-disable-next-line no-new-func
  return new Function(`${SERVER.slice(start, end)}\nreturn requireBotSecret;`)();
}
const requireBotSecret = loadRequireBotSecret();

const withEnv = (vars, fn) => {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
};

const req = (secret) => ({ headers: secret === undefined ? {} : { 'x-bot-secret': secret } });

// ── the happy path ──────────────────────────────────────────────────────────
test('the correct TELEGRAM_WEBHOOK_SECRET is accepted', () => {
  withEnv({ TELEGRAM_WEBHOOK_SECRET: 'unified-secret-value' }, () => {
    assert.strictEqual(requireBotSecret(req('unified-secret-value')), true);
  });
});

test('a wrong value is rejected', () => {
  withEnv({ TELEGRAM_WEBHOOK_SECRET: 'unified-secret-value' }, () => {
    for (const bad of ['wrong', 'unified-secret-valu', 'UNIFIED-SECRET-VALUE', ''])
      assert.strictEqual(requireBotSecret(req(bad)), false, JSON.stringify(bad));
  });
});

test('a missing header is rejected', () => {
  withEnv({ TELEGRAM_WEBHOOK_SECRET: 'unified-secret-value' }, () => {
    assert.strictEqual(requireBotSecret(req(undefined)), false);
    assert.strictEqual(requireBotSecret({ headers: {} }), false);
  });
});

// ── the fallbacks are gone ──────────────────────────────────────────────────
test('BOT_TOKEN is no longer accepted as the bot secret', () => {
  // The fallback that coupled backend auth to Telegram token rotation.
  withEnv({ TELEGRAM_WEBHOOK_SECRET: 'unified-secret-value', BOT_TOKEN: '123456:AAtoken' }, () => {
    assert.strictEqual(requireBotSecret(req('123456:AAtoken')), false,
      'presenting the bot token must not authenticate a request');
  });
});

test('WEBHOOK_SECRET is not consulted — it never was on this side', () => {
  withEnv({ TELEGRAM_WEBHOOK_SECRET: 'unified-secret-value', WEBHOOK_SECRET: 'legacy' }, () => {
    assert.strictEqual(requireBotSecret(req('legacy')), false);
  });
});

// ── fail closed when unconfigured ───────────────────────────────────────────
test('an UNSET secret rejects everything, including an absent header', () => {
  // The dangerous shape: without the explicit falsy check, `undefined === undefined`
  // authenticates every caller the moment the variable goes missing.
  withEnv({ TELEGRAM_WEBHOOK_SECRET: undefined, BOT_TOKEN: undefined, WEBHOOK_SECRET: undefined }, () => {
    assert.strictEqual(requireBotSecret(req(undefined)), false, 'no header, no secret → reject');
    assert.strictEqual(requireBotSecret(req('anything')), false);
    assert.strictEqual(requireBotSecret({ headers: { 'x-bot-secret': undefined } }), false);
  });
});

test('an EMPTY secret also rejects everything', () => {
  withEnv({ TELEGRAM_WEBHOOK_SECRET: '' }, () => {
    assert.strictEqual(requireBotSecret(req('')), false);
    assert.strictEqual(requireBotSecret(req(undefined)), false);
  });
});

test('with the secret unset, BOT_TOKEN does not quietly take over', () => {
  withEnv({ TELEGRAM_WEBHOOK_SECRET: undefined, BOT_TOKEN: '123456:AAtoken' }, () => {
    assert.strictEqual(requireBotSecret(req('123456:AAtoken')), false,
      'the whole point of PR0.5 — a missing secret must not silently fall back');
  });
});

test('the guard always returns a boolean, never a truthy string', () => {
  withEnv({ TELEGRAM_WEBHOOK_SECRET: 'unified-secret-value' }, () => {
    for (const v of ['unified-secret-value', 'nope', undefined])
      assert.strictEqual(typeof requireBotSecret(req(v)), 'boolean', JSON.stringify(v));
  });
});

// ── source guards ───────────────────────────────────────────────────────────
// LINE-BASED on purpose. The obvious `/\/\*[\s\S]*?\*\//g` is wrong on this file: it has 33
// `/*` and only 30 `*/`, because some appear inside regex literals rather than comments. The
// greedy match then runs from a fake opener to a distant closer and silently deletes ~24% of
// the source — including the very lines these guards are meant to inspect. A line-based pass
// cannot run away: worst case it drops one line too many, which only weakens a guard rather
// than making it pass vacuously.
function stripComments(src) {
  const out = [];
  for (const raw of src.replace(/\r\n/g, '\n').split('\n')) {
    const t = raw.trim();
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*/') || t.startsWith('*')) continue;
    // Trailing comment, but never cut a URL: the `//` in `https://` is not a comment.
    out.push(raw.replace(/(^|[^:])\/\/.*$/, '$1'));
  }
  return out.join('\n');
}
const CODE = stripComments(SERVER);

test('there is exactly ONE definition of bot authentication', () => {
  // /api/debts/from-telegram used to inline its own copy of the chain.
  assert.strictEqual((CODE.match(/function requireBotSecret\(/g) || []).length, 1);
  const inlined = CODE.match(/const botSecret\s*=/g) || [];
  assert.strictEqual(inlined.length, 1,
    'the secret must be read in requireBotSecret() and nowhere else');
});

test('no fallback chain survives on the secret', () => {
  assert.ok(!/TELEGRAM_WEBHOOK_SECRET\s*\|\|/.test(CODE),
    'TELEGRAM_WEBHOOK_SECRET must not fall back to anything');
  assert.ok(!/\|\|\s*process\.env\.TELEGRAM_WEBHOOK_SECRET/.test(CODE),
    'nothing may fall back INTO it either');
});

test('BOT_TOKEN is never read near an x-bot-secret comparison', () => {
  const lines = CODE.split('\n');
  lines.forEach((line, i) => {
    if (!/x-bot-secret/.test(line)) return;
    const window = lines.slice(Math.max(0, i - 6), i + 7).join('\n');
    assert.ok(!/process\.env\.BOT_TOKEN/.test(window),
      `BOT_TOKEN appears within 6 lines of an x-bot-secret check at line ${i + 1}`);
  });
});

test('every Telegram bot endpoint authenticates through the shared guard', () => {
  const calls = (CODE.match(/requireBotSecret\(req\)/g) || []).length;
  assert.ok(calls >= 9, `expected the bot endpoints to gate, found ${calls}`);
});

test('the falsy guard cannot be removed', () => {
  const start = SERVER.indexOf('function requireBotSecret(req) {');
  const body = SERVER.slice(start, SERVER.indexOf('\n}', start));
  assert.match(body, /if \(!botSecret\) return false;/,
    'an unset secret must short-circuit before any comparison');
});

// ── startup validation ──────────────────────────────────────────────────────
test('TELEGRAM_WEBHOOK_SECRET is required at boot', () => {
  const at = CODE.indexOf('const REQUIRED_ENV');
  const block = CODE.slice(at, CODE.indexOf(']', at));
  assert.match(block, /'TELEGRAM_WEBHOOK_SECRET'/,
    'a missing secret must stop the server, not degrade authentication');
});

test('BOT_TOKEN stays required — it has legitimate uses', () => {
  // Telegram Login Widget HMAC and outbound Bot API calls. Only the auth fallback went away.
  const at = CODE.indexOf('const REQUIRED_ENV');
  assert.match(CODE.slice(at, CODE.indexOf(']', at)), /'BOT_TOKEN'/);
  assert.match(CODE, /crypto\.createHash\('sha256'\)\.update\(BOT_TOKEN\)/,
    'verifyTelegramAuth must keep using the bot token');
});
