// General Indonesian tax deadlines, for the calendar while the tax rules wait for professional
// review (migration 023 demoted every rule to under_review because no source was verified, so the
// rule engine generates nothing). These dates come from the general rule — PMK 81/2024 (in force
// from 1 January 2025): PPh 21/23/26/4(2) paid by the 15th and reported (SPT Masa) by the 20th of
// the next month; PPN paid and reported by the end of the next month; the annual PPh Badan return
// by the end of the 4th month after the financial year. A deadline on a weekend or public holiday
// moves to the next working day — holidays are NOT computed here, which the UI says.
//
// Sources checked 2026-10-09 (secondary, citing the regulation):
//   PMK 81/2024 Pasal 94(2) — PPh paid by the 15th of the next month; SPT Masa PPh 21/23/4(2) by the 20th:
//     https://ortax.org/jatuh-tempo-pembayaran-pajak-masa-menurut-pmk-81-2024
//     https://news.ddtc.co.id/berita/nasional/1818651/kapan-batas-waktu-bayar-dan-lapor-spt-masa-pph-21-begini-aturannya
//   PPN paid by the end of the next month, before the SPT Masa PPN:
//     https://www.online-pajak.com/tentang-efaktur-ppn/pengaruh-pmk-81-tahun-2024-terhadap-pelaporan-spt-masa-ppn/
//   Nil returns — PMK 81/2024 Pasal 171(5): SPT Masa PPh 21 for December (the last period) is filed even when nil;
//     for other months it is required only when income was paid:
//     https://news.ddtc.co.id/berita/nasional/1800203/walaupun-nihil-spt-masa-pph-pasal-2126-wajib-dilaporkan
//     https://pajak.go.id/id/artikel/sekarang-spt-pph-21-nihil-tak-hanya-dilaporkan-desember-ya
// None of this is a professional review; the rules stay under_review until a consultant approves them.
//
// Every date produced here is ADVISORY (verified:false). Once a rule is professionally approved
// and active, the rule engine (GET /api/accountant/calendar) and its due_date_rule_json take over.
'use strict';

const { ymd } = require('./dueDate');
const { normalizePkpStatus } = require('./pkpStatus');

const GENERAL = {
  ID_PPH21_MONTHLY: {
    frequency: 'monthly', pay: { type: 'day_of_next_month', day: 15 }, file: { type: 'day_of_next_month', day: 20 },
    // A month with no payments: not filed, except December (the last period), which is filed as nil.
    nil: (period) => (String(period).slice(5, 7) === '12' ? 'required' : 'not_required_without_payments'),
    // Only when the profile says the company has employees; unknown → the profile is asked for instead.
    applies: (p) => p?.employee_status === 'has_employees' || p?.has_employees === true,
  },
  ID_PPN_MONTHLY: {
    frequency: 'monthly', pay: { type: 'end_of_next_month' }, file: { type: 'end_of_next_month' },
    nil: () => 'required',
    // pkp_status is the profile's current field; vat_status is the older one.
    // pkp_status ('pkp_registered' | 'non_pkp' | legacy 'pkp') through the one normaliser; the older
    // vat_status only when pkp_status says nothing.
    applies: (p) => { const s = normalizePkpStatus(p?.pkp_status); return s === 'pkp_registered' || (s === 'unknown' && normalizePkpStatus(p?.vat_status) === 'pkp_registered') },
  },
  ID_PPH_BADAN_ANNUAL: {
    frequency: 'annual', pay: { type: 'months_after', months: 4 }, file: { type: 'months_after', months: 4 },
    nil: () => 'required',
    // Every PT files the annual return, active or not; an unknown entity type is treated as a PT
    // (the companies registered here are PTs) and the profile is asked for.
    // Every legal entity (PT, CV, Yayasan, branch) files the annual return; an individual does not.
    applies: (p) => !/individual|freelancer|perorangan|orang pribadi/i.test(String(p?.legal_entity_type || '')),
  },
};
const SOURCE = 'PMK 81/2024';

