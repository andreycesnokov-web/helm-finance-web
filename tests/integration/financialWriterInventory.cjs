'use strict';
// Static inventory, not a proof of reachability/locking. Include dynamic targets
// and parse errors rather than silently dropping them. Requires npm ci in client.
const fs=require('node:fs'),path=require('node:path');
const parser=require('../../client/node_modules/@babel/parser');
const root=path.resolve(__dirname,'../..'),writes=[],sql=[],parseErrors=[];
const walk=(n,f,parents=[])=>{if(!n||typeof n!=='object')return;f(n,parents);for(const [k,v] of Object.entries(n)){if(k==='loc')continue;if(Array.isArray(v))v.forEach(x=>walk(x,f,[n,...parents]));else if(v?.type)walk(v,f,[n,...parents])}};
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)])}
function tableOf(n){if(!n)return null;if(n.type==='CallExpression'&&n.callee?.property?.name==='from')return n.arguments[0]?.value||'<dynamic>';return tableOf(n.object||n.callee)||(n.arguments||[]).map(tableOf).find(Boolean)}
for(const file of files(path.join(root,'server')).filter(f=>f.endsWith('.js'))){
 let ast;try{ast=parser.parse(fs.readFileSync(file,'utf8'),{sourceType:'unambiguous'})}catch(e){parseErrors.push({file:path.relative(root,file),error:e.message});continue}
 walk(ast,(n,parents)=>{
  if(n.type!=='CallExpression')return;const action=n.callee?.property?.name;
  if(!['insert','update','delete','upsert','rpc'].includes(action))return;
  const table=action==='rpc'?null:tableOf(n.callee.object);if(action!=='rpc'&&!table&&n.callee.object?.type!=='Identifier')return;
  const route=parents.find(p=>p.type==='CallExpression'&&p.callee?.object?.name==='app'&&['get','post','put','patch','delete'].includes(p.callee.property?.name));
  const fn=parents.find(p=>['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(p.type));
  writes.push({file:path.relative(root,file).replaceAll('\\','/'),line:n.loc.start.line,path:route?`${route.callee.property.name.toUpperCase()} ${route.arguments[0]?.value||'<dynamic>'}`:`helper:${fn?.id?.name||'<anonymous>'}`,action,table:table|| (action!=='rpc'?'<indirect:'+n.callee.object.name+'>':null),rpc:action==='rpc'?n.arguments[0]?.value||'<dynamic>':null});
 });
}
for(const file of files(path.join(root,'migrations')).filter(f=>f.endsWith('.sql'))){
 const text=fs.readFileSync(file,'utf8');let current=null;
 text.split(/\r?\n/).forEach((line,i)=>{const fn=line.match(/CREATE(?: OR REPLACE)? FUNCTION\s+(?:public\.)?(\w+)/i);if(fn)current=fn[1];if(/FOR UPDATE|fn_ledger_writer_lock|INSERT INTO|DELETE FROM|^\s*UPDATE\s/i.test(line))sql.push({file:path.relative(root,file).replaceAll('\\','/'),line:i+1,function:current,text:line.trim()})});
}
const out=path.resolve(process.argv[2]||'writer-inventory.json');
fs.writeFileSync(out,JSON.stringify({kind:'static_inventory_not_execution_proof',parseErrors,serverWrites:writes,sqlLockWriteMentions:sql},null,2)+'\n');
console.log(JSON.stringify({out,serverWrites:writes.length,sqlMentions:sql.length,parseErrors}));
if(parseErrors.length)process.exitCode=1;
