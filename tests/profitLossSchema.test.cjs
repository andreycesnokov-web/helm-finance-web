// Embedded PostgreSQL contract check, NOT native PG17/PostgREST acceptance.
// DDL comes from the committed schema fixture plus columns required by existing
// baseline migrations. Nothing is connected to or applied to an external DB.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite'),{TABLES,NAMES}=require('../server/lib/profitLossRoutes');
test('all read columns exist in baseline schema and numeric casts preserve text',async()=>{
 const db=new PGlite(),schema=fs.readFileSync('tests/fixtures/schema/prod_public_schema_2026-10-08.sql','utf8');
 try{
  for(const key of Object.keys(TABLES)){
   const name=NAMES[key]||key,ddl=schema.match(new RegExp('CREATE TABLE public\\.'+name+' \\([\\s\\S]*?\\n\\);'))?.[0];
   assert.ok(ddl,'Committed fixture must contain '+name);await db.exec(ddl);
  }
  // Existing baseline 070 / 20261013114500, test fixture adaptation ONLY.
  await db.exec(`ALTER TABLE transactions ADD COLUMN debt_payment_id bigint, ADD COLUMN is_opening_balance boolean, ADD COLUMN bank_import_row_id uuid, ADD COLUMN balance_version bigint;
    ALTER TABLE debts ADD COLUMN invoice_number text, ADD COLUMN bill_version bigint;`);
  for(const key of Object.keys(TABLES))await db.query(`SELECT ${TABLES[key]} FROM public.${NAMES[key]||key} WHERE business_id=$1 ORDER BY id LIMIT 500`,['b0000000-0000-4000-8000-000000000001']);
  const sourceRead=require('../server/lib/sourceRecordRead');
  for(const table of ['transactions','debts']){
   const columns=sourceRead.select(table,'1').replace(/exact_(\w+):(\w+)::text/g,'$2::text AS exact_$1');
   await db.query(`SELECT ${columns} FROM public.${table} WHERE business_id=$1 AND id=$2 LIMIT 1`,['b0000000-0000-4000-8000-000000000001','1']);
  }
  const r=await db.query(`SELECT 9007199254740993::numeric::text AS value`);assert.equal(r.rows[0].value,'9007199254740993');
  const v=await db.query('SELECT version()');console.log('Embedded SQL engine:',v.rows[0].version.split(' on ')[0]);
 }finally{await db.close();}
});
