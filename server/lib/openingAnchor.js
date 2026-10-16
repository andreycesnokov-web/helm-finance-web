'use strict';
// D4-A — dated opening anchors (Business workspace only). The arithmetic lives in ONE place, the
// database (cfo_reanchor_math / cfo_apply_reanchor); this module only validates requests, prices
// FX for foreign-currency wallets and maps refusals. Nothing here repairs data on its own:
//   GET  /api/wallets/:id/reconciliation        read-only diagnostics (ledger vs every statement)
//   GET  /api/wallets/:id/reanchor-preview      what an explicit re-anchor would write (read-only)
//   POST /api/wallets/:id/reanchor-opening      the explicit, confirmed re-anchor of an existing wallet
const { openingRequest, errorBody } = require('./bankImportReview');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stable = (x) => Array.isArray(x) ? x.map(stable) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])])) : x;
const invalid = (code = 'import_invalid_request', status = 400) => Object.assign(new Error(code), { code, status });
// Mirror of public.fn_ledger_signed (070) for one statement row: what the booked row adds to the ledger.
function ledgerSigned(type, amount) {
  const a = Math.abs(Number(amount) || 0);
  if (type === 'income') return a;
  if (type === 'expense' || type === 'payroll') return -a;
  if (type === 'correction') return Number(amount) || 0;
  return 0;
}

// Company time zone rule shared with public.cfo_business_tz (see profileValidation).
const { validBusinessTimezone, IANA_AREA_LOCATION } = require('./profileValidation');

function reanchorBody(body, walletId) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['request_key', 'batch_id', 'opening'].includes(k))) throw invalid();
  if (!UUID.test(body.request_key || '') || !UUID.test(body.batch_id || '') || !UUID.test(walletId || '')) throw invalid();
  const opening = openingRequest({ ...(body.opening || {}), mode: 'reanchor' });
  return {
    request_key: body.request_key.toLowerCase(),
    batch_id: body.batch_id.toLowerCase(),
    intent: stable({ version: 1, operation: 'wallet_reanchor', wallet_id: walletId.toLowerCase(), batch_id: body.batch_id.toLowerCase(), opening }),
  };
}

