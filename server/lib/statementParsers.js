'use strict';
// Bank statement → rows. Engine first, the model only where no engine fits.
//
//   · BCA "Account Portfolio — Transaction Inquiry" CSV  (KlikBCA Bisnis export)
//   · Permata "TRANSACTION HISTORY" PDF with a text layer (PermataNet)
//   · anything else: the model reads the file and returns rows (caller supplies it)
//
// Every result carries CHECKS the engine computes itself — opening + credits − debits must equal
// the closing balance, and each printed running balance must follow from the previous one. A
// statement that does not balance is shown as such; nothing is "fixed" to make it balance.
//
// Rows: { row_index, tx_date: 'YYYY-MM-DD', description, amount (>0), direction: 'in'|'out',
//         balance_after|null, bank_reference|null, raw }

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  mei: 5, agu: 8, agt: 8, okt: 10, des: 12 };
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');

/** "30,000,000.00" | "30.000.000,00" | "1,096,949.00" → number (null when not a number). */
function amountOf(s) {
  let v = String(s ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!v || v === '-' ) return null;
  const lastDot = v.lastIndexOf('.'), lastComma = v.lastIndexOf(',');
  if (lastComma > lastDot) v = v.replace(/\./g, '').replace(',', '.');   // 1.234,56
  else v = v.replace(/,/g, '');                                          // 1,234.56
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Split one CSV line into cells (quoted fields with commas). */
function csvCells(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === ';') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

function checks({ opening, closing, rows }) {
  const credits = r2(rows.filter((r) => r.direction === 'in').reduce((s, r) => s + r.amount, 0));
  const debits = r2(rows.filter((r) => r.direction === 'out').reduce((s, r) => s + r.amount, 0));
  const out = { credits, debits, rows: rows.length };
  if (opening != null && closing != null) {
    out.expected_closing = r2(opening + credits - debits);
    out.balances = Math.abs(out.expected_closing - closing) < 0.01;
  } else out.balances = null;
  // Running balance continuity where the statement prints one.
  let prev = opening, breaks = 0, seen = 0;
  for (const r of rows) {
    if (r.balance_after == null) { prev = prev == null ? null : r2(prev + (r.direction === 'in' ? r.amount : -r.amount)); continue; }
    if (prev != null) { seen++; if (Math.abs(r2(prev + (r.direction === 'in' ? r.amount : -r.amount)) - r.balance_after) >= 0.01) breaks++; }
    prev = r.balance_after;
  }
  out.running_checked = seen; out.running_breaks = breaks;
  return out;
}

/* ── BCA CSV ─────────────────────────────────────────────────────────────── */
function isBcaCsv(text) { return /Account Portfolio\s*-\s*Transaction Inquiry/i.test(text) || (/"?Transaction Date"?\s*,\s*"?Description"?/i.test(text) && /\b(CR|DB)"?\s*,/.test(text)); }

function parseBcaCsv(text) {
  const lines = String(text).split(/\r?\n/);
  const meta = {};
  for (const l of lines.slice(0, 12)) {
    const c = csvCells(l).join(' ');
    let m;
    if ((m = /Account Number\s*:\s*([\d-]+)/i.exec(c))) meta.account_number = m[1].replace(/\D/g, '');
    if ((m = /Name\s*:\s*(.+)/i.exec(c))) meta.account_name = m[1].trim();
    if ((m = /Period\s*:\s*(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(c))) { meta.period_start = `${m[3]}-${m[2]}-${m[1]}`; meta.period_end = `${m[6]}-${m[5]}-${m[4]}`; }
    if ((m = /Currency Code\s*:\s*(\S+)/i.exec(c))) meta.currency = /^rp$/i.test(m[1]) ? 'IDR' : m[1].toUpperCase();
  }
  const year = Number((meta.period_end || meta.period_start || '').slice(0, 4)) || new Date().getFullYear();
  const startMonth = Number((meta.period_start || '').slice(5, 7)) || null;
  const rows = []; let opening = null, closing = null;
  for (const l of lines) {
    const c = csvCells(l);
    const dm = /^(\d{2})\/(\d{2})(?:\/(\d{4}))?$/.exec(c[0] || '');
    if (!dm) {
      const j = c.join(' ');
      let m;
      if ((m = /(Starting|Opening|Saldo Awal) Balance\s*[:,]?\s*([\d.,]+)/i.exec(j))) opening = amountOf(m[2]);
      if ((m = /(Ending|Closing|Saldo Akhir) Balance\s*[:,]?\s*([\d.,]+)/i.exec(j))) closing = amountOf(m[2]);
      continue;
    }
    const amt = /([\d.,]+)\s*(CR|DB)/i.exec(c[3] || '')
    if (!amt) continue;
    const mon = Number(dm[2]);
    const y = dm[3] ? Number(dm[3]) : (startMonth && mon < startMonth ? year : year);
    const amount = amountOf(amt[1]);
    if (!(amount > 0)) continue;
    rows.push({ row_index: rows.length, tx_date: `${y}-${pad(mon)}-${dm[1]}`, description: (c[1] || '').replace(/\s+/g, ' ').trim(),
      amount, direction: /CR/i.test(amt[2]) ? 'in' : 'out', balance_after: amountOf(c[4]), bank_reference: null,
      raw: { branch: c[2] || null, line: l.slice(0, 300) } });
  }
  if (opening == null && rows.length && rows[0].balance_after != null) opening = r2(rows[0].balance_after - (rows[0].direction === 'in' ? rows[0].amount : -rows[0].amount));
  if (closing == null && rows.length && rows[rows.length - 1].balance_after != null) closing = rows[rows.length - 1].balance_after;
  return { format: 'bca_csv', bank: 'BCA', ...meta, currency: meta.currency || 'IDR', opening, closing, rows };
}

/* ── Permata TRANSACTION HISTORY (PDF text) ──────────────────────────────── */
function isPermataText(text) { return /TRANSACTION HISTORY/i.test(text) && /Opening Balance\s+Total Debit\s+Total Credit\s+Closing Balance/i.test(text); }

const DATE_RE = /(\d{2}) ([A-Za-z]{3}) (\d{4})/;
const isoOf = (d, m, y) => { const mo = MONTHS[m.toLowerCase()]; return mo ? `${y}-${pad(mo)}-${d}` : null };

function parsePermataText(text) {
  const t = String(text).replace(/\s+/g, ' ');
  const meta = {};
  let m;
  if ((m = /Account No\.\s+Currency\s+Period\s+([\d-]{8,})/i.exec(t)) || (m = /\b(\d{4}-\d{4}-\d{3})\b/.exec(t))) meta.account_number = m[1].replace(/\D/g, '');
  if ((m = /Account Name\s+(.+?)\s+Opening Balance/i.exec(t))) meta.account_name = m[1].trim();
  if ((m = /(\d{2} [A-Za-z]{3} \d{4}) - (\d{2} [A-Za-z]{3} \d{4})\s+([A-Z]{3})\b/.exec(t))) {
    const a = DATE_RE.exec(m[1]), b = DATE_RE.exec(m[2]);
    meta.period_start = isoOf(a[1], a[2], a[3]); meta.period_end = isoOf(b[1], b[2], b[3]); meta.currency = m[3];
  }
  let opening = null, closing = null, totalDebit = null, totalCredit = null;
  if ((m = /Closing Balance\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i.exec(t))) {
    opening = amountOf(m[1]); totalDebit = amountOf(m[2]); totalCredit = amountOf(m[3]); closing = amountOf(m[4]);
  }
  // Drop repeated page headers and footers so they do not glue onto the previous row.
  const body = t.replace(/Page \d+ of \d+ TRANSACTION HISTORY .*?Description Amount/g, ' ')
    .replace(/^.*?Description Amount/, ' ');
  // After the two dates: "- <debit>" is money out; "<credit> …" (a reference or "-" follows) is money in.
  const rec = /(\d{2} [A-Za-z]{3} \d{4}) (\d{2} [A-Za-z]{3} \d{4}) (?:- ([\d.,]+\.\d{2})|([\d.,]+\.\d{2})) /g;
  const starts = [];
  let x;
  while ((x = rec.exec(body)) !== null) starts.push({ i: x.index, end: rec.lastIndex, d: x[1], credit: x[4] || '-', debit: x[3] || '-' });
  const rows = [];
  starts.forEach((s, k) => {
    const text = body.slice(s.end, k + 1 < starts.length ? starts[k + 1].i : body.length).replace(/Page \d+ of \d+.*$/, '').trim();
    const credit = amountOf(s.credit), debit = amountOf(s.debit);
    const amount = credit > 0 ? credit : debit > 0 ? debit : null;
    if (!(amount > 0)) return;
    const dd = DATE_RE.exec(s.d);
    const ref = (/\b(\d{4}-\d{4}-\d{4}-\d{4})\b/.exec(text) || [])[1] || null;
    const description = text.replace(/\b\d{4}-\d{4}-\d{4}-\d{4}\b/g, '').replace(/\s-\s/g, ' ').replace(/\s+/g, ' ').replace(/^[-\s]+/, '').trim();
    rows.push({ row_index: rows.length, tx_date: isoOf(dd[1], dd[2], dd[3]), description, amount, direction: credit > 0 ? 'in' : 'out',
      balance_after: null, bank_reference: ref, raw: { text: text.slice(0, 400) } });
  });
  // The statement lists the newest first: keep the bank's order for display, oldest first for checks.
  rows.sort((a, b) => (a.tx_date < b.tx_date ? -1 : a.tx_date > b.tx_date ? 1 : 0));
  rows.forEach((r, i) => { r.row_index = i });
  return { format: 'permata_pdf', bank: 'Permata', ...meta, currency: meta.currency || 'IDR', opening, closing,
    printed_totals: { debit: totalDebit, credit: totalCredit }, rows };
}

/** Detect and parse. `text` is the file's text (CSV text, or the PDF text layer). */
function parseStatement({ text = '', file_name = '' } = {}) {
  let out = null;
  if (isBcaCsv(text)) out = parseBcaCsv(text);
  else if (isPermataText(text)) out = parsePermataText(text);
  if (!out) return { ok: false, reason: 'unknown_format' };
  out.checks = checks(out);
  if (out.printed_totals) {
    out.checks.totals_match = out.printed_totals.debit != null
      && Math.abs(out.printed_totals.debit - out.checks.debits) < 0.01 && Math.abs(out.printed_totals.credit - out.checks.credits) < 0.01;
  }
  out.ok = out.rows.length > 0;
  return out;
}

/** The model's rows (already parsed JSON) → the same shape, with the engine's checks. */
function normalizeModelStatement(raw = {}) {
  const rows = (Array.isArray(raw.rows) ? raw.rows : []).map((r, i) => {
    const credit = amountOf(r.credit), debit = amountOf(r.debit), amt = amountOf(r.amount);
    const direction = credit > 0 ? 'in' : debit > 0 ? 'out' : r.direction === 'in' || r.direction === 'out' ? r.direction : (amt != null && amt < 0 ? 'out' : 'in');
    const amount = Math.abs(credit > 0 ? credit : debit > 0 ? debit : amt ?? 0);
    return { row_index: i, tx_date: /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : null, description: String(r.description || '').slice(0, 300).trim(),
      amount, direction, balance_after: amountOf(r.balance), bank_reference: r.reference ? String(r.reference).slice(0, 80) : null, raw: { model: true } };
  }).filter((r) => r.amount > 0 && r.tx_date);
  const out = { format: 'model', bank: String(raw.bank || '').slice(0, 60) || null, account_number: String(raw.account_number || '').replace(/\D/g, '') || null,
    account_name: String(raw.account_name || '').slice(0, 120) || null, currency: /^[A-Z]{3}$/.test(raw.currency || '') ? raw.currency : 'IDR',
    period_start: /^\d{4}-\d{2}-\d{2}$/.test(raw.period_start || '') ? raw.period_start : null, period_end: /^\d{4}-\d{2}-\d{2}$/.test(raw.period_end || '') ? raw.period_end : null,
    opening: amountOf(raw.opening_balance), closing: amountOf(raw.closing_balance), rows };
  out.checks = checks(out);
  out.ok = rows.length > 0;
  return out;
}

const MODEL_PROMPT = `You read ONE bank statement. Return ONLY JSON, no markdown:
{"bank":"","account_number":"","account_name":"","currency":"IDR","period_start":"YYYY-MM-DD","period_end":"YYYY-MM-DD","opening_balance":"","closing_balance":"",
 "rows":[{"date":"YYYY-MM-DD","description":"","credit":"","debit":"","balance":"","reference":""}]}
Every transaction row, in the statement's order. credit = money in, debit = money out, as printed (one of them empty).
Copy amounts exactly as printed. Never invent a row or a balance; leave a field empty when it is not printed.`;

module.exports = { amountOf, csvCells, checks, parseBcaCsv, parsePermataText, parseStatement, normalizeModelStatement, isBcaCsv, isPermataText, MODEL_PROMPT };
