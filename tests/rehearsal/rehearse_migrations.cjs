'use strict';
const fs = require('fs');
const { Client } = require('pg');
const { secrets, PORTS } = require('./env.cjs');
const S = secrets();

(async () => {
  const pg = new Client({ connectionString: `postgresql://postgres:${S.db_password}@127.0.0.1:${PORTS.db}/postgres` });
  await pg.connect();

  console.log('--- Testing Down Migration ---');
  await pg.query("SET cfo.confirm_down = '20261018130000'");
  const downSql = fs.readFileSync('supabase/migrations/20261018130000_billing_published_matrix_sync_down.sql', 'utf8');
  await pg.query(downSql);
  console.log('Down migration executed successfully.');

  const verCheck = await pg.query("SELECT * FROM public.billing_schema_versions WHERE version='20261018130000'");
  if (verCheck.rows.length === 0) {
    console.log('Verified: 20261018130000 removed from schema versions.');
  }

  console.log('--- Re-applying Up Migration ---');
  const upSql = fs.readFileSync('supabase/migrations/20261018130000_billing_published_matrix_sync.sql', 'utf8');
  await pg.query(upSql);
  console.log('Up migration re-applied successfully.');

  const verCheck2 = await pg.query("SELECT * FROM public.billing_schema_versions WHERE version='20261018130000'");
  if (verCheck2.rows.length === 1) {
    console.log('Verified: 20261018130000 recorded in schema versions.');
  }

  await pg.end();
})();
