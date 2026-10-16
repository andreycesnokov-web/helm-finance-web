'use strict';
// Every /api route the server registers must be classified by the billing route policy, so a new endpoint
// cannot silently bypass plan enforcement. Also pins the policy of the commercially managed modules.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {classify}=require('../server/lib/billingRoutes');

const ROOT=path.join(__dirname,'..','server');
const files=[];
(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
 if(e.isDirectory()&&e.name!=='node_modules')walk(p);else if(/\.(c?js|mjs)$/.test(e.name))files.push(p)}})(ROOT);
const routes=[];
for(const f of files){
 const src=fs.readFileSync(f,'utf8');
 for(const m of src.matchAll(/app\.(get|post|put|patch|delete)\(\s*(['"`])(\/api\/[^'"`]*)\2/g))routes.push({method:m[1].toUpperCase(),path:m[3],file:path.relative(ROOT,f)});
 // Routes registered in a loop: app.post('/api/billing/'+path, ...)
 for(const m of src.matchAll(/app\.(get|post|put|patch|delete)\(\s*'(\/api\/[^']*\/)'\s*\+/g))routes.push({method:m[1].toUpperCase(),path:m[2]+'x',file:path.relative(ROOT,f)});
}
const sample=p=>p.replace(/\$\{[^}]+\}/g,'x').replace(/:[A-Za-z_]+/g,'00000000-0000-4000-8000-000000000000');

test('the server registers routes (sanity)',()=>assert.ok(routes.length>250,String(routes.length)));
test('every registered /api route is explicitly classified by the billing route policy',()=>{
 const missing=routes.filter(r=>!classify(r.method,sample(r.path)).classified).map(r=>`${r.method} ${r.path} (${r.file})`);
 assert.deepEqual(missing,[],'unclassified routes:\n'+missing.join('\n'));
});
test('own data stays open: reads, document download, export package, recovery, D4 repair',()=>{
 for(const [m,p] of [['GET','/api/transactions'],['GET','/api/wallets/1/transactions'],['GET','/api/debts'],['GET','/api/documents/1'],['POST','/api/documents/1/signed-url'],
  ['GET','/api/accountant/operation-documents/package'],['GET','/api/accountant/obligations'],['GET','/api/accountant/tax-calendar'],['GET','/api/pulse'],
  ['GET','/api/financial-operations/recent'],['POST','/api/wallets/1/reanchor-opening'],['GET','/api/bank-import/batches'],['GET','/api/billing'],['POST','/api/billing/plan']]){
  const c=classify(m,p);assert.equal(c.open,true,`${m} ${p}`);
 }
});
test('commercially managed modules are enforced on the server',()=>{
 const f=(m,p)=>classify(m,p);
 assert.deepEqual(f('POST','/api/transactions/batch').features,['transactions']);assert.equal(f('POST','/api/transactions/batch').resource,'transactions');
 assert.deepEqual(f('POST','/api/wallets').features,['accounts']);assert.equal(f('POST','/api/wallets/transfer').resource,'transactions');
 assert.deepEqual(f('POST','/api/debts').features,['bills']);assert.deepEqual(f('PATCH','/api/debts/1/approve').features,['bills','approvals']);
 assert.deepEqual(f('POST','/api/ai-cfo/ask').features,['cfo_ai','ai']);assert.deepEqual(f('GET','/api/ai-cfo/context').features,['cfo_ai']);
 assert.deepEqual(f('POST','/api/accountant/ask').features,['ai_accountant','ai']);assert.deepEqual(f('GET','/api/ai-accountant/document-intake').features,['ai_accountant']);
 assert.deepEqual(f('POST','/api/tax-split/suggest').features,['tax_compliance']);assert.deepEqual(f('GET','/api/accountant/tax-knowledge/cards').features,['tax_compliance']);
 assert.deepEqual(f('POST','/api/accountant/operation-documents/action').features,['accounting_export']);
 assert.equal(f('POST','/api/payment-connections').resource,'integrations');assert.deepEqual(f('PATCH','/api/incoming-payments/1/status').features,['integrations']);
 assert.deepEqual(f('GET','/api/pulse/advanced-insights').features,['radar']);
 assert.equal(f('POST','/api/documents/upload-init').resource,'documents');assert.equal(typeof f('POST','/api/documents/upload-init').storage,'function');
 assert.equal(f('POST','/api/bank-imports/1/confirm').units,'import_rows');assert.equal(f('POST','/api/bank-import/batches/1/confirm').units,'import_rows');
 assert.equal(f('POST','/api/telegram/debts/1/approve').channel,'telegram');
});
test('an unknown write is not open (needs an active plan) and is flagged as unclassified',()=>{
 const c=classify('POST','/api/some-future-endpoint');assert.equal(c.classified,false);assert.deepEqual(c.features,[]);assert.equal(c.open,undefined);
 assert.equal(classify('GET','/api/some-future-endpoint').open,true,'reads stay open even when unclassified');
});
