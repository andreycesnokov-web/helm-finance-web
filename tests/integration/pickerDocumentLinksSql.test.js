'use strict';
// Existing document RPC contracts over full-schema embedded PostgreSQL.
// No HTTP/Auth/Storage or independent-session race certification.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite'),{randomUUID}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');let db,doc,tx,other,biz,actor=99401;
before(async()=>{
 db=new PGlite();await db.waitReady;const root=path.resolve(__dirname,'../..');
 await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;');
 await db.exec(fs.readFileSync(path.join(root,'tests/fixtures/schema/prod_public_schema_2026-10-08.sql'),'utf8'));
 for(const m of require('./_integratedSchemaDb').migrations)await db.exec(fs.readFileSync(path.join(root,'migrations',m),'utf8'));
 await db.exec('SET search_path=public,pg_catalog');
 biz=randomUUID();const foreign=randomUUID(),file=randomUUID();doc=randomUUID();
 await db.query('INSERT INTO users(id) VALUES($1)',[actor]);
 await db.query("INSERT INTO businesses(id,name,owner_user_id,type) VALUES($1,'Synthetic document scope',$3,'business'),($2,'Other company',$3,'business')",[biz,foreign,actor]);
 await db.query("INSERT INTO document_files(id,business_id,storage_path,sha256_hash) VALUES($1,$2,'synthetic/invoice.pdf','synthetic-hash')",[file,biz]);
 await db.query("INSERT INTO financial_documents(id,business_id,file_id,document_type) VALUES($1,$2,$3,'vendor_invoice')",[doc,biz,file]);
 tx=(await db.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,scope) VALUES($1,$2,'income',100,100,'IDR','business') RETURNING id",[biz,actor])).rows[0].id;
 other=(await db.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,scope) VALUES($1,$2,'income',100,100,'IDR','business') RETURNING id",[foreign,actor])).rows[0].id;
});
after(async()=>await db?.close());
const link=id=>db.query("SELECT rpc_document_link($1,$2,'transaction',$3,$4) id",[doc,biz,String(id),actor]);
test('link/readback/duplicate/unlink keep original ledger byte-for-byte and audit commits with the link',async()=>{
 const before=(await db.query('SELECT jsonb_agg(to_jsonb(t) ORDER BY id) rows FROM transactions t')).rows[0].rows;
 const id=(await link(tx)).rows[0].id;
 assert.equal((await db.query('SELECT count(*)::int n FROM document_transaction_links WHERE document_id=$1',[doc])).rows[0].n,1);
 assert.equal((await db.query("SELECT count(*)::int n FROM document_audit WHERE document_id=$1 AND action='linked'",[doc])).rows[0].n,1);
 await assert.rejects(link(tx),/duplicate key|unique/);
 await db.query('SELECT rpc_document_unlink($1,$2,$3,$4)',[id,doc,biz,actor]);
 assert.equal((await db.query('SELECT count(*)::int n FROM document_transaction_links WHERE document_id=$1',[doc])).rows[0].n,0);
 assert.deepEqual((await db.query('SELECT jsonb_agg(to_jsonb(t) ORDER BY id) rows FROM transactions t')).rows[0].rows,before);
});
test('cross-company target and audit failure cannot leave a link behind',async()=>{
 await assert.rejects(link(other),/cross-business/);
 await db.exec("CREATE FUNCTION synthetic_doc_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic_audit_failure';END$$;CREATE TRIGGER synthetic_doc_audit BEFORE INSERT ON document_audit FOR EACH ROW EXECUTE FUNCTION synthetic_doc_audit_failure();");
 try{await assert.rejects(link(tx),/synthetic_audit_failure/);assert.equal((await db.query('SELECT count(*)::int n FROM document_transaction_links WHERE document_id=$1',[doc])).rows[0].n,0)}
 finally{await db.exec('DROP TRIGGER synthetic_doc_audit ON document_audit;DROP FUNCTION synthetic_doc_audit_failure()')}
});
