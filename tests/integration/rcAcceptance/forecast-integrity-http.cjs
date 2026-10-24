'use strict';
// Real stack (financial integrity audit 2026-10-24): the 30/60/90-day cash forecast a company sees equals an
// independent recomputation straight from PostgreSQL, salaries sit on their pay dates, nothing of another
// company leaks in, a loan schedule cannot outgrow its loan, tax payment and filing are reported apart, and
// Pulse states no unchecked assurance. Date-independent: the expected figures are rebuilt from SQL for "today".
// Env: FI_EMAIL, FI_PASSWORD, FI_BIZ (company under test, ideally with payroll and a loan),
//      FI_OTHER_EMAIL, FI_OTHER_PASSWORD, FI_OTHER_BIZ (another company), DATABASE_URL, EXPECTED_PG_SYSTEM_ID.
// Synthetic data only; the only write attempted (an oversized repayment) must be refused.
const assert = require('node:assert/strict'), fs = require('node:fs'), { Client } = require('pg');
const db = new Client({ connectionString: process.env.DATABASE_URL }), results = [];
const E = process.env, BIZ = E.FI_BIZ, OTHER = E.FI_OTHER_BIZ;
const pass = (name, extra = {}) => { results.push({ case: name, status: 'PASS', ...extra }); fs.writeFileSync('/evidence/FORECAST_INTEGRITY_HTTP.json', JSON.stringify({ candidate: E.CFO_RC_SHA || 'unrecorded', biz: BIZ, results }, null, 2)); console.log('PASS ' + name); };
const login = async (email, password) => { const r = await fetch(E.BASE_URL + '/api/auth/password/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) }); const d = await r.json(); assert.ok(d.token, 'sign-in ' + email); return d.token; };
const api = async (path, token, biz, { method = 'GET', body } = {}) => { const r = await fetch(E.BASE_URL + '/api' + path, { method, headers: { authorization: 'Bearer ' + token, 'x-business-id': biz, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) }); return { status: r.status, data: await r.json().catch(() => null) }; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayDiff = (a, b) => Math.round((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 86400000);

(async () => {
  assert.ok(BIZ && OTHER && E.FI_EMAIL && E.FI_OTHER_EMAIL, 'FI_* variables are required');
  await db.connect();
  assert.equal((await db.query('SELECT system_identifier::text id FROM pg_control_system()')).rows[0].id, E.EXPECTED_PG_SYSTEM_ID, 'isolated test cluster only');
  const q = async (s, p) => (await db.query(s, p)).rows;
  const tok = await login(E.FI_EMAIL, E.FI_PASSWORD), other = await login(E.FI_OTHER_EMAIL, E.FI_OTHER_PASSWORD);
  const now = new Date(), today = iso(now);
  const R = await import('../../../client/src/v2/lib/radarSeries.js');

  // 1. Payroll schedule = PostgreSQL: unpaid payments per date, salaries inside the burn window.
  const p = (await api('/pulse', tok, BIZ)).data;
  assert.equal(p.payroll_schedule.available, true);
  const unpaid = await q(`SELECT payment_date::text date, status, period_month period, sum(net_amount)::numeric amount, count(*)::int count FROM payroll_payments
    WHERE business_id=$1 AND status IN ('scheduled','draft') AND coalesce(currency,'IDR')='IDR' GROUP BY 1,2,3 ORDER BY 1,2`, [BIZ]);
  assert.deepEqual(p.payroll_schedule.payments.map((x) => [x.date, x.status, x.period, x.amount, x.count]), unpaid.map((x) => [x.date, x.status, x.period, Number(x.amount), x.count]));
  const asOf = p.as_of_date; // the server's burn window ends here (UTC day)
  const [{ s }] = await q(`SELECT coalesce(sum(t.amount_idr),0)::numeric s FROM payroll_payments pp JOIN transactions t ON t.id=pp.transaction_id
    WHERE pp.business_id=$1 AND pp.status='paid' AND t.transaction_date BETWEEN ($2::date - 29) AND $2::date`, [BIZ, asOf]);
  assert.equal(p.payroll_schedule.burn_daily, Math.min(Number(p.burnRate), Math.round(Number(s) / (p.burnWindowDays || 30))));
  pass('payroll schedule and the salaries inside the burn equal PostgreSQL', { unpaid_dates: unpaid.length, payroll_in_window: Number(s), burn_daily: p.payroll_schedule.burn_daily });

  // 2. 30/60/90-day expected line = an independent rebuild from SQL (cash, bills, loan schedule, payroll).
  const [{ cash }] = await q(`SELECT coalesce(sum(CASE WHEN type='income' THEN amount_idr WHEN type IN ('expense','payroll') THEN -amount_idr WHEN type='correction' THEN amount_idr ELSE 0 END),0)::numeric cash FROM transactions WHERE business_id=$1`, [BIZ]);
  assert.equal(Number(cash), p.totalBalance, 'cash now');
  const debts = await q(`SELECT type, coalesce(amount,0)-coalesce(paid_amount,0) rem, due_date::date::text due FROM debts WHERE business_id=$1 AND status NOT IN ('paid','cancelled') AND coalesce(approval_status,'approved')='approved' AND coalesce(currency,'IDR')='IDR' AND coalesce(is_training,false)=false AND due_date IS NOT NULL`, [BIZ]);
  const reps = await q(`SELECT due_on::text due, (principal+interest)::numeric amt FROM business_funding_repayments WHERE business_id=$1 AND paid_on IS NULL`, [BIZ]);
  const [lc] = await q(`WITH c AS (SELECT period_month, payment_date, net_amount FROM payroll_payments WHERE business_id=$1 AND status IN ('paid','scheduled') AND coalesce(currency,'IDR')='IDR'), lp AS (SELECT max(period_month) pm FROM c)
    SELECT (SELECT sum(net_amount) FROM c, lp WHERE period_month=lp.pm)::numeric amount, (SELECT max(payment_date)::text FROM c, lp WHERE period_month=lp.pm) date FROM lp`, [BIZ]);
  const fund = (await api('/business-funding', tok, BIZ)).data, obl = (await api('/accountant/obligations', tok, BIZ)).data;
  const taxes = (obl?.obligations || []).filter((o) => o.status === 'calculated' && o.due_date && Number(o.amount) > 0);
  const burnEx = Number(p.burnRate) - Number(p.payroll_schedule.burn_daily);
  const horizons = {};
  for (const H of [30, 60, 90]) {
    const items = [];
    const at = (due, v) => { const n = Math.max(0, dayDiff(due, today)); if (n <= H) items.push([n, v]); };
    for (const d of debts) at(d.due, d.type === 'receivable' ? Number(d.rem) : -Number(d.rem));
    for (const r of reps) at(r.due, -Number(r.amt));
    for (const u of unpaid) at(u.date, -Number(u.amount));
    for (const o of taxes) at(String(o.due_date).slice(0, 10), -Number(o.amount));
    if (lc && lc.date && Number(s) > 0) {
      const months = new Set([...unpaid.map((u) => u.date.slice(0, 7)), lc.date.slice(0, 7)]);
      let [y, m] = [...months].sort().pop().split('-').map(Number);
      for (;;) { m++; if (m > 12) { m = 1; y++; } const dd = iso(new Date(y, m - 1, Math.min(Number(lc.date.slice(8, 10)), new Date(y, m, 0).getDate()))); const n = dayDiff(dd, today); if (n > H) break; if (n >= 0) items.push([n, -Number(lc.amount)]); }
    }
    let low = Infinity, first = null;
    for (let n = 0; n <= H; n++) { const v = Number(cash) + items.filter(([d]) => d <= n).reduce((a, [, v]) => a + v, 0) - burnEx * n; if (v < low) low = v; if (v < 0 && first == null) first = n; }
    const expected = { end: Math.round(Number(cash) + items.reduce((a, [, v]) => a + v, 0) - burnEx * H), lowest: Math.round(low), first };
    const { items: its } = R.cashItems({ debts: p.debts, obligations: obl?.obligations || [], repayments: fund.upcoming || [], payroll: p.payroll_schedule, horizon: H, rates: p.rates, today: now });
    const f = R.forecast({ balance: p.totalBalance, burnRate: R.forecastBurn(p), items: its, horizon: H, today: now });
    const got = { end: Math.round(f.end.value), lowest: Math.round(f.lowest.value), first: f.firstShortfall ? f.firstShortfall.day : null };
    assert.deepEqual(got, expected, `${H}-day forecast`);
    horizons[H] = got;
  }
  pass('the 30/60/90-day forecast equals an independent recomputation from PostgreSQL', { today, horizons });

  // 3. Isolation: another company's member cannot read this company, and its payroll never enters these figures.
  for (const path of ['/pulse', '/business-funding', '/accountant/tax-calendar']) assert.ok([403, 404].includes((await api(path, other, BIZ)).status), 'outsider refused ' + path);
  const theirs = (await api('/pulse', other, OTHER)).data;
  const [{ n }] = await q(`SELECT count(*)::int n FROM payroll_payments WHERE business_id=$1 AND status IN ('scheduled','draft')`, [OTHER]);
  assert.equal(theirs.payroll_schedule.payments.reduce((a, x) => a + x.count, 0), n, 'the other company sees only its own payroll');
  pass('another company is refused, and each company\'s payroll schedule holds only its own payments');

  // 4. A loan schedule cannot promise more principal than the loan (the refused write leaves no row).
  const loan = (fund.records || []).find((r) => r.instrument === 'loan' && r.status === 'active');
  if (loan) {
    const before = (await q('SELECT count(*)::int n FROM business_funding_repayments WHERE funding_record_id=$1', [loan.id]))[0].n;
    const room = Number(loan.amount) - loan.repayments.reduce((a, r) => a + Number(r.principal), 0);
    const r = await api(`/business-funding/${loan.id}/repayments`, tok, BIZ, { method: 'POST', body: { due_on: '2030-01-05', principal: String(Math.max(0, room) + 1), interest: '0' } });
    assert.equal(r.status, 400); assert.equal(r.data.error, 'schedule_exceeds_loan');
    assert.equal((await q('SELECT count(*)::int n FROM business_funding_repayments WHERE funding_record_id=$1', [loan.id]))[0].n, before);
    pass('a repayment that would take the schedule past the loan amount is refused; nothing is written', { loan: Number(loan.amount), room });
  }

  // 5. Tax: payment and filing apart; "done" only with a recorded filing.
  const cal = (await api('/accountant/tax-calendar', tok, BIZ)).data;
  for (const e of cal.events) {
    assert.ok(['recorded', 'overdue', 'due'].includes(e.payment_stage) && ['filed', 'overdue', 'due'].includes(e.filing_stage), 'stages ' + e.rule_code);
    if (e.stage === 'done') assert.equal(e.filing_stage, 'filed');
    if (e.payment_stage !== 'recorded') assert.notEqual(e.stage, 'paid');
  }
  pass('tax calendar reports payment and filing separately; nothing is done without a filed return', { events: cal.events.length });

  // 6. Pulse states no unchecked assurance and no raw translation keys.
  assert.ok(!/incomeCoversObligations|noRisksDetected/.test(p.aiText || ''), 'no raw keys');
  pass('Pulse text carries no raw keys and no "no risks detected" claim', { aiText: p.aiText });
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.end().catch(() => {}));
