const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// --- Environment validation (fail fast, never log secret values) -----------

const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'BOT_TOKEN',
  'JWT_SECRET',
];

const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
  console.error('Set these variables before starting the server.');
  process.exit(1);
}

const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('client/dist'));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;

// --- Telegram Login verification ------------------------------------------

function verifyTelegramAuth(data) {
  const { hash, ...rest } = data;
  const secret = crypto.createHash('sha256').update(BOT_TOKEN).digest();
  const checkString = Object.keys(rest).sort()
    .map(k => `${k}=${rest[k]}`).join('\n');
  const hmac = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  if (hmac !== hash) return false;
  if (Date.now() / 1000 - parseInt(rest.auth_date) > 86400) return false;
  return true;
}

// --- Auth ------------------------------------------------------------------

app.post('/api/auth/telegram', async (req, res) => {
  try {
    const data = req.body;
    if (!verifyTelegramAuth(data)) {
      return res.status(401).json({ error: 'Invalid Telegram auth' });
    }
    const { data: user, error } = await supabase
      .from('users')
      .upsert({
        id: data.id,
        username: data.username || '',
        first_name: data.first_name || '',
      }, { onConflict: 'id' })
      .select().single();
    if (error) throw error;
    const token = jwt.sign({ userId: user.id, firstName: user.first_name }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Auth middleware -------------------------------------------------------

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Shared burn rate & runway helper ─────────────────────────────────────────
//
// Single source of truth for burn rate and runway across Pulse, AI CFO,
// Radar and Hiring Readiness.
//
// Algorithm: rolling 30-day window (preferred) → falls back to all-time / actual days.
// Why rolling 30-day?
//   expenses_this_month / days_elapsed is volatile: a large payroll on day 1
//   makes burn rate look 3–5× higher for the rest of the month.
//   A fixed 30-day rolling window smooths out single-day spikes and gives
//   a stable, representative daily burn rate.
//
// @param allTxs — all-time transactions array (must include `created_at`)
// @param totalBalance — computed total cash balance (all-time income − expenses + corrections)
// @returns { burn_rate_daily, runway_days, burn_window_days }
function computeBurnAndRunway(allTxs, totalBalance) {
  const CASH_OUT = ['expense', 'payroll'];
  const now      = new Date();
  const cutoff30 = new Date(now.getTime() - 30 * 86400000);

  // All expense transactions with a valid date
  const allExpTxs = (allTxs || []).filter(t => CASH_OUT.includes(t.type) && t.created_at);

  if (allExpTxs.length === 0) {
    // No expense data — cannot compute burn rate
    return { burn_rate_daily: 0, runway_days: null, burn_window_days: 0 };
  }

  // Days since oldest expense transaction (data window we actually have)
  const oldestDate  = allExpTxs.reduce((oldest, t) => {
    const d = new Date(t.created_at);
    return d < oldest ? d : oldest;
  }, now);
  const daysOfData  = Math.max(1, Math.round((now - oldestDate) / 86400000));

  let dailyBurn, windowDays;

  if (daysOfData >= 30) {
    // ── Full rolling 30-day window ────────────────────────────────────────
    const last30Exp = allExpTxs
      .filter(t => new Date(t.created_at) >= cutoff30)
      .reduce((s, t) => s + Number(t.amount_original || 0), 0);
    dailyBurn  = last30Exp / 30;
    windowDays = 30;
  } else {
    // ── Partial window — use all available data ───────────────────────────
    const totalExp = allExpTxs.reduce((s, t) => s + Number(t.amount_original || 0), 0);
    dailyBurn  = totalExp / daysOfData;
    windowDays = daysOfData;
  }

  const runwayDays = dailyBurn > 0 ? Math.round(totalBalance / dailyBurn) : null;

  return {
    burn_rate_daily:  Math.round(dailyBurn),
    runway_days:      runwayDays,
    burn_window_days: windowDays,   // how many days of data used (for UI transparency)
  };
}

// --- Pulse API -------------------------------------------------------------

app.get('/api/pulse', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const language = normalizeLanguage(req.query.language || await getUserLanguage(req.user.userId));
    const scope = req.query.scope || 'all';
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // ALL transactions ever · for total balance
    let allTxQuery = supabase.from('transactions').select('*').eq('user_id', userId);
    if (scope !== 'all') allTxQuery = allTxQuery.eq('scope', scope);
    const { data: allTxs } = await allTxQuery;

    // This month transactions · for burn rate
    let txQuery = supabase.from('transactions').select('*')
      .eq('user_id', userId).gte('created_at', monthStart);
    if (scope !== 'all') txQuery = txQuery.eq('scope', scope);
    const { data: txs } = await txQuery;

    // Debts — fetch all (including settled) so UI can show history; enrich with status
    const { data: rawDebts } = await supabase.from('debts')
      .select('*').eq('user_id', userId)
      .order('due_date', { ascending: true });
    const debts = enrichDebts(rawDebts);

    // Reminders
    const { data: reminders } = await supabase.from('reminders')
      .select('*').eq('user_id', userId).eq('is_done', false)
      .order('due_date', { ascending: true });

    // ── Cash impact model (Phase 1) ─────────────────────────────────────────
    // Single source of truth for which transaction types affect cash.
    // Used for BOTH totalBalance and per-account sourceMap so the two
    // figures always agree.
    //
    // CASH_IN:  types that increase total cash / account balance
    // CASH_OUT: types that decrease total cash / account balance
    // NEUTRAL:  types with no net cash effect (Phase 1 limitation noted below)
    //
    // Phase 1 known limitation:
    //   'transfer' is NEUTRAL for both total cash AND account balances.
    //   Reason: we store only one transaction leg (source account), not
    //   a double-entry from/to pair.  Without a reliable to_account field
    //   we cannot credit the destination account, so we treat transfers
    //   as cash-neutral to avoid phantom debits.
    //   TODO: when from_account / to_account schema fields are added,
    //         transfer should debit source account and credit destination.
    const CASH_IN  = ['income'];
    const CASH_OUT = ['expense', 'payroll'];
    // 'transfer', 'correction', unknown types → NEUTRAL (no effect)

    const allIncome      = (allTxs || []).filter(t => CASH_IN.includes(t.type)).reduce((s, t) => s + Number(t.amount_original), 0);
    const allExpenses    = (allTxs || []).filter(t => CASH_OUT.includes(t.type)).reduce((s, t) => s + Number(t.amount_original), 0);
    // correction: signed delta — positive = add cash, negative = remove cash. Excluded from income/expense KPIs.
    const allCorrections = (allTxs || []).filter(t => t.type === 'correction').reduce((s, t) => s + Number(t.amount_original), 0);
    const totalBalance = allIncome - allExpenses + allCorrections;

    // Virtual accounts from transaction sources.
    // Uses the same CASH_IN / CASH_OUT model as totalBalance so that
    // sum(account balances) == totalBalance for all source-linked transactions.
    // Null-source transactions are excluded from accounts but still count in totalBalance.
    const sourceMap = {};
    (allTxs || []).forEach(t => {
      if (!t.source) return; // null-source txs counted in totalBalance but belong to no named account
      const src = t.source;
      if (!sourceMap[src]) sourceMap[src] = { id: src, name: src, balance: 0, type: t.scope || 'personal' };
      if      (CASH_IN.includes(t.type))  sourceMap[src].balance += Number(t.amount_original);
      else if (CASH_OUT.includes(t.type)) sourceMap[src].balance -= Number(t.amount_original);
      else if (t.type === 'correction')   sourceMap[src].balance += Number(t.amount_original); // signed delta
      // transfer / unknown → neutral: no effect on account balance (Phase 1)
    });
    // Wallet-aware accounts:
    // If user has real wallets → use them with computed balance (wallet_id match OR legacy source name).
    // Otherwise fall back to virtual source-based accounts for full backward compatibility.
    const { data: userWallets } = await supabase
      .from('wallets').select('id, name, currency, type, entity_name, scope')
      .eq('user_id', userId).eq('is_active', true)
      .order('sort_order', { ascending: true });

    // Filter wallets by scope if requested
    const filteredWallets = (userWallets || []).filter(w =>
      scope === 'all' || (w.scope || 'business') === scope
    );

    let accounts;
    if (userWallets && userWallets.length > 0) {
      accounts = filteredWallets.map(w => {
        const related = (allTxs || []).filter(t =>
          t.wallet_id === w.id || (!t.wallet_id && t.source === w.name)
        );
        const balance = related.reduce((sum, t) => {
          if (CASH_IN.includes(t.type))  return sum + Number(t.amount_original || 0);
          if (CASH_OUT.includes(t.type)) return sum - Number(t.amount_original || 0);
          if (t.type === 'correction')   return sum + Number(t.amount_original || 0); // signed delta
          return sum;
        }, 0);
        return { id: w.id, name: w.name, balance, currency: w.currency || 'IDR', type: w.type || 'bank', entity_name: w.entity_name || null, scope: w.scope || 'business' };
      });
    } else {
      // Legacy mode: virtual accounts derived from transactions.source
      accounts = Object.values(sourceMap)
        .filter(a => a.balance !== 0 || true)
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 10);
    }

    // -- This month metrics (display only — income/expenses KPIs) -----------
    // Uses the same CASH_IN / CASH_OUT model for consistency.
    const income   = (txs || []).filter(t => CASH_IN.includes(t.type)).reduce((s, t) => s + Number(t.amount_original), 0);
    const expenses = (txs || []).filter(t => CASH_OUT.includes(t.type)).reduce((s, t) => s + Number(t.amount_original), 0);

    // -- Burn rate & runway via rolling 30-day window ----------------------
    // allTxs has created_at (select('*')), so computeBurnAndRunway works here.
    const burnMetrics = computeBurnAndRunway(allTxs, totalBalance);
    const burnRate = burnMetrics.burn_rate_daily;
    const runway   = burnMetrics.runway_days ?? 999;

    // Use remaining_amount (not original amount) and exclude paid/cancelled
    // Only approved/confirmed debts count as real obligations/expected cash.
    // pending_approval (Telegram drafts) are excluded from balance calculations.
    const openDebts    = (debts || []).filter(d =>
      !['paid', 'cancelled'].includes(d.status) &&
      (d.approval_status === 'approved' || !d.approval_status)
    );
    const pendingDebts = (debts || []).filter(d =>
      d.approval_status === 'pending_approval' && !['paid', 'cancelled'].includes(d.status)
    );
    const receivables  = openDebts.filter(d => d.type === 'receivable').reduce((s, d) => s + Number(d.remaining_amount || d.amount || 0), 0);
    const payables     = openDebts.filter(d => d.type === 'payable').reduce((s, d) => s + Number(d.remaining_amount || d.amount || 0), 0);
    const pendingReceivables = pendingDebts.filter(d => d.type === 'receivable').reduce((s, d) => s + Number(d.remaining_amount || d.amount || 0), 0);
    const pendingPayables    = pendingDebts.filter(d => d.type === 'payable').reduce((s, d) => s + Number(d.remaining_amount || d.amount || 0), 0);
    const netPosition = totalBalance + receivables - payables;

    // -- AI status ----------------------------------------------------------
    let aiStatus = 'healthy';
    let aiText = '';
    if (runway <= 7) {
      aiStatus = 'critical';
      aiText = `Only ${runway} days of runway left. Incoming payment needed.`;
    } else if (runway <= 14) {
      aiStatus = 'attention';
      aiText = `Runway ${runway} days. Check receivables - some obligations may reduce the buffer.`;
    } else {
      aiStatus = 'healthy';
      const runwayPart = language === 'ru' ? `Запас денег: ${runway} дней.` : language === 'id' ? `Cadangan kas: ${runway} hari.` : `Runway ${runway} days.`
      const incomePart = cx(language, 'incomeCoversObligations')
      const riskPart   = cx(language, 'noRisksDetected')
      aiText = `${runwayPart} ${incomePart} ${riskPart}`;
    }

    // -- Today's focus ------------------------------------------------------
    const todayFocus = [];
    (debts || []).slice(0, 2).forEach(d => {
      const daysLeft = Math.round((new Date(d.due_date) - now) / 86400000);
      if (daysLeft <= 14) {
        todayFocus.push({
          id: d.id,
         title: d.type === 'receivable' ? `Remind ${d.counterparty} to pay` : `Pay ${d.counterparty}`,
          meta: `${Number(d.amount).toLocaleString('en-US')} IDR · ${daysLeft > 0 ? daysLeft + ' days' : 'today'}`,
          type: d.type === 'receivable' ? 'receivable' : 'payable',
          done: false
        });
      }
    });
    (reminders || []).slice(0, 2).forEach(r => {
      todayFocus.push({ id: r.id, title: r.title, meta: r.meta || '', type: 'reminder', done: false });
    });

    res.json({
      scope, totalBalance, income, expenses, burnRate, runway,
      burnWindowDays: burnMetrics.burn_window_days,
      receivables, payables, netPosition,
      // Pending (Telegram drafts) — not in confirmed cash but visible in UI
      pendingReceivables, pendingPayables,
      aiStatus, aiText,
      accounts,
      debts: debts || [],
      reminders: reminders || [],
      todayFocus,
      recentTxs: (allTxs || []).slice(0, 5)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Debts API -------------------------------------------------------------

// ── Debt status helpers ────────────────────────────────────────────────────────
/**
 * computeDebtStatus — derive status + extra fields from a debt row.
 *
 * Status rules:
 *   cancelled   → stays cancelled
 *   is_settled  → paid
 *   paid_amount >= effective_amount → paid
 *   paid_amount > 0                 → partial
 *   due_date < today                → overdue
 *   otherwise                      → open
 *
 * Returns plain object with extra derived fields merged into debt.
 */
function computeDebtStatus(debt) {
  const effectiveAmount = Number(debt.original_amount || debt.amount || 0);
  const paidAmount      = Number(debt.paid_amount     || 0);
  const remaining       = Math.max(0, effectiveAmount - paidAmount);
  const now             = new Date();
  const dueDate         = debt.due_date ? new Date(debt.due_date) : null;
  const daysOverdue     = dueDate ? Math.floor((now - dueDate) / 86400000) : 0;

  let status;
  if (debt.status === 'cancelled')             status = 'cancelled';
  else if (debt.is_settled || remaining <= 0)  status = 'paid';
  else if (paidAmount > 0)                     status = 'partial';
  else if (dueDate && now > dueDate)           status = 'overdue';
  else                                         status = 'open';

  return {
    ...debt,
    // Normalised amounts
    original_amount: effectiveAmount,
    paid_amount:     paidAmount,
    remaining_amount: remaining,
    // Status
    status,
    days_overdue: status === 'overdue' ? daysOverdue : 0,
  };
}

/** Enrich an array of debts with computed status fields. */
function enrichDebts(debts) {
  return (debts || []).map(computeDebtStatus);
}

app.get('/api/debts', auth, async (req, res) => {
  const { type } = req.query;
  let query = supabase.from('debts')
    .select('*').eq('user_id', req.user.userId)
    .order('due_date', { ascending: true });
  // Optional type filter (receivable / payable)
  if (type) query = query.eq('type', type);
  // By default include all (not just unsettled) so UI can show paid history
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(enrichDebts(data));
});

app.post('/api/debts', auth, async (req, res) => {
  const userId = req.user.userId;
  // ── Plan limit: max_invoices_per_month (debts are the MVP invoice proxy) ──
  try {
    const access = await getCurrentAccess(userId);
    if (access) {
      const maxInvoices = access.limits.max_invoices_per_month;
      if (maxInvoices !== null && maxInvoices !== undefined) {
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const { count: usedCount } = await supabase
          .from('debts')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .gte('created_at', monthStart.toISOString());
        const used = usedCount || 0;
        if (isLimitReached(maxInvoices, used)) {
          return sendUpgradeRequired(res, 'invoices',
            `Monthly invoice/debt limit reached (${maxInvoices}/month on ${access.accessState.effectivePlan} plan)`,
            { limit: maxInvoices, usage: used, current_plan: access.accessState.effectivePlan }
          );
        }
      }
    }
  } catch (limitErr) {
    console.warn('[debts] limit check failed:', limitErr.message);
  }
  const amount = Number(req.body.amount || 0);
  const insertRow = {
    ...req.body,
    user_id:         userId,
    original_amount: amount,  // lock original amount; never mutate this
    paid_amount:     0,
    status:          'open',
    // Web App creations are always approved immediately
    source_channel:   req.body.source_channel  || 'web',
    approval_status:  req.body.approval_status || 'approved',
    created_by_user_id: userId,
  };
  const { data, error } = await supabase.from('debts')
    .insert(insertRow).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(computeDebtStatus(data));
});

app.patch('/api/debts/:id/settle', auth, async (req, res) => {
  // Fetch debt first to know original_amount
  const { data: debt } = await supabase.from('debts')
    .select('*').eq('id', req.params.id).eq('user_id', req.user.userId).single();
  const fullAmount = Number(debt?.original_amount || debt?.amount || 0);
  const { data, error } = await supabase.from('debts')
    .update({
      is_settled:   true,
      settled_at:   new Date().toISOString(),
      status:       'paid',
      paid_amount:  fullAmount,
    })
    .eq('id', req.params.id).eq('user_id', req.user.userId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(computeDebtStatus(data));
});

// ── PATCH /api/debts/:id/approve ─────────────────────────────────────────────
// Owner / admin approves a pending_approval debt created from Telegram.
app.patch('/api/debts/:id/approve', auth, async (req, res) => {
  const userId = req.user.userId;
  try {
    // Only owner/admin can approve
    const { data: mem } = await supabase.from('business_members')
      .select('role').eq('user_id', userId).eq('status', 'active')
      .in('role', ['owner', 'admin', 'cfo']).limit(1);
    if (!mem || mem.length === 0)
      return res.status(403).json({ error: 'Only owner, admin or CFO can approve' });

    const { data, error } = await supabase.from('debts')
      .update({
        approval_status:    'approved',
        approved_by_user_id: userId,
        approved_at:         new Date().toISOString(),
        status:              'open',   // activate the record
      })
      .eq('id', req.params.id).eq('user_id', userId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(computeDebtStatus(data));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/debts/:id/reject ──────────────────────────────────────────────
app.patch('/api/debts/:id/reject', auth, async (req, res) => {
  const userId = req.user.userId;
  const { reason } = req.body;
  try {
    const { data: mem } = await supabase.from('business_members')
      .select('role').eq('user_id', userId).eq('status', 'active')
      .in('role', ['owner', 'admin', 'cfo']).limit(1);
    if (!mem || mem.length === 0)
      return res.status(403).json({ error: 'Only owner, admin or CFO can reject' });

    const { data, error } = await supabase.from('debts')
      .update({
        approval_status:    'rejected',
        approved_by_user_id: userId,
        approved_at:         new Date().toISOString(),
        rejected_reason:     reason || null,
        status:              'cancelled',
      })
      .eq('id', req.params.id).eq('user_id', userId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(computeDebtStatus(data));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/debts/from-telegram ────────────────────────────────────────────
// Called by the Telegram bot to create a draft receivable / payable.
// Requires telegram_id → users.id mapping.
// Role check: employee creates pending_approval; owner/admin creates approved directly.
app.post('/api/debts/from-telegram', async (req, res) => {
  try {
    const {
      telegram_id,
      type,              // 'receivable' | 'payable'
      counterparty,
      amount,
      currency = 'IDR',
      due_date,
      description,
      raw_input_text,
      raw_input_language,
      confidence_score,
      attachment_url,
      business_owner_telegram_id, // owner's telegram id (to resolve user_id)
    } = req.body;

    if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' });
    if (!type || !['receivable', 'payable'].includes(type))
      return res.status(400).json({ error: 'type must be receivable or payable' });
    if (!amount || isNaN(Number(amount)))
      return res.status(400).json({ error: 'amount required' });

    // Resolve submitting user from telegram_id
    const { data: submitterUser } = await supabase.from('users')
      .select('id, name, role').eq('telegram_id', telegram_id).single();
    if (!submitterUser)
      return res.status(403).json({
        error: 'not_linked',
        message: 'Your Telegram is not linked to CFO AI. Contact your administrator.',
      });

    // Resolve business owner (user_id for the debt record)
    // If business_owner_telegram_id provided, use that; otherwise submitter is owner
    let ownerId = submitterUser.id;
    if (business_owner_telegram_id && business_owner_telegram_id !== telegram_id) {
      const { data: ownerUser } = await supabase.from('users')
        .select('id').eq('telegram_id', business_owner_telegram_id).single();
      if (ownerUser) ownerId = ownerUser.id;
    }

    // Check membership of submitter in owner's business
    const { data: membership } = await supabase.from('business_members')
      .select('role').eq('user_id', submitterUser.id).eq('status', 'active').limit(1);
    const memberRole = membership?.[0]?.role || 'member';

    // Owner/admin/CFO → approved immediately; others → pending_approval
    const isPrivileged = ['owner', 'admin', 'cfo'].includes(memberRole);
    const approvalStatus = isPrivileged ? 'approved' : 'pending_approval';
    const status         = isPrivileged ? 'open' : 'open'; // always open; pending shown via approval_status

    const amountNum = Number(amount);
    const insertRow = {
      user_id:               ownerId,
      type,
      counterparty:          counterparty || null,
      amount:                amountNum,
      original_amount:       amountNum,
      paid_amount:           0,
      currency:              currency || 'IDR',
      due_date:              due_date || null,
      description:           description || null,
      status,
      // Telegram / approval metadata
      source_channel:            'telegram',
      raw_input_text:            raw_input_text || null,
      raw_input_language:        raw_input_language || null,
      confidence_score:          confidence_score ? Number(confidence_score) : null,
      attachment_url:            attachment_url || null,
      created_by_user_id:        submitterUser.id,
      created_by_telegram_id:    Number(telegram_id),
      created_by_name:           submitterUser.name || null,
      created_by_role:           memberRole,
      approval_status:           approvalStatus,
      approved_by_user_id:       isPrivileged ? submitterUser.id : null,
      approved_at:               isPrivileged ? new Date().toISOString() : null,
    };

    const { data, error } = await supabase.from('debts').insert(insertRow).select().single();
    if (error) return res.status(500).json({ error: error.message });

    res.json({
      debt:            computeDebtStatus(data),
      approval_status: approvalStatus,
      needs_approval:  !isPrivileged,
      created_by:      submitterUser.name || telegram_id,
      role:            memberRole,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEAM & INVITE SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

function generateInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase(); // e.g. "A3K9PZ"
}

// ── GET /api/team ─────────────────────────────────────────────────────────────
// List all members of the caller's business.
app.get('/api/team', auth, async (req, res) => {
  const userId = req.user.userId;
  try {
    // Get business_id for this user
    const { data: memberships } = await supabase.from('business_members')
      .select('business_id, role').eq('user_id', userId).eq('status', 'active').limit(1);
    if (!memberships?.length) return res.status(403).json({ error: 'Not a member of any business' });
    const { business_id, role: myRole } = memberships[0];

    if (!['owner', 'admin', 'cfo'].includes(myRole))
      return res.status(403).json({ error: 'Only owner, admin or CFO can view team' });

    // Fetch all members + their user info
    const { data: members, error } = await supabase.from('business_members')
      .select('id, user_id, role, status, display_name, joined_at, invited_by, invite_code')
      .eq('business_id', business_id)
      .neq('status', 'removed')
      .order('joined_at', { ascending: true });
    if (error) throw error;

    // Enrich with user names
    const userIds = members.map(m => m.user_id);
    const { data: users } = await supabase.from('users')
      .select('id, name, first_name, last_name, telegram_id')
      .in('id', userIds);
    const userMap = Object.fromEntries((users || []).map(u => [u.id, u]));

    const enriched = members.map(m => {
      const u = userMap[m.user_id] || {};
      return {
        ...m,
        name: m.display_name || u.name || [u.first_name, u.last_name].filter(Boolean).join(' ') || `User ${m.user_id}`,
        telegram_id: u.telegram_id || null,
      };
    });

    // Also fetch active invites
    const { data: invites } = await supabase.from('business_invites')
      .select('id, code, role, label, max_uses, uses_count, expires_at, status, created_at')
      .eq('business_id', business_id).eq('status', 'active')
      .order('created_at', { ascending: false });

    res.json({ members: enriched, invites: invites || [], my_role: myRole, business_id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/team/invite ─────────────────────────────────────────────────────
// Generate a new invite code/link.
app.post('/api/team/invite', auth, async (req, res) => {
  const userId = req.user.userId;
  const { role = 'employee', label, max_uses = 1, expires_days = 7 } = req.body;

  const VALID_ROLES = ['employee', 'manager', 'cfo', 'admin'];
  if (!VALID_ROLES.includes(role))
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });

  try {
    const { data: memberships } = await supabase.from('business_members')
      .select('business_id, role').eq('user_id', userId).eq('status', 'active').limit(1);
    if (!memberships?.length) return res.status(403).json({ error: 'Not a member of any business' });
    const { business_id, role: myRole } = memberships[0];

    if (!['owner', 'admin'].includes(myRole))
      return res.status(403).json({ error: 'Only owner or admin can create invites' });

    // Cannot invite higher/equal role than yourself (only owner can invite admin)
    const ROLE_RANK = { employee: 1, manager: 2, cfo: 3, admin: 4, owner: 5 };
    if (ROLE_RANK[role] >= ROLE_RANK[myRole])
      return res.status(403).json({ error: `You cannot invite someone with role "${role}" — your role is "${myRole}"` });

    // Generate unique code
    let code, exists = true;
    while (exists) {
      code = generateInviteCode();
      const { data: check } = await supabase.from('business_invites').select('id').eq('code', code).single();
      exists = !!check;
    }

    const expiresAt = new Date(Date.now() + expires_days * 86400000).toISOString();
    const { data: invite, error } = await supabase.from('business_invites').insert({
      business_id,
      invited_by: userId,
      code,
      role,
      label: label || null,
      max_uses: Number(max_uses) || 1,
      expires_at: expiresAt,
    }).select().single();
    if (error) throw error;

    res.json({ invite, invite_url: `/invite/${code}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/team/invites/:code ────────────────────────────────────────────
// Revoke an invite (owner/admin only).
app.delete('/api/team/invites/:code', auth, async (req, res) => {
  const userId = req.user.userId;
  try {
    const { data: memberships } = await supabase.from('business_members')
      .select('business_id, role').eq('user_id', userId).eq('status', 'active').limit(1);
    if (!memberships?.length) return res.status(403).json({ error: 'Not a member' });
    if (!['owner', 'admin'].includes(memberships[0].role))
      return res.status(403).json({ error: 'Only owner/admin can revoke invites' });

    await supabase.from('business_invites')
      .update({ status: 'revoked' })
      .eq('code', req.params.code)
      .eq('business_id', memberships[0].business_id);

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/team/members/:memberId ────────────────────────────────────────
// Update role or status.
app.patch('/api/team/members/:memberId', auth, async (req, res) => {
  const userId = req.user.userId;
  const { role, status } = req.body;
  try {
    const { data: myMem } = await supabase.from('business_members')
      .select('business_id, role').eq('user_id', userId).eq('status', 'active').limit(1);
    if (!myMem?.length) return res.status(403).json({ error: 'Not a member' });
    if (!['owner', 'admin'].includes(myMem[0].role))
      return res.status(403).json({ error: 'Only owner/admin can change roles' });

    const update = {};
    if (role)   update.role   = role;
    if (status) update.status = status;

    const { data, error } = await supabase.from('business_members')
      .update(update)
      .eq('id', req.params.memberId)
      .eq('business_id', myMem[0].business_id)
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/team/members/:memberId ───────────────────────────────────────
// Remove a member (soft: status = removed).
app.delete('/api/team/members/:memberId', auth, async (req, res) => {
  const userId = req.user.userId;
  try {
    const { data: myMem } = await supabase.from('business_members')
      .select('business_id, role').eq('user_id', userId).eq('status', 'active').limit(1);
    if (!myMem?.length) return res.status(403).json({ error: 'Not a member' });
    if (!['owner', 'admin'].includes(myMem[0].role))
      return res.status(403).json({ error: 'Only owner/admin can remove members' });

    // Prevent removing yourself
    const { data: target } = await supabase.from('business_members')
      .select('user_id, role').eq('id', req.params.memberId).single();
    if (target?.user_id === userId)
      return res.status(400).json({ error: 'Cannot remove yourself' });
    if (target?.role === 'owner')
      return res.status(403).json({ error: 'Cannot remove business owner' });

    await supabase.from('business_members')
      .update({ status: 'removed' })
      .eq('id', req.params.memberId)
      .eq('business_id', myMem[0].business_id);

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/invite/:code  (PUBLIC — no auth) ─────────────────────────────────
// Returns invite info so the join page can show company name + role.
app.get('/api/invite/:code', async (req, res) => {
  try {
    const { data: invite, error } = await supabase.from('business_invites')
      .select('id, code, role, label, max_uses, uses_count, expires_at, status, business_id')
      .eq('code', req.params.code.toUpperCase()).single();
    if (error || !invite) return res.status(404).json({ error: 'Invite not found' });
    if (invite.status !== 'active') return res.status(410).json({ error: 'Invite has been revoked or expired', status: invite.status });
    if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: 'Invite has expired' });
    if (invite.uses_count >= invite.max_uses) return res.status(410).json({ error: 'Invite has reached its use limit' });

    // Fetch business name
    const { data: biz } = await supabase.from('businesses').select('name').eq('id', invite.business_id).single();
    res.json({
      code:          invite.code,
      role:          invite.role,
      label:         invite.label,
      business_name: biz?.name || 'CFO AI',
      expires_at:    invite.expires_at,
      uses_left:     invite.max_uses - invite.uses_count,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/invite/:code/accept  (auth required) ───────────────────────────
// Accept invite → create/update business_members row.
// Called after user authenticates with Telegram on the invite page.
app.post('/api/invite/:code/accept', auth, async (req, res) => {
  const userId = req.user.userId;
  try {
    const code = req.params.code.toUpperCase();
    const { data: invite, error: iErr } = await supabase.from('business_invites')
      .select('*').eq('code', code).single();
    if (iErr || !invite) return res.status(404).json({ error: 'Invite not found' });
    if (invite.status !== 'active') return res.status(410).json({ error: 'Invite is no longer active' });
    if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: 'Invite has expired' });
    if (invite.uses_count >= invite.max_uses) return res.status(410).json({ error: 'Invite limit reached' });

    // Check if user already a member
    const { data: existing } = await supabase.from('business_members')
      .select('id, role, status').eq('user_id', userId).eq('business_id', invite.business_id).single();

    if (existing) {
      if (existing.status === 'active')
        return res.json({ ok: true, already_member: true, role: existing.role, message: 'Already a member of this business' });
      // Reactivate if removed
      await supabase.from('business_members')
        .update({ status: 'active', role: invite.role, invite_code: code })
        .eq('id', existing.id);
    } else {
      // Get user display name
      const { data: u } = await supabase.from('users').select('name, first_name, last_name').eq('id', userId).single();
      const displayName = u?.name || [u?.first_name, u?.last_name].filter(Boolean).join(' ') || null;

      await supabase.from('business_members').insert({
        business_id:  invite.business_id,
        user_id:      userId,
        role:         invite.role,
        status:       'active',
        display_name: displayName,
        joined_at:    new Date().toISOString(),
        invited_by:   invite.invited_by,
        invite_code:  code,
      });
    }

    // Increment uses_count; mark exhausted if max reached
    const newCount = invite.uses_count + 1;
    await supabase.from('business_invites').update({
      uses_count: newCount,
      status: newCount >= invite.max_uses ? 'exhausted' : 'active',
    }).eq('id', invite.id);

    res.json({ ok: true, role: invite.role, business_id: invite.business_id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Transactions API ------------------------------------------------------

app.get('/api/transactions', auth, async (req, res) => {
  const { scope, period = 'month', type } = req.query;
  const now = new Date();

  let query = supabase.from('transactions').select('*')
    .eq('user_id', req.user.userId)
    .order('created_at', { ascending: false });

  // Period filter — 'all' skips date filter entirely (used by Payroll page)
  if (period !== 'all') {
    let from;
    if (period === 'today') from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    else if (period === 'week') { from = new Date(now); from.setDate(now.getDate() - 7); }
    else from = new Date(now.getFullYear(), now.getMonth(), 1); // default: this month
    query = query.gte('created_at', from.toISOString());
  }

  // Scope filter
  if (scope && scope !== 'all') query = query.eq('scope', scope);

  // Type filter — allows Payroll page to fetch only payroll transactions
  if (type && type !== 'all') query = query.eq('type', type);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// --- Reminders API ---------------------------------------------------------

app.post('/api/reminders', auth, async (req, res) => {
  const { data, error } = await supabase.from('reminders')
    .insert({ ...req.body, user_id: req.user.userId }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/reminders/:id/done', auth, async (req, res) => {
  const { data, error } = await supabase.from('reminders')
    .update({ is_done: true }).eq('id', req.params.id)
    .eq('user_id', req.user.userId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/reminders/:id/snooze', auth, async (req, res) => {
  const { days, until } = req.body;
  let snoozedUntil;

  if (until !== undefined) {
    const d = new Date(until);
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid date format' });
    if (d <= new Date()) return res.status(400).json({ error: 'Snooze date must be in the future' });
    snoozedUntil = d.toISOString();
  } else if (days !== undefined) {
    const n = Number(days);
    if (![1, 3, 7].includes(n)) return res.status(400).json({ error: 'days must be 1, 3, or 7' });
    snoozedUntil = new Date(Date.now() + n * 86400000).toISOString();
  } else {
    return res.status(400).json({ error: 'Provide days (1, 3, or 7) or until (ISO date string)' });
  }

  const { data, error } = await supabase.from('reminders')
    .update({ snoozed_until: snoozedUntil })
    .eq('id', req.params.id)
    .eq('user_id', req.user.userId)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// --- Parse API (AI) --------------------------------------------------------

const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.post('/api/parse', auth, async (req, res) => {
  try {
    const { text } = req.body;
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Ты финансовый ассистент. Найди ВСЕ транзакции в тексте.

Верни ТОЛЬКО JSON массив без markdown, без пояснений:
[{"type":"expense или income или payroll или transfer","amount":число,"currency":"IDR по умолчанию","description":"краткое описание","source":"счёт или null","scope":"personal или business","project":"проект или null","category":"категория или null"}]

Правила:
- Суммы всегда положительные. Тип определяет знак.
- type="payroll" если это зарплата, salary, gaji, bonus сотруднику, commission, payroll — даже если написано как expense. Используй payroll, не expense.
- type="transfer" если деньги переводятся между своими счётами.
- type="income" если деньги поступают извне.
- type="expense" для обычных расходов (еда, транспорт, сервисы, аренда и т.д.).
- source: название счёта/кошелька если упомянуто, иначе null.
- scope: "business" если упомянут сотрудник, компания, бизнес-расход. "personal" если не ясно.
- Валюта: IDR если не указана.

Текст: "${text}"`
      }]
    });
    const raw = response.content[0].text.trim().replace(/\`\`\`json\n?/g, '').replace(/\`\`\`\n?/g, '').trim();
    const transactions = JSON.parse(raw);
    res.json({ transactions: Array.isArray(transactions) ? transactions : [transactions] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/transactions/batch', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { transactions } = req.body;

    // ── Plan limit: max_transactions_per_month ───────────────────────────────
    // Corrections by type are counted but super-admin bypass is handled by
    // the /api/admin/ path which uses requireAdmin middleware.
    try {
      const access = await getCurrentAccess(userId);
      if (access) {
        const maxTx = access.limits.max_transactions_per_month;
        if (maxTx !== null && maxTx !== undefined) {
          // Count non-correction transactions this calendar month
          const monthStart = new Date();
          monthStart.setDate(1);
          monthStart.setHours(0, 0, 0, 0);
          const { count: usedCount } = await supabase
            .from('transactions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .gte('created_at', monthStart.toISOString());
          const used = usedCount || 0;
          const batchSize = (transactions || []).length;
          if (isLimitReached(maxTx, used)) {
            return sendUpgradeRequired(res, 'transactions',
              `Monthly transaction limit reached (${maxTx}/month on ${access.accessState.effectivePlan} plan)`,
              { limit: maxTx, usage: used, current_plan: access.accessState.effectivePlan }
            );
          }
          // Partial batch: reject entire batch if it would exceed limit
          if (used + batchSize > maxTx) {
            return sendUpgradeRequired(res, 'transactions',
              `This batch of ${batchSize} would exceed your monthly limit. You have ${maxTx - used} transaction${maxTx - used === 1 ? '' : 's'} remaining this month.`,
              { limit: maxTx, usage: used, remaining: maxTx - used, current_plan: access.accessState.effectivePlan }
            );
          }
        }
      }
    } catch (limitErr) {
      // Fail open — don't block transactions if limit check itself errors
      console.warn('[transactions/batch] limit check failed:', limitErr.message);
    }

    // ── Wallet validation ────────────────────────────────────────────────────
    // Collect distinct wallet_ids supplied in this batch
    const requestedWalletIds = [...new Set(
      transactions.map(t => t.wallet_id).filter(Boolean)
    )];

    let walletMap = {}; // id → { id, name, currency }
    if (requestedWalletIds.length > 0) {
      const { data: ownedWallets, error: wErr } = await supabase
        .from('wallets')
        .select('id, name, currency')
        .eq('user_id', userId)
        .in('id', requestedWalletIds);
      if (wErr) throw wErr;

      // All supplied wallet_ids must belong to this user
      const ownedIds = new Set((ownedWallets || []).map(w => w.id));
      const invalidId = requestedWalletIds.find(id => !ownedIds.has(id));
      if (invalidId) {
        return res.status(400).json({ error: `Invalid or inaccessible wallet_id: ${invalidId}` });
      }

      walletMap = Object.fromEntries((ownedWallets || []).map(w => [w.id, w]));
    }

    // ── Build rows ───────────────────────────────────────────────────────────
    const rows = transactions.map(t => {
      // Auto-fill source from wallet name if wallet_id provided but source is empty
      const wallet        = t.wallet_id ? walletMap[t.wallet_id] : null;
      const resolvedSource = t.source || (wallet ? wallet.name : null);

      return {
        user_id:                userId,
        type:                   t.type,
        amount_original:        t.amount,
        currency_original:      t.currency || 'IDR',
        amount_idr:             t.currency === 'IDR' ? t.amount : (t.amount_idr || t.amount),
        description:            t.description,
        source:                 resolvedSource            || null,
        scope:                  t.scope                   || 'personal',
        project:                t.project                 || null,
        category:               t.category                || null,
        // Always set transaction_date so period filters work correctly
        transaction_date:       t.transaction_date        || new Date().toISOString().slice(0, 10),
        // Reference data (Phase 1 — all nullable, backward compatible)
        cashflow_category_id:   t.cashflow_category_id    || null,
        counterparty_id:        t.counterparty_id          || null,
        counterparty_name:      t.counterparty_name        || null,
        business_direction_id:  t.business_direction_id    || null,
        activity_type_id:       t.activity_type_id         || null,
        // Wallet (TASK 29B — nullable, backward compatible)
        wallet_id:              t.wallet_id                || null,
      };
    });

    const { error } = await supabase.from('transactions').insert(rows);
    if (error) throw error;
    res.json({ saved: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Reference Data API ---------------------------------------------------
// Phase 1: user_id-scoped reference tables.
// Future: migrate to business_id-scoped model.

// GET /api/cashflow-categories — user-owned active categories only
app.get('/api/cashflow-categories', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { data, error } = await supabase
      .from('cashflow_categories')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw error;
    res.json({ categories: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/cashflow-categories — create user custom category
app.post('/api/cashflow-categories', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, group_type, activity_type, sub_category, description } = req.body;
    if (!name || !group_type) return res.status(400).json({ error: 'name and group_type required' });
    const { data, error } = await supabase
      .from('cashflow_categories')
      .insert({ user_id: userId, name, group_type, activity_type: activity_type || null, sub_category: sub_category || null, description: description || null, is_system: false })
      .select()
      .single();
    if (error) throw error;
    res.json({ category: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/cashflow-categories/:id — update user's own custom category
app.patch('/api/cashflow-categories/:id', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, group_type, activity_type, sub_category, description, is_active } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (group_type !== undefined) updates.group_type = group_type;
    if (activity_type !== undefined) updates.activity_type = activity_type;
    if (sub_category !== undefined) updates.sub_category = sub_category;
    if (description !== undefined) updates.description = description;
    if (is_active !== undefined) updates.is_active = is_active;
    const { data, error } = await supabase
      .from('cashflow_categories')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', userId)   // can only edit own categories, not system ones
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Category not found or not editable' });
    res.json({ category: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/cashflow-categories/:id — soft archive user's own category
app.delete('/api/cashflow-categories/:id', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { data, error } = await supabase
      .from('cashflow_categories')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Category not found' });
    res.json({ category: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/counterparties — user's counterparties, optional ?q=search
app.get('/api/counterparties', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    let query = supabase
      .from('counterparties')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('name', { ascending: true });
    if (req.query.q) query = query.ilike('name', `%${req.query.q}%`);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ counterparties: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/counterparties — create counterparty
app.post('/api/counterparties', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, group_name, type, email, phone, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const { data, error } = await supabase
      .from('counterparties')
      .insert({ user_id: userId, name, group_name: group_name || null, type: type || null, email: email || null, phone: phone || null, notes: notes || null })
      .select()
      .single();
    if (error) throw error;
    res.json({ counterparty: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/counterparties/:id
app.patch('/api/counterparties/:id', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, group_name, type, email, phone, notes, is_active } = req.body;
    const { data, error } = await supabase
      .from('counterparties')
      .update({ name, group_name, type, email, phone, notes, is_active, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Counterparty not found' });
    res.json({ counterparty: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/business-directions — user-owned active directions only
app.get('/api/business-directions', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { data, error } = await supabase
      .from('business_directions')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    res.json({ directions: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/business-directions — create user direction
app.post('/api/business-directions', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, slug } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const { data, error } = await supabase
      .from('business_directions')
      .insert({ user_id: userId, name: name.trim(), slug: slug || null, is_system: false, is_active: true, source: 'user' })
      .select()
      .single();
    if (error) throw error;
    res.json({ direction: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/business-directions/:id — soft archive
app.delete('/api/business-directions/:id', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { data, error } = await supabase
      .from('business_directions')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Direction not found' });
    res.json({ direction: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/activity-types — user-owned active activity types only
app.get('/api/activity-types', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { data, error } = await supabase
      .from('activity_types')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    res.json({ activityTypes: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/activity-types — create user activity type
app.post('/api/activity-types', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, code } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const { data, error } = await supabase
      .from('activity_types')
      .insert({ user_id: userId, name: name.trim(), code: code || null, is_system: false, is_active: true, source: 'user' })
      .select()
      .single();
    if (error) throw error;
    res.json({ activityType: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/activity-types/:id — soft archive
app.delete('/api/activity-types/:id', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { data, error } = await supabase
      .from('activity_types')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Activity type not found' });
    res.json({ activityType: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── SaaS Foundation Helpers ──────────────────────────────────────────────────
//
// Phase 1 bridge: existing financial data remains user_id-scoped.
// Future migration: transactions/wallets/debts/reminders will move
// to business_id-scoped model.

/**
 * Ensure every authenticated user has a default business + owner membership.
 * Idempotent: safe to call on every request that needs access context.
 */
async function ensureDefaultBusiness(userId, firstName) {
  // Look for existing active membership
  const { data: memberships } = await supabase
    .from('business_members')
    .select('role, status, business_id, businesses(*)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1);

  if (memberships && memberships.length > 0) {
    const m = memberships[0];
    return { business: m.businesses, membership: { role: m.role, status: m.status } };
  }

  // No business — bootstrap default with 7-day trial
  const now = new Date();
  const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const name = `${firstName || 'My'} Business`;

  const { data: business, error: bErr } = await supabase
    .from('businesses')
    .insert({
      owner_user_id:       userId,
      name,
      base_currency:       'IDR',
      plan:                'free',
      trial_status:        'active',
      trial_started_at:    now.toISOString(),
      trial_ends_at:       trialEnd.toISOString(),
      subscription_status: 'trialing',
    })
    .select()
    .single();
  if (bErr) throw bErr;

  await supabase.from('business_members').insert({
    business_id: business.id,
    user_id:     userId,
    role:        'owner',
    status:      'active',
  });

  return { business, membership: { role: 'owner', status: 'active' } };
}

/**
 * Compute effective access state from a business row.
 * Effective plan rules:
 *   trial active           → founder-level access (full features)
 *   subscription active    → business.plan
 *   expired / no sub       → free
 */
function getAccessState(business) {
  const now = new Date();
  const trialEnd = business.trial_ends_at ? new Date(business.trial_ends_at) : null;
  const isTrialActive =
    business.trial_status === 'active' &&
    trialEnd !== null &&
    now < trialEnd;

  const daysLeft = isTrialActive && trialEnd
    ? Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)))
    : 0;

  let effectivePlan;
  if (isTrialActive) {
    effectivePlan = 'founder'; // Full access during trial
  } else if (business.subscription_status === 'active') {
    effectivePlan = business.plan;
  } else {
    effectivePlan = 'free'; // Expired trial, no paid sub
  }

  return { isTrialActive, daysLeft, effectivePlan };
}

/**
 * Load full access context for a userId.
 * Returns null if no business found (before ensureDefaultBusiness call).
 */
async function getCurrentAccess(userId) {
  const { data: memberships } = await supabase
    .from('business_members')
    .select('role, status, businesses(*)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1);

  if (!memberships || memberships.length === 0) return null;

  const m = memberships[0];
  const business = m.businesses;
  const accessState = getAccessState(business);

  const { data: limits } = await supabase
    .from('plan_limits')
    .select('*')
    .eq('plan', accessState.effectivePlan)
    .single();

  return {
    business,
    membership: { role: m.role, status: m.status },
    accessState,
    limits: limits || {},
  };
}

/** Returns true if the feature boolean flag is enabled in the access context. */
function hasFeature(access, featureName) {
  if (!access) return false;
  return access.limits[featureName] === true;
}

/**
 * Send a standardised 403 upgrade_required response.
 * requiredPlan is advisory — no billing logic here.
 */
function sendUpgradeRequired(res, feature, message, extra = {}) {
  res.status(403).json({
    error: message || 'Plan limit reached',
    feature,
    upgrade_required: true,
    ...extra,
  });
}

/**
 * Assert feature is available; sends 403 and returns false if not.
 * Usage: if (!assertFeature(access, 'payroll_enabled', res)) return;
 */
function assertFeature(access, featureName, res) {
  if (!hasFeature(access, featureName)) {
    sendUpgradeRequired(res, featureName, 'Feature not available on your current plan', {
      current_plan: access?.accessState?.effectivePlan || 'free',
    });
    return false;
  }
  return true;
}

/**
 * Check if a numeric usage limit is reached.
 * Returns true (limit reached) when currentUsage >= limit.
 * A null/undefined limit means unlimited → returns false.
 */
function isLimitReached(limitValue, currentUsage) {
  if (limitValue === null || limitValue === undefined) return false;
  return currentUsage >= limitValue;
}

// --- Language helpers -------------------------------------------------------

function normalizeLanguage(lang) {
  return ['en', 'ru', 'id'].includes(lang) ? lang : 'en'
}

async function getUserLanguage(userId) {
  try {
    const { data } = await supabase
      .from('users')
      .select('language')
      .eq('id', userId)
      .single()
    return normalizeLanguage(data?.language)
  } catch { return 'en' }
}

const CONTEXT_STRINGS = {
  en: {
    financiallyStable: 'Business is financially stable',
    cashStrong: 'Cash is strong with no urgent payment risks detected. Keep monitoring monthly.',
    notEnoughExpenseHistory: 'Not enough expense history',
    runwayUnknown: 'Runway unknown — add expenses',
    noPayables: 'No payables',
    noReceivables: 'No receivables',
    noMonthlyData: 'No monthly data yet',
    noRisks: 'No significant risks',
    financesStable: 'Finances look stable',
    noUrgentActions: 'No urgent actions detected. Keep adding transactions daily and review cash weekly.',
    needsAttention: 'Needs Attention',
    someAreasNeedAttention: 'Some areas need attention.',
    healthy: 'Healthy',
    critical: 'Critical',
    notEnoughData: 'Not enough data',
    addWalletsHint: 'Add wallets, transactions and expenses to calculate safe hiring budget.',
    readyToHire: 'Ready to hire',
    hireCaution: 'Proceed with caution',
    notRecommended: 'Not recommended',
  },
  ru: {
    financiallyStable: 'Финансы бизнеса стабильны',
    cashStrong: 'Денежная позиция стабильная, срочных рисков нет. Продолжайте контролировать финансы регулярно.',
    notEnoughExpenseHistory: 'Недостаточно истории расходов',
    runwayUnknown: 'Запас денег неизвестен — добавьте расходы',
    noPayables: 'Обязательств нет',
    noReceivables: 'Дебиторки нет',
    noMonthlyData: 'За месяц пока нет данных',
    noRisks: 'Существенных рисков нет',
    financesStable: 'Финансы выглядят стабильно',
    noUrgentActions: 'Срочных действий нет. Продолжайте добавлять операции и проверять деньги еженедельно.',
    needsAttention: 'Требует внимания',
    someAreasNeedAttention: 'Есть зоны, которые требуют внимания.',
    healthy: 'Хорошо',
    critical: 'Критично',
    notEnoughData: 'Недостаточно данных',
    addWalletsHint: 'Добавьте кошельки, операции и расходы, чтобы рассчитать безопасный бюджет на найм.',
    readyToHire: 'Можно нанимать',
    hireCaution: 'Осторожно',
    notRecommended: 'Не рекомендуется',
  },
  id: {
    financiallyStable: 'Keuangan bisnis stabil',
    cashStrong: 'Posisi kas stabil dan tidak ada risiko pembayaran mendesak. Tetap pantau keuangan secara rutin.',
    notEnoughExpenseHistory: 'Riwayat pengeluaran belum cukup',
    runwayUnknown: 'Cadangan kas belum diketahui — tambahkan pengeluaran',
    noPayables: 'Tidak ada kewajiban',
    noReceivables: 'Tidak ada piutang',
    noMonthlyData: 'Belum ada data bulanan',
    noRisks: 'Tidak ada risiko signifikan',
    financesStable: 'Keuangan terlihat stabil',
    noUrgentActions: 'Tidak ada tindakan mendesak. Tetap tambah transaksi harian dan tinjau cash flow setiap minggu.',
    needsAttention: 'Perlu perhatian',
    someAreasNeedAttention: 'Ada beberapa area yang perlu diperhatikan.',
    healthy: 'Baik',
    critical: 'Kritis',
    notEnoughData: 'Data belum cukup',
    addWalletsHint: 'Tambahkan dompet, transaksi, dan pengeluaran untuk menghitung anggaran rekrutmen yang aman.',
    readyToHire: 'Siap merekrut',
    hireCaution: 'Hati-hati',
    notRecommended: 'Tidak disarankan',
    noRisksDetected: 'Tidak ada risiko terdeteksi.',
    incomeCoversObligations: 'Pemasukan menutup kewajiban.',
  },
}
function cx(language, key) {
  const lang = normalizeLanguage(language)
  return (CONTEXT_STRINGS[lang] || CONTEXT_STRINGS.en)[key] || CONTEXT_STRINGS.en[key] || key
}

function getCfoOutOfScopeResponse(language) {
  if (language === 'ru') {
    return 'Извините, я не могу помочь с этим вопросом. Я CFO AI-консультант и отвечаю только на вопросы, связанные с финансами бизнеса: cash flow, дебиторкой, обязательствами, расходами, запасом денег, зарплатами и финансовыми решениями владельца бизнеса.'
  }
  if (language === 'id') {
    return 'Maaf, saya tidak bisa membantu pertanyaan itu. Saya adalah CFO AI — konsultan keuangan untuk pemilik bisnis. Saya hanya menjawab pertanyaan yang terkait dengan keuangan bisnis: cash flow, piutang, kewajiban, pengeluaran, cadangan kas, payroll, dan keputusan keuangan pemilik bisnis.'
  }
  return "Sorry, I can't help with that. I'm CFO AI — a financial consultant for business owners. I only answer questions related to business finance: cash flow, receivables, payables, expenses, runway, payroll and financial decisions."
}

const NOTIFICATION_TEMPLATES = {
  runway_warning: {
    en: (p) => `Runway: ${p.days} days. Review upcoming payments and protect your cash buffer.`,
    ru: (p) => `Запас денег: ${p.days} дней. Проверьте ближайшие платежи и защитите денежный буфер.`,
    id: (p) => `Cadangan kas: ${p.days} hari. Periksa pembayaran yang akan datang dan lindungi kas bisnis Anda.`,
  },
  cash_critical: {
    en: () => 'Cash is critically low. Immediate action required.',
    ru: () => 'Деньги на критически низком уровне. Требуются немедленные действия.',
    id: () => 'Kas berada di level kritis. Diperlukan tindakan segera.',
  },
  receivable_overdue: {
    en: (p) => `Receivable overdue: ${p.counterparty} owes ${p.amount} (${p.days} days overdue).`,
    ru: (p) => `Просрочена дебиторка: ${p.counterparty} должен ${p.amount} (просрочено на ${p.days} дней).`,
    id: (p) => `Piutang terlambat: ${p.counterparty} berutang ${p.amount} (terlambat ${p.days} hari).`,
  },
  payable_due_soon: {
    en: (p) => `Payment due soon: ${p.counterparty} — ${p.amount} due in ${p.days} days.`,
    ru: (p) => `Скоро платёж: ${p.counterparty} — ${p.amount} через ${p.days} дней.`,
    id: (p) => `Pembayaran segera jatuh tempo: ${p.counterparty} — ${p.amount} dalam ${p.days} hari.`,
  },
  payroll_due: {
    en: (p) => `Payroll due: ${p.amount} in ${p.days} days.`,
    ru: (p) => `Зарплата: ${p.amount} через ${p.days} дней.`,
    id: (p) => `Gaji jatuh tempo: ${p.amount} dalam ${p.days} hari.`,
  },
  ai_scope_refusal: {
    en: () => getCfoOutOfScopeResponse('en'),
    ru: () => getCfoOutOfScopeResponse('ru'),
    id: () => getCfoOutOfScopeResponse('id'),
  },
}

function notificationText(type, language, params = {}) {
  const lang = normalizeLanguage(language)
  const template = NOTIFICATION_TEMPLATES[type]
  if (!template) return ''
  const fn = template[lang] || template.en
  return fn(params)
}

// --- Wallets API ----------------------------------------------------------
// Phase 1: user-scoped. Balance computed from transactions (wallet_id match
// OR legacy source-name match for backward compat with pre-wallet transactions).

const WALLET_CASH_IN  = ['income'];
const WALLET_CASH_OUT = ['expense', 'payroll'];

app.get('/api/wallets', auth, async (req, res) => {
  const userId = req.user.userId;
  try {
    const { data: wallets, error: wErr } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (wErr) throw wErr;

    if (!wallets || wallets.length === 0) return res.json({ wallets: [] });

    // Fetch transactions to compute per-wallet balances
    const { data: txs, error: tErr } = await supabase
      .from('transactions')
      .select('wallet_id, source, type, amount_idr')
      .eq('user_id', userId);
    if (tErr) throw tErr;

    const withBalance = wallets.map(w => {
      const related = (txs || []).filter(t =>
        t.wallet_id === w.id || (!t.wallet_id && t.source === w.name)
      );
      const balance = related.reduce((sum, t) => {
        if (WALLET_CASH_IN.includes(t.type))  return sum + Number(t.amount_idr || 0);
        if (WALLET_CASH_OUT.includes(t.type)) return sum - Number(t.amount_idr || 0);
        if (t.type === 'correction')           return sum + Number(t.amount_idr || 0); // signed delta
        return sum;
      }, 0);
      return { ...w, balance };
    });

    res.json({ wallets: withBalance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/wallets', auth, async (req, res) => {
  const userId = req.user.userId;
  const { name, currency, type, entity_name, color, opening_balance, sort_order, scope } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  if (scope && !['business', 'personal'].includes(scope)) {
    return res.status(400).json({ error: "scope must be 'business' or 'personal'" });
  }
  try {
    // ── Feature gate: wallet limit ───────────────────────────────────────────
    const access = await getCurrentAccess(userId);
    if (access) {
      const maxWallets = access.limits.max_wallets;
      if (maxWallets !== null && maxWallets !== undefined) {
        const { count: currentCount } = await supabase
          .from('wallets')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('is_active', true);
        if ((currentCount || 0) >= maxWallets) {
          return res.status(403).json({
            error: 'Plan limit reached',
            feature: 'wallets',
            limit: maxWallets,
            current: currentCount,
            upgrade_required: true,
          });
        }
      }
    }
    // ── End gate ─────────────────────────────────────────────────────────────

    const { data: wallet, error: wErr } = await supabase
      .from('wallets')
      .insert({
        user_id:     userId,
        name,
        currency:    currency    || 'IDR',
        type:        type        || null,
        entity_name: entity_name || null,
        color:       color       || null,
        sort_order:  sort_order  || 0,
        scope:       scope       || 'business',
      })
      .select()
      .single();
    if (wErr) throw wErr;

    // Insert opening balance transaction if provided and non-zero
    const ob = Number(opening_balance) || 0;
    if (ob !== 0) {
      await supabase.from('transactions').insert({
        user_id:          userId,
        type:             ob > 0 ? 'income' : 'expense',
        amount_original:  Math.abs(ob),
        currency_original: currency || 'IDR',
        amount_idr:       Math.abs(ob),
        description:      `Opening balance · ${name}`,
        source:           name,
        wallet_id:        wallet.id,
        scope:            scope || 'business',
      });
    }

    res.json({ wallet });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Wallet transactions ──────────────────────────────────────────────────────
app.get('/api/wallets/:id/transactions', auth, async (req, res) => {
  const userId = req.user.userId;
  const { id } = req.params;
  const { period = 'all', limit = 200 } = req.query;

  try {
    const { data: wallet, error: wErr } = await supabase
      .from('wallets').select('id, name, currency, type')
      .eq('id', id).eq('user_id', userId).single();
    if (wErr || !wallet) return res.status(404).json({ error: 'Wallet not found' });

    let query = supabase.from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('transaction_date', { ascending: false, nullsLast: true })
      .order('created_at', { ascending: false })
      .limit(Number(limit));

    const { data: txs, error: tErr } = await query;
    if (tErr) throw tErr;

    // Compute period boundary (if any)
    let fromDate = null;
    if (period !== 'all') {
      const now = new Date();
      if (period === 'week')        { fromDate = new Date(now); fromDate.setDate(now.getDate() - 7); }
      else if (period === 'month')    fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
      else if (period === '3m')     { fromDate = new Date(now); fromDate.setMonth(now.getMonth() - 3); }
    }
    const fromStr = fromDate ? fromDate.toISOString().slice(0, 10) : null;

    const filtered = (txs || []).filter(t => {
      // Wallet match: prefer wallet_id, fall back to legacy source name
      const walletMatch = t.wallet_id === wallet.id || (!t.wallet_id && t.source === wallet.name);
      if (!walletMatch) return false;

      // Period filter: use transaction_date; fall back to created_at date for null transaction_date
      if (fromStr) {
        const txDate = t.transaction_date || (t.created_at ? t.created_at.slice(0, 10) : null);
        if (!txDate || txDate < fromStr) return false;
      }

      return true;
    });

    res.json({ wallet, transactions: filtered });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/wallets/:id', auth, async (req, res) => {
  const userId = req.user.userId;
  const { id } = req.params;
  const { name, currency, type, entity_name, color, sort_order, scope } = req.body;
  if (scope !== undefined && !['business', 'personal'].includes(scope)) {
    return res.status(400).json({ error: "scope must be 'business' or 'personal'" });
  }
  try {
    // If renaming, sync source text on legacy transactions for balance continuity
    if (name) {
      const { data: existing } = await supabase
        .from('wallets').select('name').eq('id', id).eq('user_id', userId).single();
      if (existing && existing.name !== name) {
        await supabase.from('transactions')
          .update({ source: name })
          .eq('user_id', userId)
          .eq('source', existing.name);
      }
    }

    const updates = { updated_at: new Date().toISOString() };
    if (name         !== undefined) updates.name        = name;
    if (currency     !== undefined) updates.currency    = currency;
    if (type         !== undefined) updates.type        = type;
    if (entity_name  !== undefined) updates.entity_name = entity_name;
    if (color        !== undefined) updates.color       = color;
    if (sort_order   !== undefined) updates.sort_order  = sort_order;
    if (scope        !== undefined) updates.scope       = scope;

    const { data, error } = await supabase
      .from('wallets')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    res.json({ wallet: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/wallets/:id', auth, async (req, res) => {
  const userId = req.user.userId;
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('wallets')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/wallets/backfill
// Creates wallets from distinct transactions.source values for THIS user only.
// Never touches other users. Skips sources that already exist as wallet names.
app.post('/api/wallets/backfill', auth, async (req, res) => {
  const userId = req.user.userId;
  try {
    const { data: txs, error: tErr } = await supabase
      .from('transactions')
      .select('source')
      .eq('user_id', userId)
      .not('source', 'is', null);
    if (tErr) throw tErr;

    const sources = [...new Set((txs || []).map(t => t.source).filter(Boolean))];
    if (sources.length === 0) return res.json({ created: 0, wallets: [] });

    const { data: existing } = await supabase
      .from('wallets').select('name').eq('user_id', userId);
    const existingNames = new Set((existing || []).map(w => w.name));

    const toCreate = sources.filter(s => !existingNames.has(s));
    if (toCreate.length === 0) return res.json({ created: 0, wallets: [] });

    const rows = toCreate.map((name, i) => ({
      user_id:  userId,
      name,
      // Heuristic: name contains '$' or 'usd' (case-insensitive) → USD wallet
      currency: /\$|usd/i.test(name) ? 'USD' : 'IDR',
      type:     null,
      sort_order: i,
    }));

    const { data: created, error: cErr } = await supabase
      .from('wallets').insert(rows).select();
    if (cErr) throw cErr;

    res.json({ created: (created || []).length, wallets: created || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Accounts API ---------------------------------------------------------

app.post('/api/accounts/adjust', auth, async (req, res) => {
  const { name, diff, type } = req.body
  if (!name || diff === undefined) return res.status(400).json({ error: 'Missing fields' })
  const { error } = await supabase.from('transactions').insert({
    user_id: req.user.userId,
    type: diff > 0 ? 'income' : 'expense',
    amount_original: Math.abs(diff),
    currency_original: 'IDR',
    amount_idr: Math.abs(diff),
    description: `Balance adjustment · ${name}`,
    source: name,
    scope: type || 'personal',
  })
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

app.post('/api/accounts/delete', auth, async (req, res) => {
  const { name } = req.body
  if (!name) return res.status(400).json({ error: 'Missing name' })
  const { error } = await supabase.from('transactions')
    .update({ source: null })
    .eq('user_id', req.user.userId)
    .eq('source', name)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

app.post('/api/accounts/rename', auth, async (req, res) => {
  const { oldName, newName, type } = req.body
  if (!oldName || !newName) return res.status(400).json({ error: 'Missing fields' })
  // Update all transactions where source = oldName
  const updates = { source: newName }
  if (type !== undefined) updates.scope = type
  const { error } = await supabase.from('transactions')
    .update(updates)
    .eq('user_id', req.user.userId)
    .eq('source', oldName)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})


app.post('/api/accounts', auth, async (req, res) => {
  const { name, type, balance } = req.body
  const { error } = await supabase.from('transactions').insert({
    user_id: req.user.userId,
    type: 'income',
    amount_original: balance || 0,
    currency_original: 'IDR',
    amount_idr: balance || 0,
    description: `Opening balance · ${name}`,
    source: name,
    scope: type || 'personal',
  })
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

// --- Platform Admin guard -------------------------------------------------

function isAdminUser(userId) {
  const ids = (process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
  return ids.includes(String(userId));
}

function requireAdmin(req, res, next) {
  if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!isAdminUser(req.user.userId)) return res.status(403).json({ error: 'Admin access required' });
  next();
}

// POST /api/wallets/:id/adjust-balance
// Any authenticated user — ownership-checked. Creates a signed correction
// transaction to bring the wallet balance to target_balance.
// NEVER modifies wallet.balance directly.
app.post('/api/wallets/:id/adjust-balance', auth, async (req, res) => {
  try {
    const userId   = req.user.userId;
    const walletId = req.params.id;
    const { target_balance, reason, transaction_date } = req.body;

    if (target_balance === undefined || target_balance === null) {
      return res.status(400).json({ error: 'target_balance is required' });
    }
    const targetNum = Number(target_balance);
    if (isNaN(targetNum)) {
      return res.status(400).json({ error: 'target_balance must be a number' });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'reason is required' });
    }

    // Role check: only owner/admin can adjust balance
    const { data: membership } = await supabase
      .from('business_members')
      .select('role')
      .eq('user_id', userId)
      .eq('status', 'active')
      .in('role', ['owner', 'admin'])
      .limit(1);
    if (!membership || membership.length === 0) {
      return res.status(403).json({ error: 'Only business owner or admin can adjust wallet balances' });
    }

    // Load wallet — ownership enforced via user_id filter
    const { data: wallet, error: wErr } = await supabase
      .from('wallets')
      .select('id, user_id, name, currency, scope')
      .eq('id', walletId)
      .eq('user_id', userId)
      .single();
    if (wErr || !wallet) return res.status(404).json({ error: 'Wallet not found' });

    // Compute current balance
    const { data: txs, error: tErr } = await supabase
      .from('transactions')
      .select('wallet_id, source, type, amount_idr')
      .eq('user_id', userId);
    if (tErr) throw tErr;

    const related = (txs || []).filter(t =>
      t.wallet_id === wallet.id || (!t.wallet_id && t.source === wallet.name)
    );
    const currentBalance = related.reduce((sum, t) => {
      if (WALLET_CASH_IN.includes(t.type))  return sum + Number(t.amount_idr || 0);
      if (WALLET_CASH_OUT.includes(t.type)) return sum - Number(t.amount_idr || 0);
      if (t.type === 'correction')           return sum + Number(t.amount_idr || 0);
      return sum;
    }, 0);

    const delta = targetNum - currentBalance;

    if (delta === 0) {
      return res.json({
        ok: true,
        message: 'Balance is already at target — no correction needed.',
        current_balance: currentBalance,
        delta: 0,
      });
    }

    const txDate = transaction_date
      ? new Date(transaction_date).toISOString()
      : new Date().toISOString();

    const { data: corrTx, error: cErr } = await supabase
      .from('transactions')
      .insert({
        user_id:           userId,
        type:              'correction',
        amount_original:   delta,
        currency_original: wallet.currency || 'IDR',
        amount_idr:        delta,
        description:       `Balance correction: ${String(reason).trim()}`,
        source:            wallet.name,
        wallet_id:         wallet.id,
        scope:             wallet.scope || 'business',
        category:          'Balance Correction',
        created_at:        txDate,
      })
      .select('id')
      .single();
    if (cErr) throw cErr;

    res.json({
      ok:               true,
      previous_balance: currentBalance,
      delta,
      new_balance:      targetNum,
      transaction_id:   corrTx.id,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Admin endpoints -------------------------------------------------------

app.get('/api/admin/users', auth, requireAdmin, async (req, res) => {
  try {
    // Fetch raw data — counts only, no financial amounts
    const [
      { data: users,        error: uErr },
      { data: transactions, error: tErr },
      { data: debts,        error: dErr },
      { data: reminders,    error: rErr },
    ] = await Promise.all([
      supabase.from('users').select('*').order('id', { ascending: true }),
      supabase.from('transactions').select('user_id, created_at'),
      supabase.from('debts').select('user_id, created_at'),
      supabase.from('reminders').select('user_id, created_at'),
    ]);

    if (uErr) throw uErr;

    // Build per-user aggregates in JS
    const txMap  = {};
    const dbMap  = {};
    const rmMap  = {};

    (transactions || []).forEach(t => {
      const uid = String(t.user_id);
      if (!txMap[uid]) txMap[uid] = { count: 0, last: null };
      txMap[uid].count++;
      if (!txMap[uid].last || t.created_at > txMap[uid].last) txMap[uid].last = t.created_at;
    });

    (debts || []).forEach(d => {
      const uid = String(d.user_id);
      if (!dbMap[uid]) dbMap[uid] = { count: 0, last: null };
      dbMap[uid].count++;
      if (!dbMap[uid].last || d.created_at > dbMap[uid].last) dbMap[uid].last = d.created_at;
    });

    (reminders || []).forEach(r => {
      const uid = String(r.user_id);
      if (!rmMap[uid]) rmMap[uid] = { count: 0, last: null };
      rmMap[uid].count++;
      if (!rmMap[uid].last || r.created_at > rmMap[uid].last) rmMap[uid].last = r.created_at;
    });

    const now30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const enriched = (users || []).map(u => {
      const uid  = String(u.id);
      const txD  = txMap[uid]  || { count: 0, last: null };
      const dbD  = dbMap[uid]  || { count: 0, last: null };
      const rmD  = rmMap[uid]  || { count: 0, last: null };

      // Last activity = most recent across all tables
      const lastActivity = [txD.last, dbD.last, rmD.last]
        .filter(Boolean)
        .sort()
        .pop() || null;

      return {
        id:                   u.id,
        username:             u.username   || null,
        first_name:           u.first_name || null,
        last_name:            u.last_name  || null,
        photo_url:            u.photo_url  || null,
        language:             u.language   || null,
        timezone:             u.timezone   || null,
        created_at:           u.created_at || null,
        is_telegram_connected: true, // always — auth is Telegram-only
        transaction_count:    txD.count,
        debt_count:           dbD.count,
        reminder_count:       rmD.count,
        last_transaction_date: txD.last,
        last_debt_date:        dbD.last,
        last_reminder_date:    rmD.last,
        last_activity_date:    lastActivity,
      };
    });

    // Summary stats
    const activeLast30Days = enriched.filter(u =>
      u.last_activity_date && u.last_activity_date >= now30
    ).length;

    const summary = {
      totalUsers:             enriched.length,
      usersWithTransactions:  enriched.filter(u => u.transaction_count > 0).length,
      usersWithDebts:         enriched.filter(u => u.debt_count > 0).length,
      usersWithReminders:     enriched.filter(u => u.reminder_count > 0).length,
      activeLast30Days,
    };

    res.json({ summary, users: enriched });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/users/:id  — single user detail for admin
app.get('/api/admin/users/:id', auth, requireAdmin, async (req, res) => {
  try {
    const targetId = req.params.id;

    const [
      { data: user,         error: uErr  },
      { data: transactions, error: tErr  },
      { data: debts,        error: dErr  },
      { data: reminders,    error: rErr  },
    ] = await Promise.all([
      supabase.from('users').select('*').eq('id', targetId).single(),
      supabase.from('transactions').select('created_at, description, type').eq('user_id', targetId).order('created_at', { ascending: false }),
      supabase.from('debts').select('created_at, counterparty, type, due_date').eq('user_id', targetId).order('created_at', { ascending: false }),
      supabase.from('reminders').select('created_at, title, due_date').eq('user_id', targetId).order('created_at', { ascending: false }),
    ]);

    if (uErr || !user) return res.status(404).json({ error: 'User not found' });

    const txs  = transactions || [];
    const dbs  = debts        || [];
    const rms  = reminders    || [];

    // --- Summary ---
    const allDates = [
      ...txs.map(x => x.created_at),
      ...dbs.map(x => x.created_at),
      ...rms.map(x => x.created_at),
    ].filter(Boolean).sort();

    const first_activity_at  = allDates[0]  || null;
    const last_activity_at   = allDates[allDates.length - 1] || null;

    // Count distinct calendar days with any activity
    const activeDaySet = new Set(allDates.map(d => d.slice(0, 10)));
    const active_days_count = activeDaySet.size;

    // --- Monthly activity ---
    const monthMap = {};
    const bucket = (date, field) => {
      if (!date) return;
      const m = date.slice(0, 7); // "2026-06"
      if (!monthMap[m]) monthMap[m] = { month: m, transactions: 0, debts: 0, reminders: 0 };
      monthMap[m][field]++;
    };
    txs.forEach(t => bucket(t.created_at, 'transactions'));
    dbs.forEach(d => bucket(d.created_at, 'debts'));
    rms.forEach(r => bucket(r.created_at, 'reminders'));

    const monthly_activity = Object.values(monthMap)
      .sort((a, b) => a.month > b.month ? 1 : -1);

    // --- Recent activity (last 10, NO amounts) ---
    const events = [
      ...txs.map(t => ({ type: 'transaction', title: t.description || `${t.type} transaction`, date: t.created_at, meta: t.type })),
      ...dbs.map(d => ({ type: 'debt',        title: d.counterparty || 'Debt',                  date: d.created_at, meta: d.type })),
      ...rms.map(r => ({ type: 'reminder',    title: r.title || 'Reminder',                     date: r.created_at, meta: r.due_date ? `due ${r.due_date.slice(0,10)}` : null })),
    ];
    const recent_activity = events
      .sort((a, b) => (b.date || '') > (a.date || '') ? 1 : -1)
      .slice(0, 10);

    res.json({
      user: {
        id:                   user.id,
        username:             user.username   || null,
        first_name:           user.first_name || null,
        last_name:            user.last_name  || null,
        photo_url:            user.photo_url  || null,
        language:             user.language   || null,
        timezone:             user.timezone   || null,
        created_at:           user.created_at || null,
        is_telegram_connected: true,
      },
      summary: {
        transaction_count: txs.length,
        debt_count:        dbs.length,
        reminder_count:    rms.length,
        first_activity_at,
        last_activity_at,
        active_days_count,
      },
      monthly_activity,
      recent_activity,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/status  — any authenticated user can call; returns is_admin boolean
// Used by frontend to conditionally show admin-only UI elements.
app.get('/api/admin/status', auth, (req, res) => {
  res.json({ is_admin: isAdminUser(req.user.userId) });
});

// POST /api/admin/wallets/:id/adjust-balance
// Super-admin only. Creates a signed correction transaction to bring the wallet
// balance to target_balance.  NEVER modifies wallet.balance directly.
// correction type: affects wallet balance + total cash, excluded from income/expense KPIs.
app.post('/api/admin/wallets/:id/adjust-balance', auth, requireAdmin, async (req, res) => {
  try {
    const adminUserId = req.user.userId;
    const walletId    = req.params.id;
    const { target_balance, reason, transaction_date } = req.body;

    if (target_balance === undefined || target_balance === null) {
      return res.status(400).json({ error: 'target_balance is required' });
    }
    const targetNum = Number(target_balance);
    if (isNaN(targetNum)) {
      return res.status(400).json({ error: 'target_balance must be a number' });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'reason is required' });
    }

    // Load wallet (no user_id filter — admin can adjust any wallet)
    const { data: wallet, error: wErr } = await supabase
      .from('wallets')
      .select('id, user_id, name, currency, scope')
      .eq('id', walletId)
      .single();
    if (wErr || !wallet) return res.status(404).json({ error: 'Wallet not found' });

    // Compute current balance using same logic as GET /api/wallets
    const { data: txs, error: tErr } = await supabase
      .from('transactions')
      .select('wallet_id, source, type, amount_idr')
      .eq('user_id', wallet.user_id);
    if (tErr) throw tErr;

    const related = (txs || []).filter(t =>
      t.wallet_id === wallet.id || (!t.wallet_id && t.source === wallet.name)
    );
    const currentBalance = related.reduce((sum, t) => {
      if (WALLET_CASH_IN.includes(t.type))  return sum + Number(t.amount_idr || 0);
      if (WALLET_CASH_OUT.includes(t.type)) return sum - Number(t.amount_idr || 0);
      if (t.type === 'correction')           return sum + Number(t.amount_idr || 0);
      return sum;
    }, 0);

    const delta = targetNum - currentBalance;

    if (delta === 0) {
      return res.json({
        ok: true,
        message: 'Balance is already at target — no correction needed.',
        current_balance: currentBalance,
        delta: 0,
      });
    }

    // Create correction transaction (signed delta stored in amount fields)
    const txDate = transaction_date
      ? new Date(transaction_date).toISOString()
      : new Date().toISOString();

    const corrRow = {
      user_id:           wallet.user_id,
      type:              'correction',
      amount_original:   delta,                              // signed: + increase, − decrease
      currency_original: wallet.currency || 'IDR',
      amount_idr:        delta,                              // signed
      description:       `Balance correction: ${String(reason).trim()} [admin:${adminUserId}]`,
      source:            wallet.name,
      wallet_id:         wallet.id,
      scope:             wallet.scope || 'business',
      category:          'Balance Correction',
      created_at:        txDate,
    };

    const { data: corrTx, error: cErr } = await supabase
      .from('transactions')
      .insert(corrRow)
      .select('id')
      .single();
    if (cErr) throw cErr;

    res.json({
      ok:               true,
      previous_balance: currentBalance,
      delta,
      new_balance:      targetNum,
      transaction_id:   corrTx.id,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Profile ---------------------------------------------------------------

app.get('/api/profile', auth, async (req, res) => {
  const { data, error } = await supabase.from('users').select('*').eq('id', req.user.userId).single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

app.post('/api/profile', auth, async (req, res) => {
  const { first_name, last_name, photo_url, language, timezone } = req.body
  const { data, error } = await supabase.from('users').update({ first_name, last_name, photo_url, language, timezone }).eq('id', req.user.userId).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

app.post('/api/debts/:id/pay', auth, async (req, res) => {
  const { amount, account, date, wallet_id } = req.body;
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'amount must be > 0' });

  const { data: debt, error: debtErr } = await supabase.from('debts')
    .select('*').eq('id', req.params.id).eq('user_id', req.user.userId).single();
  if (debtErr || !debt) return res.status(404).json({ error: 'Debt not found' });

  const paymentAmount  = Number(amount);
  const effectiveTotal = Number(debt.original_amount || debt.amount || 0);
  const alreadyPaid    = Number(debt.paid_amount || 0);
  const remaining      = Math.max(0, effectiveTotal - alreadyPaid);

  if (paymentAmount > remaining + 0.01) {
    return res.status(400).json({ error: `Payment amount exceeds remaining balance (${remaining})` });
  }

  const newPaidAmount = alreadyPaid + paymentAmount;
  const isFullyPaid   = newPaidAmount >= effectiveTotal - 0.01;
  const newStatus     = isFullyPaid ? 'paid' : 'partial';

  // 1. Create transaction
  const txType = debt.type === 'payable' ? 'expense' : 'income';
  const { data: tx, error: txErr } = await supabase.from('transactions').insert({
    user_id:           req.user.userId,
    type:              txType,
    amount_original:   paymentAmount,
    currency_original: 'IDR',
    amount_idr:        paymentAmount,
    description:       `Payment: ${debt.counterparty}`,
    source:            account || null,
    wallet_id:         wallet_id || null,
    scope:             debt.scope || 'business',
    created_at:        date ? new Date(date).toISOString() : new Date().toISOString(),
  }).select('id').single();
  if (txErr) return res.status(500).json({ error: txErr.message });

  // 2. Update debt — track paid_amount; NEVER modify original amount
  // Note: last_payment_at and linked_transaction_id require migration 015
  const debtUpdates = {
    paid_amount:            newPaidAmount,
    status:                 newStatus,
    last_payment_at:        new Date().toISOString(),
    linked_transaction_id:  tx?.id || null,
  };
  if (isFullyPaid) {
    debtUpdates.is_settled = true;
    debtUpdates.settled_at = new Date().toISOString();
  }

  const { data: updatedDebt, error: updateErr } = await supabase.from('debts')
    .update(debtUpdates).eq('id', req.params.id).select().single();
  if (updateErr) return res.status(500).json({ error: updateErr.message });

  res.json({
    ok:           true,
    isFullyPaid,
    remaining:    Math.max(0, effectiveTotal - newPaidAmount),
    debt:         computeDebtStatus(updatedDebt),
  });
})

// ── Business Settings Endpoint ───────────────────────────────────────────────
// PATCH /api/business/current — owner/admin can update safe fields
const BUSINESS_ALLOWED_CURRENCIES = ['IDR', 'USD', 'EUR', 'SGD', 'MYR', 'THB', 'CNY'];

app.patch('/api/business/current', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, base_currency, timezone, country } = req.body;

    if (base_currency && !BUSINESS_ALLOWED_CURRENCIES.includes(base_currency)) {
      return res.status(400).json({ error: `Invalid currency: ${base_currency}. Allowed: ${BUSINESS_ALLOWED_CURRENCIES.join(', ')}` });
    }
    if (!name && !base_currency && timezone === undefined && country === undefined) {
      return res.status(400).json({ error: 'At least one field required: name, base_currency, timezone, country' });
    }

    // Only owner or admin can update business settings
    const { data: memberships } = await supabase
      .from('business_members')
      .select('business_id, role')
      .eq('user_id', userId)
      .eq('status', 'active')
      .in('role', ['owner', 'admin'])
      .limit(1);

    let businessId;
    if (!memberships || memberships.length === 0) {
      // No business yet — bootstrap then update
      const { data: userRow } = await supabase.from('users').select('first_name, username').eq('id', userId).single();
      const firstName = userRow?.first_name || userRow?.username || 'My';
      const { business: newBiz } = await ensureDefaultBusiness(userId, firstName);
      businessId = newBiz.id;
    } else {
      businessId = memberships[0].business_id;
    }
    const updates = { updated_at: new Date().toISOString() };
    if (name?.trim())           updates.name          = name.trim();
    if (base_currency)          updates.base_currency = base_currency;
    if (timezone !== undefined) updates.timezone      = timezone || null;
    if (country  !== undefined) updates.country       = country  || null;

    const { data: business, error: bErr } = await supabase
      .from('businesses').update(updates).eq('id', businessId).select().single();
    if (bErr) throw bErr;

    res.json({ business });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Access Status Endpoint ───────────────────────────────────────────────────
// GET /api/access/status
// Returns current plan, trial info, limits, and usage for the authenticated user.
// Also bootstraps default business+trial on first call (idempotent).
app.get('/api/access/status', auth, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Fetch user profile for business name bootstrap
    const { data: user } = await supabase
      .from('users')
      .select('first_name, username')
      .eq('id', userId)
      .single();
    const firstName = user?.first_name || user?.username || 'My';

    // Ensure business exists (creates on first call)
    const { business, membership } = await ensureDefaultBusiness(userId, firstName);

    // Compute access state
    const accessState = getAccessState(business);

    // Fetch plan limits for effective plan
    const { data: limits } = await supabase
      .from('plan_limits')
      .select('*')
      .eq('plan', accessState.effectivePlan)
      .single();

    // Usage counts
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [walletsRes, txRes] = await Promise.all([
      supabase.from('wallets').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('is_active', true),
      supabase.from('transactions').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).gte('created_at', monthStart),
    ]);

    res.json({
      business: {
        id:            business.id,
        name:          business.name,
        base_currency: business.base_currency,
        timezone:      business.timezone  || null,
        country:       business.country   || null,
      },
      membership,
      plan: {
        name:               business.plan,
        subscription_status: business.subscription_status,
        trial_status:        business.trial_status,
        trial_started_at:    business.trial_started_at,
        trial_ends_at:       business.trial_ends_at,
        days_left_in_trial:  accessState.daysLeft,
        is_trial_active:     accessState.isTrialActive,
        effective_plan:      accessState.effectivePlan,
      },
      limits: limits || {},
      usage: {
        wallets_count:             walletsRes.count  || 0,
        transactions_this_month:   txRes.count       || 0,
        invoices_this_month:       0,   // invoice table not yet implemented
        ai_questions_this_month:   0,   // not tracked yet
        voice_inputs_this_month:   0,   // not tracked yet
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── AI CFO V2 ─────────────────────────────────────────────────────────────────

/**
 * Build rich financial context for AI CFO.
 * Reuses existing data from Pulse + access helpers.
 */
async function buildAiCfoContext(userId, language = 'en') {
  const now       = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [
    { data: allTxs    },
    { data: monthTxs  },
    { data: rawDebts  },
    { data: wallets   },
    accessData,
  ] = await Promise.all([
    supabase.from('transactions').select('type,amount_original,amount_idr,currency_original,created_at,wallet_id,source,scope').eq('user_id', userId).order('created_at', { ascending: false }),
    supabase.from('transactions').select('type,amount_original,amount_idr,created_at,wallet_id,source,scope').eq('user_id', userId).gte('created_at', monthStart),
    supabase.from('debts').select('*').eq('user_id', userId),
    supabase.from('wallets').select('id,name,currency,type,scope').eq('user_id', userId).eq('is_active', true),
    getCurrentAccess(userId),
  ]);

  const debts = enrichDebts(rawDebts);

  // ── Wallet scope split ────────────────────────────────────────────────────
  const allWallets      = wallets || [];
  const businessWallets = allWallets.filter(w => (w.scope || 'business') === 'business');
  const personalWallets = allWallets.filter(w => w.scope === 'personal');
  const businessWalletIds = new Set(businessWallets.map(w => w.id));

  // ── Cash (business wallets only for CFO Score / runway) ──────────────────
  const CASH_IN  = ['income'];
  const CASH_OUT = ['expense', 'payroll'];

  // Helper to sum tx that belong to a given set of wallet IDs (or legacy source match or scope field)
  function txBelongsToWallets(t, walletSet, walletIdSet, scopeValue) {
    if (t.wallet_id) return walletIdSet.has(t.wallet_id);
    if (walletSet.some(w => w.name === t.source)) return true;
    // Fallback: use the scope column (same logic as Pulse endpoint)
    if (scopeValue) return (t.scope || 'business') === scopeValue;
    return false;
  }

  const bizTxs = (allTxs || []).filter(t => txBelongsToWallets(t, businessWallets, businessWalletIds, 'business'));

  const allIncome    = bizTxs.filter(t => CASH_IN.includes(t.type)).reduce((s,t) => s + Number(t.amount_original||0), 0);
  const allExpenses  = bizTxs.filter(t => CASH_OUT.includes(t.type)).reduce((s,t) => s + Number(t.amount_original||0), 0);
  const allCorrections = bizTxs.filter(t => t.type === 'correction').reduce((s,t) => s + Number(t.amount_original||0), 0);
  const totalBalance = allIncome - allExpenses + allCorrections;

  // Personal cash (informational only — not used in CFO score)
  const persTxs = (allTxs || []).filter(t => txBelongsToWallets(t, personalWallets, new Set(personalWallets.map(w => w.id)), 'personal'));
  const personalBalance = persTxs.filter(t => CASH_IN.includes(t.type)).reduce((s,t) => s + Number(t.amount_original||0), 0)
    - persTxs.filter(t => CASH_OUT.includes(t.type)).reduce((s,t) => s + Number(t.amount_original||0), 0)
    + persTxs.filter(t => t.type === 'correction').reduce((s,t) => s + Number(t.amount_original||0), 0);

  // ── This month (business wallets only) ────────────────────────────────────
  const bizMonthTxs   = (monthTxs || []).filter(t => txBelongsToWallets(t, businessWallets, businessWalletIds, 'business'));
  const monthIncome   = bizMonthTxs.filter(t => CASH_IN.includes(t.type)).reduce((s,t) => s + Number(t.amount_original||0), 0);
  const monthExpenses = bizMonthTxs.filter(t => CASH_OUT.includes(t.type)).reduce((s,t) => s + Number(t.amount_original||0), 0);

  // ── Burn rate & runway — rolling 30-day window (business wallets only) ────
  const burnMetrics = computeBurnAndRunway(bizTxs, totalBalance);
  const burnRate    = burnMetrics.burn_rate_daily;

  // ── Wallet balances ───────────────────────────────────────────────────────
  const walletList = allWallets.map(w => {
    const related = (allTxs || []).filter(t => t.wallet_id === w.id || (!t.wallet_id && t.source === w.name));
    const bal = related.reduce((s,t) => {
      if (CASH_IN.includes(t.type))  return s + Number(t.amount_original||0);
      if (CASH_OUT.includes(t.type)) return s - Number(t.amount_original||0);
      if (t.type === 'correction')   return s + Number(t.amount_original||0);
      return s;
    }, 0);
    return { id: w.id, name: w.name, currency: w.currency, type: w.type, scope: w.scope || 'business', balance: bal };
  });

  // ── Debts breakdowns ──────────────────────────────────────────────────────
  const openDebts  = debts.filter(d => !['paid','cancelled'].includes(d.status));
  const recvList   = openDebts.filter(d => d.type === 'receivable');
  const payList    = openDebts.filter(d => d.type === 'payable');

  const recvTotal    = recvList.reduce((s,d) => s + Number(d.remaining_amount||0), 0);
  const recvOverdue  = recvList.filter(d => d.status === 'overdue');
  const recvDueSoon  = recvList.filter(d => { const days = Math.ceil((new Date(d.due_date)-now)/86400000); return days>=0 && days<=7; });

  const payTotal     = payList.reduce((s,d) => s + Number(d.remaining_amount||0), 0);
  const payOverdue   = payList.filter(d => d.status === 'overdue');
  const payDueSoon   = payList.filter(d => { const days = Math.ceil((new Date(d.due_date)-now)/86400000); return days>=0 && days<=7; });

  // ── Risks ─────────────────────────────────────────────────────────────────
  const risks  = [];
  const runway = burnMetrics.runway_days;
  if (totalBalance < 0) risks.push({ type:'negative_balance', severity:'critical', title:'Negative cash balance', description:'Total cash is below zero', amount: totalBalance });
  if (runway !== null && runway < 7)  risks.push({ type:'runway_critical', severity:'critical', title:`Only ${runway} days runway`, description:'Cash will run out very soon', amount: totalBalance });
  else if (runway !== null && runway < 14) risks.push({ type:'runway_low', severity:'high', title:`Short runway: ${runway} days`, description:'Monitor cash carefully', amount: totalBalance });
  if (recvOverdue.length > 0) risks.push({ type:'overdue_receivables', severity:'high', title:`${recvOverdue.length} overdue receivable${recvOverdue.length>1?'s':''}`, description:'Clients have not paid past due date', amount: recvOverdue.reduce((s,d)=>s+Number(d.remaining_amount||0),0) });
  if (payOverdue.length > 0)  risks.push({ type:'overdue_payables', severity:'high', title:`${payOverdue.length} overdue payable${payOverdue.length>1?'s':''}`, description:'Payments overdue — may affect relationships', amount: payOverdue.reduce((s,d)=>s+Number(d.remaining_amount||0),0) });
  if (payDueSoon.length > 0)  risks.push({ type:'payables_due_soon', severity:'medium', title:`${payDueSoon.length} payment${payDueSoon.length>1?'s':''} due within 7 days`, description:'Upcoming cash outflows', amount: payDueSoon.reduce((s,d)=>s+Number(d.remaining_amount||0),0) });
  if (payTotal > recvTotal && payTotal > 0) risks.push({ type:'payables_exceed_receivables', severity:'medium', title:'Payables exceed receivables', description:'Net cash pressure ahead', amount: payTotal - recvTotal });
  if (risks.length === 0) risks.push({ type:'healthy', severity:'low', title: cx(language, 'noRisks'), description: cx(language, 'financesStable'), amount: 0 });

  // ── Build partial context for engines (before final return) ──────────────
  const walletsSummary = {
    business_cash:          totalBalance,
    personal_cash:          personalBalance,
    total_cash:             totalBalance + personalBalance,
    business_wallets_count: businessWallets.length,
    personal_wallets_count: personalWallets.length,
  };

  const partialCtx = {
    business:        { name: (accessData?.business || {}).name || 'My Business', base_currency: (accessData?.business || {}).base_currency || 'IDR', plan: (accessData?.business || {}).plan || 'free', effective_plan: (accessData?.accessState || {}).effectivePlan || 'free', trial_status: (accessData?.business || {}).trial_status || 'inactive', days_left_in_trial: (accessData?.accessState || {}).daysLeft || 0 },
    cash:            { total_balance: totalBalance, wallets_count: businessWallets.length, wallets: walletList.filter(w => (w.scope||'business') === 'business').slice(0,5) },
    wallets_summary: walletsSummary,
    current_month: { income: monthIncome, expenses: monthExpenses, net_flow: monthIncome - monthExpenses, transactions_count: (monthTxs||[]).length, burn_rate: burnRate, burn_window_days: burnMetrics.burn_window_days },
    receivables:   { total_remaining: recvTotal, overdue_total: recvOverdue.reduce((s,d)=>s+Number(d.remaining_amount||0),0), overdue_count: recvOverdue.length, partial_total: recvList.filter(d=>d.status==='partial').reduce((s,d)=>s+Number(d.remaining_amount||0),0), due_soon_total: recvDueSoon.reduce((s,d)=>s+Number(d.remaining_amount||0),0), top: recvList.slice(0,5).map(d=>({counterparty:d.counterparty,remaining_amount:d.remaining_amount,due_date:d.due_date,status:d.status,days_overdue:d.days_overdue})) },
    payables:      { total_remaining: payTotal, overdue_total: payOverdue.reduce((s,d)=>s+Number(d.remaining_amount||0),0), overdue_count: payOverdue.length, partial_total: payList.filter(d=>d.status==='partial').reduce((s,d)=>s+Number(d.remaining_amount||0),0), due_soon_total: payDueSoon.reduce((s,d)=>s+Number(d.remaining_amount||0),0), top: payList.slice(0,5).map(d=>({counterparty:d.counterparty,remaining_amount:d.remaining_amount,due_date:d.due_date,status:d.status,days_overdue:d.days_overdue})) },
    risks,
    runway_days: runway,
  };

  // ── Decision layer engines ────────────────────────────────────────────────
  const cfoScore        = calculateCfoScore(partialCtx, language);
  const aiAlert         = calculateAiAlertStatus(partialCtx, cfoScore, language);
  const hiringReadiness = calculateHiringReadiness(partialCtx, language);
  const nextActions     = buildNextActionsV2(partialCtx, hiringReadiness, language);

  // ── Access info ───────────────────────────────────────────────────────────
  const limits = accessData?.limits || {};

  return {
    ...partialCtx,
    next_actions:     nextActions,
    cfo_score:        cfoScore,
    ai_alert:         aiAlert,
    hiring_readiness: hiringReadiness,
    usage: {
      ai_questions_this_month:    0,   // not tracked in DB yet — V2 limitation
      max_ai_questions_per_month: limits.max_ai_questions_per_month ?? null,
      remaining_ai_questions:     limits.max_ai_questions_per_month ?? null,
    },
  };
}

// ── CFO Score Engine ─────────────────────────────────────────────────────────
function calculateCfoScore(ctx, language = 'en') {
  const cash   = ctx.cash     || {};
  const month  = ctx.current_month || {};
  const recv   = ctx.receivables   || {};
  const pay    = ctx.payables      || {};
  const runway = ctx.runway_days;

  const bal      = Number(cash.total_balance  || 0);
  const mExpense = Number(month.expenses      || 0);
  const mIncome  = Number(month.income        || 0);
  const netFlow  = Number(month.net_flow      || 0);
  const recvTotal    = Number(recv.total_remaining || 0);
  const recvOverdue  = Number(recv.overdue_total   || 0);
  const payTotal     = Number(pay.total_remaining  || 0);
  const payOverdue   = Number(pay.overdue_total    || 0);
  const payDueSoon   = Number(pay.due_soon_total   || 0);

  // ── Cash Health (25%) ───────────────────────────────────────────────────
  let cashScore, cashLabel, cashImpact;
  if (mExpense === 0) {
    cashScore = 70; cashLabel = cx(language, 'notEnoughExpenseHistory'); cashImpact = 'neutral';
  } else {
    const ratio = bal / mExpense;
    if (ratio >= 3)       { cashScore = 90; cashLabel = 'Strong cash position'; cashImpact = 'positive'; }
    else if (ratio >= 1)  { cashScore = 78; cashLabel = 'Adequate cash reserves'; cashImpact = 'positive'; }
    else if (ratio >= 0.5){ cashScore = 58; cashLabel = 'Cash below 1 month expenses'; cashImpact = 'warning'; }
    else                  { cashScore = 30; cashLabel = 'Cash critically low'; cashImpact = 'negative'; }
  }

  // ── Runway (25%) ────────────────────────────────────────────────────────
  let runwayScore, runwayLabel, runwayImpact;
  if (runway === null || runway === 999) {
    runwayScore = 60; runwayLabel = cx(language, 'runwayUnknown'); runwayImpact = 'neutral';
  } else if (runway >= 90)  { runwayScore = 100; runwayLabel = 'Runway excellent (90+ days)'; runwayImpact = 'positive'; }
  else if (runway >= 60)    { runwayScore = 85;  runwayLabel = 'Runway healthy (60+ days)';   runwayImpact = 'positive'; }
  else if (runway >= 30)    { runwayScore = 70;  runwayLabel = 'Runway adequate (30+ days)';  runwayImpact = 'neutral'; }
  else if (runway >= 15)    { runwayScore = 45;  runwayLabel = 'Runway short — needs attention'; runwayImpact = 'warning'; }
  else                      { runwayScore = 20;  runwayLabel = 'Runway critical (<15 days)';  runwayImpact = 'negative'; }

  // ── Receivables (15%) ───────────────────────────────────────────────────
  let recvScore, recvLabel, recvImpact;
  if (recvTotal === 0) {
    recvScore = 80; recvLabel = cx(language, 'noReceivables'); recvImpact = 'neutral';
  } else {
    const overdueRatio = recvOverdue / recvTotal;
    if (recvOverdue === 0)       { recvScore = 85; recvLabel = 'All receivables on time';    recvImpact = 'positive'; }
    else if (overdueRatio < 0.25){ recvScore = 70; recvLabel = 'Minor overdue receivables';  recvImpact = 'neutral'; }
    else if (overdueRatio < 0.5) { recvScore = 50; recvLabel = 'Significant overdue receivables'; recvImpact = 'warning'; }
    else                         { recvScore = 30; recvLabel = 'Most receivables overdue';   recvImpact = 'negative'; }
  }

  // ── Payables (20%) ──────────────────────────────────────────────────────
  let payScore, payLabel, payImpact;
  if (payTotal === 0) {
    payScore = 90; payLabel = cx(language, 'noPayables'); payImpact = 'positive';
  } else if (bal > 0 && payOverdue > bal) {
    payScore = 20; payLabel = 'Overdue payables exceed cash'; payImpact = 'negative';
  } else if (bal > 0 && payDueSoon > bal) {
    payScore = 35; payLabel = 'Upcoming payments exceed cash'; payImpact = 'negative';
  } else if (bal > 0 && payDueSoon <= bal * 0.3) {
    payScore = 80; payLabel = 'Payables under control'; payImpact = 'positive';
  } else {
    payScore = 60; payLabel = 'Payables manageable'; payImpact = 'neutral';
  }

  // ── Expense Control (15%) ───────────────────────────────────────────────
  let expScore, expLabel, expImpact;
  if (mIncome === 0 && mExpense === 0) {
    expScore = 60; expLabel = cx(language, 'noMonthlyData'); expImpact = 'neutral';
  } else if (netFlow >= 0) {
    const margin = mIncome > 0 ? netFlow / mIncome : 0;
    expScore = margin > 0.2 ? 92 : margin > 0.05 ? 80 : 72;
    expLabel = 'Net flow positive'; expImpact = 'positive';
  } else if (cashScore >= 70) {
    expScore = 62; expLabel = 'Monthly expenses exceed income'; expImpact = 'warning';
  } else {
    expScore = mExpense > mIncome * 1.5 ? 32 : 48;
    expLabel = 'Expenses significantly exceed income'; expImpact = 'negative';
  }

  // ── Weighted total ──────────────────────────────────────────────────────
  const score = Math.round(
    cashScore   * 0.25 +
    runwayScore * 0.25 +
    recvScore   * 0.15 +
    payScore    * 0.20 +
    expScore    * 0.15
  );

  const status = score >= 75 ? 'healthy' : score >= 50 ? 'warning' : 'critical';
  const statusLabel = score >= 75 ? cx(language, 'healthy') : score >= 50 ? cx(language, 'needsAttention') : cx(language, 'critical');

  // Summary sentence
  const positives = [cashLabel, runwayLabel, recvLabel, payLabel, expLabel].filter((_, i) => [cashImpact,runwayImpact,recvImpact,payImpact,expImpact][i] === 'positive');
  const warnings  = [cashLabel, runwayLabel, recvLabel, payLabel, expLabel].filter((_, i) => ['warning','negative'].includes([cashImpact,runwayImpact,recvImpact,payImpact,expImpact][i]));
  let summary;
  if (status === 'healthy') summary = positives.length > 0 ? `${positives[0]}. ${warnings.length > 0 ? warnings[0] + '.' : 'All key metrics are positive.'}` : cx(language, 'financiallyStable');
  else if (status === 'warning') summary = warnings.length > 0 ? `${warnings[0]}. Monitor closely and take action.` : cx(language, 'someAreasNeedAttention');
  else summary = warnings.length > 0 ? `${warnings[0]}. Immediate action required.` : 'Financial health is critical. Prioritize cash flow.';

  return {
    score,
    status,
    label: statusLabel,
    summary,
    factors: {
      cash_health:      { score: cashScore,   label: cashLabel,   impact: cashImpact },
      runway:           { score: runwayScore, label: runwayLabel, impact: runwayImpact },
      receivables:      { score: recvScore,   label: recvLabel,   impact: recvImpact },
      payables:         { score: payScore,    label: payLabel,    impact: payImpact },
      expense_control:  { score: expScore,    label: expLabel,    impact: expImpact },
    },
  };
}

// ── AI Alert Status ───────────────────────────────────────────────────────────
function calculateAiAlertStatus(ctx, cfoScore, language = 'en') {
  const cash   = ctx.cash     || {};
  const pay    = ctx.payables || {};
  const runway = ctx.runway_days;
  const score  = cfoScore?.score ?? 70;

  const bal         = Number(cash.total_balance  || 0);
  const payOverdue  = Number(pay.overdue_total   || 0);
  const payDueSoon  = Number(pay.due_soon_total  || 0);

  const isCritical =
    (runway !== null && runway < 15) ||
    (bal > 0 && payOverdue > bal) ||
    bal < 0 ||
    score < 40;

  const isWarning = !isCritical && (
    (runway !== null && runway < 30) ||
    (ctx.receivables?.overdue_count || 0) > 0 ||
    (bal > 0 && payDueSoon > bal * 0.3) ||
    score < 70
  );

  if (isCritical) return {
    status: 'critical', label: 'Critical', color: 'red',
    headline: 'Immediate cash action required',
    description: bal < 0
      ? 'Cash balance is negative. Review all transactions and stop non-essential spending.'
      : runway !== null && runway < 7
        ? `Cash runway is ${runway} days. Prioritize collecting receivables and reducing expenses now.`
        : payOverdue > bal
          ? 'Overdue payables exceed available cash. Renegotiate or arrange payment immediately.'
          : 'Financial health score is below safe threshold. Review all key metrics.',
  };

  if (isWarning) return {
    status: 'warning', label: 'Warning', color: 'amber',
    headline: 'Some areas need attention',
    description: runway !== null && runway < 30
      ? `Cash runway is ${runway} days. This requires active cash planning — collect receivables on time.`
      : (ctx.receivables?.overdue_count || 0) > 0
        ? `${ctx.receivables.overdue_count} receivable${ctx.receivables.overdue_count > 1 ? 's are' : ' is'} overdue. Follow up to protect cash flow.`
        : 'Cash position is adequate but some metrics need monitoring.',
  };

  return {
    status: 'healthy', label: cx(language, 'healthy'), color: 'green',
    headline: cx(language, 'financiallyStable'),
    description: cx(language, 'cashStrong'),
  };
}

// ── Hiring Readiness Engine ───────────────────────────────────────────────────
function calculateHiringReadiness(ctx, language = 'en') {
  const cash   = ctx.cash          || {};
  const month  = ctx.current_month || {};
  const pay    = ctx.payables      || {};
  const runway = ctx.runway_days;

  const bal        = Number(cash.total_balance     || 0);
  const mExpense   = Number(month.expenses         || 0);
  const netFlow    = Number(month.net_flow         || 0);
  const burnRate   = Number(month.burn_rate        || 0);
  const dueSoon    = Number(pay.due_soon_total     || 0);
  const currency   = ctx.business?.base_currency   || 'IDR';

  if (mExpense === 0 && bal === 0) return {
    status: 'insufficient_data', label: cx(language, 'notEnoughData'),
    recommendation: cx(language, 'addWalletsHint'),
    safe_monthly_salary: 0, max_safe_monthly_salary: 0, currency,
    reasoning: ['No expense or balance data available.'],
    assumptions: [],
  };

  const BUFFER_DAYS   = 30;
  const bufferCash    = burnRate * BUFFER_DAYS;
  const safeCashPool  = Math.max(0, bal - bufferCash - dueSoon);
  const safeSalary    = Math.max(0, Math.round(safeCashPool / 3));

  const reasoning = [];
  if (runway !== null) reasoning.push(`Current runway is ${runway} days.`);
  reasoning.push(netFlow >= 0 ? 'Monthly net flow is positive.' : 'Monthly expenses currently exceed income.');
  if (dueSoon > 0) reasoning.push(`${dueSoon.toLocaleString()} ${currency} in payables due within 7 days.`);
  reasoning.push(`Safe salary = (cash − 30d buffer − due-soon payables) ÷ 3 months.`);

  let status, label, recommendation;
  if (runway === null && mExpense === 0) {
    status = 'insufficient_data'; label = cx(language, 'notEnoughData');
    recommendation = cx(language, 'addWalletsHint');
  } else if (runway !== null && runway >= 60 && netFlow >= 0) {
    status = 'ready'; label = cx(language, 'readyToHire');
    recommendation = safeSalary > 0
      ? `You can hire within the safe salary limit. Keep at least ${BUFFER_DAYS} days runway after onboarding.`
      : 'Runway and flow are healthy, but most cash is tied up in upcoming payments.';
  } else if (runway === null || (runway >= 30 && runway < 60)) {
    status = 'caution'; label = cx(language, 'hireCaution');
    recommendation = language === 'ru' ? 'Запас денег умеренный. Найм возможен, но держите зарплату консервативной и проверяйте деньги еженедельно.' : 'Runway is moderate. A hire is possible but keep the salary conservative and monitor cash weekly.';
  } else {
    status = 'not_ready'; label = cx(language, 'notRecommended');
    recommendation = `Runway is ${runway !== null ? runway + ' days' : 'unknown'}. Delay hiring until runway exceeds 45 days and cash flow stabilises.`;
    return { status, label, recommendation, safe_monthly_salary: 0, max_safe_monthly_salary: 0, currency, reasoning, assumptions: ['Requires 45+ days runway before hiring.'] };
  }

  return {
    status, label, recommendation,
    safe_monthly_salary: safeSalary,
    max_safe_monthly_salary: safeSalary,
    currency, reasoning,
    assumptions: [
      `Keeps at least ${BUFFER_DAYS} days cash buffer after withdrawal.`,
      'Based on current monthly burn rate.',
      'Covers upcoming payables due within 7 days.',
    ],
  };
}

// ── Next Best Actions V2 ──────────────────────────────────────────────────────
function buildNextActionsV2(ctx, hiringReadiness, language = 'en') {
  const recv   = ctx.receivables   || {};
  const pay    = ctx.payables      || {};
  const month  = ctx.current_month || {};
  const runway = ctx.runway_days;
  const currency = ctx.business?.base_currency || 'IDR';

  const actions = [];
  const fmt = n => Number(n || 0).toLocaleString('id-ID');

  // ── Overdue receivables ──────────────────────────────────────────────────
  const recvOverdueList = (recv.top || []).filter(d => d.status === 'overdue');
  if (recvOverdueList.length > 0) {
    const top = recvOverdueList[0];
    actions.push({
      title: `Follow up: ${top.counterparty}`,
      description: `${fmt(top.remaining_amount)} ${currency} overdue${top.days_overdue > 0 ? ` — ${top.days_overdue}d past due` : ''}. Send a payment reminder.`,
      action_type: 'receivable_followup', priority: 'high',
      amount: top.remaining_amount, route: '/receivables',
    });
    if (recvOverdueList.length > 1) {
      const total = recvOverdueList.reduce((s, d) => s + Number(d.remaining_amount || 0), 0);
      actions.push({
        title: `${recvOverdueList.length - 1} more overdue receivable${recvOverdueList.length > 2 ? 's' : ''}`,
        description: `${fmt(total - Number(top.remaining_amount || 0))} ${currency} also overdue. Review and follow up.`,
        action_type: 'receivable_followup', priority: 'high',
        amount: total - Number(top.remaining_amount || 0), route: '/receivables',
      });
    }
  } else if ((recv.due_soon_total || 0) > 0) {
    const topDueSoon = (recv.top || []).find(d => d.status !== 'paid' && d.status !== 'cancelled');
    actions.push({
      title: topDueSoon ? `Confirm payment: ${topDueSoon.counterparty}` : 'Receivable due soon',
      description: `${fmt(recv.due_soon_total)} ${currency} expected within 7 days. Confirm collection date.`,
      action_type: 'receivable_due_soon', priority: 'medium',
      amount: recv.due_soon_total, route: '/receivables',
    });
  }

  // ── Overdue payables ─────────────────────────────────────────────────────
  const payOverdueList = (pay.top || []).filter(d => d.status === 'overdue');
  if (payOverdueList.length > 0) {
    const top = payOverdueList[0];
    actions.push({
      title: `Pay or renegotiate: ${top.counterparty}`,
      description: `${fmt(top.remaining_amount)} ${currency} overdue${top.days_overdue > 0 ? ` — ${top.days_overdue}d past due` : ''}. Resolve to protect vendor relationship.`,
      action_type: 'payable_overdue', priority: 'high',
      amount: top.remaining_amount, route: '/payables',
    });
  }

  // ── Payables due soon ────────────────────────────────────────────────────
  const payDueSoonList = (pay.top || []).filter(d => {
    const days = d.due_date ? Math.ceil((new Date(d.due_date) - new Date()) / 86400000) : null;
    return days !== null && days >= 0 && days <= 7 && d.status !== 'paid';
  });
  if (payDueSoonList.length > 0 && payOverdueList.length === 0) {
    const top = payDueSoonList[0];
    actions.push({
      title: `Prepare payment: ${top.counterparty}`,
      description: `${fmt(top.remaining_amount)} ${currency} due within 7 days. Ensure funds are ready.`,
      action_type: 'payable_due_soon', priority: 'medium',
      amount: top.remaining_amount, route: '/payables',
    });
  }

  // ── Cash / runway actions ────────────────────────────────────────────────
  if (runway !== null && runway < 30) {
    actions.push({
      title: 'Protect runway: review non-critical spending',
      description: `Runway is ${runway} days. Delay or cancel non-essential expenses to extend cash runway.`,
      action_type: 'cash_protection', priority: runway < 15 ? 'high' : 'medium',
      amount: 0, route: '/transactions',
    });
  }
  if (Number(month.net_flow || 0) < 0 && (runway === null || runway >= 30)) {
    actions.push({
      title: 'Review top expenses this month',
      description: `Monthly expenses exceed income by ${fmt(Math.abs(month.net_flow))} ${currency}. Identify which categories can be reduced.`,
      action_type: 'expense_review', priority: 'medium',
      amount: Math.abs(month.net_flow || 0), route: '/transactions',
    });
  }

  // ── Hiring readiness action ──────────────────────────────────────────────
  if (hiringReadiness) {
    if (hiringReadiness.status === 'not_ready' && (runway || 0) > 0) {
      actions.push({
        title: 'Delay hiring — build runway first',
        description: `Runway of ${runway} days is below safe threshold. Focus on extending runway before adding fixed costs.`,
        action_type: 'hiring_delay', priority: 'medium',
        amount: 0, route: '/cfo',
      });
    } else if (hiringReadiness.status === 'ready' && hiringReadiness.safe_monthly_salary > 0) {
      actions.push({
        title: 'Hiring capacity available',
        description: `Safe monthly salary budget: ${fmt(hiringReadiness.safe_monthly_salary)} ${currency}. You can hire conservatively.`,
        action_type: 'hiring_ready', priority: 'low',
        amount: hiringReadiness.safe_monthly_salary, route: '/cfo',
      });
    }
  }

  // ── Fallback ─────────────────────────────────────────────────────────────
  if (actions.length === 0) {
    actions.push({
      title: cx(language, 'financesStable'),
      description: cx(language, 'noUrgentActions'),
      action_type: 'pulse', priority: 'low',
      amount: 0, route: '/transactions',
    });
  }

  return actions.slice(0, 5);
}

/**
 * Local rule-based CFO answer — used when Anthropic is unavailable.
 * Answers common financial questions from context data.
 */
function generateLocalCfoAnswer(question, ctx) {
  const q      = (question || '').toLowerCase();
  const fmt    = n => Number(n || 0).toLocaleString('id-ID');
  const biz    = ctx.business || {};
  const cash   = ctx.cash     || {};
  const month  = ctx.current_month || {};
  const recv   = ctx.receivables   || {};
  const pay    = ctx.payables      || {};
  const runway = ctx.runway_days;

  const currency = biz.base_currency || 'IDR';
  const hasData  = cash.total_balance !== undefined;

  if (!hasData) {
    return `I don't have enough data yet for ${biz.name || 'your business'}. Please add transactions, wallets, receivables and payables first to get meaningful insights.`;
  }

  // Cash / balance questions
  if (/cash|balance|money|сколько|остат|баланс|дене/.test(q)) {
    let ans = `**${biz.name}** has **${fmt(cash.total_balance)} ${currency}** in total cash`;
    if (cash.wallets_count > 0) ans += ` across ${cash.wallets_count} wallet${cash.wallets_count > 1 ? 's' : ''}`;
    ans += '.';
    if (recv.total_remaining > 0) ans += `\n\nYou also have **${fmt(recv.total_remaining)} ${currency}** in outstanding receivables.`;
    if (pay.total_remaining > 0)  ans += `\n\nUpcoming payables: **${fmt(pay.total_remaining)} ${currency}**.`;
    if (runway !== null) ans += `\n\nAt current burn rate, cash runway is approximately **${runway} days**.`;
    return ans;
  }

  // Runway / cash risk
  if (/runway|run out|когда закончится|риск/.test(q)) {
    if (runway === null || runway === 999) return `Runway cannot be calculated — no regular expenses tracked yet. Add expense transactions to get a burn rate estimate.`;
    const status = runway < 7 ? '🔴 Critical' : runway < 14 ? '⚠️ Short' : '✅ Healthy';
    const advice = runway < 7
      ? 'This needs immediate attention — focus on collecting receivables and cutting non-essential expenses.'
      : runway < 14
        ? 'This needs active cash planning. Focus on collecting receivables on time and reviewing upcoming expenses.'
        : 'Runway looks healthy. Keep monitoring monthly expenses and incoming payments.';
    return `${status} — approximately **${runway} days** of cash runway remaining.\n\nCurrent balance: ${fmt(cash.total_balance)} ${currency}\nDaily burn rate: ~${fmt(month.burn_rate)} ${currency}/day\n\n${advice}`;
  }

  // Owner withdrawal / personal draw
  if (isOwnerWithdrawalQuestion(q)) {
    const bal      = Number(cash.total_balance || 0);
    const burnRate = Number(month.burn_rate || 0);
    const currency = biz.base_currency || 'IDR';

    // Try to parse an amount from the question (e.g. "15M", "10,000,000", "5 juta")
    let amount = 0;
    const mM  = q.match(/(\d[\d,.]*)[\s]*m(?:illion)?(?:\s*idr)?/);
    const mK  = q.match(/(\d[\d,.]*)[\s]*k(?:\s*idr)?/);
    const mN  = q.match(/(\d[\d,.]+)\s*(idr|juta|jt|rb|ribu)?/);
    if (mM)       amount = parseFloat(mM[1].replace(/,/g,'')) * 1_000_000;
    else if (mK)  amount = parseFloat(mK[1].replace(/,/g,'')) * 1_000;
    else if (mN)  amount = parseFloat(mN[1].replace(/,/g,''));

    if (amount <= 0) {
      return `I won't advise on how to spend money personally.\n\nBut as your CFO, I can assess whether an owner withdrawal is safe for the business. **How much are you planning to take out?** (e.g. "Can I take 15M IDR?")`;
    }

    const cashAfter   = bal - amount;
    const runwayAfter = burnRate > 0 ? Math.floor(cashAfter / burnRate) : null;
    const pctOfCash   = bal > 0 ? Math.round((amount / bal) * 100) : 100;
    const hasOverdue  = (pay.overdue_count || 0) > 0;

    let rating, advice;
    if (cashAfter < 0) {
      rating = '🔴 Not recommended';
      advice = `This withdrawal exceeds current cash balance. It would leave the business with a negative cash position.`;
    } else if (runwayAfter !== null && runwayAfter < 15 || pctOfCash > 70 || hasOverdue) {
      rating = '⚠️ Caution';
      advice = `${hasOverdue ? `You have ${pay.overdue_count} overdue payable${pay.overdue_count > 1 ? 's' : ''} (${fmt(pay.overdue_total || 0)} ${currency}) that should be resolved first. ` : ''}${runwayAfter !== null && runwayAfter < 15 ? `Runway after withdrawal would be only ${runwayAfter} days. ` : ''}Consider a smaller amount or wait until receivables are collected.`;
    } else {
      rating = '✅ Appears safe';
      advice = `Payroll and upcoming payables (${fmt(pay.total_remaining)} ${currency}) appear coverable from remaining cash.`;
    }

    return `I won't advise on personal spending decisions.\n\nAs CFO, here is the **business cash-flow assessment** for a ${fmt(amount)} ${currency} owner withdrawal:\n\n**${rating}**\n\nCash before: ${fmt(bal)} ${currency}\nCash after: ${fmt(Math.max(0, cashAfter))} ${currency}\n${runwayAfter !== null ? `Runway after: ~${Math.max(0, runwayAfter)} days (vs ${runway ?? '?'} days now)\n` : ''}\n${advice}\n\n**Classification:** Record this as owner withdrawal, salary, or dividend — not as a business expense. Confirm tax treatment with your accountant.`;
  }

  // Receivables
  if (/receiv|owes|owe me|кто должен|дебитор|поступлен/.test(q)) {
    if (recv.total_remaining === 0) return `No open receivables at the moment. Everything has been collected or no receivables have been added yet.`;
    let ans = `You have **${fmt(recv.total_remaining)} ${currency}** in outstanding receivables.`;
    if (recv.overdue_count > 0) ans += `\n\n⚠️ **${recv.overdue_count} overdue** — ${fmt(recv.overdue_total)} ${currency} past due date.`;
    if (recv.due_soon_total > 0) ans += `\n\n⏰ **${fmt(recv.due_soon_total)} ${currency}** due within 7 days.`;
    if ((recv.top || []).length > 0) {
      ans += '\n\nTop receivables:\n';
      recv.top.forEach(r => { ans += `• ${r.counterparty}: ${fmt(r.remaining_amount)} ${currency} (${r.status})\n`; });
    }
    return ans;
  }

  // Payables / urgent payments
  if (/payable|pay|owe|платить|кому должны|срочн|urgent/.test(q)) {
    if (pay.total_remaining === 0) return `No open payables at the moment.`;
    let ans = `You have **${fmt(pay.total_remaining)} ${currency}** in outstanding payables.`;
    if (pay.overdue_count > 0) ans += `\n\n🔴 **${pay.overdue_count} overdue** — ${fmt(pay.overdue_total)} ${currency}. Pay immediately.`;
    if (pay.due_soon_total > 0) ans += `\n\n⏰ **${fmt(pay.due_soon_total)} ${currency}** due within 7 days.`;
    if ((pay.top || []).length > 0) {
      ans += '\n\nTop payables:\n';
      pay.top.forEach(p => { ans += `• ${p.counterparty}: ${fmt(p.remaining_amount)} ${currency} (${p.status})\n`; });
    }
    return ans;
  }

  // Hire / headcount — use hiring_readiness engine result if available
  if (/hire|нанять|employee|salary(?! to)|staff|headcount|hiring/.test(q)) {
    const hr = ctx.hiring_readiness;
    if (hr) {
      if (hr.status === 'insufficient_data') return `Not enough financial data to calculate a safe hiring budget.\n\n${hr.recommendation}`;
      if (hr.status === 'not_ready') return `**${hr.label}** — ${hr.recommendation}\n\n${hr.reasoning.join('\n')}`;
      const salaryStr = hr.safe_monthly_salary > 0 ? `\n\n**Safe monthly salary budget:** ${fmt(hr.safe_monthly_salary)} ${currency}/month` : '';
      return `**${hr.label}**\n\n${hr.recommendation}${salaryStr}\n\n${hr.reasoning.join('\n')}\n\n_Note: This is a conservative estimate. Confirm with your accountant._`;
    }
    // Fallback if hiring_readiness not in ctx
    const bal = cash.total_balance || 0;
    if (bal <= 0) return `Current cash balance is ${fmt(bal)} ${currency}. Hiring is not recommended until cash position improves.`;
    if (runway !== null && runway < 30) return `Cash runway is only ${runway} days. Delay hiring until runway is above 45 days and cash flow is stable.`;
    const safeBudget = Math.round(bal * 0.12);
    return `Cash position is ${fmt(bal)} ${currency}${runway !== null ? ` with ${runway} days runway` : ''}. A conservative monthly salary budget would be around **${fmt(safeBudget)} ${currency}** (12% of cash).\n\nCheck upcoming payables (${fmt(pay.total_remaining)} ${currency}) before committing to fixed costs.`;
  }

  // What to do today
  if (/today|сегодня|do now|next action|что делать|priority/.test(q)) {
    const actions = ctx.next_actions || [];
    if (actions.length === 0) {
      if (language === 'ru') return 'Финансы стабильны. Продолжайте добавлять операции ежедневно для точных данных.'
      if (language === 'id') return 'Keuangan terlihat stabil. Tetap tambah transaksi harian untuk menjaga data yang akurat.'
      return 'Finances look stable. Keep adding transactions daily to maintain accurate insights.'
    }
    let ans = `**Today's priorities for ${biz.name}:**\n\n`;
    actions.slice(0, 3).forEach((a, i) => { ans += `${i+1}. ${a.title}\n   ${a.description}\n\n`; });
    return ans.trim();
  }

  // Expenses / costs
  if (/expense|cost|spend|расход|затрат/.test(q)) {
    if (month.expenses === 0) return `No expenses recorded this month yet.`;
    return `This month: **${fmt(month.expenses)} ${currency}** in expenses, **${fmt(month.income)} ${currency}** income.\nNet flow: **${month.net_flow >= 0 ? '+' : ''}${fmt(month.net_flow)} ${currency}**.\nBurn rate: ~${fmt(month.burn_rate)} ${currency}/day.`;
  }

  // Default — financial summary
  const topRisk = (ctx.risks || []).find(r => r.severity === 'critical') || (ctx.risks || [])[0];
  const runwayNote = runway !== null
    ? runway < 7  ? `\n\n⚠️ Runway is ${runway} days — this needs immediate attention.`
    : runway < 14 ? `\n\n⚠️ Runway is ${runway} days — this requires active cash planning.`
    : runway < 30 ? `\n\nRunway is ${runway} days. Keep monitoring cash flow carefully.`
    : ''
    : '';
  return `**Financial summary for ${biz.name}:**\n\nCash: ${fmt(cash.total_balance)} ${currency}${runway !== null ? ` · ${runway}d runway` : ''}\nThis month: +${fmt(month.income)} income / −${fmt(month.expenses)} expenses\nReceivables: ${fmt(recv.total_remaining)} ${currency} outstanding\nPayables: ${fmt(pay.total_remaining)} ${currency} pending\n\n${topRisk ? `Key insight: ${topRisk.title}` : 'No major risks detected.'}${runwayNote}`;
}

// ── Domain guardrail for AI CFO ───────────────────────────────────────────────

/**
 * isOwnerWithdrawalQuestion — detects questions about taking money from business
 * for personal/family use (owner draw, salary, dividend, personal spend).
 * These are ALLOWED as CFO cash-impact questions, not lifestyle advice.
 */
function isOwnerWithdrawalQuestion(question) {
  const q = question.toLowerCase().trim();
  const OWNER_PATTERNS = [
    /owner.{0,10}draw/,
    /withdraw/,
    /take.{0,15}(money|cash|funds|out)/,
    /pay (my)?self/,
    /for (my)?self/,
    /personal.{0,15}(spend|withdraw|use|take)/,
    /family.{0,20}(spend|use|take|weekend|money|cash)/,
    /dividend/,
    /director.{0,10}(draw|withdrawal|salary)/,
    /founder.{0,10}(draw|withdrawal|salary)/,
    /use.{0,15}(business|company).{0,15}(cash|money|funds)/,
    /company.{0,15}(money|cash|funds).{0,15}(personal|myself|family)/,
    /transfer.{0,15}(to myself|personal)/,
    /i want to spend/,
    /can i spend/,
    /i (need|want).{0,10}(take|use|withdraw)/,
    /вывести|вывод денег|зарплата себе|дивиденд|личные расходы/,
  ];
  return OWNER_PATTERNS.some(re => re.test(q));
}

/**
 * isBusinessFinanceQuestion — returns true if question is within CFO scope.
 * Flow: owner_withdrawal → always allow
 *       blocklist → false (lifestyle / unrelated)
 *       allowlist → true  (explicit finance keywords)
 *       short / ambiguous → fail open (true)
 */
function isBusinessFinanceQuestion(question) {
  const q = question.toLowerCase().trim();

  // 0. Owner withdrawal is always allowed — it's a business cash-impact question
  if (isOwnerWithdrawalQuestion(q)) return true;

  // 1. Blocklist — obvious lifestyle / out-of-scope topics
  //    NOTE: "family" alone is NOT blocked — "family" + spend/withdraw is owner_withdrawal (caught above)
  //    Only block pure lifestyle uses of family: "where to go with family", "family trip"
  const BLOCKED = [
    /cook|recipe|пельмен|борщ|блин|суп|готов(?!ить бизнес)/,
    /poem|стих(?!и о деньгах)|write me a (song|poem|story|rap)/,
    /\bmovie\b|\bfilm\b|фильм|сериал|netflix|кино/,
    /\bfootball\b|\bsoccer\b|game score|sport.*result|who won the/,
    /romantic|dating|boyfriend|girlfriend|marriage/,
    /politic|election|президент|vote|партия(?! в бизнесе)|война|war(?! on cost)/,
    /weather|погод(?!а в бизнесе)|forecast(?! cash)|температур/,
    /\bmedical\b|\bdoctor\b|\bmedicine\b|болезн|симптом|лекарств|diagnos/,
    /\bjoke\b|funny|анекдот|\bhumor\b/,
    /horoscope|гороскоп|astrology/,
    /where (should|to) (i|we) go.{0,20}(weekend|vacation|holiday|trip|family)/,
    /recommend.{0,20}(restaurant|place|hotel|travel|movie|show)/,
    /where is my (sister|brother|mom|dad|friend|wife|husband)/,
  ];
  if (BLOCKED.some(re => re.test(q))) return false;

  // 2. Finance/business allowlist — explicit finance keywords always pass
  const ALLOWED = [
    /cash|деньги|наличн/,
    /balance|баланс/,
    /runway|рунвей/,
    /receiv|дебитор/,
    /payable|кредитор/,
    /invoice|счёт|счет/,
    /expense|расход|затрат/,
    /income|revenue|доход|выручк/,
    /profit|прибыл/,
    /hire|нанять|employee|salary|зарплат|payroll|staff|headcount/,
    /\bdebt\b|долг/,
    /\brisk\b|риск/,
    /budget|бюджет/,
    /business|company|бизнес|компани/,
    /payment|платеж|заплатить/,
    /collect|взыскать/,
    /financial|финанс/,
    /\btax\b|налог/,
    /burn rate|\bburn\b/,
    /wallet|кошелек/,
    /transaction|транзакц/,
    /overdue|просроч/,
    /what should (i|we) do/,
    /can i (hire|afford)/,
    /how much (cash|do i have)/,
    /what.*biggest.*risk/,
    /today.*priorit|priorit.*today/,
    /liquidity|ликвидн/,
    /cash flow|кэш.?флоу/,
  ];
  if (ALLOWED.some(re => re.test(q))) return true;

  // 3. Very short questions (<= 5 words) — ambiguous, fail open
  const wordCount = q.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 5) return true;

  // 4. Default: fail open — better to answer than over-block a legitimate question
  return true;
}

const CFO_OUT_OF_SCOPE_RESPONSE = "Sorry, I can't help with that. I'm CFO AI — a financial consultant for business owners. I only answer questions about business finance: cash flow, receivables, payables, expenses, runway, hiring readiness, payroll and owner financial decisions.";
const CFO_OUT_OF_SCOPE_RESPONSE_RU = "Извините, я не могу помочь с этим вопросом. Я CFO AI-консультант и отвечаю только на вопросы, связанные с финансами бизнеса.";

// GET /api/ai-cfo/context — full financial context for AI CFO page
app.get('/api/ai-cfo/context', auth, async (req, res) => {
  try {
    const language = normalizeLanguage(req.query.language || await getUserLanguage(req.user.userId));
    const ctx = await buildAiCfoContext(req.user.userId, language);
    res.json(ctx);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ai-cfo/ask — ask the AI CFO a question
app.post('/api/ai-cfo/ask', auth, async (req, res) => {
  try {
    const userId   = req.user.userId;
    const { question } = req.body;
    const rawLang = req.body.language || await getUserLanguage(userId);
    const language = normalizeLanguage(rawLang);
    const isRu = language === 'ru';
    if (!question || !question.trim()) return res.status(400).json({ error: 'question required' });

    // ── Domain guardrail: reject out-of-scope questions ───────────────────────
    if (!isBusinessFinanceQuestion(question)) {
      return res.json({ answer: getCfoOutOfScopeResponse(language), out_of_scope: true });
    }

    // ── Usage limit check (soft — not yet tracked in DB) ─────────────────────
    let access;
    try {
      access = await getCurrentAccess(userId);
      if (access) {
        const maxQ = access.limits?.max_ai_questions_per_month;
        // V1 limitation: ai_questions_this_month is not tracked in DB.
        // Limit enforcement will be added when usage table is created (TASK 36+).
        // For now: enforce if access returns a count > 0 from future tracking.
        // Skipped intentionally to not block users in V1.
        void maxQ;
      }
    } catch (_) { /* fail open */ }

    // ── Build context ─────────────────────────────────────────────────────────
    const ctx = await buildAiCfoContext(userId, language);
    const currency = ctx.business?.base_currency || 'IDR';

    // ── Try Anthropic first, fall back to local analyzer ─────────────────────
    let answer;
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

    if (hasApiKey) {
      try {
        const ownerWithdrawal = isOwnerWithdrawalQuestion(question);
        const cfo   = ctx.cfo_score        || {};
        const alert = ctx.ai_alert         || {};
        const hire  = ctx.hiring_readiness || {};
        const langInstruction = language === 'ru'
          ? 'IMPORTANT: The user speaks Russian. Answer ENTIRELY in Russian. All text, headings, recommendations, and refusals must be in Russian. You may keep product terms like CFO AI, AI CFO, cash flow, runway in their original form.'
          : language === 'id'
          ? 'PENTING: Pengguna berbicara Bahasa Indonesia. Jawab SELURUHNYA dalam Bahasa Indonesia. Gunakan Bahasa Indonesia bisnis yang sederhana dan jelas. Anda boleh menggunakan istilah produk seperti CFO AI, AI CFO, CFO Score dalam bentuk aslinya. Untuk istilah keuangan, gunakan: arus kas (cash flow), cadangan kas (runway), piutang (receivables), kewajiban (payables).'
          : 'Answer in English.'
        const systemPrompt = `You are CFO AI, a financial decision assistant for ${ctx.business.name} — a ${ctx.business.effective_plan} plan business using ${currency} as base currency.
Answer like a calm, direct CFO speaking to a CEO. Be specific, conservative, action-oriented, and not dramatic.
${langInstruction}

YOUR ROLE: You ONLY answer questions about business finance: cash flow, runway, receivables, payables,
expenses, income, payroll, hiring readiness, invoices, financial risks, budgeting, owner financial decisions.
Refuse unrelated topics (cooking, entertainment, politics, sports, relationships, medical, poems, jokes).

OWNER WITHDRAWAL POLICY: If user asks about taking money from business for personal/family use,
do NOT give lifestyle advice. Assess cash-flow impact: cash before/after, runway before/after,
payables coverage, rating (safe/caution/not recommended). Recommend classification (owner withdrawal,
salary, or dividend). Say "confirm tax treatment with your accountant." Do NOT comment on how to spend.

DECISION LAYER (today ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}):
- CFO Score: ${cfo.score ?? '?'}/100 — ${cfo.label ?? 'unknown'} (${cfo.summary ?? ''})
- AI Alert: ${alert.label ?? 'unknown'} — ${alert.headline ?? ''}
- Hiring: ${hire.label ?? 'unknown'} — safe salary ${hire.safe_monthly_salary ? hire.safe_monthly_salary.toLocaleString() + ' ' + currency + '/mo' : 'unknown'}
  ${(hire.reasoning || []).join(' ')}

FINANCIAL CONTEXT:
- Total cash: ${ctx.cash.total_balance.toLocaleString()} ${currency}
- Cash runway: ${ctx.runway_days !== null ? ctx.runway_days + ' days' : 'unknown'}
- This month: +${ctx.current_month.income.toLocaleString()} income / -${ctx.current_month.expenses.toLocaleString()} expenses (net: ${ctx.current_month.net_flow.toLocaleString()})
- Daily burn rate: ~${ctx.current_month.burn_rate.toLocaleString()} ${currency}/day
- Receivables: ${ctx.receivables.total_remaining.toLocaleString()} ${currency} outstanding (${ctx.receivables.overdue_count} overdue)
- Payables: ${ctx.payables.total_remaining.toLocaleString()} ${currency} pending (${ctx.payables.overdue_count} overdue)
${ctx.receivables.top.length > 0 ? `- Top receivables: ${ctx.receivables.top.map(r => `${r.counterparty} ${r.remaining_amount.toLocaleString()} (${r.status})`).join(', ')}` : ''}
${ctx.payables.top.length > 0 ? `- Top payables: ${ctx.payables.top.map(p => `${p.counterparty} ${p.remaining_amount.toLocaleString()} (${p.status})`).join(', ')}` : ''}
- Wallets: ${ctx.cash.wallets.map(w => `${w.name} ${w.balance.toLocaleString()} ${w.currency}`).join(', ') || 'none'}
- Risk signals: ${ctx.risks.map(r => r.title).join('; ') || 'none'}
- Top actions: ${(ctx.next_actions || []).slice(0,3).map(a => a.title).join(' | ') || 'none'}
${ownerWithdrawal ? '\nNOTE: This is an owner withdrawal question. Apply OWNER WITHDRAWAL POLICY.' : ''}

ANSWER RULES:
- Concise, direct, 3-8 sentences max — like a real CFO
- Use ONLY the actual numbers above — never invent data
- If data is missing, say what is missing
- Use ${currency} in all amounts
- NEVER use: "this isn't a drill", "crisis", "emergency" for moderate situations
- For moderate risk: "This needs attention" / "This requires active cash planning" / "This is manageable if income is collected on time"
- Reserve strong warnings for truly critical: runway < 7 days or negative cash
- When asked about hiring → use the Hiring Readiness data above
- When asked what to do today → use the Top Actions above
- When asked about biggest risk → use Risk signals + AI Alert above`;

        const response = await anthropic.messages.create({
          model:      'claude-haiku-4-5',
          max_tokens: 400,
          system:     systemPrompt,
          messages:   [{ role: 'user', content: question.trim() }],
        });
        answer = response.content[0].text.trim();
      } catch (aiErr) {
        console.warn('[ai-cfo/ask] Anthropic failed, using local fallback:', aiErr.message);
        answer = generateLocalCfoAnswer(question, ctx);
      }
    } else {
      answer = generateLocalCfoAnswer(question, ctx);
    }

    res.json({
      answer,
      context_summary: {
        total_balance:   ctx.cash.total_balance,
        runway_days:     ctx.runway_days,
        risks_count:     ctx.risks.filter(r => r.severity !== 'low').length,
      },
      used_ai_provider: hasApiKey,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/user/reset-data ───────────────────────────────────────────────
// Deletes all financial data for the current user.
// Keeps: users row, business, business_members, access/plan.
// Deletes: transactions, debts, wallets, reminders.
// Requires confirmation token in body: { confirm: "RESET" }
app.delete('/api/user/reset-data', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { confirm } = req.body || {};

    if (confirm !== 'RESET') {
      return res.status(400).json({ error: 'Send { "confirm": "RESET" } to confirm data reset.' });
    }

    const errors = [];

    // Delete in safe order (no FK issues — all scoped to user_id)
    const tables = ['transactions', 'debts', 'reminders', 'wallets'];
    for (const table of tables) {
      const { error } = await supabase.from(table).delete().eq('user_id', userId);
      if (error) errors.push(`${table}: ${error.message}`);
    }

    if (errors.length > 0) {
      return res.status(500).json({ error: 'Partial reset — some tables failed', details: errors });
    }

    res.json({
      success: true,
      message: 'All financial data deleted. Account, business and plan settings are preserved.',
      deleted: tables,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PAYROLL V1 ───────────────────────────────────────────────────────────────

// GET /api/payroll/employees
app.get('/api/payroll/employees', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { data, error } = await supabase
      .from('payroll_employees')
      .select('*')
      .eq('user_id', userId)
      .neq('status', 'archived')
      .order('name', { ascending: true });
    if (error) throw error;
    res.json({ employees: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/payroll/employees
app.post('/api/payroll/employees', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, role, default_salary, currency, pay_day, default_wallet_id, notes } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Employee name is required.' });

    // Validate wallet belongs to user if supplied
    if (default_wallet_id) {
      const { data: w } = await supabase.from('wallets').select('id').eq('id', default_wallet_id).eq('user_id', userId).single();
      if (!w) return res.status(400).json({ error: 'Invalid wallet.' });
    }

    const { data, error } = await supabase.from('payroll_employees').insert({
      user_id: userId,
      name: name.trim(),
      role: role?.trim() || null,
      default_salary: default_salary ? Number(default_salary) : null,
      currency: currency || 'IDR',
      pay_day: pay_day ? Number(pay_day) : null,
      default_wallet_id: default_wallet_id || null,
      notes: notes?.trim() || null,
    }).select().single();
    if (error) throw error;
    res.json({ employee: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/payroll/employees/:id
app.patch('/api/payroll/employees/:id', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { name, role, default_salary, currency, pay_day, default_wallet_id, status, notes } = req.body;

    const { data: existing } = await supabase.from('payroll_employees').select('id').eq('id', id).eq('user_id', userId).single();
    if (!existing) return res.status(404).json({ error: 'Employee not found.' });

    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined)              updates.name              = name.trim();
    if (role !== undefined)              updates.role              = role?.trim() || null;
    if (default_salary !== undefined)    updates.default_salary    = default_salary ? Number(default_salary) : null;
    if (currency !== undefined)          updates.currency          = currency;
    if (pay_day !== undefined)           updates.pay_day           = pay_day ? Number(pay_day) : null;
    if (default_wallet_id !== undefined) updates.default_wallet_id = default_wallet_id || null;
    if (status !== undefined)            updates.status            = status;
    if (notes !== undefined)             updates.notes             = notes?.trim() || null;

    const { data, error } = await supabase.from('payroll_employees').update(updates).eq('id', id).select().single();
    if (error) throw error;
    res.json({ employee: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/payroll/employees/:id  — soft delete
app.delete('/api/payroll/employees/:id', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { data: existing } = await supabase.from('payroll_employees').select('id').eq('id', id).eq('user_id', userId).single();
    if (!existing) return res.status(404).json({ error: 'Employee not found.' });

    const { error } = await supabase.from('payroll_employees').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/payroll/payments
app.get('/api/payroll/payments', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { data, error } = await supabase
      .from('payroll_payments')
      .select('*, payroll_employees(name, role)')
      .eq('user_id', userId)
      .order('payment_date', { ascending: false });
    if (error) throw error;
    res.json({ payments: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/payroll/overview
app.get('/api/payroll/overview', auth, async (req, res) => {
  try {
    const userId = req.user.userId;

    const [empRes, payRes] = await Promise.all([
      supabase.from('payroll_employees').select('id, name, role, default_salary, currency, pay_day, default_wallet_id').eq('user_id', userId).neq('status', 'archived').order('name'),
      supabase.from('payroll_payments').select('*, payroll_payment_items(*)').eq('user_id', userId).order('payment_date', { ascending: false }),
    ]);

    const employees = empRes.data || [];
    const payments  = payRes.data || [];

    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    // Use net_amount if available, fallback to amount for old records
    const netOf = p => Number(p.net_amount ?? p.amount ?? 0);
    const paidThisMonth = payments
      .filter(p => (p.period_month || '').startsWith(thisMonth) && p.status === 'paid')
      .reduce((s, p) => s + netOf(p), 0);
    const totalPaidAll = payments
      .filter(p => p.status === 'paid')
      .reduce((s, p) => s + netOf(p), 0);

    res.json({
      employees,
      payments: payments.slice(0, 20),
      summary: {
        employee_count: employees.length,
        paid_this_month: paidThisMonth,
        total_paid_all: totalPaidAll,
        payments_this_month: payments.filter(p => (p.period_month || '').startsWith(thisMonth)).length,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/payroll/payments
// TODO (Telegram): When Telegram bot parses "зарплата Kevin 12M + бонус 2M - штраф 300k с BCA",
//   it should call this same endpoint with the items array. No separate Telegram payroll logic.
//
// Creates payroll_payment + payroll_payment_items + linked transaction (net amount only).
app.post('/api/payroll/payments', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      employee_id,
      employee_name,
      currency = 'IDR',
      period_month,
      payment_date,
      wallet_id,
      notes,
      items = [],   // NEW: array of { item_type, label, amount, direction }
      // Legacy single-amount fallback (V1 compatibility)
      amount: legacyAmount,
      payment_type: legacyType = 'salary',
    } = req.body;

    if (!employee_name || !employee_name.trim()) return res.status(400).json({ error: 'Employee name is required.' });

    // ── Build items ──────────────────────────────────────────────────────────
    // If items array provided (V1.1), use it. Otherwise fall back to legacy single amount.
    let resolvedItems = [];
    if (items && items.length > 0) {
      // Validate each item
      for (const item of items) {
        if (!item.label || !item.label.trim())            return res.status(400).json({ error: 'Each item must have a label.' });
        if (!Number(item.amount) || Number(item.amount) <= 0) return res.status(400).json({ error: `Amount for "${item.label}" must be positive.` });
        if (!['addition', 'deduction'].includes(item.direction)) return res.status(400).json({ error: `Invalid direction for "${item.label}".` });
      }
      resolvedItems = items;
    } else if (legacyAmount && Number(legacyAmount) > 0) {
      // Legacy V1 fallback: single salary amount
      resolvedItems = [{ item_type: legacyType, label: 'Salary', amount: Number(legacyAmount), direction: 'addition' }];
    } else {
      return res.status(400).json({ error: 'No payroll items provided.' });
    }

    // ── Calculate gross / deductions / net ───────────────────────────────────
    const grossAmount     = resolvedItems.filter(i => i.direction === 'addition').reduce((s, i) => s + Number(i.amount), 0);
    const deductionAmount = resolvedItems.filter(i => i.direction === 'deduction').reduce((s, i) => s + Number(i.amount), 0);
    const netAmount       = grossAmount - deductionAmount;

    if (netAmount <= 0) return res.status(400).json({ error: `Net amount must be positive. Gross: ${grossAmount}, Deductions: ${deductionAmount}.` });

    // ── Validate wallet ───────────────────────────────────────────────────────
    let wallet = null;
    if (wallet_id) {
      const { data: w } = await supabase.from('wallets').select('id, name, scope, currency').eq('id', wallet_id).eq('user_id', userId).single();
      if (!w) return res.status(400).json({ error: 'Invalid or inaccessible wallet.' });
      wallet = w;
    }

    const payDate     = payment_date || new Date().toISOString().slice(0, 10);
    const periodLabel = period_month ? ` — ${period_month}` : '';
    const description = `Payroll payment for ${employee_name.trim()}${periodLabel}`;

    // ── 1. Create transaction (net paid only — single cash impact) ───────────
    const { data: tx, error: txErr } = await supabase.from('transactions').insert({
      user_id:           userId,
      type:              'payroll',
      amount_original:   netAmount,
      amount_idr:        netAmount,
      currency_original: currency,
      description,
      source:            wallet ? wallet.name : null,
      wallet_id:         wallet_id || null,
      scope:             wallet ? (wallet.scope || 'business') : 'business',
      category:          'payroll',
      transaction_date:  payDate,
    }).select().single();
    if (txErr) throw txErr;

    // ── 2. Create payroll_payment ─────────────────────────────────────────────
    const { data: payment, error: pmtErr } = await supabase.from('payroll_payments').insert({
      user_id:          userId,
      employee_id:      employee_id || null,
      transaction_id:   tx.id,
      employee_name:    employee_name.trim(),
      amount:           netAmount,
      gross_amount:     grossAmount,
      deduction_amount: deductionAmount,
      net_amount:       netAmount,
      currency,
      payment_type:     resolvedItems[0]?.item_type || legacyType,
      period_month:     period_month || null,
      payment_date:     payDate,
      wallet_id:        wallet_id || null,
      status:           'paid',
      notes:            notes?.trim() || null,
    }).select().single();
    if (pmtErr) throw pmtErr;

    // ── 3. Create payroll_payment_items ───────────────────────────────────────
    if (resolvedItems.length > 0) {
      const itemRows = resolvedItems.map(item => ({
        user_id:            userId,
        payroll_payment_id: payment.id,
        item_type:          item.item_type || 'other',
        label:              item.label.trim(),
        amount:             Number(item.amount),
        direction:          item.direction,
        notes:              item.notes?.trim() || null,
      }));
      const { error: itemErr } = await supabase.from('payroll_payment_items').insert(itemRows);
      if (itemErr) throw itemErr;
    }

    res.json({ payment, transaction: tx });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/payroll/by-transaction/:transactionId
// TODO (Telegram): Telegram-created payroll payments should link to
//   payroll_payments.transaction_id the same way as web-created payments.
//   Telegram bot should call POST /api/payroll/payments — no separate logic needed.
app.get('/api/payroll/by-transaction/:transactionId', auth, async (req, res) => {
  try {
    const userId        = req.user.userId;
    const transactionId = Number(req.params.transactionId);
    if (!transactionId) return res.status(400).json({ error: 'Invalid transaction ID.' });

    // Security: verify transaction belongs to user
    const { data: tx, error: txErr } = await supabase
      .from('transactions').select('id, user_id, type').eq('id', transactionId).single();
    if (txErr || !tx) return res.status(404).json({ error: 'Transaction not found.' });
    if (String(tx.user_id) !== String(userId)) return res.status(403).json({ error: 'Access denied.' });

    // Fetch payroll_payment linked to this transaction
    const { data: payment, error: pmtErr } = await supabase
      .from('payroll_payments')
      .select('*')
      .eq('transaction_id', transactionId)
      .eq('user_id', userId)
      .single();

    if (pmtErr || !payment) return res.json({ payroll_payment: null, items: [] });

    // Fetch items
    const { data: items } = await supabase
      .from('payroll_payment_items')
      .select('*')
      .eq('payroll_payment_id', payment.id)
      .eq('user_id', userId)
      .order('direction', { ascending: false }); // additions first

    res.json({ payroll_payment: payment, items: items || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── END PAYROLL V1 ────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile('index.html', { root: 'client/dist' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Helm Finance Web running on port ${PORT}`));