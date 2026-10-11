// 053_support_center_foundation.sql — DDL, constraints, indexes and triggers over PGlite.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const SQL = fs.readFileSync(path.join(__dirname, '../../migrations/053_support_center_foundation.sql'), 'utf8');

const BIZ_A = '11111111-1111-1111-1111-111111111111';
const USER = -1;
const TABLES = ['support_conversations', 'support_messages', 'support_escalations', 'support_events'];

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users (id BIGINT PRIMARY KEY);
    CREATE TABLE businesses (id uuid PRIMARY KEY, type text DEFAULT 'business');
    INSERT INTO users VALUES (${USER});
    INSERT INTO businesses VALUES ('${BIZ_A}','business');`);
  await db.exec(SQL);
  return db;
}
const fails = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { return e.message; } };
const one = async (db, sql) => (await db.query(sql)).rows[0];

const conv = (o = {}) => {
  const f = { business_id: `'${BIZ_A}'`, created_by_user_id: `${USER}`, ...o };
  return `INSERT INTO support_conversations (${Object.keys(f).join(', ')}) VALUES (${Object.values(f).join(', ')})`;
};
async function newConv(db, o = {}) {
  const r = await db.query(conv(o) + ' RETURNING id');
  return r.rows[0].id;
}
const msg = (cid, o = {}) => {
  const f = { conversation_id: `'${cid}'`, business_id: `'${BIZ_A}'`, sender_type: `'user'`,
              sender_user_id: `${USER}`, body: `'hello there'`, ...o };
  return `INSERT INTO support_messages (${Object.keys(f).join(', ')}) VALUES (${Object.values(f).join(', ')});`;
};

test('053 applies cleanly and is IDEMPOTENT', async () => {
  const db = await freshDb();
  assert.strictEqual(await fails(db, SQL), null);
});

test('all four tables exist and start empty', async () => {
  const db = await freshDb();
  for (const t of TABLES) {
    assert.ok(await one(db, `SELECT to_regclass('public.${t}') AS t`).then(r => r.t), `${t} missing`);
    assert.strictEqual((await one(db, `SELECT count(*)::int n FROM ${t}`)).n, 0, `${t} not empty`);
  }
});

test('the documented indexes exist', async () => {
  const db = await freshDb();
  const { rows } = await db.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public'
    AND tablename IN ('support_conversations','support_messages','support_escalations','support_events')`);
  const idx = rows.map(r => r.indexname);
  for (const n of ['support_conversations_business_idx', 'support_conversations_creator_idx',
                   'support_conversations_status_idx', 'support_conversations_priority_idx',
                   'support_conversations_last_message_idx', 'support_messages_conversation_idx',
                   'support_escalations_status_idx', 'support_escalations_business_idx',
                   'support_events_conversation_idx']) {
    assert.ok(idx.includes(n), `missing index ${n}`);
  }
});