// Profiles store the financial year as "MM-DD" or as a full date "YYYY-MM-DD"; only month and day matter.
function monthDay(v, fallback) {
  const parts = String(v || '').split('-').map(Number).filter((n) => Number.isFinite(n));
  const [m, d] = parts.length >= 3 ? parts.slice(-2) : parts;
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? [m, d] : fallback;
}
const parse = (s) => { const [y, m, d] = String(s).split('-').map(Number); return { y, m0: m - 1, d } };
function dateFor(rule, periodEnd) {
  const e = parse(periodEnd);
  if (rule.type === 'day_of_next_month') return ymd(e.y, e.m0 + 1, rule.day);
  if (rule.type === 'end_of_next_month') return ymd(e.y, e.m0 + 1, 31);
  if (rule.type === 'months_after') return ymd(e.y, e.m0 + rule.months, 31);
  return null;
}

/** Monthly periods from `back` months ago to `ahead` months ahead of `now` (UTC). */
function monthlyPeriods(now, back = 3, ahead = 2) {
  const out = [];
  for (let i = -back; i <= ahead; i++) {
    const t = now.getUTCMonth() + i;
    const y = now.getUTCFullYear() + Math.floor(t / 12);
    const m0 = ((t % 12) + 12) % 12;
    out.push({ period: `${y}-${String(m0 + 1).padStart(2, '0')}`, period_start: ymd(y, m0, 1), period_end: ymd(y, m0, 31) });
  }
  return out;
}

/** The period a document month belongs to, and its general deadlines. */
function deadlinesFor(ruleCode, period, profile = null) {
  const g = GENERAL[ruleCode];
  if (!g) return null;
  let start, end;
  if (g.frequency === 'monthly') {
    const [y, m] = String(period).split('-').map(Number);
    if (!y || !m) return null;
    start = ymd(y, m - 1, 1); end = ymd(y, m - 1, 31);
  } else {
    const y = Number(String(period).slice(0, 4));
    if (!y) return null;
    const [em, ed] = monthDay(profile?.financial_year_end, [12, 31]);
    const [sm, sd] = monthDay(profile?.financial_year_start, [1, 1]);
    start = ymd(y, (sm || 1) - 1, sd || 1); end = ymd(y, (em || 12) - 1, ed || 31);
  }
  return { period, period_start: start, period_end: end, pay_by: dateFor(g.pay, end), file_by: dateFor(g.file, end), source: SOURCE, verified: false };
}

/**
 * Advisory calendar rows for the rules that exist in tax_rules and apply to the profile.
 * @param {object[]} rules    tax_rules rows (any status) — title / obligation_type / rule_code
 * @param {object}   profile  tax_profiles row
 */
/** What a period with no activity means for the return: 'required' (file a nil return) or not. */
const nilRule = (ruleCode, period) => (GENERAL[ruleCode]?.nil ? GENERAL[ruleCode].nil(period) : 'required');
const appliesTo = (ruleCode, profile) => !!GENERAL[ruleCode] && GENERAL[ruleCode].applies(profile);

function advisoryCalendar(rules = [], profile = null, now = new Date()) {
  const out = [];
  for (const r of rules) {
    const g = GENERAL[r.rule_code];
    if (!g || !g.applies(profile)) continue;
    const periods = g.frequency === 'monthly' ? monthlyPeriods(now)
      : [String(now.getUTCFullYear() - 1), String(now.getUTCFullYear())].map((p) => ({ period: p }));
    for (const p of periods) {
      const d = deadlinesFor(r.rule_code, p.period, profile);
      if (!d) continue;
      out.push({ rule_code: r.rule_code, title: r.title, obligation_type: r.obligation_type, rule_status: r.status, ...d, due_date: d.file_by });
    }
  }
  return out.sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
}

module.exports = { GENERAL, SOURCE, deadlinesFor, advisoryCalendar, monthlyPeriods, monthDay, appliesTo, nilRule };
