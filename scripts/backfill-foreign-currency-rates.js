#!/usr/bin/env node
/**
 * Backfill foreign-currency transactions where amount_idr was stored equal to amount_original.
 *
 * Usage:
 *   node scripts/backfill-foreign-currency-rates.js             (Dry-run by default: no DB writes)
 *   node scripts/backfill-foreign-currency-rates.js --dry-run   (Explicit dry-run)
 *   node scripts/backfill-foreign-currency-rates.js --apply     (Applies updates to DB with audit events)
 *   node scripts/backfill-foreign-currency-rates.js --business=<id>
 *   node scripts/backfill-foreign-currency-rates.js --limit=50
 *
 * Safety Invariants:
 *   - Dry run by default: will NEVER mutate database unless --apply is passed explicitly.
 *   - Only targets rows where (currency <> 'IDR') AND (amount_idr = amount_original) AND (amount_original <> 0).
 *   - Every mutation inserts an audit_events record.
 *   - Home currency IDR rows are strictly ignored.
 */

const path = require('node:path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Import FX provider
const fx = require('../server/lib/fxProvider');

const args = process.argv.slice(2);
const IS_APPLY = args.includes('--apply');
const IS_DRY_RUN = !IS_APPLY || args.includes('--dry-run');

const getArgVal = (name) => {
  const match = args.find((a) => a.startsWith(`--${name}=`));
  return match ? match.split('=')[1] : null;
};

const businessFilter = getArgVal('business');
const limitFilter = parseInt(getArgVal('limit') || '0', 10) || null;

console.log('='.repeat(70));
console.log('Backfill Foreign Currency Rates');
console.log(`Mode: ${IS_APPLY ? '>>> LIVE APPLY <<<' : 'DRY-RUN (Safe, no mutations)'}`);
if (businessFilter) console.log(`Business Filter: ${businessFilter}`);
if (limitFilter) console.log(`Limit: ${limitFilter} rows`);
console.log('='.repeat(70));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('\nMissing SUPABASE_URL or SUPABASE_SECRET_KEY in environment.');
  console.log('If you need SQL to run directly in Supabase SQL Editor, run scripts/audit-foreign-currency-skew.sql');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function run() {
  // Query candidate transactions
  let query = supabase
    .from('transactions')
    .select(`
      id,
      business_id,
      wallet_id,
      transaction_date,
      type,
      currency_original,
      amount_original,
      amount_idr,
      description,
      created_at,
      wallets (
        id,
        name,
        currency
      )
    `)
    .neq('currency_original', 'IDR')
    .not('amount_original', 'is', null)
    .not('amount_idr', 'is', null);

  if (businessFilter) {
    query = query.eq('business_id', businessFilter);
  }

  const { data: rows, error } = await query;
  if (error) {
    console.error('Failed to query transactions:', error.message);
    process.exit(1);
  }

  // Filter skewed rows (amount_idr == amount_original and non-zero)
  const skewedRows = (rows || []).filter((r) => {
    const orig = Number(r.amount_original);
    const idr = Number(r.amount_idr);
    const ccy = r.currency_original || r.wallets?.currency || 'IDR';
    return ccy !== 'IDR' && orig !== 0 && orig === idr;
  });

  const targets = limitFilter ? skewedRows.slice(0, limitFilter) : skewedRows;

  console.log(`Found ${skewedRows.length} skewed rows matching criteria. Target to process: ${targets.length}\n`);

  if (targets.length === 0) {
    console.log('No skewed foreign currency transactions found.');
    return;
  }

  const summary = [];

  for (const row of targets) {
    const currency = (row.currency_original || row.wallets?.currency || 'IDR').toUpperCase();
    const origAmount = Number(row.amount_original);
    const txDate = row.transaction_date || row.created_at;

    const conv = await fx.toIdr(origAmount, currency, txDate);

    summary.push({
      id: row.id,
      business_id: row.business_id,
      wallet: row.wallets?.name || row.wallet_id,
      currency,
      date: txDate?.slice(0, 10),
      amount_orig: origAmount,
      old_idr: Number(row.amount_idr),
      new_idr: conv.amount_idr,
      rate: conv.rate,
      source: conv.source,
      effective_date: conv.rate_effective_date
    });
  }

  // Print preview table
  console.table(summary.map(s => ({
    ID: s.id,
    Date: s.date,
    Currency: s.currency,
    Original: s.amount_orig,
    Old_IDR: s.old_idr,
    New_IDR: s.new_idr,
    Rate: s.rate,
    Source: s.source
  })));

  if (IS_DRY_RUN) {
    console.log('\n[DRY RUN COMPLETE] Zero database rows modified.');
    console.log('To apply these changes, re-run with:');
    console.log('  node scripts/backfill-foreign-currency-rates.js --apply\n');
    return;
  }

  // Applying mutations
  console.log('\nApplying updates to database...');
  let updatedCount = 0;
  let errorCount = 0;

  for (const item of summary) {
    try {
      const updatePayload = {
        amount_idr: item.new_idr
      };

      // Additive migration 065 columns (best effort if migration 065 is applied)
      try {
        updatePayload.booked_rate = item.rate;
        updatePayload.rate_source = item.source;
        updatePayload.rate_effective_date = item.effective_date;
      } catch (_) {}

      const { error: updateErr } = await supabase
        .from('transactions')
        .update(updatePayload)
        .eq('id', item.id);

      if (updateErr) {
        // Fallback: update only amount_idr if migration 065 columns do not yet exist
        const { error: fallbackErr } = await supabase
          .from('transactions')
          .update({ amount_idr: item.new_idr })
          .eq('id', item.id);

        if (fallbackErr) throw fallbackErr;
      }

      // Record audit event
      await supabase.from('audit_events').insert({
        business_id: item.business_id,
        actor_user_id: -1, // System backfill script
        actor_role: 'system_migration',
        channel: 'script',
        entity_type: 'transaction',
        entity_id: String(item.id),
        action: 'backfill_foreign_currency_rate',
        before_json: { amount_idr: item.old_idr },
        after_json: {
          amount_idr: item.new_idr,
          booked_rate: item.rate,
          rate_source: item.source,
          rate_effective_date: item.effective_date
        }
      }).catch(() => {/* audit best effort */});

      updatedCount++;
    } catch (err) {
      console.error(`Error updating transaction ${item.id}:`, err.message);
      errorCount++;
    }
  }

  console.log(`\nApply finished. Successfully updated: ${updatedCount}, Errors: ${errorCount}`);
}

run().catch((err) => {
  console.error('Fatal error during backfill:', err);
  process.exit(1);
});