test('the three triggers exist', async () => {
  const db = await freshDb();
  const { rows } = await db.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`);
  const t = rows.map(r => r.tgname);
  for (const n of ['trg_support_conversations_updated_at', 'trg_support_message_touch_conversation',
                   'trg_support_conversation_created_event']) {
    assert.ok(t.includes(n), `missing trigger ${n}`);
  }
});

// ── Vocabularies ─────────────────────────────────────────────────────────────────────────
test('every enum-style column is a closed vocabulary', async () => {
  const db = await freshDb();
  for (const [col, bad] of [['channel', 'carrier_pigeon'], ['status', 'pending'],
                            ['priority', 'critical'], ['category', 'random'], ['ai_mode', 'skynet']]) {
    assert.match(await fails(db, conv({ [col]: `'${bad}'` }) + ';') || '', /check constraint/i, `${col} accepted ${bad}`);
  }
  assert.match(await fails(db, msg('00000000-0000-0000-0000-000000000000', { sender_type: `'robot'` })) || '',
    /check constraint|foreign key/i);
});

test('safe defaults', async () => {
  const db = await freshDb();
  await newConv(db);
  const c = await one(db, 'SELECT channel, status, priority, category, ai_mode, ai_confidence FROM support_conversations');
  assert.deepStrictEqual(
    { ch: c.channel, st: c.status, pr: c.priority, cat: c.category, ai: c.ai_mode, conf: c.ai_confidence },
    { ch: 'in_app', st: 'open', pr: 'normal', cat: 'general', ai: 'not_started', conf: null });
});

test('ai_confidence is bounded to 0..1', async () => {
  const db = await freshDb();
  assert.match(await fails(db, conv({ ai_confidence: '1.5' }) + ';') || '', /check constraint/i);
  assert.match(await fails(db, conv({ ai_confidence: '-0.1' }) + ';') || '', /check constraint/i);
  assert.strictEqual(await fails(db, conv({ ai_confidence: '0.75' }) + ';'), null);
});

// ── Stamps ───────────────────────────────────────────────────────────────────────────────
test('a closed conversation must carry closed_at, and an open one must not', async () => {
  const db = await freshDb();
  assert.match(await fails(db, conv({ status: `'closed'` }) + ';') || '', /closed_stamp/i);
  assert.match(await fails(db, conv({ closed_at: 'now()' }) + ';') || '', /closed_stamp/i);
  assert.strictEqual(await fails(db, conv({ status: `'closed'`, closed_at: 'now()' }) + ';'), null);
});

test('an escalation records when it was resolved, or does not claim to be', async () => {
  const db = await freshDb();
  const cid = await newConv(db);
  const esc = (o = {}) => {
    const f = { conversation_id: `'${cid}'`, reason: `'needs a person'`, ...o };
    return `INSERT INTO support_escalations (${Object.keys(f).join(', ')}) VALUES (${Object.values(f).join(', ')});`;
  };
  assert.match(await fails(db, esc({ status: `'resolved'` })) || '', /resolved_stamp/i);
  assert.match(await fails(db, esc({ resolved_at: 'now()' })) || '', /resolved_stamp/i);
  assert.strictEqual(await fails(db, esc({ status: `'resolved'`, resolved_at: 'now()' })), null);
  assert.strictEqual(await fails(db, esc()), null);   // open, no stamp
});

// ── Internal notes ───────────────────────────────────────────────────────────────────────
test('only staff senders may mark a message internal', async () => {
  const db = await freshDb();
  const cid = await newConv(db);
  // A user or the AI hiding a message from the thread owner makes no sense.
  assert.match(await fails(db, msg(cid, { sender_type: `'user'`, is_internal: 'true' })) || '', /internal_sender/i);
  assert.match(await fails(db, msg(cid, { sender_type: `'ai'`, is_internal: 'true' })) || '', /internal_sender/i);
  assert.strictEqual(await fails(db, msg(cid, { sender_type: `'manager'`, is_internal: 'true' })), null);
  assert.strictEqual(await fails(db, msg(cid, { sender_type: `'system'`, is_internal: 'true' })), null);
});

test('a message body cannot be blank', async () => {
  const db = await freshDb();
  const cid = await newConv(db);
  assert.match(await fails(db, msg(cid, { body: `'   '` })) || '', /check constraint/i);
  assert.match(await fails(db, msg(cid, { body: `''` })) || '', /check constraint/i);
});

// ── Triggers do their work ───────────────────────────────────────────────────────────────
test('inserting a message updates the conversation last_message_at', async () => {
  const db = await freshDb();
  const cid = await newConv(db);
  assert.strictEqual((await one(db, `SELECT last_message_at FROM support_conversations WHERE id='${cid}'`)).last_message_at, null);
  await db.exec(msg(cid));
  const after = (await one(db, `SELECT last_message_at FROM support_conversations WHERE id='${cid}'`)).last_message_at;
  assert.ok(after, 'last_message_at was not set by the trigger');
});

test('creating a conversation and a message write timeline events', async () => {
  const db = await freshDb();
  const cid = await newConv(db);
  let evs = (await db.query(`SELECT event_type, event_payload FROM support_events WHERE conversation_id='${cid}' ORDER BY created_at`)).rows;
  assert.deepStrictEqual(evs.map(e => e.event_type), ['conversation_created']);

  await db.exec(msg(cid));
  evs = (await db.query(`SELECT event_type, event_payload FROM support_events WHERE conversation_id='${cid}' ORDER BY created_at`)).rows;
  assert.deepStrictEqual(evs.map(e => e.event_type), ['conversation_created', 'message_created']);
});

test('the timeline event never copies the message body', async () => {
  const db = await freshDb();
  const cid = await newConv(db);
  await db.exec(msg(cid, { body: `'MY SECRET SUPPORT TEXT'` }));
  const blob = JSON.stringify((await db.query(`SELECT event_payload FROM support_events`)).rows);
  assert.ok(!blob.includes('MY SECRET SUPPORT TEXT'), 'the body was duplicated into the event log');
});

test('updated_at is maintained by the trigger', async () => {
  const db = await freshDb();
  const cid = await newConv(db);
  const before = (await one(db, `SELECT updated_at FROM support_conversations WHERE id='${cid}'`)).updated_at;
  await db.exec(`UPDATE support_conversations SET subject='changed' WHERE id='${cid}';`);
  const after = (await one(db, `SELECT updated_at FROM support_conversations WHERE id='${cid}'`)).updated_at;
  assert.ok(new Date(after) >= new Date(before));
});

// ── Tenancy / lifecycle ──────────────────────────────────────────────────────────────────
test('business_id is NULLABLE - a user with no business can still ask for help', async () => {
  const db = await freshDb();
  assert.strictEqual(await fails(db, conv({ business_id: 'NULL' }) + ';'), null);
});

test('created_by_user_id is required and must be a real user', async () => {
  const db = await freshDb();
  assert.match(await fails(db, conv({ created_by_user_id: 'NULL' }) + ';') || '', /null value|not-null/i);
  assert.match(await fails(db, conv({ created_by_user_id: '999999' }) + ';') || '', /foreign key/i);
});

test('deleting a conversation removes its messages, escalations and events', async () => {
  const db = await freshDb();
  const cid = await newConv(db);
  await db.exec(msg(cid));
  await db.exec(`INSERT INTO support_escalations (conversation_id, reason) VALUES ('${cid}','x');`);
  await db.exec(`DELETE FROM support_conversations WHERE id='${cid}';`);
  for (const t of ['support_messages', 'support_escalations', 'support_events']) {
    assert.strictEqual((await one(db, `SELECT count(*)::int n FROM ${t}`)).n, 0, `${t} left orphans`);
  }
});
