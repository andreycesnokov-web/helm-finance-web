'use strict';
// Only an explicitly provided disposable loopback admin instance. Never live data.
const {Client}=require('pg'),{randomBytes}=require('node:crypto');
const input=process.env.DATABASE_URL;
if(!input||!['localhost','127.0.0.1','[::1]'].includes(new URL(input).hostname))throw Error('Use an explicitly disposable loopback instance');
const name='cfo_acceptance_probe_'+randomBytes(6).toString('hex');
const admin=new Client({connectionString:input,connectionTimeoutMillis:4000,query_timeout:5000});
let created=false,a,b;const evidence={node:process.version,status:'not_verified',steps:[]};
(async()=>{try{
 await admin.connect();const version=(await admin.query("SELECT version() version,current_setting('server_version_num')::int version_num")).rows[0];
 if(Math.floor(version.version_num/10000)!==17)throw Error('Requires PostgreSQL17');evidence.postgres=version;
 await admin.query(`CREATE DATABASE ${name}`);created=true;evidence.steps.push('created_owned_disposable_database');
 const target=new URL(input);target.pathname='/'+name;
 a=new Client({connectionString:target.toString(),connectionTimeoutMillis:4000,query_timeout:5000});
 b=new Client({connectionString:target.toString(),connectionTimeoutMillis:4000,query_timeout:5000});await Promise.all([a.connect(),b.connect()]);
 const pids=await Promise.all([a,b].map(c=>c.query('SELECT pg_backend_pid() pid')));
 if(pids[0].rows[0].pid===pids[1].rows[0].pid)throw Error('Independent sessions not established');
 evidence.backend_pids=pids.map(r=>r.rows[0].pid);evidence.steps.push('two_simultaneous_independent_sessions');
 await a.query('CREATE TABLE probe(v integer NOT NULL)');
 await a.query('BEGIN;INSERT INTO probe VALUES(1);ROLLBACK');
 if(Number((await b.query('SELECT count(*) n FROM probe')).rows[0].n)!==0)throw Error('Rollback failed');
 await a.query('BEGIN;INSERT INTO probe VALUES(2);COMMIT');
 if(Number((await b.query('SELECT count(*) n FROM probe')).rows[0].n)!==1)throw Error('Commit visibility failed');
 evidence.steps.push('rollback_and_commit_visible_on_second_session');evidence.status='verified';
}catch(e){evidence.error={code:e.code||null,message:e.message};process.exitCode=1;
}finally{
 await a?.end().catch(()=>{});await b?.end().catch(()=>{});
 if(created){try{await admin.query(`DROP DATABASE ${name}`);evidence.steps.push('dropped_only_owned_database')}catch(e){evidence.status='cleanup_failed';evidence.cleanup_error={code:e.code||null,message:e.message};process.exitCode=1}}
 await admin.end().catch(()=>{});console.log(JSON.stringify(evidence,null,2));
}})();