function install(app, { auth, requireBusiness, supabase, fx, canView, canWrite }) {
  const send = (res, e) => { const r = errorBody(e); res.status(e.status || r.status).json(r.body); };
  const scoped = (handler) => async (req, res) => {
    res.set({ 'Cache-Control': 'private, no-store', Vary: 'Authorization' });
    try {
      const biz = await requireBusiness(req, res);
      if (!biz) return;
      if (!UUID.test(req.params.id || '')) throw invalid();
      await handler(req, res, biz);
    } catch (e) { send(res, e); }
  };

  app.get('/api/wallets/:id/reconciliation', auth, scoped(async (req, res, biz) => {
    if (!canView(biz.role)) return res.status(403).json({ error: 'import_review_forbidden' });
    const { data, error } = await supabase.rpc('rpc_wallet_reconciliation', { p_business: biz.business.id, p_wallet: req.params.id, p_actor: req.user.userId });
    if (error) throw error;
    res.json(data);
  }));

  app.get('/api/wallets/:id/reanchor-preview', auth, scoped(async (req, res, biz) => {
    if (!canView(biz.role)) return res.status(403).json({ error: 'import_review_forbidden' });
    if (!UUID.test(String(req.query.batch_id || ''))) throw invalid();
    const sameDay = req.query.same_day == null ? null : String(req.query.same_day);
    if (sameDay != null && !['covered', 'after'].includes(sameDay)) throw invalid();
    // The role check above plus this ownership read: the math function itself is scope-checked too.
    const { data: rec, error: e1 } = await supabase.rpc('rpc_wallet_reconciliation', { p_business: biz.business.id, p_wallet: req.params.id, p_actor: req.user.userId });
    if (e1) throw e1;
    const statement = (rec.statements || []).find(s => s.batch_id === String(req.query.batch_id).toLowerCase());
    if (!statement) throw invalid('batch_not_found', 404);
    const { data, error } = await supabase.rpc('cfo_reanchor_math', { p_business: biz.business.id, p_wallet: req.params.id,
      p_start: statement.start, p_extra: [], p_same_day: sameDay });
    if (error) throw error;
    res.json({ ...data, statement, reconciliation_risks: rec.risks, can_reanchor: canWrite(biz.role) });
  }));

  // Preview for the EXACT confirm plan: only rows that the confirm would book as new money count.
  // Excluded, linked (matched to an existing record), already-booked and duplicate-flagged rows
  // never move the anchor — the same filter the database applies when it recomputes under lock.
  app.post('/api/bank-imports/:id/reanchor-preview', auth, scoped(async (req, res, biz) => {
    if (!canView(biz.role)) return res.status(403).json({ error: 'import_review_forbidden' });
    const body = req.body || {};
    if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['rows', 'same_day'].includes(k))) throw invalid();
    if (body.same_day != null && !['covered', 'after'].includes(body.same_day)) throw invalid();
    const rows = Array.isArray(body.rows) ? body.rows : null;
    if (!rows || rows.length > 2000 || rows.some(r => !r || !UUID.test(r.row_id || '') || (r.match_action && !['create', 'create_transaction', 'link', 'exclude'].includes(r.match_action)))) throw invalid();
    if (new Set(rows.map(r => r.row_id.toLowerCase())).size !== rows.length) throw invalid();
    const { data: batches, error: be } = await supabase.from('bank_import_batches').select('id, wallet_id, statement_start, business_id')
      .eq('id', req.params.id).eq('business_id', biz.business.id).limit(1);
    if (be) throw be;
    const batch = batches?.[0];
    if (!batch?.wallet_id || !batch.statement_start) throw invalid('batch_not_found', 404);
    const { data: stored, error: re } = await supabase.from('bank_import_rows').select('*').eq('batch_id', batch.id).eq('business_id', biz.business.id);
    if (re) throw re;
    const byId = new Map((stored || []).map(r => [String(r.id).toLowerCase(), r]));
    const extra = [];
    for (const p of rows) {
      const row = byId.get(p.row_id.toLowerCase());
      if (!row) throw invalid('import_invalid_request');
      const action = p.match_action === 'link' ? 'link' : p.match_action === 'exclude' ? 'exclude' : 'create';
      if (action !== 'create' || row.linked_transaction_id || row.match_status === 'duplicate' || !row.tx_date) continue;
      const type = p.transaction_type || row.suggested_transaction_type || row.suggested_type || (row.direction === 'in' ? 'income' : 'expense');
      extra.push({ date: String(row.tx_date).slice(0, 10), signed: String(ledgerSigned(type, row.amount)) });
    }
    const { data, error } = await supabase.rpc('cfo_reanchor_math', { p_business: biz.business.id, p_wallet: batch.wallet_id,
      p_start: String(batch.statement_start).slice(0, 10), p_extra: extra, p_same_day: body.same_day ?? null });
    if (error) throw error;
    res.json({ ...data, counted_rows: extra.length, can_reanchor: canWrite(biz.role) });
  }));

  app.post('/api/wallets/:id/reanchor-opening', auth, scoped(async (req, res, biz) => {
    if (!canWrite(biz.role)) return res.status(403).json({ error: 'import_opening_forbidden' });
    const r = reanchorBody(req.body, req.params.id);
    let valuation = null;
    const { data: wallets, error: we } = await supabase.from('wallets').select('id, currency, business_id, scope').eq('id', req.params.id).eq('business_id', biz.business.id).limit(1);
    if (we) throw we;
    const wallet = wallets?.[0];
    if (!wallet || wallet.scope !== 'business') throw invalid('wallet_not_found', 404);
    if (String(wallet.currency || 'IDR').toUpperCase() !== 'IDR') {
      const { data: batches, error: be } = await supabase.from('bank_import_batches').select('statement_start').eq('id', r.batch_id).eq('business_id', biz.business.id).limit(1);
      if (be) throw be;
      if (!batches?.[0]?.statement_start) throw invalid('batch_not_found', 404);
      const d = new Date(String(batches[0].statement_start).slice(0, 10) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
      try {
        const v = await fx.toIdr(1, wallet.currency, d.toISOString().slice(0, 10));
        valuation = { anchor_rate: v.booked_rate, anchor_rate_source: v.rate_source };
      } catch { return res.status(502).json({ error: 'fx_unavailable', code: 'fx_unavailable', automatic_retry: false }); }
    }
    const { data, error } = await supabase.rpc('rpc_reanchor_wallet_opening', { p_business: biz.business.id, p_wallet: req.params.id,
      p_actor: req.user.userId, p_request_key: r.request_key, p_intent: r.intent, p_valuation: valuation });
    if (error) throw error;
    res.json(data);
  }));
}

module.exports = { install, validBusinessTimezone, reanchorBody, IANA_AREA_LOCATION };
