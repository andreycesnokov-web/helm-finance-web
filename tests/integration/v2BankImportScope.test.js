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
const ROOT = (process.env.V2_SCOPE_TEST_ROOT || path.resolve(__dirname, '../..')).replace(/\\/g, '/');
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const companies = [A, B].map((id, i) => ({ id, name: i ? 'Company B' : 'Company A', type: 'business', role: 'owner', country: 'Indonesia', timezone: 'Asia/Jakarta', base_currency: 'IDR' }));
const profile = (id, name) => ({ business_id: id, company_legal_name: name, country: 'Indonesia', jurisdiction: 'ID', legal_entity_type: 'PT PMA', npwp: id === A ? '000111' : '000222', pkp_status: 'non_pkp', tax_regime: 'normal', financial_year_start: '2026-01-01', financial_year_end: '2026-12-31', field_verification: {} });
let App, root, state, dir;
const flush = async () => { await act(async () => {}); };
const click = async (button) => { await act(async () => { button.props.onClick(); }); };
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

// Defer one real pipeline boundary. Everything goes through the app's API client;
// the signed storage URL is synthetic and no real documents or cash are written.
function importServer({ hold, duplicate = false, failFirst = false, dropConfirm = false, partial = false, canConfirm = true, knownOpening = false } = {}) {
  const normalFetch = global.fetch;
  const calls = [];
  const gate = { release: null };
  let imported = false, receipt=null, confirms=0;
  const row2='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const hash=()=>((partial&&confirms===1)?'b':'a').repeat(64);
  const review = () => ({
    batch: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: imported ? 'imported' : partial&&confirms===1 ? 'partially_imported' : 'review_required', currency: 'IDR', opening_balance: 100, closing_balance: partial?110:90, statement_start:'2026-05-01', statement_end: '2026-05-31' },
    rows: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', row_index: 0, tx_date: '2026-05-10', description: 'Bank admin fee', amount: 10, direction: 'out', review_status: partial&&confirms>0?'imported':'needs_review',linked_transaction_id:partial&&confirms>0?700:null },...(partial?[{id:row2,row_index:1,tx_date:'2026-05-11',description:'STAGE receipt',amount:20,direction:'in',review_status:imported?'imported':'needs_review',linked_transaction_id:imported?701:null}]:[])],
    categories: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Bank fee and admin', group_type: 'outflow' }],
    reviewed:{review_hash:hash(),can_confirm:canConfirm,can_correct_opening:knownOpening,opening_state:knownOpening?'known':'unknown',historical_opening:knownOpening?'80':null,current_balance:'60'},
  });
  global.fetch = async (url, opts = {}) => {
    const p = String(url), method = opts.method || 'GET';
    const id = opts.headers?.['x-business-id'];
    const storage = p === 'http://synthetic.local/storage';
    const body = storage ? opts.body : opts.body ? JSON.parse(opts.body) : null;
    const file = storage ? body.name : body?.file_name;
    const first = file === 'A-first.csv';
    let result, status = 200, stage;
    if (p === '/api/documents/upload-init') {
      stage = 'init';
      result = { document_id: file, storage_path: file, upload_url: 'http://synthetic.local/storage' };
      if (duplicate && first) { status = 409; result = { error: 'duplicate', existing_document_id: 'existing-A' }; }
      if (failFirst && first) { status = 500; result = { error: 'Synthetic upload error' }; }
    } else if (storage) { stage = 'storage'; result = {}; }
    else if (p === '/api/documents/upload-complete') { stage = 'complete'; result = { document: { id: body.document_id } }; }
    else if (p === '/api/bank-import/read') {
      stage = 'read';
      result = { ok: true, method: 'csv', suggested_wallet_id: `wallet-${A}`, statement: { currency: 'IDR', period_start: '2026-05-01', period_end: '2026-05-31', opening: 100, closing: 90, checks: { balances: true }, rows: review().rows } };
    } else if (p === '/api/bank-import/batches' && method === 'POST') { stage = 'batch'; result = { batch: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }; }
    else if (p.endsWith('/filing')) { stage = 'filing'; result = {}; }
    else if (p.endsWith('/suggest')) { stage = 'suggest'; result = {}; }
    else if (p === '/api/classification-rules') { stage = 'rule'; result = {}; }
    else if (p.endsWith('/confirm')) { stage='confirm';confirms++;imported=!partial||confirms>1;const {request_key,...payload}=body;result={ok:true,request_id:request_key,batch_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',review_hash:payload.review_hash,imported:1,linked:0,status:imported?'imported':'partially_imported'};receipt={state:'confirmed',request_id:request_key,batch_id:result.batch_id,intent:{version:1,operation:'bank_import_confirm',batch_id:result.batch_id,...payload},result}; }
    else if(p.includes('/requests/')){stage='receipt';result=receipt||{state:'not_found'};}
    else if(p.endsWith('/receipts')){stage='history';result={rows:[]};}
    else if (p === '/api/bank-imports/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/review') return id === A ? respond(review()) : respond({ error: 'not_found' }, 404);
    else return normalFetch(url, opts);
    calls.push({ p, method, id, file, body, stage });
    if(stage==='confirm'&&dropConfirm&&confirms===1)throw Error('Synthetic response lost after commit');
    if (stage === hold && !gate.release && (stage !== 'init' && stage !== 'storage' && stage !== 'complete' || first)) {
      return new Promise(resolve => { gate.release = () => resolve(respond(result, status)); });
    }
    return respond(result, status);
  };
  return { calls, gate };
}

async function until(predicate, message) {
  for (let i = 0; !predicate() && i < 100; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  assert.ok(predicate(), message);
}
async function settle() {
  // Flush async hashing, Response.text() and state effects after releasing a gate.
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
}
const has = key => root.root.findAll(x => x.props[key] !== undefined).length > 0;
async function pickFiles() {
  const input = root.root.findAllByType('input').find(x => x.props['data-imp-file'] !== undefined);
  const files = ['A-first.csv', 'A-second.csv'].map(name => new File(['date,amount\n2026-05-10,10'], name, { type: 'text/csv' }));
  await act(async () => { input.props.onChange({ target: { files, value: '' } }); });
}
async function readyFiles(server) {
  await mount('/business/bank-import');
  await pickFiles();
  await until(() => root.root.findAll(x => x.props['data-imp-item'] === 'read').length === 2, 'both files must be read');
  assert.equal(server.calls.filter(x => x.stage === 'read').length, 2);
}
function assertNoB(server) {
  assert.equal(server.calls.filter(x => x.id === B).length, 0, 'old A process must never write in B');
}

for (const stage of ['init', 'storage', 'complete', 'read']) {
  test(`multi-file upload stops when company changes during ${stage}`, async () => {
    const server = importServer({ hold: stage });
    await mount('/business/bank-import');
    await pickFiles();
    await until(() => server.gate.release, `${stage} must be held`);
    const count = server.calls.length;
    await switchTo(B);
    await act(async () => server.gate.release());
    await settle();
    assertNoB(server);
    assert.equal(server.calls.length, count, 'no subsequent upload/read step after switch');
    assert.equal(has('data-imp-item'), false, 'A files must not appear in B');
  });
}

test('switch A → B → A cannot revive the old multi-file process', async () => {
  const server = importServer({ hold: 'storage' });
  await mount('/business/bank-import'); await pickFiles();
  await until(() => server.gate.release, 'storage must be held');
  const count = server.calls.length;
  await switchTo(B); await switchTo(A);
  await act(async () => server.gate.release()); await settle();
  assert.equal(server.calls.length, count);
  assert.equal(has('data-imp-item'), false);
});

test('unmount stops pending upload without completing a document', async () => {
  const server = importServer({ hold: 'storage' });
  await mount('/business/bank-import'); await pickFiles();
  await until(() => server.gate.release, 'storage must be held');
  const count = server.calls.length;
  await act(async () => root.unmount()); root = null;
  await act(async () => server.gate.release()); await settle();
  assert.equal(server.calls.length, count);
});

test('two files complete and are read in the original company', async () => {
  const server = importServer(); await readyFiles(server);
  assert.equal(server.calls.filter(x => x.stage === 'complete').length, 2);
  assert.ok(server.calls.filter(x => x.id).every(x => x.id === A));
});

test('duplicate upload uses existing company document and reads remaining files', async () => {
  const server = importServer({ duplicate: true }); await readyFiles(server);
  assert.equal(server.calls.filter(x => x.stage === 'complete').length, 1);
  assert.equal(server.calls.find(x => x.stage === 'read').body.document_id, 'existing-A');
  assertNoB(server);
});

test('upload failure is shown and remaining file still succeeds in same company', async () => {
  const server = importServer({ failFirst: true }); await mount('/business/bank-import'); await pickFiles();
  await until(() => root.root.findAll(x => x.props['data-imp-item'] === 'read').length === 1, 'second file must be read');
  assert.equal(root.root.findAll(x => x.props['data-imp-item'] === 'failed').length, 1);
  assertNoB(server);
});

for (const stage of ['batch', 'filing', 'suggest']) {
  test(`start import stops after company switch during ${stage}`, async () => {
    const server = importServer({ hold: stage }); await readyFiles(server);
    await click(root.root.findByProps({ 'data-imp-start': true }));
    await until(() => server.gate.release, `${stage} must be held`);
    const count = server.calls.length;
    await switchTo(B); await act(async () => server.gate.release()); await settle();
    assertNoB(server);
    assert.equal(server.calls.length, count, 'no filing/suggestion after switch');
    assert.equal(has('data-imp-file'), true, 'late A result must not navigate B into its batch');
    assert.equal(has('data-imp-confirm'), false);
  });
}

test('same-company start creates batch, files both documents and opens review', async () => {
  const server = importServer(); await readyFiles(server);
  await click(root.root.findByProps({ 'data-imp-start': true }));
  await until(() => has('data-imp-confirm'), 'review must open');
  assert.equal(server.calls.filter(x => x.stage === 'batch').length, 1);
  assert.equal(server.calls.filter(x => x.stage === 'filing').length, 2);
  assert.equal(server.calls.filter(x => x.stage === 'suggest').length, 1);
  assert.ok(server.calls.filter(x => x.id).every(x => x.id === A));
});

async function enableRule() {
  const row = root.root.findAll(x => x.props['data-imp-row'] === 'bank_fee')[0];
  assert.ok(row, 'bank fee must offer classification rule');
  await act(async () => row.findByType('select').props.onChange({ target: { value: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } }));
  const checkbox = root.root.findAllByType('input').find(x => x.props['data-imp-rule-save']!==undefined);
  assert.ok(checkbox);
  await act(async () => checkbox.props.onChange({ target: { checked: true } }));
}
for (const stage of ['rule', 'confirm']) {
  test(`confirm stops after company switch during ${stage}`, async () => {
    const server = importServer({ hold: stage }); await mount('/business/bank-import?batch=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    await until(() => has('data-imp-confirm'), 'review must open');
    await enableRule();
    await click(root.root.findByProps({ 'data-imp-confirm': true }));
    await until(() => server.gate.release, `${stage} must be held`);
    const count = server.calls.length;
    await switchTo(B); await act(async () => server.gate.release()); await settle();
    assertNoB(server);
    assert.equal(server.calls.length, count, 'no next mutation after switch');
    assert.equal(has('data-imp-done'), false, 'late A confirmation must not show success in B');
  });
}

test('same-company confirm saves rule and displays completed import', async () => {
  const server = importServer(); await mount('/business/bank-import?batch=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  await until(() => has('data-imp-confirm'), 'review must open'); await enableRule();
  await click(root.root.findByProps({ 'data-imp-confirm': true }));
  await until(() => has('data-imp-done'), 'done must open');
  assert.equal(server.calls.filter(x => x.stage === 'rule').length, 1);
  assert.equal(server.calls.filter(x => x.stage === 'confirm').length, 1);
  assert.ok(server.calls.every(x => x.id === A));
});

test('partial selection stays in review and confirms only remaining row with a fresh identity',async()=>{
 const server=importServer({partial:true});await mount('/business/bank-import?batch=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');await until(()=>has('data-imp-confirm'),'review opens');
 await act(async()=>root.root.findByProps({'data-imp-select':'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}).props.onChange({target:{checked:false}}));
 await click(root.root.findByProps({'data-imp-confirm':true}));await until(()=>root.root.findByProps({'data-imp-select':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}).props.disabled,'confirmed row becomes immutable');
 assert(!has('data-imp-done'));await act(async()=>root.root.findByProps({'data-imp-select':'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}).props.onChange({target:{checked:true}}));
 await click(root.root.findByProps({'data-imp-confirm':true}));await until(()=>has('data-imp-done'),'done after remaining row');
 const posts=server.calls.filter(x=>x.stage==='confirm');assert.equal(posts.length,2);assert.deepEqual(posts[0].body.rows.map(r=>r.row_id),['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);assert.deepEqual(posts[1].body.rows.map(r=>r.row_id),['dddddddd-dddd-4ddd-8ddd-dddddddddddd']);assert.notEqual(posts[0].body.request_key,posts[1].body.request_key);assert.notEqual(posts[0].body.review_hash,posts[1].body.review_hash);
});

test('committed response loss survives page remount; recovery checks own original receipt without another POST',async()=>{
 const server=importServer({dropConfirm:true});await mount('/business/bank-import?batch=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');await until(()=>has('data-imp-confirm'),'review opens');await click(root.root.findByProps({'data-imp-confirm':true}));await settle();assert(!has('data-imp-done'));
 await act(async()=>root.unmount());root=null;await mount('/business/bank-import?batch=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');await until(()=>has('data-imp-recover'),'pending recovery retained after reload');await click(root.root.findByProps({'data-imp-recover':true}));await until(()=>has('data-imp-done'),'own committed result accepted');assert.equal(server.calls.filter(x=>x.stage==='confirm').length,1);const posts=server.calls.filter(x=>x.stage==='confirm');assert(server.calls.filter(x=>x.stage==='receipt').every(x=>x.p.endsWith(posts[0].body.request_key)));
});

test('readonly reviewed membership disables confirmation and refuses programmatic submission',async()=>{
 const server=importServer({canConfirm:false});await mount('/business/bank-import?batch=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');await until(()=>has('data-imp-confirm'),'review opens');const button=root.root.findByProps({'data-imp-confirm':true});assert(button.props.disabled);await click(button);await settle();assert.equal(server.calls.filter(x=>x.stage==='confirm').length,0);
});

test('opening correction is only an explicit part of confirm and uses historical80 instead of current60',async()=>{
 const server=importServer({knownOpening:true});await mount('/business/bank-import?batch=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');await until(()=>has('data-imp-opening'),'dated opening control opens');assert.equal(root.root.findByProps({'data-imp-opening':true}).props.checked,false);
 await act(async()=>root.root.findByProps({'data-imp-opening':true}).props.onChange({target:{checked:true}}));assert(root.root.findByProps({'data-imp-confirm':true}).props.disabled);await act(async()=>root.root.findByProps({'data-imp-opening-reason':true}).props.onChange({target:{value:'STAGE explicit opening reason'}}));await click(root.root.findByProps({'data-imp-confirm':true}));await until(()=>has('data-imp-done'),'done');const posts=server.calls.filter(x=>x.stage==='confirm');assert.equal(posts.length,1);assert.deepEqual(posts[0].body.opening,{expected_historical_opening:'80',target_opening:'100',reason:'STAGE explicit opening reason'});assert(!server.calls.some(x=>x.p.includes('adjust-balance')));
});
