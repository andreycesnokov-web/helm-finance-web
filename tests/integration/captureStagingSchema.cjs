'use strict';
// Explicit READONLY_CATALOG_URL required; never runs migration or data-repair SQL.
const fs=require('fs'),path=require('path'),{Client}=require('pg');
const url=process.env.READONLY_CATALOG_URL;if(!url)throw Error('Provide a separately authorized read-only catalog connection');
const file=path.resolve(process.argv[2]||'schema-catalog.json'),sql=fs.readFileSync(path.join(__dirname,'stagingSchemaCatalog.sql'),'utf8');
const client=new Client({connectionString:url,connectionTimeoutMillis:4000,query_timeout:25000});const history=[];
client.on('notice',n=>{if(n.message.startsWith('CFO_HISTORY_JSON='))history.push(JSON.parse(n.message.slice('CFO_HISTORY_JSON='.length)))});
(async()=>{try{await client.connect();const results=await client.query(sql),entries=results.flatMap(r=>r.rows||[]);
 const runtime=entries.find(r=>r.category==='runtime')?.item;if(runtime?.transaction_read_only!=='on')throw Error('Read-only transaction not confirmed');
 fs.writeFileSync(file,JSON.stringify({kind:'read_only_full_scoped_catalog_not_data_or_JWT_RLS_acceptance',captured_at_utc:new Date().toISOString(),runtime,entries,history},null,2)+'\n');
 console.log(JSON.stringify({status:'captured',file,entries:entries.length,postgres:runtime.postgres}));
}finally{await client.query('ROLLBACK').catch(()=>{});await client.end().catch(()=>{})}})().catch(e=>{console.error({status:'not_verified',code:e.code||null,message:e.message});process.exitCode=1});
