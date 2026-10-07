import assert from 'node:assert';
import { dedupeDocumentLinks, createAccountantZipPackage, packageExportData } from '../client/src/v2/lib/accounting.js';

let pass = 0;
let fail = 0;
const ok = (msg, cond) => {
  if (cond) {
    console.log('OK  ' + msg);
    pass++;
  } else {
    console.error('FAIL ' + msg);
    fail++;
  }
};

const BIZ_ID = 'biz-demo-123';
const MONTH = '2026-09';

// ── Test 1: Deduplication of document links ──────────────────────────────────
{
  const links = [
    { document_id: 'doc-1', file_name: 'invoice_1.pdf' },
    { document_id: 'doc-1', file_name: 'invoice_1_dup.pdf' }, // Duplicate by doc id
    { document_id: 'doc-2', file_name: 'invoice_2.pdf' },
    { id: 'doc-3', file_name: 'invoice_3.pdf' },
    { id: 'doc-3', file_name: 'invoice_3.pdf' }, // Duplicate by id
  ];
  const deduped = dedupeDocumentLinks(links);
  ok('Deduplication reduces 5 links with duplicates to 3 unique links', deduped.length === 3);
  ok('First document doc-1 is preserved', deduped[0].document_id === 'doc-1');
  ok('Second document doc-2 is preserved', deduped[1].document_id === 'doc-2');
  ok('Third document doc-3 is preserved', deduped[2].id === 'doc-3');

  const emptyDeduped = dedupeDocumentLinks(null);
  ok('dedupeDocumentLinks safely handles null/undefined', Array.isArray(emptyDeduped) && emptyDeduped.length === 0);
}

// ── Test 2: Package with Invoice AND Bank Statement Original (files_available: true) ─
{
  const debts = [
    {
      id: 'd-1',
      business_id: BIZ_ID,
      due_date: '2026-09-10',
      counterparty: 'PT Vendor Alpha',
      amount: 10000000,
      currency: 'IDR',
      document_links: [{ document_id: 'doc-invoice', file_name: 'invoice-alpha.pdf' }],
    },
  ];
  const documents = [
    {
      id: 'doc-invoice',
      business_id: BIZ_ID,
      file_name: 'invoice-alpha.pdf',
      document_date: '2026-09-10',
      debt_id: 'd-1',
      content: '%PDF-1.4 Mock PDF Invoice Alpha',
    },
  ];
  const batches = [
    {
      id: 'b-sept',
      business_id: BIZ_ID,
      wallet_id: 'w-bca',
      file_name: 'bca_september_2026.csv',
      statement_start: '2026-09-01',
      statement_end: '2026-09-30',
      status: 'imported',
      closing_balance: 50000000,
      reconciliation_status: 'balanced',
      difference: 0,
      raw_csv: 'Date,Description,Amount,Type\n2026-09-01,Client,10000000,CR\n',
    },
  ];
  const wallets = [
    { id: 'w-bca', business_id: BIZ_ID, name: 'BCA Operasional', currency: 'IDR', type: 'bank', is_active: true },
  ];
  const transactions = [
    { id: 'tx-1', business_id: BIZ_ID, transaction_date: '2026-09-01', category: 'Revenue', amount_original: 10000000 },
  ];

  const pkg = await createAccountantZipPackage({
    month: MONTH,
    companyName: 'PT Solusi Utama',
    businessId: BIZ_ID,
    transactions,
    debts,
    batches,
    wallets,
    documents,
  });

  ok('Package with invoice and statement: unavailableFiles is empty', pkg.unavailableFiles.length === 0);
  ok('Package with invoice and statement: filesAvailable is true', pkg.filesAvailable === true);
  ok('Package with invoice and statement: summary.files_available is true', pkg.summary.files_available === true);
  ok('Package with invoice and statement: discrepancies.files_available is true', pkg.discrepancies.files_available === true);
  ok('Package with invoice and statement: zipBytes created', pkg.zipBytes instanceof Uint8Array && pkg.zipBytes.length > 0);

  // Parse zip bytes text to verify filenames are in archive
  const zipText = new TextDecoder('latin1').decode(pkg.zipBytes);
  ok('ZIP includes invoice file documents/invoice-alpha.pdf', zipText.includes('documents/invoice-alpha.pdf'));
  ok('ZIP includes bank statement file documents/bca_september_2026.csv', zipText.includes('documents/bca_september_2026.csv'));
}

