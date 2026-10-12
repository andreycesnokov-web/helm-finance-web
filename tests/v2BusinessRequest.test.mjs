import test from 'node:test'
import assert from 'node:assert/strict'
import { apiFetch, getActiveBusinessId, setActiveBusinessId } from '../client/src/lib/api.js'
import { unsavedFields } from '../client/src/v2/lib/savedFields.js'
import { build } from '../client/node_modules/esbuild/lib/main.js'
import { fileURLToPath } from 'node:url'
// Resolve the production module's Vite-style extensionless imports for Node.
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../client/src/lib/documents.js', import.meta.url))], bundle: true, format: 'esm', platform: 'node', write: false })
const { uploadDocument } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)

test.beforeEach(() => {
  const data = new Map()
  globalThis.localStorage = { getItem: (k) => data.get(k) || null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) }
  setActiveBusinessId('A')
})
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
const financialToken = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ userId: 42 })).toString('base64url') + '.synthetic-signature'
test('pinned header wins; stale completion and repeat never reach another company', async () => {
  let release, calls = []
  let alive = true
  const identity = { token: 'synthetic', businessId: 'A', isCurrent: () => alive && getActiveBusinessId() === 'A' }
  globalThis.fetch = (url, opts) => { calls.push(opts); return new Promise((r) => { release = r }) }
  const pending = apiFetch('/accountant/profile', identity, { method: 'PUT', headers: { 'x-business-id': 'B' }, body: { npwp: '000111' } })
  assert.equal(calls[0].headers['x-business-id'], 'A')
  assert.equal(calls[0].headers.Authorization, 'Bearer synthetic')
  alive = false; setActiveBusinessId('B'); release(json({ profile: {} }))
  await assert.rejects(pending, { code: 'workspace_changed' })
  await assert.rejects(apiFetch('/accountant/profile', identity, { method: 'PUT', body: {} }), { code: 'workspace_changed' })
  assert.equal(calls.length, 1)
})
test('late workspace_not_accessible from A cannot clear active B, including legacy calls', async () => {
  let release
  globalThis.fetch = () => new Promise((r) => { release = r })
  const pending = apiFetch('/accountant/profile', 'synthetic')
  setActiveBusinessId('B'); release(json({ error: 'workspace_not_accessible' }, 403))
  await assert.rejects(pending, { status: 403 }); assert.equal(getActiveBusinessId(), 'B')
})
test('no business identity fails closed before a write', async () => {
  let n = 0; globalThis.fetch = () => { n++; return Promise.resolve(json({})) }
  await assert.rejects(apiFetch('/wallets', { token: 'synthetic', businessId: null, isCurrent: () => true }, { method: 'POST', body: {} }), { code: 'workspace_changed' })
  assert.equal(n, 0)
})
test('stale network failure is rejected as stale, not as a current save error', async () => {
  let reject, notifyStarted
  const started = new Promise(resolve => { notifyStarted = resolve })
  globalThis.fetch = () => new Promise((_, r) => { reject = r; notifyStarted() })
  const identity = { token: financialToken, businessId: 'A', isCurrent: () => getActiveBusinessId() === 'A' }
  const pending = apiFetch('/wallets', identity, { method: 'POST', body: {} })
  await started
  setActiveBusinessId('B'); reject(new Error('network'))
  await assert.rejects(pending, { code: 'workspace_changed' })
})
test('multi-step document upload cannot complete under a newly selected business', async () => {
  let releaseStorage
  let notifyStorage
  const started = new Promise((resolve) => { notifyStorage = resolve })
  const calls = []
  const identity = { token: 'synthetic', businessId: 'A', isCurrent: () => getActiveBusinessId() === 'A' }
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts })
    if (url === '/api/documents/upload-init') return json({ upload_url: 'http://synthetic.storage/upload-A', document_id: 'doc-A', storage_path: 'A/file.pdf' })
    if (url === 'http://synthetic.storage/upload-A') return new Promise((r) => { releaseStorage = r; notifyStorage() })
    throw new Error('upload-complete must not run after switch')
  }
  const file = { name: 'synthetic.pdf', type: 'application/pdf', size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }
  const pending = uploadDocument(identity, file)
  await Promise.race([started, pending])
  assert.equal(calls[0].opts.headers['x-business-id'], 'A')
  setActiveBusinessId('B'); releaseStorage(json({}))
  await assert.rejects(pending, { code: 'workspace_changed' })
  assert.equal(calls.length, 2)
})
test('partial save/read-back confirms normalised values and names every unconfirmed field', () => {
  assert.deepEqual(unsavedFields({ employee_count: '0', bpjs_registered: 'false', country: '', additional_kbli: ['001'] }, { employee_count: 0, bpjs_registered: false, country: null, additional_kbli: ['001'] }), [])
  assert.deepEqual(unsavedFields({ name: 'A', timezone: 'UTC', country: 'Indonesia' }, { name: 'A', country: 'Other' }, { unsupported_fields: ['timezone'] }), ['timezone', 'country'])
  assert.deepEqual(unsavedFields({ npwp: '000123' }, null), ['npwp'])
})
