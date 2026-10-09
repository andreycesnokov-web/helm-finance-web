'use strict';
// A new company starts with standard cash-flow categories (it used to start with none).
const test = require('node:test');
const assert = require('node:assert');
const DC = require('../server/lib/defaultCategories');

test('every default has a valid group and activity, names are unique', () => {
  const names = new Set()
  for (const [name, g, a] of DC.DEFAULT_BUSINESS_CATEGORIES) {
    assert.ok(['inflow', 'outflow'].includes(g), name)
    assert.ok(['operating', 'investing', 'financing', 'technical'].includes(a), name)
    assert.ok(!names.has(name.toLowerCase()), `duplicate ${name}`)
    names.add(name.toLowerCase())
  }
  assert.ok(DC.DEFAULT_BUSINESS_CATEGORIES.some(([n, g, a]) => g === 'inflow' && a === 'technical'), 'own-account transfer in')
  assert.ok(DC.DEFAULT_BUSINESS_CATEGORIES.some(([n, g, a]) => g === 'outflow' && a === 'technical'), 'own-account transfer out')
  assert.ok(DC.DEFAULT_BUSINESS_CATEGORIES.some(([n]) => /bank fees/i.test(n)))
})

test('rows are company categories the owner can rename or archive', () => {
  const rows = DC.defaultCategoryRows({ businessId: 'b1', userId: -1 })
  assert.strictEqual(rows.length, DC.DEFAULT_BUSINESS_CATEGORIES.length)
  for (const r of rows) {
    assert.strictEqual(r.business_id, 'b1'); assert.strictEqual(r.user_id, -1)
    assert.strictEqual(r.is_system, false); assert.strictEqual(r.is_active, true); assert.strictEqual(r.source, 'default')
  }
})

test('idempotent: names the company already has are skipped, case-insensitively', () => {
  const rows = DC.defaultCategoryRows({ businessId: 'b1', userId: 1, existingNames: ['rent', 'BANK FEES '] })
  assert.ok(!rows.some((r) => /^rent$/i.test(r.name)))
  assert.ok(!rows.some((r) => /^bank fees$/i.test(r.name)))
  assert.strictEqual(rows.length, DC.DEFAULT_BUSINESS_CATEGORIES.length - 2)
})

test('seed never throws and reports what it inserted', async () => {
  const inserted = []
  const ok = { from: () => ({ select: () => ({ eq: async () => ({ data: [{ name: 'Rent' }] }) }), insert: async (rows) => { inserted.push(...rows); return { error: null } } }) }
  const r = await DC.seedBusinessCategories(ok, 'b1', 1)
  assert.strictEqual(r.inserted, DC.DEFAULT_BUSINESS_CATEGORIES.length - 1)
  const bad = { from: () => { throw new Error('db down') } }
  assert.deepStrictEqual((await DC.seedBusinessCategories(bad, 'b1', 1)).inserted, 0)
})
