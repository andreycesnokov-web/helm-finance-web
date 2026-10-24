'use strict';
// Native PG only. Fresh disposable DB; inherited guard rejects known shared clusters.
// Per-company P&L group of shared system categories (20261024120000) on the production-schema baseline.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {Client}=require('pg'),{randomUUID}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {createProdSchemaDatabase}=require('./_prodSchemaDb');
const {assertDisposableUrl}=require('./_disposableDbGuard');
let db,c;const root=path.resolve(__dirname,'../..');let uid=99800;
const sql=f=>fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8');
const FORWARD='20261024120000_business_category_pnl_groups.sql',DOWN='20261024120000_business_category_pnl_groups_down.sql';
before(async()=>{
 assert.ok(process.env.DATABASE_URL,'Set the confirmed disposable local DATABASE_URL explicitly');
 assertDisposableUrl(process.env.DATABASE_URL,{adminOnly:true});
 const H=require('./_d4Harness');
 db=await createProdSchemaDatabase('hf_pnl_system_map',[...H.CHAIN,H.D4]);
 if(!db)throw Error('Native PostgreSQL unavailable; no mapping proof');
 c=new Client({connectionString:db.connectionString,connectionTimeoutMillis:3000});await c.connect();
 await c.query("SET statement_timeout='8s';SET lock_timeout='6s'");
 await c.query(sql(FORWARD));
});
after(async()=>{await c?.query('ROLLBACK').catch(()=>{});await c?.end();if(db)await db.drop()});
async function company(){const b=randomUUID(),u=++uid;
 await c.query('INSERT INTO users(id) VALUES($1)',[u]);
 await c.query("INSERT INTO businesses(id,name,owner_user_id,type) VALUES($1,'Synthetic company',$2,'business')",[b,u]);return {b,u}}
async function systemCategory(name){return (await c.query("INSERT INTO cashflow_categories(id,name,group_type,is_system,business_id) VALUES($1,$2,'outflow',true,NULL) RETURNING id",[randomUUID(),name])).rows[0].id}
const map=(b,cat,g,u=null)=>c.query('INSERT INTO business_category_pnl_groups(business_id,category_id,pnl_group,confirmed_by_user_id) VALUES($1,$2,$3,$4)',[b,cat,g,u]);

test('two companies map the same system category differently; the shared row keeps no group',async()=>{
 const A=await company(),Bc=await company(),rent=await systemCategory('Shared rent '+randomUUID());
 await map(A.b,rent,'operating_cost',A.u);await map(Bc.b,rent,'direct_cost',Bc.u);
 const rows=(await c.query('SELECT business_id,pnl_group FROM business_category_pnl_groups WHERE category_id=$1 ORDER BY pnl_group',[rent])).rows;
 assert.deepEqual(rows.map(r=>[r.business_id,r.pnl_group]),[[Bc.b,'direct_cost'],[A.b,'operating_cost']]);
 assert.equal((await c.query('SELECT pnl_group FROM cashflow_categories WHERE id=$1',[rent])).rows[0].pnl_group,null);
 // The existing guard still forbids writing a group on the shared row itself.
 await assert.rejects(c.query("UPDATE cashflow_categories SET pnl_group='revenue' WHERE id=$1",[rent]),/pnl_group_business_chk/);
});
test('a company category, an unknown category and an invalid group are refused; one row per company and category',async()=>{
 const A=await company(),rent=await systemCategory('Shared rent '+randomUUID());
 const own=(await c.query("INSERT INTO cashflow_categories(id,name,group_type,is_system,business_id) VALUES($1,'Own rent','outflow',false,$2) RETURNING id",[randomUUID(),A.b])).rows[0].id;
 await assert.rejects(map(A.b,own,'operating_cost'),/pnl_system_mapping_requires_system_category/);
 await assert.rejects(map(A.b,randomUUID(),'operating_cost'),/pnl_system_mapping_requires_system_category|foreign key/);
 await assert.rejects(map(A.b,rent,'profit'),/check constraint/);
 await map(A.b,rent,'operating_cost');await assert.rejects(map(A.b,rent,'tax'),/duplicate key/);
 await c.query("UPDATE business_category_pnl_groups SET pnl_group='tax' WHERE business_id=$1 AND category_id=$2",[A.b,rent]);
 assert.equal((await c.query('SELECT pnl_group FROM business_category_pnl_groups WHERE business_id=$1',[A.b])).rows[0].pnl_group,'tax');
});
test('only service_role may read or write; anon and authenticated get nothing',async()=>{
 for(const role of ['anon','authenticated']){
  const r=(await c.query("SELECT has_table_privilege($1,'public.business_category_pnl_groups','SELECT') s,has_table_privilege($1,'public.business_category_pnl_groups','INSERT') i",[role])).rows[0];
  assert.deepEqual([r.s,r.i],[false,false],role);
 }
 assert.equal((await c.query("SELECT has_table_privilege('service_role','public.business_category_pnl_groups','INSERT') i")).rows[0].i,true);
 assert.equal((await c.query("SELECT relrowsecurity r FROM pg_class WHERE oid='public.business_category_pnl_groups'::regclass")).rows[0].r,true);
});
test('removing a company removes only its mappings; rollback drops the table and is re-appliable',async()=>{
 const A=await company(),Bc=await company(),rent=await systemCategory('Shared rent '+randomUUID());
 await map(A.b,rent,'operating_cost');await map(Bc.b,rent,'direct_cost');
 await c.query('DELETE FROM businesses WHERE id=$1',[A.b]);
 assert.deepEqual((await c.query('SELECT business_id FROM business_category_pnl_groups WHERE category_id=$1',[rent])).rows.map(r=>r.business_id),[Bc.b]);
 await assert.rejects(c.query(sql(FORWARD)),/already_installed/);await c.query('ROLLBACK');
 await c.query(sql(DOWN));
 assert.equal((await c.query("SELECT to_regclass('public.business_category_pnl_groups')::text r")).rows[0].r,null);
 assert.equal((await c.query('SELECT count(*)::int n FROM cashflow_categories WHERE id=$1',[rent])).rows[0].n,1,'rollback touches no category');
 await c.query(sql(FORWARD));
 assert.notEqual((await c.query("SELECT to_regclass('public.business_category_pnl_groups')::text r")).rows[0].r,null);
});
