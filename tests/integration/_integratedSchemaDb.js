'use strict';
const { createProdSchemaDatabase } = require('./_prodSchemaDb');
const migrations = ['069_bank_import_atomic_confirm.sql', '070_atomic_business_balance.sql',
  '071_financial_records_restrict_user_delete.sql', '20261010143341_import_balance_compat.sql',
  '20261011001823_financial_writer_protocol.sql'];
async function createIntegratedDatabase(prefix) {
  const input = process.env.DATABASE_URL;
  if (!input || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(input).hostname)) {
    throw Error('DATABASE_URL must be a local disposable PostgreSQL admin database');
  }
  const db = await createProdSchemaDatabase(prefix, migrations);
  if (!db) throw Error('Real PostgreSQL required; this suite never skips');
  return db;
}
module.exports = { createIntegratedDatabase, migrations };
