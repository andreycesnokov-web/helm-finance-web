'use strict';
// Telegram HTML notices escape every person/document value; receipt proxy never renders HTML.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tgEsc } = require('../server/lib/telegramText');
const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8').replace(/\r\n/g, '\n');

test('tgEsc neutralises markup and keeps plain text', () => {
  assert.strictEqual(tgEsc('<a href="https://x">Approve</a> & co'), '&lt;a href="https://x"&gt;Approve&lt;/a&gt; &amp; co');
  assert.strictEqual(tgEsc('PT Sinar Jaya'), 'PT Sinar Jaya');
  assert.strictEqual(tgEsc(null), '');
});

test('approval and receipt notices escape counterparty, submitter, role and OCR lines', () => {
  for (const s of ["Вернуть: ${tgEsc(data.counterparty)}", "Поставщик: ${tgEsc(data.counterparty)}", "Создал: ${tgEsc(m.submitterUser.name)} · ${tgEsc(m.role)}",
    "От: ${tgEsc(name)}", "' · ' + tgEsc(a.counterparty)", "fn(tgEsc(req.body?.detail || ''))"]) assert.ok(src.includes(s), s);
  assert.ok(!/Поставщик: \$\{data\.counterparty\}|Вернуть: \$\{data\.counterparty\}|От: \$\{name\}/.test(src), 'no raw interpolation left');
});

test('receipt proxy: nosniff, inline only for images/PDF, otherwise a download', () => {
  const at = src.indexOf("app.get('/api/debts/:id/receipt'");
  const route = src.slice(at, src.indexOf('\napp.', at + 10));
  assert.match(route, /X-Content-Type-Options', 'nosniff'/);
  assert.match(route, /inline \? upstreamType : 'application\/octet-stream'/);
  assert.match(route, /Content-Disposition', inline \? 'inline' : 'attachment'/);
});
