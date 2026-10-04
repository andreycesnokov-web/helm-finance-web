#!/usr/bin/env node
/**
 * Read-Only Audit: Inspect historical debt repayments for currency mismatches.
 *
 * Usage:
 *   node scripts/auditDebtPaymentsCurrencyMismatch.js
 *   node scripts/auditDebtPaymentsCurrencyMismatch.js --business=<id>
 *
 * Safety Invariants:
 *   - Strictly READ-ONLY. Zero database writes, updates, or deletes.
 *   - Audits whether debts.currency matches linked transactions.currency_original
 *     and wallets.currency.
 *   - Highlights debts where transaction linkage is ambiguous or missing.
 */

const path = require('node:path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const getArgVal = (name) => {
  const match = args.find((a) => a.startsWith(`--${name}=`));
  return match ? match.split('=')[1] : null;
};
const businessFilter = getArgVal('business');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('='.repeat(80));
console.log('READ-ONLY AUDIT: Historical Debt Repayments Currency Mismatch');
console.log('='.repeat(80));
console.log('NOTE: This script is strictly read-only. No records will be modified.\n');

if (!supabaseUrl || !supabaseKey) {
  console.log('Notice: SUPABASE_URL or SUPABASE_SECRET_KEY not set in environment.');
  console.log('To run against a live database, ensure .env is populated.');
  console.log('You can also run the accompanying SQL script directly in Supabase SQL editor:');
  console.log('  scripts/audit-debt-payment-currency-mismatch.sql\n');
  process.exit(0);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

(async () => {
  try {
    // 1. Fetch paid debts
    let debtsQuery = supabase.from('debts').select('*').gt('paid_amount', 0);
    if (businessFilter) debtsQuery = debtsQuery.eq('business_id', businessFilter);
    const { data: debts, error: debtsErr } = await debtsQuery;
    if (debtsErr) throw debtsErr;

    console.log(`Found ${debts?.length || 0} debts with paid_amount > 0.`);
    if (!debts?.length) {
      console.log('No paid debt records found to audit.');
      return;
    }

    // 2. Fetch linked transactions
    const linkedTxIds = debts.map((d) => d.linked_transaction_id).filter(Boolean);
    let txMap = new Map();
    if (linkedTxIds.length > 0) {
      const { data: txs, error: txErr } = await supabase.from('transactions').select('*').in('id', linkedTxIds);
      if (txErr) throw txErr;
      txs.forEach((t) => txMap.set(t.id, t));
    }

    // 3. Fetch wallets
    const walletIds = Array.from(new Set(Array.from(txMap.values()).map((t) => t.wallet_id).filter(Boolean)));
    let walletMap = new Map();
    if (walletIds.length > 0) {
      const { data: wallets, error: wErr } = await supabase.from('wallets').select('*').in('id', walletIds);
      if (wErr) throw wErr;
      wallets.forEach((w) => walletMap.set(w.id, w));
    }

    const confirmedMismatches = [];
    const ambiguousLinkages = [];
    const healthyMatches = [];

    for (const d of debts) {
      const debtCur = String(d.currency || 'IDR').toUpperCase();
      if (!d.linked_transaction_id) {
        ambiguousLinkages.push({
          debt_id: d.id,
          counterparty: d.counterparty,
          debt_currency: debtCur,
          paid_amount: d.paid_amount,
          reason: 'No linked_transaction_id (legacy or unlinked payment)',
        });
        continue;
      }

      const tx = txMap.get(d.linked_transaction_id);
      if (!tx) {
        ambiguousLinkages.push({
          debt_id: d.id,
          counterparty: d.counterparty,
          debt_currency: debtCur,
          paid_amount: d.paid_amount,
          reason: `linked_transaction_id (${d.linked_transaction_id}) not found in transactions table`,
        });
        continue;
      }

      const wallet = tx.wallet_id ? walletMap.get(tx.wallet_id) : null;
      const txCur = String(tx.currency_original || wallet?.currency || 'IDR').toUpperCase();
      const walletCur = wallet ? String(wallet.currency || 'IDR').toUpperCase() : null;

      if (debtCur !== txCur || (walletCur && debtCur !== walletCur)) {
        confirmedMismatches.push({
          debt_id: d.id,
          counterparty: d.counterparty,
          debt_currency: debtCur,
          paid_amount: d.paid_amount,
          tx_id: tx.id,
          tx_amount_original: tx.amount_original,
          tx_currency: txCur,
          wallet_id: tx.wallet_id,
          wallet_currency: walletCur || 'N/A',
          mismatch: debtCur !== txCur ? 'debt_vs_tx' : 'debt_vs_wallet',
        });
      } else {
        healthyMatches.push({
          debt_id: d.id,
          debt_currency: debtCur,
          tx_id: tx.id,
          currency: debtCur,
        });
      }
    }

    console.log('\nAudit Results Summary:');
    console.log(`- Total Paid Debts Inspected:        ${debts.length}`);
    console.log(`- Healthy Same-Currency Payments:    ${healthyMatches.length}`);
    console.log(`- Confirmed Currency Mismatches:     ${confirmedMismatches.length}`);
    console.log(`- Ambiguous / Missing Linkages:      ${ambiguousLinkages.length}`);

    if (confirmedMismatches.length > 0) {
      console.log('\n[!] CONFIRMED CURRENCY MISMATCHES (Requires manual accountant adjustment):');
      console.table(confirmedMismatches);
    } else {
      console.log('\n[OK] No confirmed currency mismatches found among linked debt payments.');
    }

    if (ambiguousLinkages.length > 0) {
      console.log('\n[?] AMBIGUOUS LINKAGES:');
      console.log('The following debts have paid amounts but lack definitive 1:1 transaction links:');
      console.table(ambiguousLinkages.slice(0, 10));
      if (ambiguousLinkages.length > 10) {
        console.log(`... and ${ambiguousLinkages.length - 10} more.`);
      }
      console.log('\nCaveat: Automated backfill or reconciliation of ambiguous rows is not possible');
      console.log('without potential false positives. Manual bank reconciliation is recommended.');
    }

    console.log('\nAudit complete. No changes made.');
  } catch (err) {
    console.error('Audit failed with error:', err.message);
    process.exit(1);
  }
})();
