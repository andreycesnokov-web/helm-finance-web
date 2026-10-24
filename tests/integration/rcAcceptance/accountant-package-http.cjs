'use strict';
// Real stack: the accountant package's sources are company-scoped. An outsider, or a member of ANOTHER company,
// cannot read this company's registers' sources or the original file bytes; unauthenticated requests are refused;
// the original bytes come only as a download (attachment + nosniff); each read is audited without file contents.
// Env: PKG_EMAIL, PKG_PASSWORD, PKG_BIZ (the company under test) and the admitted session (C.other / C.foreign
// = another company and its owner). Synthetic data only.
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg');
const C=JSON.parse(fs.readFileSync('/tmp/acceptance-session.json')),db=new Client({connectionString:process.env.DATABASE_URL}),results=[];
const BIZ=process.env.PKG_BIZ;
const pass=(name,extra={})=>{results.push({case:name,status:'PASS',...extra});fs.writeFileSync('/evidence/ACCOUNTANT_PACKAGE_HTTP.json',JSON.stringify({candidate:process.env.CFO_RC_SHA||'unrecorded',results},null,2));console.log('PASS '+name)};
const call=async(path,{token,biz,raw=false}={})=>{const r=await fetch(process.env.BASE_URL+'/api'+path,{headers:{...(token?{authorization:'Bearer '+token}:{}),...(biz?{'x-business-id':biz}:{})},signal:AbortSignal.timeout(20000)});return {status:r.status,headers:r.headers,body:raw?Buffer.from(await r.arrayBuffer()):await r.json().catch(()=>null)}};
const SOURCES=['/payroll/runs','/business-funding','/pulse/profit-loss?month=2026-09&currency=IDR&months=2026-07,2026-08,2026-09','/accountant/profile','/accountant/operation-documents/package?month=2026-09','/transactions?period=all','/debts','/documents','/wallets'];
(async()=>{
 assert.ok(BIZ&&process.env.PKG_EMAIL&&process.env.PKG_PASSWORD,'PKG_EMAIL, PKG_PASSWORD and PKG_BIZ are required');
 await db.connect();assert.equal((await db.query('SELECT system_identifier::text id FROM pg_control_system()')).rows[0].id,C.cluster);
 const login=await fetch(process.env.BASE_URL+'/api/auth/password/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:process.env.PKG_EMAIL,password:process.env.PKG_PASSWORD})});
 const owner=(await login.json()).token;assert.ok(owner,'owner sign-in');
 for(const s of SOURCES)assert.equal((await call(s,{token:owner,biz:BIZ})).status,200,'owner reads '+s);
 const doc=(await db.query("SELECT d.id FROM financial_documents d WHERE d.business_id=$1 AND d.archived_at IS NULL ORDER BY d.created_at LIMIT 1",[BIZ])).rows[0].id;
 const own=await call(`/documents/${doc}/content?purpose=accountant_package`,{token:owner,biz:BIZ,raw:true});
 assert.equal(own.status,200);assert.equal(own.headers.get('content-type'),'application/octet-stream');assert.match(own.headers.get('content-disposition')||'',/^attachment; filename="[A-Za-z0-9._-]+"$/);
 assert.equal(own.headers.get('x-content-type-options'),'nosniff');assert.match(own.headers.get('cache-control')||'',/no-store/);
 const sha=(await db.query('SELECT f.sha256_hash FROM financial_documents d JOIN document_files f ON f.id=d.file_id WHERE d.id=$1',[doc])).rows[0].sha256_hash;
 assert.equal(require('node:crypto').createHash('sha256').update(own.body).digest('hex'),sha);
 pass('the owner reads every package source; an original comes as an unchanged download (attachment, nosniff, no-store)',{sources:SOURCES.length});
 // Unauthenticated.
 for(const s of [...SOURCES,`/documents/${doc}/content?purpose=accountant_package`])assert.equal((await call(s,{biz:BIZ})).status,401,'no token: '+s);
 pass('without a sign-in every source and the original bytes are refused (401)');
 // An outsider with this company's id in the header.
 const email='pkg.outsider.'+Date.now()+'@example.invalid';
 const st=await (await fetch(process.env.BASE_URL+'/api/auth/email/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email})})).json();
 const outsider=(await (await fetch(process.env.BASE_URL+'/api/auth/email/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,code:st.dev_code})})).json()).token;
 for(const s of [...SOURCES,`/documents/${doc}/content?purpose=accountant_package`]){const r=await call(s,{token:outsider,biz:BIZ});assert.ok([403,404,409].includes(r.status),`outsider ${s}: ${r.status}`);}
 pass('a signed-in outsider naming this company is refused for every source and the original bytes');
 // The owner of ANOTHER company: their own scope never reaches this company's document.
 const foreign=await call(`/documents/${doc}/content?purpose=accountant_package`,{token:C.other.token,biz:C.foreign,raw:true});
 assert.ok([403,404].includes(foreign.status),'foreign company scope: '+foreign.status);
 const spoof=await call(`/documents/${doc}/content?purpose=accountant_package`,{token:C.other.token,biz:BIZ,raw:true});
 assert.ok([403,404,409].includes(spoof.status),'another company owner naming this company: '+spoof.status);
 pass('the owner of another company cannot fetch this company\'s original, in their own scope or by naming this company');
 // Audit: reads are logged with purpose and size only.
 const a=(await db.query("SELECT metadata FROM document_audit WHERE business_id=$1 AND document_id=$2 AND action='file_downloaded' ORDER BY id DESC LIMIT 1",[BIZ,doc])).rows[0].metadata;
 assert.deepEqual(Object.keys(a).sort(),['bytes','purpose']);assert.equal(a.purpose,'accountant_package');
 pass('every original read is audited with purpose and size only (no file name, no content)');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.end().catch(()=>{}));
