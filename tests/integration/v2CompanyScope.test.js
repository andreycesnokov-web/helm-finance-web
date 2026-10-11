// Real React components/providers, synthetic API and manually released promises.
// No browser, AI, payment or real DB. Install renderer outside the repo and set
// REACT_TEST_RENDERER_PATH to its package directory (React 18, matching the app).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const esbuild = require('../../client/node_modules/esbuild');
const rendererPath = process.env.REACT_TEST_RENDERER_PATH || 'react-test-renderer';
const renderer = require(rendererPath);
const React = require(require.resolve('react', { paths: [path.dirname(require.resolve(rendererPath))] }));
const { act } = renderer;
const ROOT = process.env.V2_SCOPE_TEST_ROOT || path.resolve(__dirname, '../..');
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const companies = [A, B].map((id, i) => ({ id, name: i ? 'Company B' : 'Company A', type: 'business', role: 'owner', country: 'Indonesia', timezone: 'Asia/Jakarta', base_currency: 'IDR' }));
const profile = (id, name) => ({ business_id: id, company_legal_name: name, country: 'Indonesia', jurisdiction: 'ID', legal_entity_type: 'PT PMA', npwp: id === A ? '000111' : '000222', pkp_status: 'non_pkp', tax_regime: 'normal', financial_year_start: '2026-01-01', financial_year_end: '2026-12-31', field_verification: {} });
let App, root, state, dir;
const flush = async () => { await act(async () => {}); };
const text = () => JSON.stringify(root.toJSON());
const field = (label) => root.root.findAllByType('label').find((x) => x.findAllByType('span').some((s) => s.children.includes(label))).findAll((x) => x.type === 'input' || x.type === 'select')[0];
const edit = async (label, value) => { await act(async () => field(label).props.onChange({ target: { value } })); };
const save = () => root.root.findAllByType('button').find((x) => x.children.includes('Save'));
const click = async (button) => { await act(async () => button.props.onClick()); };
const switchTo = async (id) => { await act(async () => { const e = new Event('workspace-switch'); e.detail = { id }; window.dispatchEvent(e); }); };
const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function reset() {
  const ls = new Map([['hf_token', `x.${Buffer.from(JSON.stringify({ userId: 501, firstName: 'Synthetic' })).toString('base64')}.x`], ['hf_lang', 'en'], ['activeBusinessId', A], ['activeWorkspaceId', A], ['last_active_workspace_id', A]]);
  global.localStorage = { getItem: (k) => ls.get(k) || null, setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
  global.sessionStorage = { getItem: () => null, setItem: () => {} };
  global.window = new EventTarget();
  require('node:events').setMaxListeners(100, window);
  window.location = { search: '', pathname: '/', href: 'http://synthetic.local' };
  const doc = new EventTarget(); doc.body = {}; doc.activeElement = { focus() {} }; doc.documentElement = { style: {} };
  global.document = doc;
  state = { profiles: { [A]: profile(A, 'Legal A'), [B]: profile(B, 'Legal B') }, companies: structuredClone(companies), calls: [], pending: [], holdGet: null, holdPut: null, errorGet: null, errorPut: null, unsupported: [] };
  global.fetch = async (url, opts = {}) => {
    const p = String(url).replace(/^\/api/, '').split('?')[0];
    const method = opts.method || 'GET', id = opts.headers?.['x-business-id'] || A;
    const body = opts.body ? JSON.parse(opts.body) : null;
    state.calls.push({ p, method, id, body });
    let result = {};
    if (p === '/workspaces') result = { business: state.companies, personal: [] };
    if (p === '/access/status') result = { plan: { effective_plan: 'founder' }, limits: {} };
    if (p === '/accountant/profile/from-documents') result = { suggestions: [], documents: [], kbli_titles: [] };
    if (p === '/accountant/profile' && method === 'GET') {
      if (state.errorGet) return respond({ error: 'Synthetic read error' }, state.errorGet);
      result = { profile: structuredClone(state.profiles[id]), extended_fields: true, can_edit: true };
    }
    if (p === '/accountant/profile' && method === 'PUT') {
      if (state.errorPut) return respond({ error: 'Synthetic save error', missing: ['jurisdiction'] }, state.errorPut);
      const accepted = Object.fromEntries(Object.entries(body).filter(([k]) => !state.unsupported.includes(k)));
      state.profiles[id] = { ...(state.profiles[id] || {}), ...accepted };
      result = { profile: structuredClone(state.profiles[id]), not_saved: [...state.unsupported], completeness: { percent: 100 } };
    }
    if (p === '/business/current') {
      const co = state.companies.find((x) => x.id === id);
      if (method === 'PATCH') Object.assign(co, Object.fromEntries(Object.entries(body).filter(([k]) => !state.unsupported.includes(k))));
      result = { business: { ...co }, can_edit: true, unsupported_fields: [...state.unsupported] };
    }
    if (p === '/business/financial-counts') result = { counts: { transactions: 1 } };
    if (p === '/wallets') result = { wallets: [{ id: `wallet-${id}`, name: id === A ? 'Wallet A' : 'Wallet B', currency: 'IDR', balance: 100 }] };
    if (p === '/transactions') result = [{ id: id === A ? 1 : 2, description: id === A ? 'Transaction A' : 'Transaction B', amount_original: 10, currency_original: 'IDR', type: 'expense', wallet_id: `wallet-${id}`, transaction_date: new Date().toISOString().slice(0, 10) }];
    if (p === '/cashflow-categories') result = { categories: [] };
    if (p === '/me/profile') result = { profile: { display_name: 'Synthetic', timezone: 'Asia/Jakarta' } };
    if (p === '/team') result = { members: [], invites: [] };
    if (p === '/payroll/employees') result = { employees: [] };
    if (p === '/payroll/payments') result = { payments: [] };
    if ((p === '/accountant/profile' && method === 'GET' && state.holdGet === id) || (p === '/accountant/profile' && method === 'PUT' && state.holdPut === id)) {
      return new Promise((resolve) => state.pending.push(() => resolve(respond(result))));
    }
    return respond(result);
  };
}
async function mount(route = '/business/accountant/tax-profile/edit') {
  await act(async () => { root = renderer.create(React.createElement(App, { path: route }), { createNodeMock: () => ({ focus() {}, querySelector() { return null; } }) }); });
  await flush();
}
test.before(async () => {
  reset(); dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-scope-components-'));
  const source = `import React from 'react'; import { MemoryRouter, Routes, Route } from 'react-router-dom';
    import { AuthProvider } from '${ROOT}/client/src/hooks/useAuth.jsx';
    import BusinessApp from '${ROOT}/client/src/v2/BusinessApp.jsx';
    export function App({path}) {return <AuthProvider><MemoryRouter initialEntries={[path]}><Routes><Route path='/business/*' element={<BusinessApp/>}/></Routes></MemoryRouter></AuthProvider>}`;
  const reactBase = path.dirname(require.resolve('react', { paths: [path.dirname(require.resolve(rendererPath))] }));
  await esbuild.build({ stdin: { contents: source, loader: 'jsx', resolveDir: ROOT }, nodePaths: [path.join(ROOT, 'client/node_modules')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(dir, 'app.cjs'), jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' }, logLevel: 'silent', plugins: [{ name: 'test-host', setup(b) {
    b.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, (a) => ({ path: a.path === 'react' ? path.join(reactBase, 'index.js') : path.join(reactBase, 'jsx-runtime.js'), external: true }));
    b.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'host' }));
    b.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: 'exports.createPortal = (children) => children;' }));
  } }] });
  App = require(path.join(dir, 'app.cjs')).App;
});
test.beforeEach(reset);
test.afterEach(async () => { if (root) { await act(async () => root.unmount()); root = null; } });
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('unsaved A cannot be submitted as B; A→B→A reloads server values', async () => {
  await mount(); await edit('Legal name', 'Unsaved A'); await switchTo(B);
  assert.equal(field('Legal name').props.value, 'Legal B');
  await click(save());
  const writes = state.calls.filter((c) => c.method === 'PUT');
  assert.equal(writes.at(-1).id, B); assert.notEqual(writes.at(-1).body.company_legal_name, 'Unsaved A');
  await switchTo(A); assert.equal(field('Legal name').props.value, 'Legal A');
});
test('explicit request identity still works when localStorage writes fail', async () => {
  await mount(); localStorage.setItem = () => { throw new Error('synthetic private storage'); };
  await switchTo(B); await edit('Legal name', 'Private storage B'); await click(save());
  assert.equal(state.calls.filter((c) => c.method === 'PUT').at(-1).id, B);
  assert.equal(state.profiles[B].company_legal_name, 'Private storage B');
  assert.equal(state.profiles[A].company_legal_name, 'Legal A');
});
test('controlled late GET A never paints B, and B cannot save before its GET', async () => {
  state.holdGet = A; await mount(); assert.equal(state.pending.length, 1);
  state.holdGet = B; await switchTo(B); assert.equal(state.pending.length, 2);
  assert.equal(save(), undefined);
  const [a, b] = state.pending;
  await act(async () => b()); assert.equal(field('Legal name').props.value, 'Legal B');
  await act(async () => a()); assert.equal(field('Legal name').props.value, 'Legal B');
});
test('Save A keeps its business header; late completion does not announce success/refetch B', async () => {
  await mount(); await edit('Legal name', 'Saved A'); state.holdPut = A;
  let pending; await act(async () => { pending = save().props.onClick(); });
  assert.equal(state.calls.filter((x) => x.method === 'PUT').at(-1).id, A);
  await switchTo(B); const n = state.calls.length;
  await act(async () => { state.pending[0](); await pending; });
  assert.equal(field('Legal name').props.value, 'Legal B'); assert.equal(state.calls.length, n);
  assert.ok(!text().includes('Saved.')); assert.equal(state.profiles[A].company_legal_name, 'Saved A');
});
for (const code of [403, 500]) test(`initial GET ${code} renders ErrorBox; Retry after switch reads B`, async () => {
  state.errorGet = code; await mount(); assert.ok(text().includes('v2-error'));
  await switchTo(B); assert.ok(text().includes('v2-error'));
  state.errorGet = null; await click(root.root.findAllByType('button').find((x) => x.children.includes('Try again')));
  assert.equal(field('Legal name').props.value, 'Legal B');
  assert.equal(state.calls.filter((c) => c.p === '/accountant/profile' && c.method === 'GET').at(-1).id, B);
});
test('first save sends jurisdiction and confirmed values survive reload', async () => {
  state.profiles[A] = null; await mount(); await edit('Legal name', 'New profile'); await click(save());
  assert.equal(state.calls.filter((c) => c.method === 'PUT').at(-1).body.jurisdiction, 'ID');
  await act(async () => root.unmount()); root = null; await mount();
  assert.equal(field('Legal name').props.value, 'New profile'); assert.equal(field('Tax jurisdiction (code)').props.value, 'ID');
});
for (const code of [422, 500, 403]) test(`PUT ${code} keeps input and shows an error without success`, async () => {
  await mount(); await edit('Legal name', 'Keep this draft'); state.errorPut = code; await click(save());
  assert.equal(field('Legal name').props.value, 'Keep this draft'); assert.ok(text().includes('v2-tone-warn'));
  assert.equal(state.profiles[A].company_legal_name, 'Legal A');
});
test('partial profile save names unsupported field and retains its draft', async () => {
  await mount(); await edit('Legal name', 'Unsupported name'); await edit('NPWP', '000999'); state.unsupported = ['company_legal_name']; await click(save());
  assert.ok(text().includes('Not confirmed as saved: Legal name'));
  assert.equal(field('Legal name').props.value, 'Unsupported name'); assert.equal(state.profiles[A].npwp, '000999');
});
test('CompanyTab loads current B record and shows concrete unsupported fields', async () => {
  await mount('/business/settings?tab=company'); await edit('Name in the app', 'Draft A'); await switchTo(B);
  assert.equal(field('Name in the app').props.value, 'Company B');
  await edit('Time zone', 'Asia/Singapore'); state.unsupported = ['timezone'];
  await act(async () => root.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.ok(text().includes('Not saved: Time zone')); assert.equal(field('Time zone').props.value, 'Asia/Singapore');
  assert.equal(state.calls.filter((c) => c.method === 'PATCH' && c.p === '/business/current').at(-1).id, B);
});
test('financial dialog A closes on business switch and cannot retain its draft', async () => {
  await mount('/business/transactions');
  const nodeText = (x) => typeof x === 'string' ? x : x.children.map(nodeText).join(' ');
  const row = root.root.findAllByType('button').find((x) => x.props.onClick && nodeText(x).includes('Transaction A'));
  assert.ok(row, 'transaction row must exist'); await click(row);
  assert.equal(root.root.findAll((x) => x.props.role === 'dialog').length, 1);
  await switchTo(B); assert.equal(root.root.findAll((x) => x.props.role === 'dialog').length, 0);
  assert.ok(text().includes('Transaction B')); assert.ok(!text().includes('Transaction A'));
});
