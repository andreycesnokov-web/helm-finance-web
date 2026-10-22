'use strict';
const fs=require('fs'),path=require('path'),{spawn,spawnSync}=require('child_process');
const evidence='/evidence',jobs=[],base=process.env.BASE_URL;
const redact=s=>{for(const[k,v]of Object.entries(process.env))if(v&&/SECRET|PASSWORD|KEY|TOKEN/.test(k)&&v.length>8)s=s.split(v).join('[REDACTED]');return s.replace(/eyJ[A-Za-z0-9_.-]+/g,'[JWT REDACTED]').replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]');};
const child=spawn(process.execPath,['/candidate/tests/integration/unifiedRc/test-entry.cjs'],{cwd:'/candidate',stdio:['ignore','pipe','pipe']});
const log=fs.createWriteStream(path.join(evidence,'app.log'));for(const stream of [child.stdout,child.stderr])stream.on('data',b=>log.write(redact(b.toString())));
const save=()=>fs.writeFileSync(path.join(evidence,'SESSION_RESULTS.json'),JSON.stringify({sha:process.env.CFO_RC_SHA,node:process.version,finished:false,jobs},null,2));
async function ready(){for(let i=0;i<40;i++){if(child.exitCode!==null)throw Error('Native candidate exited during startup');try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}await new Promise(r=>setTimeout(r,300));}throw Error('Native candidate health timeout');}
function run(name,file){const r=spawnSync(process.execPath,[file],{cwd:'/candidate',encoding:'utf8',maxBuffer:15e6,timeout:210000});const output=redact((r.stdout||'')+(r.stderr||''));fs.writeFileSync(path.join(evidence,name+'.log'),output);jobs.push({name,exit:r.status,ok:r.status===0,error:r.error?.code||null});save();console.log(JSON.stringify(jobs.at(-1)));}
(async()=>{await ready();save();
 run('admission','/candidate/tests/integration/rcAcceptance/admit-http.cjs');
 if(jobs.at(-1).ok){
  run('picker-http','/candidate/tests/integration/rcAcceptance/picker-http.cjs');
  run('payroll-http','/candidate/tests/integration/rcAcceptance/payroll-http.cjs');
  run('picker-payroll-browser','/candidate/tests/integration/rcAcceptance/browser-native.cjs');
  run('combined-native','/candidate/tests/integration/unifiedRc/native.cjs');
  run('combined-browser','/candidate/tests/integration/unifiedRc/browser.cjs');
 }
 fs.writeFileSync(path.join(evidence,'SESSION_RESULTS.json'),JSON.stringify({sha:process.env.CFO_RC_SHA,node:process.version,finished:true,paid_providers_disabled:true,jobs,ok:jobs.every(x=>x.ok)},null,2));
 process.exitCode=jobs.every(x=>x.ok)?0:1;
})().catch(e=>{fs.writeFileSync(path.join(evidence,'SESSION_FATAL.json'),JSON.stringify({error:redact(e.message),jobs}));process.exitCode=1;}).finally(()=>{child.once('close',()=>log.end());child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),1500).unref();});
