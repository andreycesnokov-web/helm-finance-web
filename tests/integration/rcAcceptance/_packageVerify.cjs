'use strict';
// Independent checks of a downloaded accountant package against PostgreSQL. Reads the ZIP with its own reader
// (central directory, CRC-32, DOS dates), parses every CSV and the XLSX with SheetJS, checks PDFs, hashes
// originals against document_files.sha256_hash, and recalculates every total from the database. Read-only.
const assert = require('node:assert/strict');
const crypto = require('node:crypto'), zlib = require('node:zlib'), path = require('node:path'), fs = require('node:fs'), { execFileSync } = require('node:child_process');
const XLSX = require(path.resolve(__dirname, '../../../client/node_modules/xlsx'));
const LABEL = 'Prepared for Accountant Review — Not a Direct Coretax Import File';

const CRC = new Uint32Array(256).map((_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'end of central directory');
  const count = buf.readUInt16LE(eocd + 10), cdOffset = buf.readUInt32LE(eocd + 16), files = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'central header');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), time = buf.readUInt16LE(p + 12), date = buf.readUInt16LE(p + 14);
    const crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString(flags & 0x0800 ? 'utf8' : 'latin1');
    const lnlen = buf.readUInt16LE(off + 26), lelen = buf.readUInt16LE(off + 28), start = off + 30 + lnlen + lelen;
    const raw = buf.slice(start, start + csize), data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    assert.ok(data, `${name}: supported compression`);
    assert.equal(crc32(data), crc, `${name}: CRC-32`);
    const month = (date >> 5) & 15, day = date & 31;
    assert.ok(month >= 1 && month <= 12 && day >= 1, `${name}: valid DOS date (month ${month})`);
    assert.ok(!name.startsWith('/') && !/^[a-zA-Z]:/.test(name) && !name.includes('\\') && !name.split('/').includes('..'), `${name}: safe path`);
    assert.ok(!files.has(name), `${name}: unique`);
    files.set(name, data); void time;
    p += 46 + nlen + elen + clen;
  }
  return files;
}
const csvRows = (buf) => {
  const text = buf.toString('utf8');
  assert.ok(text.startsWith('﻿'), 'UTF-8 BOM');
  const wb = XLSX.read(text.slice(1), { type: 'string', raw: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
};
const n = (v) => (v === '' || v == null ? 0 : Number(v));
const cents = (v) => Math.round(n(v) * 100);
const eqMoney = (a, b, what) => assert.equal(cents(a), cents(b), `${what}: package ${a} vs database ${b}`);

/**
 * @returns {Promise<{checks: string[], files: Map, manifest: object, summary: object}>}
 */
async function verifyPackage({ zipPath, db, biz, periodKey, otherCompanyNames = [] }) {
  const checks = [], ok = (m) => checks.push(m);
  const buf = fs.readFileSync(zipPath);
  const files = readZip(buf);
  ok(`ZIP opens with an independent reader: ${files.size} entries, CRC-32 and DOS dates valid, safe unique paths`);
  try { execFileSync('unzip', ['-tq', zipPath], { stdio: 'pipe' }); ok('unzip -t: no errors'); } catch (e) { if (e.code !== 'ENOENT') throw Error('unzip -t failed: ' + String(e.stderr || e.message)); }
  const manifest = JSON.parse(files.get('manifest.json').toString('utf8')), summary = JSON.parse(files.get('summary.json').toString('utf8'));
  const p = manifest.period;
  assert.equal(p.key, periodKey); assert.equal(summary.period.key, periodKey); assert.equal(manifest.filed, false); assert.equal(summary.filed, false);
  // Manifest: every other file listed with the right size and SHA-256.
  const listed = new Map(manifest.files.map((f) => [f.path, f]));
  for (const [name, data] of files) {
    if (name === 'manifest.json' || name === 'manifest.csv') continue;
    const m = listed.get(name); assert.ok(m, `${name} is in the manifest`);
    assert.equal(m.bytes, data.length, `${name} size`); assert.equal(m.sha256, crypto.createHash('sha256').update(data).digest('hex'), `${name} sha256`);
  }
  assert.equal(listed.size, files.size - 2, 'manifest lists exactly the package files');
  ok(`manifest: ${listed.size} files, sizes and SHA-256 all match`);
  // Registers: CSV parse, counts, and the XLSX workbook carries the same rows.
  const reg = {};
  for (const [name, data] of files) if (/^registers\/\d\d_[a-z_]+\.csv$/.test(name)) reg[name.replace(/^registers\/\d\d_|\.csv$/g, '')] = csvRows(data);
  for (const [k, count] of Object.entries(manifest.record_counts)) assert.equal(reg[k].length - 1, count, `${k}: CSV rows = manifest count`);
  const xlsxName = [...files.keys()].find((f) => f.endsWith('_Registers.xlsx')); assert.ok(xlsxName, 'XLSX workbook present');
  const wb = XLSX.read(files.get(xlsxName), { type: 'buffer' });
  for (const [k, rows] of Object.entries(reg)) {
    const sheet = XLSX.utils.sheet_to_json(wb.Sheets[k.slice(0, 31)], { header: 1, raw: true, defval: '' });
    assert.equal(sheet.length, rows.length, `${k}: XLSX rows = CSV rows`);
    assert.deepEqual(sheet[0], rows[0], `${k}: XLSX header = CSV header`);
  }
  ok(`registers: ${Object.keys(reg).length} CSV files parse, counts match the manifest, the XLSX has the same sheets and rows`);
  // PDFs and originals.
  for (const [name, data] of files) if (name.endsWith('.pdf')) { const s = data.toString('latin1'); assert.ok(s.startsWith('%PDF-') && s.trimEnd().endsWith('%%EOF'), `${name}: PDF structure`); }
  const docMap = reg.document_map, H = docMap[0], iId = H.indexOf('document_id'), iFile = H.indexOf('file_in_package');
  for (const r of docMap.slice(1)) {
    const data = files.get(r[iFile]); assert.ok(data, `${r[iFile]} present`);
    const row = (await db.query('SELECT f.sha256_hash, d.business_id FROM financial_documents d JOIN document_files f ON f.id=d.file_id WHERE d.id=$1', [r[iId]])).rows[0];
    assert.ok(row, `document ${r[iId]} exists`); assert.equal(row.business_id, biz, `document ${r[iId]} belongs to the company`);
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'), row.sha256_hash, `${r[iFile]} is the unchanged original`);
  }
  ok(`originals: ${docMap.length - 1} files byte-identical to the uploaded originals (SHA-256 = document_files.sha256_hash), all of this company`);
  // pdftotext (Poppler) on a temporary copy: some builds cannot read a PDF from stdin.
  const tmpPdf = path.join(require('node:os').tmpdir(), `acct-summary-${process.pid}-${Date.now()}.pdf`);
  fs.writeFileSync(tmpPdf, files.get('accountant-summary.pdf'));
  let pdfText = null;
  try { pdfText = execFileSync('pdftotext', ['-layout', tmpPdf, '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8'); }
  catch (e) { if (e.code !== 'ENOENT') throw Error('pdftotext could not read accountant-summary.pdf: ' + String(e.stderr || e.message).slice(0, 200)); }
  finally { fs.rmSync(tmpPdf, { force: true }); }
  if (pdfText != null) { assert.ok(pdfText.includes('Not a Direct Coretax Import File'), 'PDF carries the label'); assert.ok(pdfText.includes(p.start) && pdfText.includes(p.end), 'PDF shows the exact period'); ok(`accountant-summary.pdf: text readable with pdftotext (${pdfText.length} characters), label and exact period present`); }
  else ok('accountant-summary.pdf: pdftotext not installed here; PDF structure checked only');
  const readme = files.get('README.txt').toString('utf8');
  assert.ok(readme.includes(LABEL) && /Filed: NO/.test(readme) && /CASH-BASIS/.test(readme) && /OSS, not Coretax/.test(readme), 'README label and limitations');
  assert.ok(reg.tax_preparation.slice(1).every((r) => !/coretax[- ]compatible/i.test(r.join(' '))), 'nothing claims Coretax compatibility');
  ok('README and tax schedule: label, "Filed: NO", cash-basis limitation, Coretax vs OSS distinction; no Coretax-compatibility claim');
  // ── recalculation from PostgreSQL
  const T = reg.transactions, th = T[0], ti = (c) => th.indexOf(c);
  const dbTx = (await db.query(`SELECT id::text, type, amount_original::text a, transaction_date::text d FROM transactions
    WHERE business_id=$1 AND coalesce(is_training,false)=false AND transaction_date BETWEEN $2 AND $3`, [biz, p.start, p.end])).rows;
  const pkgIds = T.slice(1).map((r) => String(r[ti('transaction_id')]));
  assert.equal(new Set(pkgIds).size, pkgIds.length, 'no duplicate operation in the register');
  assert.deepEqual([...pkgIds].sort(), dbTx.map((r) => r.id).sort(), 'register = every operation of the company in the period');
  const dates = T.slice(1).map((r) => String(r[ti('date')]));
  assert.ok(dates.every((d) => d >= p.start && d <= p.end), 'every date inside the period');
  const sign = (t) => (t.type === 'income' ? 1 : ['expense', 'payroll'].includes(t.type) ? -1 : t.type === 'correction' ? 1 : 0);
  const dbIn = dbTx.filter((t) => sign(t) * n(t.a) > 0).reduce((s, t) => s + cents(t.a), 0) / 100, dbOut = dbTx.filter((t) => sign(t) * n(t.a) < 0).reduce((s, t) => s + cents(t.a), 0) / 100;
  eqMoney(manifest.totals.transactions.money_in, dbIn, 'money in'); eqMoney(manifest.totals.transactions.money_out, dbOut, 'money out');
  ok(`transactions: ${dbTx.length} operations = database for ${p.start}..${p.end}; money in ${dbIn}, money out ${dbOut} recalculated from PostgreSQL`);
  // Accounts: opening and closing from the ledger's own sign function.
  const A = reg.bank_cash_accounts, ah = A[0];
  for (const r of A.slice(1)) {
    const w = (await db.query('SELECT id FROM wallets WHERE business_id=$1 AND name=$2', [biz, r[ah.indexOf('account')]])).rows[0];
    const q = async (cmp, d) => (await db.query(`SELECT coalesce(sum(fn_ledger_signed(t.type,t.amount_original,t.amount_idr)),0)::text v FROM transactions t JOIN wallets w ON w.id=$1
      WHERE t.business_id=w.business_id AND (t.wallet_id=w.id OR (t.wallet_id IS NULL AND t.source=w.name)) AND t.transaction_date ${cmp} $2`, [w.id, d])).rows[0].v;
    eqMoney(r[ah.indexOf('opening_balance')], await q('<', p.start), `${r[0]} opening`); eqMoney(r[ah.indexOf('closing_balance')], await q('<=', p.end), `${r[0]} closing`);
  }
  ok(`accounts: opening and closing of ${A.length - 1} account(s) = PostgreSQL fn_ledger_signed sums at ${p.start} and ${p.end}`);
  // Payroll.
  const P = reg.payroll, ph = P[0];
  const dbPay = (await db.query(`SELECT p.gross_amount::text g, p.net_amount::text net, p.status, p.employer_bpjs::text er,
     coalesce((SELECT sum(amount) FROM payroll_payment_items i WHERE i.payroll_payment_id=p.id AND i.item_type='pph21'),0)::text pph,
     coalesce((SELECT sum(amount) FROM payroll_payment_items i WHERE i.payroll_payment_id=p.id AND i.item_type='bpjs_kes'),0)::text kes,
     coalesce((SELECT sum(amount) FROM payroll_payment_items i WHERE i.payroll_payment_id=p.id AND i.item_type='bpjs_jp'),0)::text jp,
     coalesce((SELECT sum(amount) FROM payroll_payment_items i WHERE i.payroll_payment_id=p.id AND i.item_type='bpjs_jht'),0)::text jht
     FROM payroll_payments p JOIN payroll_runs r ON r.id=p.run_id WHERE r.business_id=$1 AND r.period_month = ANY($2) AND r.status<>'cancelled' AND p.status<>'cancelled'`, [biz, p.months])).rows;
  assert.equal(P.length - 1, dbPay.length, 'payroll lines');
  const sum = (rows, k) => rows.reduce((s, r) => s + cents(r[k]), 0) / 100;
  eqMoney(manifest.totals.payroll.gross, sum(dbPay, 'g'), 'payroll gross'); eqMoney(manifest.totals.payroll.pph21_entered, sum(dbPay, 'pph'), 'PPh 21 entered');
  eqMoney(manifest.totals.payroll.bpjs_kesehatan, sum(dbPay, 'kes'), 'BPJS Kesehatan'); eqMoney(manifest.totals.payroll.bpjs_tk_jp, sum(dbPay, 'jp'), 'BPJS TK JP');
  eqMoney(manifest.totals.payroll.bpjs_tk_jht, sum(dbPay, 'jht'), 'BPJS TK JHT'); eqMoney(manifest.totals.payroll.net, sum(dbPay, 'net'), 'payroll net');
  eqMoney(manifest.totals.payroll.unpaid_net, sum(dbPay.filter((r) => r.status !== 'paid'), 'net'), 'payroll unpaid');
  ok(`payroll: ${dbPay.length} lines; gross ${manifest.totals.payroll.gross}, PPh 21 ${manifest.totals.payroll.pph21_entered}, BPJS KS/JP/JHT ${manifest.totals.payroll.bpjs_kesehatan}/${manifest.totals.payroll.bpjs_tk_jp}/${manifest.totals.payroll.bpjs_tk_jht}, net ${manifest.totals.payroll.net}, unpaid ${manifest.totals.payroll.unpaid_net} = database`);
  // Financing, and never revenue.
  const fr = (await db.query('SELECT coalesce(sum(amount),0)::text v FROM business_funding_records WHERE business_id=$1 AND received_on BETWEEN $2 AND $3', [biz, p.start, p.end])).rows[0].v;
  const rp = (await db.query('SELECT coalesce(sum(principal),0)::text v FROM business_funding_repayments WHERE business_id=$1 AND paid_on BETWEEN $2 AND $3', [biz, p.start, p.end])).rows[0].v;
  eqMoney(manifest.totals.financing.received, fr, 'financing received'); eqMoney(manifest.totals.financing.principal_repaid, rp, 'principal repaid');
  const fundIds = new Set((await db.query(`SELECT received_transaction_id::text id FROM business_funding_records WHERE business_id=$1 AND received_transaction_id IS NOT NULL
    UNION SELECT paid_transaction_id::text FROM business_funding_repayments WHERE business_id=$1 AND paid_transaction_id IS NOT NULL`, [biz])).rows.map((r) => r.id));
  const fundRows = T.slice(1).filter((r) => fundIds.has(String(r[ti('transaction_id')])));
  assert.ok(fundRows.every((r) => !/^included: (revenue|other_income)/.test(r[ti('pnl_treatment')]) && r[ti('financing')] !== ''), 'financing rows are flagged and never revenue');
  ok(`financing: received ${fr}, principal repaid ${rp} = database; ${fundRows.length} financing operation(s) flagged and never counted as revenue`);
  // Receivables / payables still open at period end.
  const open = async (type) => (await db.query(`SELECT coalesce(sum(coalesce(original_amount,amount)-coalesce(paid_amount,0)),0)::text v FROM debts WHERE business_id=$1 AND type=$2
    AND coalesce(is_training,false)=false AND status<>'cancelled' AND coalesce(approval_status,'')<>'rejected' AND coalesce(original_amount,amount)-coalesce(paid_amount,0)>0
    AND coalesce(invoice_date, created_at::date) <= $3`, [biz, type, p.end])).rows[0].v;
  eqMoney(manifest.totals.receivables_open, await open('receivable'), 'open receivables'); eqMoney(manifest.totals.payables_open, await open('payable'), 'open payables');
  ok(`receivables ${manifest.totals.receivables_open} and payables ${manifest.totals.payables_open} open at ${p.end} = database`);
  // Isolation and secrets.
  const all = [...files.values()].map((b) => b.toString('latin1')).join('\n');
  for (const name of otherCompanyNames) assert.ok(!all.includes(name), `no data of "${name}"`);
  assert.ok(!/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/.test(all) && !/service_role|SUPABASE_SECRET|sk_live_|password\s*[:=]/i.test(all), 'no tokens, keys or passwords');
  ok(`isolation: no data of ${otherCompanyNames.length} other companies; no tokens, keys or passwords in any file`);
  return { checks, files, manifest, summary, registers: reg };
}
module.exports = { verifyPackage, readZip, LABEL };