// ── Test 3: Package with Unavailable Bank Statement Original (files_available: false) ─
{
  const debts = [
    {
      id: 'd-1',
      business_id: BIZ_ID,
      due_date: '2026-09-10',
      counterparty: 'PT Vendor Alpha',
      amount: 10000000,
      currency: 'IDR',
      document_links: [{ document_id: 'doc-invoice', file_name: 'invoice-alpha.pdf' }],
    },
  ];
  const documents = [
    {
      id: 'doc-invoice',
      business_id: BIZ_ID,
      file_name: 'invoice-alpha.pdf',
      document_date: '2026-09-10',
      debt_id: 'd-1',
      content: '%PDF-1.4 Mock PDF Invoice Alpha',
    },
  ];
  // Batch exists for September, but original file content is NOT available in storage or memory
  const batches = [
    {
      id: 'b-sept-missing-orig',
      business_id: BIZ_ID,
      wallet_id: 'w-bca',
      file_name: 'bca_september_2026_unavailable.csv',
      statement_start: '2026-09-01',
      statement_end: '2026-09-30',
      status: 'imported',
      closing_balance: 50000000,
      reconciliation_status: 'balanced',
      difference: 0,
      // No content, no raw_csv, no storage file
    },
  ];
  const wallets = [
    { id: 'w-bca', business_id: BIZ_ID, name: 'BCA Operasional', currency: 'IDR', type: 'bank', is_active: true },
  ];
  const transactions = [
    { id: 'tx-1', business_id: BIZ_ID, transaction_date: '2026-09-01', category: 'Revenue', amount_original: 10000000 },
  ];

  const pkg = await createAccountantZipPackage({
    month: MONTH,
    companyName: 'PT Solusi Utama',
    businessId: BIZ_ID,
    transactions,
    debts,
    batches,
    wallets,
    documents,
  });

  ok('Unavailable statement original: unavailableFiles length is 1', pkg.unavailableFiles.length === 1);
  ok('Unavailable statement original: file_name matches', pkg.unavailableFiles[0].file_name === 'bca_september_2026_unavailable.csv');
  ok('Unavailable statement original: filesAvailable is false', pkg.filesAvailable === false);
  ok('Unavailable statement original: summary.files_available is false', pkg.summary.files_available === false);
  ok('Unavailable statement original: discrepancies.files_available is false', pkg.discrepancies.files_available === false);
  ok('Unavailable statement original: isComplete is false', pkg.isComplete === false);
  ok('Unavailable statement original: summary.is_complete is false', pkg.summary.is_complete === false);
  ok('Unavailable statement original: discrepancies.unavailable_files listed in JSON', pkg.discrepancies.unavailable_files.length === 1);
}

// ── Test 4: Cancellation with AbortSignal (Company switch during export) ──────
{
  const controller = new AbortController();
  controller.abort(); // already aborted

  let aborted = false;
  try {
    await createAccountantZipPackage({
      month: MONTH,
      companyName: 'PT Solusi Utama',
      businessId: BIZ_ID,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') aborted = true;
  }
  ok('createAccountantZipPackage aborts immediately when signal is aborted', aborted === true);
}

// ── Test 5: Signed URL request with explicit company context ──────────────────
{
  let passedBizId = null;
  const debts = [{ id: 'd-1', business_id: BIZ_ID, due_date: '2026-09-10', amount: 500 }];
  const documents = [{ id: 'doc-ext', business_id: BIZ_ID, file_name: 'doc-ext.pdf', document_date: '2026-09-10' }];

  await createAccountantZipPackage({
    month: MONTH,
    companyName: 'PT Solusi Utama',
    businessId: BIZ_ID,
    debts,
    documents,
    fetchSignedUrl: async (docId, mode, bizId) => {
      passedBizId = bizId;
      return null; // triggers unavailable
    },
  });

  ok('fetchSignedUrl is called with explicit company context businessId', passedBizId === BIZ_ID);
}

// ── Test 6: Bank statement is matched strictly by document_id, not filename alone
{
  const documents = [
    { id: 'doc-loose', business_id: BIZ_ID, file_name: 'bca_loose.csv', content: 'Date,Amount\n' },
  ];
  const batchesWithoutDocId = [
    {
      id: 'b-loose',
      business_id: BIZ_ID,
      file_name: 'bca_loose.csv',
      statement_start: '2026-09-01',
      statement_end: '2026-09-30',
      status: 'imported',
      document_id: null, // No document_id link!
    },
  ];

  const pkgLoose = await createAccountantZipPackage({
    month: MONTH,
    companyName: 'PT Solusi Utama',
    businessId: BIZ_ID,
    batches: batchesWithoutDocId,
    documents,
  });

  ok('Bank statement without document_id is NOT matched by filename alone: unavailableFiles has 1 item', pkgLoose.unavailableFiles.length === 1);
  ok('filesAvailable is false when bank statement has no document_id link', pkgLoose.filesAvailable === false);

  // Now with explicit document_id link:
  const batchesWithDocId = [
    {
      id: 'b-linked',
      business_id: BIZ_ID,
      file_name: 'bca_loose.csv',
      statement_start: '2026-09-01',
      statement_end: '2026-09-30',
      status: 'imported',
      document_id: 'doc-loose', // Explicit document_id link!
    },
  ];

  const pkgLinked = await createAccountantZipPackage({
    month: MONTH,
    companyName: 'PT Solusi Utama',
    businessId: BIZ_ID,
    batches: batchesWithDocId,
    documents,
  });

  ok('Bank statement WITH document_id link is matched and included: unavailableFiles is 0', pkgLinked.unavailableFiles.length === 0);
  ok('filesAvailable is true when bank statement is explicitly linked by document_id', pkgLinked.filesAvailable === true);
}

console.log(`\nACCOUNTANT EXPORT TESTS: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
