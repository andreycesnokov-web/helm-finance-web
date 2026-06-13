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

// ─────────────────────────────────────────────────────────────────────────────
// BUSINESS-SCOPED ACCESS MODEL
// ─────────────────────────────────────────────────────────────────────────────
// business_id = financial owner (the workspace)
// user_id     = legacy owner reference (compatibility — see bizOrFilter)
// created_by_user_id / approved_by_user_id = audit responsibility
//
// Never trust business_id from the client without a membership check.

// ── Role access helpers ──────────────────────────────────────────────────────
function canViewBusinessFinance(role)          { return ['owner', 'ceo', 'admin', 'cfo', 'accountant', 'auditor'].includes(role); }
function canCreateFinancialRequest(role)       { return ['owner', 'ceo', 'admin', 'cfo', 'accountant', 'manager', 'employee'].includes(role); }
function canCreateConfirmedFinancialRecord(role) { return ['owner', 'ceo', 'admin', 'cfo', 'accountant'].includes(role); }
function canApproveFinancialRecord(role)       { return ['owner', 'ceo', 'admin', 'cfo'].includes(role); }
function canManagePayroll(role)                { return ['owner', 'ceo', 'admin', 'cfo'].includes(role); }
function canManageWallets(role)                { return ['owner', 'ceo', 'admin', 'cfo'].includes(role); }
function canUseAiCfo(role)                     { return ['owner', 'ceo', 'admin', 'cfo', 'accountant'].includes(role); }

/**
 * Resolve the active business for a request and validate membership.
 * Selection priority: x-business-id header → ?business_id → body.business_id
 * → user's default business (ensureDefaultBusiness).
 * Returns { business, role, ownerUserId }.
 * Throws { status, message } on access violation.
 */
async function resolveActiveBusiness(req) {
  const userId = req.user.userId;
  const requested =
    req.headers['x-business-id'] ||
    req.query?.business_id ||
    req.body?.business_id ||
    null;

  if (requested) {
    const { data } = await supabase.from('business_members')
      .select('role, status, business_id, businesses(*)')
      .eq('user_id', userId).eq('business_id', requested).eq('status', 'active')
      .limit(1);
    if (data?.length) {
      const m = data[0];
      return { business: m.businesses, role: m.role, ownerUserId: m.businesses.owner_user_id };
    }
    // Requested business the user is NOT a member of → fall back to their
    // default business (never leak another workspace; also handles a stale
    // localStorage id after switching accounts on the same browser).
  }

  const { business, membership } = await ensureDefaultBusiness(userId);
  return { business, role: membership.role, ownerUserId: business.owner_user_id };
}

/**
 * Supabase .or() filter string: rows belonging to the business OR legacy
 * rows (business_id NULL) belonging to the business owner. After migration
 * 017 backfill, the legacy branch only matters for rows created before a
 * user's first business existed.
 */
function bizOrFilter(biz) {
  return `business_id.eq.${biz.business.id},and(business_id.is.null,user_id.eq.${biz.ownerUserId})`;
}

/**
 * Standard write fields for new financial records:
 * owned by the business, attributed to the acting user, user_id kept as the
 * business owner for legacy compatibility (admin tooling, old queries).
 */
function bizWriteFields(biz, actingUserId) {
  return {
    business_id:        biz.business.id,
    user_id:            biz.ownerUserId,
    created_by_user_id: actingUserId,
  };
}

/** Express-friendly wrapper: resolve business or send the right error. */
async function requireBusiness(req, res) {
  try {
    return await resolveActiveBusiness(req);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
    return null;
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
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canViewBusinessFinance(biz.role)) {
      return res.status(403).json({ error: 'Your role does not allow viewing the business dashboard' });
    }
    const language = normalizeLanguage(req.query.language || await getUserLanguage(req.user.userId));
    const scope = req.query.scope || 'all';
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const bizOr = bizOrFilter(biz);

    // ALL transactions ever · for total balance
    let allTxQuery = supabase.from('transactions').select('*').or(bizOr);
    if (scope !== 'all') allTxQuery = allTxQuery.eq('scope', scope);
    const { data: allTxs } = await allTxQuery;

    // This month transactions · for burn rate
    let txQuery = supabase.from('transactions').select('*')
      .or(bizOr).gte('created_at', monthStart);
    if (scope !== 'all') txQuery = txQuery.eq('scope', scope);
    const { data: txs } = await txQuery;

    // Debts — fetch all (including settled) so UI can show history; enrich with status
    // Training records (tutorial test submissions) are never financial data.
    const { data: rawDebts } = await supabase.from('debts')
      .select('*').or(bizOr)
      .or('is_training.is.null,is_training.eq.false')
      .order('due_date', { ascending: true });
    const debts = enrichDebts(rawDebts);

    // Reminders
    const { data: reminders } = await supabase.from('reminders')
      .select('*').or(bizOr).eq('is_done', false)
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
      .or(bizOr).eq('is_active', true)
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
  const biz = await requireBusiness(req, res);
  if (!biz) return;
  let query = supabase.from('debts')
    .select('*').or(bizOrFilter(biz))
    .order('due_date', { ascending: true });
  // Training (tutorial) records excluded by default; ?include_training=1 opts in
  if (req.query.include_training !== '1') {
    query = query.or('is_training.is.null,is_training.eq.false');
  }
  // Manager / employee see only their own submissions
  if (!canViewBusinessFinance(biz.role)) {
    query = query.eq('created_by_user_id', req.user.userId);
  }
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
  const biz = await requireBusiness(req, res);
  if (!biz) return;
  // Privileged roles create confirmed records; manager/employee → pending_approval
  const confirmed = canCreateConfirmedFinancialRecord(biz.role);
  const amount = Number(req.body.amount || 0);
  const insertRow = {
    ...req.body,
    ...bizWriteFields(biz, userId),
    original_amount: amount,  // lock original amount; never mutate this
    paid_amount:     0,
    status:          'open',
    source_channel:   req.body.source_channel  || 'web',
    approval_status:  confirmed ? (req.body.approval_status || 'approved') : 'pending_approval',
    created_by_role:  biz.role,
  };
  const { data, error } = await supabase.from('debts')
    .insert(insertRow).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(computeDebtStatus(data));
});

// ── PATCH /api/debts/:id — edit a debt's editable fields ─────────────────────
// Used to fix details (counterparty / amount / due date / description / type)
// before or after approval. Business-scoped; privileged roles only.
// original_amount tracks the editable total so status/remaining recompute.
app.patch('/api/debts/:id', auth, async (req, res) => {
  try {
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canCreateConfirmedFinancialRecord(biz.role))
      return res.status(403).json({ error: 'Your role does not allow editing records' });

    const { data: rows } = await supabase.from('debts')
      .select('id, paid_amount').eq('id', req.params.id).or(bizOrFilter(biz)).limit(1);
    const debt = rows?.[0];
    if (!debt) return res.status(404).json({ error: 'Debt not found' });

    const updates = {};
    if (req.body.counterparty !== undefined) updates.counterparty = String(req.body.counterparty).trim() || null;
    if (req.body.description  !== undefined) updates.description  = String(req.body.description).trim() || null;
    if (req.body.due_date     !== undefined) updates.due_date     = req.body.due_date || null;
    if (req.body.scope        !== undefined) updates.scope        = req.body.scope;
    if (req.body.type         !== undefined && ['receivable', 'payable'].includes(req.body.type))
      updates.type = req.body.type;
    if (req.body.amount !== undefined) {
      const amt = Number(req.body.amount);
      if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'amount must be a positive number' });
      if (amt < Number(debt.paid_amount || 0))
        return res.status(400).json({ error: 'amount cannot be less than already paid' });
      updates.amount = amt;
      updates.original_amount = amt;
    }
    if (Object.keys(updates).length === 0)
      return res.status(400).json({ error: 'No editable fields provided' });

    const { data, error } = await supabase.from('debts')
      .update(updates).eq('id', debt.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(computeDebtStatus(data));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/debts/:id/settle', auth, async (req, res) => {
  const biz = await requireBusiness(req, res);
  if (!biz) return;
  if (!canCreateConfirmedFinancialRecord(biz.role))
    return res.status(403).json({ error: 'Your role does not allow settling records' });
  // Fetch debt first to know original_amount (business-scoped)
  const { data: debts } = await supabase.from('debts')
    .select('*').eq('id', req.params.id).or(bizOrFilter(biz)).limit(1);
  const debt = debts?.[0];
  if (!debt) return res.status(404).json({ error: 'Debt not found' });
  const fullAmount = Number(debt?.original_amount || debt?.amount || 0);
  const { data, error } = await supabase.from('debts')
    .update({
      is_settled:   true,
      settled_at:   new Date().toISOString(),
      status:       'paid',
      paid_amount:  fullAmount,
    })
    .eq('id', debt.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(computeDebtStatus(data));
});

// ─────────────────────────────────────────────────────────────────────────────
// TELEGRAM ROLE MODEL
// ─────────────────────────────────────────────────────────────────────────────
// Telegram is an operational channel — behaviour depends on the member's role:
//   employee / manager  → INPUT channel: submissions become pending_approval
//                         drafts; they never create confirmed cash-impact
//                         records and cannot approve anything (incl. their own).
//   admin / cfo / owner → also NOTIFICATION + APPROVAL channel: they receive
//                         alerts about pending submissions and can approve /
//                         reject / request info — through the SAME backend
//                         endpoints the Web App uses (no Telegram-only logic).
// Every approval stores: approved_by_user_id, approved_at, approved_via_channel.

const ACTION_CHANNELS = ['web', 'telegram', 'mobile', 'api', 'whatsapp_future'];
function normalizeChannel(ch) {
  return ACTION_CHANNELS.includes(ch) ? ch : 'web';
}

// Send a Telegram message to all admin+ members of the business that owns
// `ownerUserId`'s data. No-op if TELEGRAM_BOT_TOKEN is not configured
// (the bot lives in a separate repo / may not be deployed yet).
// `buttons` — array of [{ text, url }] rows for an inline keyboard.
// TODO: when the bot supports callback actions, switch url-buttons for
//       callback_data buttons (Approve / Reject / Ask details) that call
//       PATCH /api/debts/:id/approve|reject with channel='telegram'.
async function notifyBusinessAdminsViaTelegram(ownerUserId, text, buttons = []) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
  if (!botToken) return { sent: 0, skipped: 'no_bot_token' };
  try {
    // Find the business this owner belongs to, then all active admin+ members
    const { data: ownerMem } = await supabase.from('business_members')
      .select('business_id').eq('user_id', ownerUserId).eq('status', 'active').limit(1);
    let adminUserIds = [ownerUserId];
    if (ownerMem?.length) {
      const { data: admins } = await supabase.from('business_members')
        .select('user_id').eq('business_id', ownerMem[0].business_id)
        .eq('status', 'active').in('role', ['owner', 'ceo', 'admin', 'cfo']);
      if (admins?.length) adminUserIds = admins.map(a => a.user_id);
    }
    // users.id IS the Telegram chat id (no separate telegram_id column).
    const chatIds = [...new Set(adminUserIds)];

    let sent = 0;
    for (const chatId of chatIds) {
      try {
        const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            // buttons may be a flat array (one row) or an array of rows.
            reply_markup: buttons.length
              ? { inline_keyboard: Array.isArray(buttons[0]) ? buttons : [buttons] }
              : undefined,
          }),
        });
        if (resp.ok) sent++;
      } catch (_) { /* one failed chat must not break the rest */ }
    }
    return { sent };
  } catch (e) {
    console.warn('[telegram-notify] failed:', e.message);
    return { sent: 0, error: e.message };
  }
}

// ── Single-chat Telegram DM helper (reused by creator notifications) ─────────
// No-op if no bot token. `buttons` = array of rows for an inline keyboard.
async function sendTelegramDM(chatId, text, buttons = []) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
  if (!botToken || !chatId) return { ok: false, skipped: true };
  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId, text, parse_mode: 'HTML',
        reply_markup: buttons.length ? { inline_keyboard: buttons } : undefined,
      }),
    });
    return { ok: resp.ok };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function resolveUserDisplayName(userId) {
  try {
    const { data } = await supabase.from('users').select('first_name, username').eq('id', userId).single();
    return data?.first_name || data?.username || String(userId);
  } catch { return String(userId); }
}

// Creator notification templates. p: { type, counterparty, amount, approver, reason, note, raw }
const CREATOR_TEMPLATES = {
  request_approved_creator: {
    ru: (p) => p.type === 'receivable'
      ? `✅ Ожидаемая оплата подтверждена\n\nКлиент: ${p.counterparty}\nСумма: ${p.amount}\nПодтвердил: ${p.approver}\n\nЗапись стала активной дебиторкой.\nКэш изменится только после фактического получения оплаты.`
      : `✅ Ваша заявка подтверждена\n\nКонтрагент: ${p.counterparty}\nСумма: ${p.amount}\nПодтвердил: ${p.approver}\n\nЗаявка стала активным обязательством компании.\nДеньги со счёта ещё не списаны.`,
    en: (p) => p.type === 'receivable'
      ? `✅ Expected payment approved\n\nClient: ${p.counterparty}\nAmount: ${p.amount}\nApproved by: ${p.approver}\n\nIt is now an active receivable.\nCash changes only when the money is actually received.`
      : `✅ Your request was approved\n\nCounterparty: ${p.counterparty}\nAmount: ${p.amount}\nApproved by: ${p.approver}\n\nIt is now an active company obligation.\nNo money has left the account yet.`,
    id: (p) => p.type === 'receivable'
      ? `✅ Pembayaran yang diharapkan disetujui\n\nKlien: ${p.counterparty}\nJumlah: ${p.amount}\nDisetujui oleh: ${p.approver}\n\nKini menjadi piutang aktif.\nKas berubah hanya saat uang benar-benar diterima.`
      : `✅ Permintaan Anda disetujui\n\nPemasok: ${p.counterparty}\nJumlah: ${p.amount}\nDisetujui oleh: ${p.approver}\n\nKini menjadi kewajiban aktif perusahaan.\nBelum ada uang yang keluar dari rekening.`,
  },
  request_rejected_creator: {
    ru: (p) => `❌ Ваша заявка отклонена\n\nКонтрагент: ${p.counterparty}\nСумма: ${p.amount}\nОтклонил: ${p.approver}\n\nПричина: ${p.reason || 'Причина не указана.'}`,
    en: (p) => `❌ Your request was rejected\n\nCounterparty: ${p.counterparty}\nAmount: ${p.amount}\nRejected by: ${p.approver}\n\nReason: ${p.reason || 'No reason provided.'}`,
    id: (p) => `❌ Permintaan Anda ditolak\n\nPemasok: ${p.counterparty}\nJumlah: ${p.amount}\nDitolak oleh: ${p.approver}\n\nAlasan: ${p.reason || 'Alasan tidak diberikan.'}`,
  },
  request_info_creator: {
    ru: (p) => `ℹ️ Нужна дополнительная информация\n\nПо вашей заявке запросили уточнение:\n${p.raw ? `\n"${p.raw}"\n` : ''}\nКомментарий:\n${p.note || 'Пожалуйста, уточните детали.'}\n\nОтветьте сообщением или откройте заявку в CFO AI.`,
    en: (p) => `ℹ️ More information needed\n\nClarification was requested on your submission:\n${p.raw ? `\n"${p.raw}"\n` : ''}\nNote:\n${p.note || 'Please clarify the details.'}\n\nReply with a message or open the request in CFO AI.`,
    id: (p) => `ℹ️ Perlu informasi tambahan\n\nKlarifikasi diminta untuk pengajuan Anda:\n${p.raw ? `\n"${p.raw}"\n` : ''}\nCatatan:\n${p.note || 'Mohon perjelas detailnya.'}\n\nBalas dengan pesan atau buka permintaan di CFO AI.`,
  },
};

// Notify the ORIGINAL CREATOR of a debt about a state change. Never throws —
// the financial action must succeed even if Telegram delivery fails.
// Creator resolution: created_by_telegram_id → created_by_user_id (= telegram id).
async function notifyRequestCreatorViaTelegram({ debt, event, actorUserId, actorRole, reason, note }) {
  try {
    const chatId = debt.created_by_telegram_id || debt.created_by_user_id || null;
    if (!chatId) { console.warn('[creator-notify] no telegram identity for debt', debt.id); return; }
    // Don't notify the actor about their own action (e.g. owner self-approve).
    if (String(chatId) === String(actorUserId)) return;

    const tplKey = { approved: 'request_approved_creator', rejected: 'request_rejected_creator', request_info: 'request_info_creator' }[event];
    if (!tplKey) return;

    const lang = await getUserLanguage(chatId).catch(() => 'en');
    let approver = actorUserId ? await resolveUserDisplayName(actorUserId) : '—';
    if (actorRole) approver += ` · ${actorRole}`;
    const tpl = CREATOR_TEMPLATES[tplKey];
    const fn = tpl[lang] || tpl.en;
    const text = fn({
      type:         debt.type,
      counterparty: debt.counterparty || '—',
      amount:       `${Number(debt.original_amount || debt.amount || 0).toLocaleString('en-US')} ${debt.currency || 'IDR'}`,
      approver,
      reason:       reason || debt.rejected_reason || null,
      note:         note || debt.info_request_note || null,
      raw:          debt.raw_input_text || '',
    });

    // Public deep-link base. Prefer WEB_APP_URL; CLIENT_URL is the CORS origin
    // and may point at a stale/non-public domain, so it is not used here.
    const webAppUrl = process.env.WEB_APP_URL || 'https://helm-finance-web-production.up.railway.app';
    const openUrl = `${webAppUrl}/${debt.type === 'receivable' ? 'receivables' : 'payables'}`;
    const res = await sendTelegramDM(chatId, text, [[{ text: '🌐 Открыть заявку', url: openUrl }]]);
    if (!res.ok && !res.skipped) console.warn('[creator-notify] delivery failed for debt', debt.id, res.error || '');
  } catch (e) {
    console.warn('[creator-notify] error:', e.message);
  }
}

// ── PATCH /api/debts/:id/approve ─────────────────────────────────────────────
// Owner / admin approves a pending_approval debt created from Telegram.
async function approveDebtHandler(req, res) {
  const userId = req.user.userId;
  const channel = normalizeChannel(req.body?.channel);
  try {
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canApproveFinancialRecord(biz.role))
      return res.status(403).json({ error: 'Only owner, admin or CFO can approve' });

    // Record must belong to the active business
    const { data: rows } = await supabase.from('debts')
      .select('id, created_by_user_id, approval_status').eq('id', req.params.id).or(bizOrFilter(biz)).limit(1);
    const existing = rows?.[0];
    if (!existing) return res.status(404).json({ error: 'Debt not found' });

    // Self-approval guard: only the owner/ceo may approve a record they submitted
    if (existing.created_by_user_id === userId && !['owner', 'ceo'].includes(biz.role))
      return res.status(403).json({ error: 'You cannot approve your own submission' });

    const { data, error } = await supabase.from('debts')
      .update({
        approval_status:      'approved',
        approved_by_user_id:  userId,
        approved_at:          new Date().toISOString(),
        approved_via_channel: channel,
        last_action_channel:  channel,
        status:               'open',   // activate the record
      })
      .eq('id', existing.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    // Notify creator only on a real state change (pending → approved).
    if (existing.approval_status !== 'approved')
      notifyRequestCreatorViaTelegram({ debt: data, event: 'approved', actorUserId: userId, actorRole: biz.role });
    res.json(computeDebtStatus(data));
  } catch (e) { res.status(500).json({ error: e.message }); }
}
app.patch('/api/debts/:id/approve', auth, approveDebtHandler);
app.post('/api/debts/:id/approve',  auth, approveDebtHandler); // Telegram bot calls POST

// ── PATCH /api/debts/:id/reject ──────────────────────────────────────────────
async function rejectDebtHandler(req, res) {
  const userId = req.user.userId;
  const { reason } = req.body || {};
  const channel = normalizeChannel(req.body?.channel);
  try {
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canApproveFinancialRecord(biz.role))
      return res.status(403).json({ error: 'Only owner, admin or CFO can reject' });

    const { data: rows } = await supabase.from('debts')
      .select('id, approval_status').eq('id', req.params.id).or(bizOrFilter(biz)).limit(1);
    if (!rows?.length) return res.status(404).json({ error: 'Debt not found' });

    const { data, error } = await supabase.from('debts')
      .update({
        approval_status:      'rejected',
        approved_by_user_id:  userId,
        approved_at:          new Date().toISOString(),
        approved_via_channel: channel,
        last_action_channel:  channel,
        rejected_reason:      reason || null,
        status:               'cancelled',
      })
      .eq('id', rows[0].id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (rows[0].approval_status !== 'rejected')
      notifyRequestCreatorViaTelegram({ debt: data, event: 'rejected', actorUserId: userId, actorRole: biz.role, reason: reason || null });
    res.json(computeDebtStatus(data));
  } catch (e) { res.status(500).json({ error: e.message }); }
}
app.patch('/api/debts/:id/reject', auth, rejectDebtHandler);
app.post('/api/debts/:id/reject',  auth, rejectDebtHandler); // Telegram bot calls POST

// ── POST /api/debts/:id/request-info ─────────────────────────────────────────
// Admin+ asks the submitter for clarification instead of approving/rejecting.
// Record stays pending_approval; note is stored for traceability.
app.post('/api/debts/:id/request-info', auth, async (req, res) => {
  const userId = req.user.userId;
  const { note } = req.body || {};
  const channel = normalizeChannel(req.body?.channel);
  try {
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canApproveFinancialRecord(biz.role))
      return res.status(403).json({ error: 'Only owner, admin or CFO can request info' });

    const { data: rows } = await supabase.from('debts')
      .select('id').eq('id', req.params.id).or(bizOrFilter(biz)).limit(1);
    if (!rows?.length) return res.status(404).json({ error: 'Debt not found' });

    const { data, error } = await supabase.from('debts')
      .update({
        info_request_note:   note || null,
        info_requested_at:   new Date().toISOString(),
        info_requested_by:   userId,
        last_action_channel: channel,
      })
      .eq('id', rows[0].id).select().single();
    if (error) return res.status(500).json({ error: error.message });

    notifyRequestCreatorViaTelegram({ debt: data, event: 'request_info', actorUserId: userId, actorRole: biz.role, note: note || null });
    res.json(computeDebtStatus(data));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// TELEGRAM INLINE APPROVALS — bot-safe endpoints (x-bot-secret + telegram_id)
// ─────────────────────────────────────────────────────────────────────────────
// The web approve/reject/request-info endpoints above require a user JWT and
// stay strict. These mirror them for the bot: identity proven by the shared
// secret, the acting user resolved from telegram_id, all permission checks
// done server-side. Approval NEVER moves cash — it only flips approval_status.

// Resolve a Telegram approver against a debt: returns { debt, userId, role }
// or { error }. Validates membership in the debt's business.
async function resolveBotApprover(telegram_id, debtId) {
  const { data: dRows } = await supabase.from('debts')
    .select('id, business_id, user_id, created_by_user_id, approval_status, status, type, counterparty, amount, original_amount')
    .eq('id', debtId).limit(1);
  const debt = dRows?.[0];
  if (!debt) return { error: 'not_found' };

  // Determine the business: explicit business_id, else the business owned by
  // the legacy debt.user_id (owner).
  let businessId = debt.business_id;
  if (!businessId) {
    const { data: bRows } = await supabase.from('businesses')
      .select('id').eq('owner_user_id', debt.user_id).order('created_at', { ascending: true }).limit(1);
    businessId = bRows?.[0]?.id || null;
  }
  if (!businessId) return { error: 'forbidden' };

  const { data: mem } = await supabase.from('business_members')
    .select('role').eq('user_id', telegram_id).eq('business_id', businessId)
    .eq('status', 'active').limit(1);
  const role = mem?.[0]?.role;
  if (!role) return { error: 'forbidden' };

  return { debt, userId: Number(telegram_id), role };
}

// POST /api/telegram/debts/:id/approve
app.post('/api/telegram/debts/:id/approve', async (req, res) => {
  if (!requireBotSecret(req)) return res.status(401).json({ error: 'Invalid bot credentials' });
  const { telegram_id } = req.body || {};
  if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' });
  try {
    const r = await resolveBotApprover(telegram_id, req.params.id);
    if (r.error === 'not_found') return res.status(404).json({ error: 'not_found', message: 'Request not found.' });
    if (r.error)                 return res.status(403).json({ error: 'forbidden', message: 'You do not have access to this request.' });
    const { debt, userId, role } = r;

    if (!canApproveFinancialRecord(role))
      return res.status(403).json({ error: 'forbidden', message: 'Your role cannot approve requests.' });
    if (debt.created_by_user_id === userId && !['owner', 'ceo'].includes(role))
      return res.status(403).json({ error: 'forbidden', message: 'You cannot approve your own submission.' });

    // Duplicate-click protection: report current state, never silently flip.
    if (debt.approval_status === 'approved')
      return res.json({ already: true, state: 'approved', debt: computeDebtStatus(debt) });
    if (debt.approval_status === 'rejected')
      return res.status(409).json({ error: 'already_rejected', message: 'This request was already rejected.' });

    const { data, error } = await supabase.from('debts').update({
      approval_status: 'approved', approved_by_user_id: userId,
      approved_at: new Date().toISOString(),
      approved_via_channel: 'telegram', last_action_channel: 'telegram', status: 'open',
    }).eq('id', debt.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    notifyRequestCreatorViaTelegram({ debt: data, event: 'approved', actorUserId: userId, actorRole: role });
    res.json({ ok: true, state: 'approved', type: debt.type, debt: computeDebtStatus(data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/telegram/debts/:id/reject
app.post('/api/telegram/debts/:id/reject', async (req, res) => {
  if (!requireBotSecret(req)) return res.status(401).json({ error: 'Invalid bot credentials' });
  const { telegram_id, reason } = req.body || {};
  if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' });
  try {
    const r = await resolveBotApprover(telegram_id, req.params.id);
    if (r.error === 'not_found') return res.status(404).json({ error: 'not_found', message: 'Request not found.' });
    if (r.error)                 return res.status(403).json({ error: 'forbidden', message: 'You do not have access to this request.' });
    const { debt, userId, role } = r;

    if (!canApproveFinancialRecord(role))
      return res.status(403).json({ error: 'forbidden', message: 'Your role cannot reject requests.' });
    if (debt.created_by_user_id === userId && !['owner', 'ceo'].includes(role))
      return res.status(403).json({ error: 'forbidden', message: 'You cannot act on your own submission.' });

    // Do not silently flip an already-approved record to rejected.
    if (debt.approval_status === 'approved')
      return res.status(409).json({ error: 'already_approved', message: 'This request was already approved.' });
    if (debt.approval_status === 'rejected')
      return res.json({ already: true, state: 'rejected', debt: computeDebtStatus(debt) });

    const { data, error } = await supabase.from('debts').update({
      approval_status: 'rejected', approved_by_user_id: userId,
      approved_at: new Date().toISOString(),
      approved_via_channel: 'telegram', last_action_channel: 'telegram',
      rejected_reason: reason || 'Rejected from Telegram', status: 'cancelled',
    }).eq('id', debt.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    notifyRequestCreatorViaTelegram({ debt: data, event: 'rejected', actorUserId: userId, actorRole: role, reason: reason || 'Rejected from Telegram' });
    res.json({ ok: true, state: 'rejected', debt: computeDebtStatus(data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/telegram/debts/:id/request-info
app.post('/api/telegram/debts/:id/request-info', async (req, res) => {
  if (!requireBotSecret(req)) return res.status(401).json({ error: 'Invalid bot credentials' });
  const { telegram_id, note } = req.body || {};
  if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' });
  try {
    const r = await resolveBotApprover(telegram_id, req.params.id);
    if (r.error === 'not_found') return res.status(404).json({ error: 'not_found', message: 'Request not found.' });
    if (r.error)                 return res.status(403).json({ error: 'forbidden', message: 'You do not have access to this request.' });
    const { debt, userId, role } = r;

    if (!canApproveFinancialRecord(role))
      return res.status(403).json({ error: 'forbidden', message: 'Your role cannot request info.' });

    const { data, error } = await supabase.from('debts').update({
      info_request_note: note || 'Please provide more details',
      info_requested_at: new Date().toISOString(),
      info_requested_by: userId, last_action_channel: 'telegram',
    }).eq('id', debt.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    notifyRequestCreatorViaTelegram({ debt: data, event: 'request_info', actorUserId: userId, actorRole: role, note: note || 'Please provide more details' });
    res.json({ ok: true, state: 'info_requested', created_by_telegram_id: debt.created_by_telegram_id || null, debt: computeDebtStatus(data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// DECISION ENGINE ENDPOINTS — deterministic assessments (no data mutation)
// ─────────────────────────────────────────────────────────────────────────────

async function loadBusinessDebt(biz, debtId) {
  const { data } = await supabase.from('debts').select('*')
    .eq('id', debtId).or(bizOrFilter(biz))
    .or('is_training.is.null,is_training.eq.false').limit(1);
  return data?.[0] ? enrichDebts([data[0]])[0] : null;
}

// GET /api/decisions/debts/:id/approval — assess approving a pending request
app.get('/api/decisions/debts/:id/approval', auth, async (req, res) => {
  try {
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canViewBusinessFinance(biz.role))
      return res.status(403).json({ error: 'Your role cannot view decision analysis' });
    const debt = await loadBusinessDebt(biz, req.params.id);
    if (!debt) return res.status(404).json({ error: 'Debt not found' });
    const language = normalizeLanguage(req.query.language || await getUserLanguage(req.user.userId));
    const snap = await buildBusinessFinancialSnapshot(biz, language);
    res.json(assessDebtApproval(snap, debt));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/decisions/debts/:id/payment — SIMULATE a payment/receipt (no writes)
app.post('/api/decisions/debts/:id/payment', auth, async (req, res) => {
  try {
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canViewBusinessFinance(biz.role))
      return res.status(403).json({ error: 'Your role cannot view decision analysis' });
    const debt = await loadBusinessDebt(biz, req.params.id);
    if (!debt) return res.status(404).json({ error: 'Debt not found' });

    const { amount, wallet_id } = req.body || {};
    // Validate wallet belongs to the business if provided
    if (wallet_id) {
      const { data: w } = await supabase.from('wallets').select('id').eq('id', wallet_id).or(bizOrFilter(biz)).limit(1);
      if (!w?.length) return res.status(400).json({ error: 'Invalid or inaccessible wallet' });
    }
    const language = normalizeLanguage(req.query.language || await getUserLanguage(req.user.userId));
    const snap = await buildBusinessFinancialSnapshot(biz, language);
    res.json(assessDebtPayment(snap, debt, amount, wallet_id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/decisions/payment-priority — ranked approved unpaid payables
app.get('/api/decisions/payment-priority', auth, async (req, res) => {
  try {
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canViewBusinessFinance(biz.role))
      return res.status(403).json({ error: 'Your role cannot view decision analysis' });
    const snap = await buildBusinessFinancialSnapshot(biz, 'en');
    res.json({ items: buildPaymentPriority(snap) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/telegram/debts/:id/decision — bot-safe compact assessment
app.post('/api/telegram/debts/:id/decision', async (req, res) => {
  if (!requireBotSecret(req)) return res.status(401).json({ error: 'Invalid bot credentials' });
  const { telegram_id } = req.body || {};
  if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' });
  try {
    const r = await resolveBotApprover(telegram_id, req.params.id);
    if (r.error === 'not_found') return res.status(404).json({ error: 'not_found' });
    if (r.error)                 return res.status(403).json({ error: 'forbidden' });
    if (!canViewBusinessFinance(r.role)) return res.status(403).json({ error: 'forbidden' });

    const { data: bizRow } = await supabase.from('businesses').select('*').eq('id', r.debt.business_id || null).limit(1);
    let business = bizRow?.[0];
    if (!business) {
      const { data: ob } = await supabase.from('businesses').select('*').eq('owner_user_id', r.debt.user_id).order('created_at', { ascending: true }).limit(1);
      business = ob?.[0];
    }
    if (!business) return res.status(404).json({ error: 'business_not_found' });
    const biz = { business, role: r.role, ownerUserId: business.owner_user_id };
    const language = normalizeLanguage(await getUserLanguage(telegram_id).catch(() => 'en'));
    const debt = await loadBusinessDebt(biz, req.params.id);
    if (!debt) return res.status(404).json({ error: 'not_found' });
    const snap = await buildBusinessFinancialSnapshot(biz, language);
    res.json({ approval: assessDebtApproval(snap, debt), payment: assessDebtPayment(snap, debt, null, null), currency: snap.currency });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const MAX_RECEIPTS = 5;

// Resolve a Telegram submitter → { submitterUser, role, businessId, ownerId,
// isPrivileged } using the same rules as from-telegram (single business).
async function resolveTelegramMember(telegram_id) {
  const { data: rows } = await supabase.from('users').select('id, username, first_name').eq('id', telegram_id).limit(1);
  const submitterUser = rows?.[0];
  if (!submitterUser) return { error: 'not_linked' };
  submitterUser.name = submitterUser.first_name || submitterUser.username || String(submitterUser.id);

  const { data: mem } = await supabase.from('business_members')
    .select('role, business_id, businesses(owner_user_id)')
    .eq('user_id', submitterUser.id).eq('status', 'active').limit(2);
  if (!mem?.length) return { error: 'not_member' };
  if (mem.length > 1) return { error: 'multiple_businesses', businesses: mem.map(m => m.business_id) };

  const role = mem[0].role;
  return {
    submitterUser, role,
    businessId: mem[0].business_id,
    ownerId: mem[0].businesses?.owner_user_id || submitterUser.id,
    isPrivileged: ['owner', 'ceo', 'admin', 'cfo'].includes(role),
  };
}

// Download a Telegram file as a base64 buffer + mime via the Bot API.
async function fetchTelegramFile(fileId) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
  if (!botToken) return null;
  const meta = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`).then(r => r.json());
  const filePath = meta?.result?.file_path;
  if (!filePath) return null;
  const resp = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  let mime = resp.headers.get('content-type') || '';
  if (!mime || mime === 'application/octet-stream') {
    mime = /\.pdf$/i.test(filePath) ? 'application/pdf' : 'image/jpeg';
  }
  return { base64: buf.toString('base64'), mime };
}

// Recognize amount + counterparty from a receipt image/PDF via Claude vision.
// Returns { amount, counterparty, currency, date } or null on failure.
async function recognizeReceipt(file) {
  if (!process.env.ANTHROPIC_API_KEY || !file) return null;
  try {
    const isPdf = /pdf/i.test(file.mime);
    const block = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.base64 } }
      : { type: 'image',    source: { type: 'base64', media_type: file.mime.startsWith('image/') ? file.mime : 'image/jpeg', data: file.base64 } };
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-5', max_tokens: 300,
      messages: [{ role: 'user', content: [block, { type: 'text', text:
        'Это чек/счёт. Верни ТОЛЬКО JSON без markdown: {"amount":число_итоговой_суммы,"currency":"IDR","counterparty":"продавец/магазин или null","date":"YYYY-MM-DD или null"}. amount — итоговая сумма к оплате (total/grand total). Если не уверен — поставь null.' }] }],
    });
    const raw = (resp.content?.[0]?.text || '').trim().replace(/```json\n?/g, '').replace(/```/g, '').trim();
    const j = JSON.parse(raw);
    return { amount: Number(j.amount) || null, currency: j.currency || 'IDR', counterparty: j.counterparty || null, date: j.date || null };
  } catch (e) { console.warn('[receipt-ocr] failed:', e.message); return null; }
}

// ── POST /api/telegram/debts/attach-receipt — creator sends a receipt ────────
// Attaches a photo/PDF to the creator's open request, runs OCR to recognize the
// amount + counterparty, recomputes the receipts total. Bot-safe. Up to 5.
app.post('/api/telegram/debts/attach-receipt', async (req, res) => {
  if (!requireBotSecret(req)) return res.status(401).json({ error: 'Invalid bot credentials' });
  const { telegram_id, file_id } = req.body || {};
  if (!telegram_id || !file_id) return res.status(400).json({ error: 'telegram_id and file_id required' });
  try {
    const { data: candidates } = await supabase.from('debts')
      .select('*')
      .or(`created_by_telegram_id.eq.${telegram_id},created_by_user_id.eq.${telegram_id}`)
      .not('approval_status', 'in', '("rejected")')
      .not('status', 'in', '("paid","cancelled")')
      .order('info_requested_at', { ascending: false, nullsLast: true })
      .order('created_at', { ascending: false })
      .limit(1);
    const debt = candidates?.[0];
    if (!debt) return res.status(404).json({ error: 'no_open_request', message: 'No open request to attach a receipt to.' });

    const existing = Array.isArray(debt.attachments) ? debt.attachments : [];
    if (existing.length >= MAX_RECEIPTS)
      return res.status(400).json({ error: 'too_many', message: `Maximum ${MAX_RECEIPTS} receipts per request.`, count: existing.length });

    // OCR (best-effort — never blocks the attach)
    const file = await fetchTelegramFile(file_id).catch(() => null);
    const ocr = await recognizeReceipt(file).catch(() => null);
    const item = { file_id, mime: file?.mime || null, amount: ocr?.amount ?? null, counterparty: ocr?.counterparty ?? null, date: ocr?.date ?? null, recognized: !!ocr };
    const attachments = [...existing, item];

    // Recompute total from recognized receipt amounts (if any recognized).
    const recognizedAmounts = attachments.map(a => Number(a.amount)).filter(n => isFinite(n) && n > 0);
    const receiptsTotal = recognizedAmounts.reduce((s, n) => s + n, 0);

    const updates = {
      attachments,
      attachment_url: `tg:${attachments[0].file_id}`, // legacy first-receipt pointer
      last_action_channel: 'telegram',
    };
    // Use the receipts total as the obligation amount when we recognized values.
    if (receiptsTotal > 0) { updates.amount = receiptsTotal; updates.original_amount = receiptsTotal; }
    // Fill counterparty from a recognized receipt if the debt still has a placeholder.
    const recogCp = attachments.find(a => a.counterparty)?.counterparty;
    if (recogCp && (!debt.counterparty || debt.counterparty === debt.created_by_name || debt.counterparty === 'Reimbursement'))
      updates.counterparty = recogCp;

    const { data, error } = await supabase.from('debts').update(updates).eq('id', debt.id).select().single();
    if (error) return res.status(500).json({ error: error.message });

    const ccy = data.currency || 'IDR';
    const ownerId = debt.user_id;
    const name = debt.created_by_name || String(telegram_id);
    const webAppUrl = process.env.WEB_APP_URL || 'https://helm-finance-web-production.up.railway.app';
    const lines = attachments.map((a, i) => `${i + 1}. ${a.amount ? Number(a.amount).toLocaleString('en-US') + ' ' + ccy : '— не распознано'}${a.counterparty ? ' · ' + a.counterparty : ''}`).join('\n');
    notifyBusinessAdminsViaTelegram(ownerId,
      `📎 Чек получен (${attachments.length}/${MAX_RECEIPTS}) по заявке\n\nОт: ${name}\n${lines}\n\nИтого по чекам: <b>${receiptsTotal.toLocaleString('en-US')} ${ccy}</b>`,
      [[{ text: '🌐 Открыть заявку', url: `${webAppUrl}/${debt.type === 'receivable' ? 'receivables' : 'payables'}` }]]
    ).catch(() => {});

    res.json({ ok: true, debt_id: data.id, counterparty: data.counterparty, count: attachments.length, receipts_total: receiptsTotal, recognized: !!ocr, item_amount: item.amount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/telegram/debts/from-receipt — create a payable from an invoice ─
// The creator sends an invoice photo/PDF (e.g. caption "нужно оплатить"). OCR
// recognizes amount + counterparty, a payable is created and sent to approval,
// and the file is attached. Bot-safe. Manager/employee → pending_approval.
app.post('/api/telegram/debts/from-receipt', async (req, res) => {
  if (!requireBotSecret(req)) return res.status(401).json({ error: 'Invalid bot credentials' });
  const { telegram_id, file_id, caption, kind } = req.body || {};
  if (!telegram_id || !file_id) return res.status(400).json({ error: 'telegram_id and file_id required' });
  try {
    const m = await resolveTelegramMember(telegram_id);
    if (m.error) return res.status(m.error === 'multiple_businesses' ? 409 : 403).json({ error: m.error });

    const file = await fetchTelegramFile(file_id).catch(() => null);
    const ocr = await recognizeReceipt(file).catch(() => null);
    if (!ocr || !ocr.amount)
      return res.status(422).json({ error: 'amount_not_recognized', message: 'Не удалось распознать сумму на счёте.' });

    // Reimbursement: the submitter paid (often from personal funds) and the
    // company owes THEM, so the counterparty is the submitter — never the OCR
    // counterparty from the payment proof.
    const isReimbursement = kind === 'expense_request';
    const amountNum = Number(ocr.amount);
    const approvalStatus = m.isPrivileged ? 'approved' : 'pending_approval';
    const counterparty = isReimbursement
      ? m.submitterUser.name
      : (ocr.counterparty || m.submitterUser.name || 'Invoice');
    const item = { file_id, mime: file?.mime || null, amount: amountNum, counterparty: isReimbursement ? null : (ocr.counterparty || null), date: ocr.date || null, recognized: true };

    const insertRow = {
      user_id: m.ownerId, business_id: m.businessId, type: 'payable',
      counterparty,
      amount: amountNum, original_amount: amountNum, paid_amount: 0,
      currency: ocr.currency || 'IDR', due_date: isReimbursement ? null : (ocr.date || null),
      description: isReimbursement
        ? ((caption && caption.trim()) || 'Reimbursement (paid from personal funds)')
        : ((caption && caption.trim()) || 'Invoice via Telegram'),
      training_type: isReimbursement ? 'expense_request' : null,
      status: 'open', source_channel: 'telegram',
      raw_input_text: (caption && caption.trim()) || null,
      created_by_user_id: m.submitterUser.id, created_by_telegram_id: Number(telegram_id),
      created_by_name: m.submitterUser.name, created_by_role: m.role,
      approval_status: approvalStatus,
      approved_by_user_id: m.isPrivileged ? m.submitterUser.id : null,
      approved_at: m.isPrivileged ? new Date().toISOString() : null,
      approved_via_channel: m.isPrivileged ? 'telegram' : null,
      last_action_channel: 'telegram',
      attachments: [item], attachment_url: `tg:${file_id}`,
    };
    const { data, error } = await supabase.from('debts').insert(insertRow).select().single();
    if (error) return res.status(500).json({ error: error.message });

    const ccy = data.currency || 'IDR';
    const webAppUrl = process.env.WEB_APP_URL || 'https://helm-finance-web-production.up.railway.app';
    if (!m.isPrivileged) {
      const text = isReimbursement
        ? `🧾 <b>Компенсация расхода (из Telegram)</b>\n\nВернуть: ${data.counterparty}\nСумма: <b>${amountNum.toLocaleString('en-US')} ${ccy}</b>\nСоздал: ${m.submitterUser.name} · ${m.role}\n📎 Оплачено с личных средств · ⏳ ожидает подтверждения`
        : `📤 <b>Счёт на оплату (из Telegram)</b>\n\nПоставщик: ${data.counterparty}\nСумма: <b>${amountNum.toLocaleString('en-US')} ${ccy}</b>\nСрок: ${data.due_date || '—'}\nСоздал: ${m.submitterUser.name} · ${m.role}\n📎 Распознано со счёта · ⏳ ожидает подтверждения`;
      notifyBusinessAdminsViaTelegram(m.ownerId, text, [
        [ { text: '📊 View impact', callback_data: `debt_impact:${data.id}` } ],
        [ { text: '✅ Approve', callback_data: `debt_approve:${data.id}` }, { text: '❌ Reject', callback_data: `debt_reject:${data.id}` } ],
        [ { text: 'ℹ️ Ask details', callback_data: `debt_info:${data.id}` }, { text: '🌐 Open', url: `${webAppUrl}/payables` } ],
      ]).catch(() => {});
    }

    res.json({ ok: true, action: 'created', kind: isReimbursement ? 'expense_request' : 'payable', debt_id: data.id, amount: amountNum, counterparty: data.counterparty, needs_approval: !m.isPrivileged, currency: ccy });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/debts/:id/receipt — view an attached receipt ────────────────────
// Image is opened via <a href> (no header), so the JWT may arrive as ?token=.
// If attachment is a Telegram file (tg:<file_id>), proxy it via the Bot API.
app.get('/api/debts/:id/receipt', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    try { req.user = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ error: 'Unauthorized' }); }
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canViewBusinessFinance(biz.role)) return res.status(403).json({ error: 'Forbidden' });
    const { data: rows } = await supabase.from('debts').select('attachment_url, attachments').eq('id', req.params.id).or(bizOrFilter(biz)).limit(1);
    const row = rows?.[0];
    if (!row) return res.status(404).json({ error: 'No receipt' });

    // ?i=<index> selects a specific receipt from the attachments array.
    const idx = req.query.i !== undefined ? Number(req.query.i) : null;
    let fileId = null, url = row.attachment_url;
    if (idx !== null && Array.isArray(row.attachments) && row.attachments[idx]) {
      const a = row.attachments[idx];
      if (a.file_id) fileId = a.file_id; else if (a.url) url = a.url;
    } else if (url && url.startsWith('tg:')) {
      fileId = url.slice(3);
    }
    if (!fileId) {
      if (!url) return res.status(404).json({ error: 'No receipt' });
      if (!url.startsWith('tg:')) return res.redirect(url);
      fileId = url.slice(3);
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
    if (!botToken) return res.status(503).json({ error: 'bot_not_configured' });
    const meta = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`).then(r => r.json());
    const filePath = meta?.result?.file_path;
    if (!filePath) return res.status(404).json({ error: 'File not found' });
    const fileResp = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
    res.set('Content-Type', fileResp.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=300');
    const buf = Buffer.from(await fileResp.arrayBuffer());
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/debts/from-telegram ────────────────────────────────────────────
// Called by the Telegram bot to create a draft receivable / payable.
// Requires telegram_id → users.id mapping.
// Role check: employee creates pending_approval; owner/admin creates approved directly.
app.post('/api/debts/from-telegram', async (req, res) => {
  try {
    // ── Bot authentication ───────────────────────────────────────────────────
    // This endpoint has no user JWT (called by the bot, not a browser).
    // The bot must prove its identity with a shared secret header:
    //   x-bot-secret: <TELEGRAM_WEBHOOK_SECRET or BOT_TOKEN>
    // Without this check, anyone who knows a telegram_id could inject records.
    const botSecret = process.env.TELEGRAM_WEBHOOK_SECRET || process.env.BOT_TOKEN;
    if (!req.headers['x-bot-secret'] || req.headers['x-bot-secret'] !== botSecret) {
      return res.status(401).json({ error: 'Invalid bot credentials' });
    }

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
      business_id,                // optional: explicit business (validated below)
    } = req.body;

    if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' });
    if (!type || !['receivable', 'payable'].includes(type))
      return res.status(400).json({ error: 'type must be receivable or payable' });
    if (!amount || isNaN(Number(amount)))
      return res.status(400).json({ error: 'amount required' });

    // Resolve submitting user. In this app users.id IS the Telegram id
    // (the telegram_id column may be NULL), so match on id first, then fall
    // back to the telegram_id column for any rows that have it populated.
    // users.id IS the Telegram id in this app — match on id directly.
    // Table columns: id, username, first_name, role (no name/last_name/telegram_id).
    const { data: submitterRows, error: subErr } = await supabase.from('users')
      .select('id, username, first_name').eq('id', telegram_id).limit(1);
    const submitterUser = submitterRows?.[0];
    if (submitterUser) {
      submitterUser.name = submitterUser.first_name || submitterUser.username || String(submitterUser.id);
    }
    if (subErr) console.warn('[from-telegram] user lookup error:', subErr.message);
    if (!submitterUser)
      return res.status(403).json({
        error: 'not_linked',
        message: 'Your Telegram is not linked to CFO AI. Contact your administrator.',
      });

    // ── Resolve target business + submitter role ────────────────────────────
    // Priority: explicit business_id (membership validated) → submitter's
    // single active membership → legacy owner-telegram-id path.
    let memberRole = null;
    let targetBusinessId = null;
    let ownerId = submitterUser.id;

    if (business_id) {
      const { data: mem } = await supabase.from('business_members')
        .select('role, business_id, businesses(owner_user_id)')
        .eq('user_id', submitterUser.id).eq('business_id', business_id)
        .eq('status', 'active').limit(1);
      if (!mem?.length)
        return res.status(403).json({ error: 'not_member', message: 'You are not a member of this business.' });
      memberRole       = mem[0].role;
      targetBusinessId = mem[0].business_id;
      ownerId          = mem[0].businesses?.owner_user_id || submitterUser.id;
    } else {
      const { data: mem } = await supabase.from('business_members')
        .select('role, business_id, businesses(owner_user_id)')
        .eq('user_id', submitterUser.id).eq('status', 'active').limit(2);
      if (mem?.length > 1) {
        // Multiple businesses — bot must ask which one and resend with business_id
        return res.status(409).json({
          error: 'multiple_businesses',
          message: 'User belongs to multiple businesses; specify business_id.',
          businesses: mem.map(m => m.business_id),
        });
      }
      if (mem?.length === 1) {
        memberRole       = mem[0].role;
        targetBusinessId = mem[0].business_id;
        ownerId          = mem[0].businesses?.owner_user_id || submitterUser.id;
      }
    }

    // Membership is REQUIRED — only people tied to a company may submit.
    // A users row without an active business_members row is an orphan
    // (e.g. someone who messaged the bot but was never invited): reject.
    if (!memberRole) {
      return res.status(403).json({
        error: 'not_member',
        message: 'You are not a member of any business in CFO AI. Ask an owner or admin to invite you.',
      });
    }

    // Owner/admin/CFO → approved immediately; others → pending_approval
    const isPrivileged = ['owner', 'ceo', 'admin', 'cfo'].includes(memberRole);
    const approvalStatus = isPrivileged ? 'approved' : 'pending_approval';
    const status         = isPrivileged ? 'open' : 'open'; // always open; pending shown via approval_status

    const amountNum = Number(amount);
    const insertRow = {
      user_id:               ownerId,
      business_id:           targetBusinessId || null,
      type,
      // counterparty is NOT NULL in DB. For a reimbursement (expense_request)
      // there is no external party — the company owes the submitter, so default
      // to the submitter's name; otherwise fall back to a safe placeholder.
      counterparty:          counterparty || submitterUser.name || 'Reimbursement',
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
      approved_via_channel:      isPrivileged ? 'telegram' : null,
      last_action_channel:       'telegram',
    };

    const { data, error } = await supabase.from('debts').insert(insertRow).select().single();
    if (error) return res.status(500).json({ error: error.message });

    // Notify admin+ members about a pending submission (fire-and-forget)
    if (!isPrivileged) {
      const ownerLang = await getUserLanguage(ownerId).catch(() => 'en');
      const text = notificationText(
        type === 'receivable' ? 'telegram_receivable_submitted' : 'telegram_payable_submitted',
        ownerLang,
        {
          counterparty: counterparty || '—',
          amount:       `${amountNum.toLocaleString('en-US')} ${currency || 'IDR'}`,
          due:          due_date || '—',
          createdBy:    submitterUser.name || String(telegram_id),
          role:         memberRole,
          raw:          raw_input_text || '',
        }
      );
      // Public deep-link base. Prefer WEB_APP_URL; CLIENT_URL is the CORS origin
    // and may point at a stale/non-public domain, so it is not used here.
    const webAppUrl = process.env.WEB_APP_URL || 'https://helm-finance-web-production.up.railway.app';
      const openUrl = `${webAppUrl}/${type === 'receivable' ? 'receivables' : 'payables'}`;
      // Inline approval keyboard. callback_data `debt_*:<uuid>` ≤ 49 bytes (limit 64).
      // The bot owns these callbacks and calls /api/telegram/debts/:id/* with x-bot-secret.
      notifyBusinessAdminsViaTelegram(ownerId, text, [
        [ { text: '📊 View impact', callback_data: `debt_impact:${data.id}` } ],
        [ { text: '✅ Approve', callback_data: `debt_approve:${data.id}` },
          { text: '❌ Reject',  callback_data: `debt_reject:${data.id}` } ],
        [ { text: 'ℹ️ Ask details', callback_data: `debt_info:${data.id}` },
          { text: '🌐 Open', url: openUrl } ],
      ]).catch(() => {});
    }

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

    if (!['owner', 'ceo', 'admin', 'cfo'].includes(myRole))
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
      .select('id, first_name, username')
      .in('id', userIds);
    const userMap = Object.fromEntries((users || []).map(u => [u.id, u]));

    const enriched = members.map(m => {
      const u = userMap[m.user_id] || {};
      return {
        ...m,
        name: m.display_name || u.first_name || u.username || `User ${m.user_id}`,
        telegram_id: u.id || null,
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

  const VALID_ROLES = ['employee', 'manager', 'cfo', 'admin', 'ceo'];
  if (!VALID_ROLES.includes(role))
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });

  try {
    const { data: memberships } = await supabase.from('business_members')
      .select('business_id, role').eq('user_id', userId).eq('status', 'active').limit(1);
    if (!memberships?.length) return res.status(403).json({ error: 'Not a member of any business' });
    const { business_id, role: myRole } = memberships[0];

    if (!['owner', 'ceo', 'admin'].includes(myRole))
      return res.status(403).json({ error: 'Only owner, CEO or admin can create invites' });

    // Cannot invite higher/equal role than yourself (only owner can invite admin)
    const ROLE_RANK = { employee: 1, manager: 2, cfo: 3, admin: 4, ceo: 5, owner: 6 };
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
      const { data: u } = await supabase.from('users').select('first_name, username').eq('id', userId).single();
      const displayName = u?.first_name || u?.username || null;

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

// ─────────────────────────────────────────────────────────────────────────────
// TEAM ONBOARDING & TELEGRAM ACTIVATION (training mode)
// ─────────────────────────────────────────────────────────────────────────────
// Training records (debts.is_training = true) NEVER affect cash, Pulse totals
// or AI CFO analysis. They exist only for the tutorial and can be reset.

const TRAINING_STEPS = ['telegram_connected', 'test_payable', 'test_receivable', 'test_expense_request'];

// Short signed token for Telegram deep links — proves the start payload was
// generated by us for this member, without exposing any secret.
function signOnboardingToken(memberId) {
  return crypto.createHmac('sha256', JWT_SECRET)
    .update(`onboard:${memberId}`).digest('hex').slice(0, 10);
}
function buildStartPayload(memberId) {
  // Telegram /start payload max 64 chars: "cfo_<uuid-no-dashes>_<sig10>" = 47
  return `cfo_${String(memberId).replace(/-/g, '')}_${signOnboardingToken(memberId)}`;
}
function parseStartPayload(payload) {
  const m = /^cfo_([0-9a-f]{32})_([0-9a-f]{10})$/i.exec(payload || '');
  if (!m) return null;
  const memberId = `${m[1].slice(0,8)}-${m[1].slice(8,12)}-${m[1].slice(12,16)}-${m[1].slice(16,20)}-${m[1].slice(20)}`;
  if (signOnboardingToken(memberId) !== m[2].toLowerCase()) return null;
  return memberId;
}

function requireBotSecret(req) {
  const botSecret = process.env.TELEGRAM_WEBHOOK_SECRET || process.env.BOT_TOKEN;
  return req.headers['x-bot-secret'] && req.headers['x-bot-secret'] === botSecret;
}

// ── GET /api/telegram/config — PUBLIC (no auth) ──────────────────────────────
// Returns only non-secret bot config. Never exposes any token/secret.
app.get('/api/telegram/config', (req, res) => {
  const raw = process.env.TELEGRAM_BOT_USERNAME || process.env.VITE_BOT_USERNAME || null;
  const botUsername = raw ? raw.replace(/^@/, '') : null;
  res.json({
    bot_username:       botUsername,
    bot_url:            botUsername ? `https://t.me/${botUsername}` : null,
    bot_deep_link_base: botUsername ? `https://t.me/${botUsername}` : null,
    is_configured:      Boolean(botUsername),
  });
});

// ── POST /api/team/onboarding/test-ceo-notification ──────────────────────────
// Owner/admin/cfo sends themselves a test Telegram alert to confirm the
// notification channel works. Requires an active membership + connected Telegram.
app.post('/api/team/onboarding/test-ceo-notification', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canApproveFinancialRecord(biz.role))
      return res.status(403).json({ error: 'Only owner, admin or CFO can send a CEO test notification' });

    const botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
    if (!botToken)
      return res.status(503).json({ error: 'bot_not_ready', message: 'Telegram notifications will be available after bot setup.' });

    const { data: memRows } = await supabase.from('business_members')
      .select('telegram_connected_at').eq('business_id', biz.business.id)
      .eq('user_id', userId).eq('status', 'active').limit(1);
    if (!memRows?.[0]?.telegram_connected_at)
      return res.status(400).json({ error: 'not_connected', message: 'Connect your Telegram first.' });

    const lang = normalizeLanguage(await getUserLanguage(userId));
    const text = {
      ru: '✅ CFO AI test alert\n\nTelegram уведомления подключены.\nТеперь вы сможете получать approvals, cash alerts и daily pulse здесь.',
      id: '✅ Notifikasi tes CFO AI\n\nNotifikasi Telegram sudah terhubung.\nAnda akan menerima persetujuan, peringatan kas dan ringkasan harian di sini.',
      en: '✅ CFO AI test alert\n\nTelegram notifications are connected.\nYou will receive approvals, cash alerts and daily pulse here.',
    }[lang] || '✅ CFO AI test alert\n\nTelegram notifications are connected.';

    // users.id IS the telegram chat id in this app
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: userId, text }),
    });
    if (!resp.ok) return res.status(502).json({ error: 'send_failed' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/team/onboarding — owner/admin/cfo: full team progress ──────────
app.get('/api/team/onboarding', auth, async (req, res) => {
  try {
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canApproveFinancialRecord(biz.role))
      return res.status(403).json({ error: 'Only owner, admin or CFO can view team onboarding' });

    const { data: members } = await supabase.from('business_members')
      .select('id, user_id, role, status, display_name, joined_at, onboarding_status, onboarding_step, telegram_connected_at, telegram_test_completed_at, last_onboarding_event_at')
      .eq('business_id', biz.business.id).eq('status', 'active')
      .order('joined_at', { ascending: true });

    const userIds = (members || []).map(m => m.user_id);
    const { data: users } = userIds.length
      ? await supabase.from('users').select('id, first_name, username').in('id', userIds)
      : { data: [] };
    const userMap = Object.fromEntries((users || []).map(u => [u.id, u]));

    // Training submissions per member (which test types are done)
    const { data: trainingRows } = await supabase.from('debts')
      .select('created_by_user_id, training_type')
      .eq('business_id', biz.business.id).eq('is_training', true);
    const trainingByUser = {};
    (trainingRows || []).forEach(r => {
      (trainingByUser[r.created_by_user_id] ||= new Set()).add(r.training_type);
    });

    res.json({
      members: (members || []).map(m => {
        const u = userMap[m.user_id] || {};
        const done = trainingByUser[m.user_id] || new Set();
        return {
          member_id:                  m.id,
          user_id:                    m.user_id,
          name:                       m.display_name || u.first_name || u.username || String(m.user_id),
          role:                       m.role,
          status:                     m.status,
          telegram_id:                m.user_id, // users.id IS the telegram id in this app
          telegram_connected_at:      m.telegram_connected_at,
          onboarding_status:          m.onboarding_status || 'not_started',
          onboarding_step:            m.onboarding_step,
          telegram_test_completed_at: m.telegram_test_completed_at,
          last_onboarding_event_at:   m.last_onboarding_event_at,
          tests: {
            payable:         done.has('payable'),
            receivable:      done.has('receivable'),
            expense_request: done.has('expense_request'),
          },
        };
      }),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/team/onboarding/me — current member's tutorial state ───────────
app.get('/api/team/onboarding/me', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const biz = await requireBusiness(req, res);
    if (!biz) return;

    const { data: memRows } = await supabase.from('business_members')
      .select('*').eq('business_id', biz.business.id).eq('user_id', userId)
      .eq('status', 'active').limit(1);
    const member = memRows?.[0];
    if (!member) return res.status(403).json({ error: 'Not a member of this business' });

    const { data: trainingRows } = await supabase.from('debts')
      .select('training_type')
      .eq('business_id', biz.business.id).eq('is_training', true)
      .eq('created_by_user_id', userId);
    const done = new Set((trainingRows || []).map(r => r.training_type));

    const completedSteps = [];
    if (member.telegram_connected_at) completedSteps.push('telegram_connected');
    if (done.has('payable'))          completedSteps.push('test_payable');
    if (done.has('receivable'))       completedSteps.push('test_receivable');
    if (done.has('expense_request'))  completedSteps.push('test_expense_request');

    const botUsername = process.env.TELEGRAM_BOT_USERNAME || null;
    const startPayload = buildStartPayload(member.id);

    res.json({
      business:           { id: biz.business.id, name: biz.business.name },
      member:             { id: member.id, onboarding_status: member.onboarding_status || 'not_started', onboarding_step: member.onboarding_step },
      role:               biz.role,
      telegram_connected: !!member.telegram_connected_at,
      bot_username:       botUsername,
      deep_link:          botUsername ? `https://t.me/${botUsername}?start=${startPayload}` : null,
      start_payload:      startPayload,
      required_steps:     TRAINING_STEPS,
      completed_steps:    completedSteps,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/team/onboarding/mark-step — member marks own progress ─────────
app.post('/api/team/onboarding/mark-step', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { step } = req.body || {};
    if (!TRAINING_STEPS.includes(step) && step !== 'welcome_seen')
      return res.status(400).json({ error: 'Invalid step' });
    const biz = await requireBusiness(req, res);
    if (!biz) return;

    await supabase.from('business_members')
      .update({
        onboarding_step:          step,
        onboarding_status:        'in_progress',
        last_onboarding_event_at: new Date().toISOString(),
      })
      .eq('business_id', biz.business.id).eq('user_id', userId).eq('status', 'active');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/team/onboarding/:memberId/reset — owner/admin/cfo ─────────────
// Clears progress and deletes that member's training records (safe: training only).
app.post('/api/team/onboarding/:memberId/reset', auth, async (req, res) => {
  try {
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canApproveFinancialRecord(biz.role))
      return res.status(403).json({ error: 'Only owner, admin or CFO can reset onboarding' });

    const { data: memRows } = await supabase.from('business_members')
      .select('id, user_id').eq('id', req.params.memberId)
      .eq('business_id', biz.business.id).limit(1);
    const member = memRows?.[0];
    if (!member) return res.status(404).json({ error: 'Member not found' });

    // Delete ONLY training records of this member in this business
    await supabase.from('debts').delete()
      .eq('business_id', biz.business.id)
      .eq('created_by_user_id', member.user_id)
      .eq('is_training', true);

    await supabase.from('business_members').update({
      onboarding_status:          'not_started',
      onboarding_step:            null,
      telegram_test_completed_at: null,
      last_onboarding_event_at:   new Date().toISOString(),
    }).eq('id', member.id);

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/telegram/connect — bot marks member as connected ──────────────
// Protected by x-bot-secret. start_payload is the signed deep-link payload.
app.post('/api/telegram/connect', async (req, res) => {
  try {
    if (!requireBotSecret(req))
      return res.status(401).json({ error: 'Invalid bot credentials' });

    const { telegram_id, start_payload, member_id, business_id } = req.body || {};
    if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' });

    // Resolve member: signed payload preferred; raw member_id allowed but verified
    let memberId = parseStartPayload(start_payload) || member_id || null;
    if (!memberId) return res.status(400).json({ error: 'start_payload or member_id required' });

    const { data: memRows } = await supabase.from('business_members')
      .select('id, user_id, business_id, status').eq('id', memberId).limit(1);
    const member = memRows?.[0];
    if (!member || member.status !== 'active')
      return res.status(404).json({ error: 'Member not found or inactive' });
    if (business_id && member.business_id !== business_id)
      return res.status(403).json({ error: 'Member does not belong to this business' });

    // In this app users.id IS the telegram id — a member may only connect
    // their own Telegram account. Never bind a foreign telegram_id.
    if (String(member.user_id) !== String(telegram_id))
      return res.status(403).json({ error: 'telegram_id does not match this member' });

    await supabase.from('business_members').update({
      telegram_connected_at:    new Date().toISOString(),
      onboarding_status:        'in_progress',
      onboarding_step:          'telegram_connected',
      last_onboarding_event_at: new Date().toISOString(),
    }).eq('id', member.id);

    res.json({ ok: true, member_id: member.id, business_id: member.business_id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/team/onboarding/training-submission ────────────────────────────
// Web auth OR x-bot-secret (Telegram bot). Creates a TRAINING debt record:
// is_training = true → zero cash impact, excluded from all financial totals.
app.post('/api/team/onboarding/training-submission', async (req, res) => {
  try {
    const {
      business_id, member_id, training_type,
      raw_input_text, amount, currency, counterparty, due_date, telegram_id,
    } = req.body || {};

    if (!['payable', 'receivable', 'expense_request'].includes(training_type))
      return res.status(400).json({ error: 'training_type must be payable | receivable | expense_request' });

    // ── Resolve acting user: JWT (web) or bot secret + telegram_id ──────────
    let actingUserId = null;
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      try { actingUserId = jwt.verify(token, JWT_SECRET).userId; } catch { /* fall through */ }
    }
    if (!actingUserId && requireBotSecret(req) && telegram_id) {
      actingUserId = Number(telegram_id); // users.id == telegram id
    }
    if (!actingUserId) return res.status(401).json({ error: 'Unauthorized' });

    // ── Validate membership in the target business ──────────────────────────
    let memQuery = supabase.from('business_members')
      .select('id, user_id, business_id, role, display_name, telegram_connected_at')
      .eq('user_id', actingUserId).eq('status', 'active');
    if (business_id) memQuery = memQuery.eq('business_id', business_id);
    if (member_id)   memQuery = memQuery.eq('id', member_id);
    const { data: memRows } = await memQuery.limit(1);
    const member = memRows?.[0];
    if (!member) return res.status(403).json({ error: 'Not a member of this business' });

    const { data: u } = await supabase.from('users')
      .select('first_name, username').eq('id', actingUserId).single();
    const displayName = member.display_name || u?.first_name || u?.username || String(actingUserId);

    const amountNum = Number(amount) || 0;
    const { data: business } = await supabase.from('businesses')
      .select('owner_user_id').eq('id', member.business_id).single();

    // ── Create the training record (never cash-impacting) ───────────────────
    const { data: debt, error } = await supabase.from('debts').insert({
      user_id:                business?.owner_user_id || actingUserId,
      business_id:            member.business_id,
      type:                   training_type === 'receivable' ? 'receivable' : 'payable',
      counterparty:           counterparty || (training_type === 'expense_request' ? 'Expense request (training)' : 'Training counterparty'),
      amount:                 amountNum,
      original_amount:        amountNum,
      paid_amount:            0,
      currency:               currency || 'IDR',
      due_date:               due_date || null,
      description:            `TRAINING · ${training_type}`,
      status:                 'open',
      is_training:            true,
      training_type,
      source_channel:         'telegram',
      raw_input_text:         raw_input_text || null,
      created_by_user_id:     actingUserId,
      created_by_telegram_id: Number(telegram_id || actingUserId),
      created_by_name:        displayName,
      created_by_role:        member.role,
      approval_status:        'pending_approval',
      last_action_channel:    'telegram',
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    // ── Progress update; completed when all 3 test types exist ──────────────
    const { data: doneRows } = await supabase.from('debts')
      .select('training_type').eq('business_id', member.business_id)
      .eq('created_by_user_id', actingUserId).eq('is_training', true);
    const doneTypes = new Set((doneRows || []).map(r => r.training_type));
    const allDone = ['payable', 'receivable', 'expense_request'].every(t => doneTypes.has(t));

    await supabase.from('business_members').update({
      onboarding_status:          allDone ? 'completed' : 'in_progress',
      onboarding_step:            `test_${training_type}`,
      telegram_test_completed_at: allDone ? new Date().toISOString() : null,
      last_onboarding_event_at:   new Date().toISOString(),
      ...(member.telegram_connected_at ? {} : { telegram_connected_at: new Date().toISOString() }),
    }).eq('id', member.id);

    res.json({
      ok:               true,
      training:         true,
      debt_id:          debt.id,
      completed_types:  [...doneTypes],
      onboarding_done:  allDone,
      message:          'This is only a test and will not affect company cash.',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Transactions API ------------------------------------------------------

app.get('/api/transactions', auth, async (req, res) => {
  const { scope, period = 'month', type } = req.query;
  const now = new Date();

  const biz = await requireBusiness(req, res);
  if (!biz) return;
  if (!canViewBusinessFinance(biz.role))
    return res.status(403).json({ error: 'Your role does not allow viewing business transactions' });

  let query = supabase.from('transactions').select('*')
    .or(bizOrFilter(biz))
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

    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canCreateConfirmedFinancialRecord(biz.role))
      return res.status(403).json({ error: 'Your role does not allow creating confirmed transactions. Submit a request instead.' });

    // ── Input validation ─────────────────────────────────────────────────────
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ error: 'transactions must be a non-empty array' });
    }
    const VALID_TX_TYPES = ['income', 'expense', 'transfer', 'correction', 'payroll'];
    for (const t of transactions) {
      if (!VALID_TX_TYPES.includes(t.type)) {
        return res.status(400).json({ error: `Invalid transaction type: ${t.type}` });
      }
      const amt = Number(t.amount);
      if (isNaN(amt)) return res.status(400).json({ error: 'amount must be a number' });
      // correction is a signed delta (may be negative, never zero);
      // all other types must be strictly positive
      if (t.type === 'correction' ? amt === 0 : amt <= 0) {
        return res.status(400).json({ error: `amount must be ${t.type === 'correction' ? 'non-zero' : 'positive'} for type ${t.type}` });
      }
      if (t.scope && !['business', 'personal'].includes(t.scope)) {
        return res.status(400).json({ error: "scope must be 'business' or 'personal'" });
      }
    }

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
            .or(bizOrFilter(biz))
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
        .or(bizOrFilter(biz))
        .in('id', requestedWalletIds);
      if (wErr) throw wErr;

      // All supplied wallet_ids must belong to this business
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
        ...bizWriteFields(biz, userId),
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
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    const { data, error } = await supabase
      .from('cashflow_categories')
      .select('*')
      .or(bizOrFilter(biz))
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
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    const { data, error } = await supabase
      .from('cashflow_categories')
      .insert({ user_id: biz.ownerUserId, business_id: biz.business.id, name, group_type, activity_type: activity_type || null, sub_category: sub_category || null, description: description || null, is_system: false })
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
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    let query = supabase
      .from('counterparties')
      .select('*')
      .or(bizOrFilter(biz))
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
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    const { data, error } = await supabase
      .from('counterparties')
      .insert({ user_id: biz.ownerUserId, business_id: biz.business.id, name, group_name: group_name || null, type: type || null, email: email || null, phone: phone || null, notes: notes || null })
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
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    const { data, error } = await supabase
      .from('business_directions')
      .select('*')
      .or(bizOrFilter(biz))
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
    const { name, slug } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    const { data, error } = await supabase
      .from('business_directions')
      .insert({ user_id: biz.ownerUserId, business_id: biz.business.id, name: name.trim(), slug: slug || null, is_system: false, is_active: true, source: 'user' })
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
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    const { data, error } = await supabase
      .from('activity_types')
      .select('*')
      .or(bizOrFilter(biz))
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
    const { name, code } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    const { data, error } = await supabase
      .from('activity_types')
      .insert({ user_id: biz.ownerUserId, business_id: biz.business.id, name: name.trim(), code: code || null, is_system: false, is_active: true, source: 'user' })
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

  // ── Telegram notifications for Admin / CFO / Owner ─────────────────────────
  // Sent via notifyBusinessAdminsViaTelegram(). Params:
  //   counterparty, amount (formatted with currency), due, createdBy, role, raw
  telegram_receivable_submitted: {
    en: (p) => `📥 <b>New receivable request</b>\n\nClient: ${p.counterparty}\nAmount: <b>${p.amount}</b>\nDue: ${p.due}\nCreated by: ${p.createdBy} · ${p.role}\nSource: Telegram · ⏳ Pending approval${p.raw ? `\n\n💬 "${p.raw}"` : ''}`,
    ru: (p) => `📥 <b>Новая заявка: дебиторка</b>\n\nКлиент: ${p.counterparty}\nСумма: <b>${p.amount}</b>\nСрок: ${p.due}\nСоздал: ${p.createdBy} · ${p.role}\nИсточник: Telegram · ⏳ Ожидает подтверждения${p.raw ? `\n\n💬 «${p.raw}»` : ''}`,
    id: (p) => `📥 <b>Permintaan piutang baru</b>\n\nKlien: ${p.counterparty}\nJumlah: <b>${p.amount}</b>\nJatuh tempo: ${p.due}\nDibuat oleh: ${p.createdBy} · ${p.role}\nSumber: Telegram · ⏳ Menunggu persetujuan${p.raw ? `\n\n💬 "${p.raw}"` : ''}`,
  },
  telegram_payable_submitted: {
    en: (p) => `📤 <b>New payable request</b>\n\nSupplier: ${p.counterparty}\nAmount: <b>${p.amount}</b>\nDue: ${p.due}\nCreated by: ${p.createdBy} · ${p.role}\nSource: Telegram · ⏳ Pending approval${p.raw ? `\n\n💬 "${p.raw}"` : ''}`,
    ru: (p) => `📤 <b>Новая заявка: оплата поставщику</b>\n\nПоставщик: ${p.counterparty}\nСумма: <b>${p.amount}</b>\nСрок: ${p.due}\nСоздал: ${p.createdBy} · ${p.role}\nИсточник: Telegram · ⏳ Ожидает подтверждения${p.raw ? `\n\n💬 «${p.raw}»` : ''}`,
    id: (p) => `📤 <b>Permintaan pembayaran baru</b>\n\nPemasok: ${p.counterparty}\nJumlah: <b>${p.amount}</b>\nJatuh tempo: ${p.due}\nDibuat oleh: ${p.createdBy} · ${p.role}\nSumber: Telegram · ⏳ Menunggu persetujuan${p.raw ? `\n\n💬 "${p.raw}"` : ''}`,
  },
  telegram_payment_reported: {
    en: (p) => `💰 <b>Payment reported</b>\n\n${p.counterparty} reportedly paid <b>${p.amount}</b>.\nReported by: ${p.createdBy} · ${p.role}\nNeeds confirmation before it counts as received.`,
    ru: (p) => `💰 <b>Сообщение об оплате</b>\n\n${p.counterparty} оплатил <b>${p.amount}</b> (по сообщению).\nСообщил: ${p.createdBy} · ${p.role}\nТребуется подтверждение, прежде чем сумма будет засчитана.`,
    id: (p) => `💰 <b>Pembayaran dilaporkan</b>\n\n${p.counterparty} dilaporkan membayar <b>${p.amount}</b>.\nDilaporkan oleh: ${p.createdBy} · ${p.role}\nPerlu konfirmasi sebelum dihitung sebagai diterima.`,
  },
  telegram_expense_request_submitted: {
    en: (p) => `🧾 <b>Expense request</b>\n\n${p.description}\nAmount: <b>${p.amount}</b>\nCreated by: ${p.createdBy} · ${p.role}\n⏳ Pending approval`,
    ru: (p) => `🧾 <b>Заявка на расход</b>\n\n${p.description}\nСумма: <b>${p.amount}</b>\nСоздал: ${p.createdBy} · ${p.role}\n⏳ Ожидает подтверждения`,
    id: (p) => `🧾 <b>Permintaan pengeluaran</b>\n\n${p.description}\nJumlah: <b>${p.amount}</b>\nDibuat oleh: ${p.createdBy} · ${p.role}\n⏳ Menunggu persetujuan`,
  },
  telegram_receivable_overdue: {
    en: (p) => `🔴 <b>Receivable overdue</b>\n\n${p.counterparty} owes <b>${p.amount}</b> — ${p.days} days overdue.`,
    ru: (p) => `🔴 <b>Просрочена дебиторка</b>\n\n${p.counterparty} должен <b>${p.amount}</b> — просрочено на ${p.days} дн.`,
    id: (p) => `🔴 <b>Piutang terlambat</b>\n\n${p.counterparty} berutang <b>${p.amount}</b> — terlambat ${p.days} hari.`,
  },
  telegram_payable_due_soon: {
    en: (p) => `🟡 <b>Payment due soon</b>\n\n${p.counterparty} — <b>${p.amount}</b> due in ${p.days} days.`,
    ru: (p) => `🟡 <b>Скоро платёж</b>\n\n${p.counterparty} — <b>${p.amount}</b> через ${p.days} дн.`,
    id: (p) => `🟡 <b>Pembayaran segera jatuh tempo</b>\n\n${p.counterparty} — <b>${p.amount}</b> dalam ${p.days} hari.`,
  },
  telegram_payable_overdue: {
    en: (p) => `🔴 <b>Payable overdue</b>\n\n${p.counterparty} — <b>${p.amount}</b>, ${p.days} days overdue.`,
    ru: (p) => `🔴 <b>Просрочен платёж</b>\n\n${p.counterparty} — <b>${p.amount}</b>, просрочено на ${p.days} дн.`,
    id: (p) => `🔴 <b>Pembayaran terlambat</b>\n\n${p.counterparty} — <b>${p.amount}</b>, terlambat ${p.days} hari.`,
  },
  telegram_payroll_payment_created: {
    en: (p) => `👥 <b>Payroll payment recorded</b>\n\nEmployee: ${p.employee}\nAmount: <b>${p.amount}</b>\nBy: ${p.createdBy}`,
    ru: (p) => `👥 <b>Записана выплата зарплаты</b>\n\nСотрудник: ${p.employee}\nСумма: <b>${p.amount}</b>\nКем: ${p.createdBy}`,
    id: (p) => `👥 <b>Pembayaran gaji dicatat</b>\n\nKaryawan: ${p.employee}\nJumlah: <b>${p.amount}</b>\nOleh: ${p.createdBy}`,
  },
  telegram_cash_risk_alert: {
    en: (p) => `🚨 <b>Cash risk alert</b>\n\nRunway: ${p.runway} days\nCash: ${p.cash}\n${p.detail || ''}`,
    ru: (p) => `🚨 <b>Риск по деньгам</b>\n\nЗапас: ${p.runway} дн.\nКасса: ${p.cash}\n${p.detail || ''}`,
    id: (p) => `🚨 <b>Peringatan risiko kas</b>\n\nCadangan: ${p.runway} hari\nKas: ${p.cash}\n${p.detail || ''}`,
  },
  telegram_approval_required: {
    en: (p) => `⏳ <b>Approval required</b>\n\n${p.count} record${p.count > 1 ? 's' : ''} waiting for your review.`,
    ru: (p) => `⏳ <b>Требуется подтверждение</b>\n\nЗаписей на проверку: ${p.count}.`,
    id: (p) => `⏳ <b>Persetujuan diperlukan</b>\n\n${p.count} catatan menunggu tinjauan Anda.`,
  },
  // TODO: wire to a scheduler (cron / Railway scheduled job) — template is ready,
  // no scheduling system exists in this repo yet.
  telegram_daily_financial_pulse: {
    en: (p) => `📊 <b>CFO AI Daily Pulse</b>\n\nCash: <b>${p.cash}</b>\nRunway: ${p.runway} days\nReceivables overdue: ${p.recvOverdue}\nPayables due soon: ${p.payDueSoon}\nPending approvals: ${p.pendingApprovals}\n\n${p.topAction ? `Top action:\n${p.topAction}` : ''}`,
    ru: (p) => `📊 <b>CFO AI: дневная сводка</b>\n\nКасса: <b>${p.cash}</b>\nЗапас: ${p.runway} дн.\nПросроченная дебиторка: ${p.recvOverdue}\nБлижайшие платежи: ${p.payDueSoon}\nОжидают подтверждения: ${p.pendingApprovals}\n\n${p.topAction ? `Главное действие:\n${p.topAction}` : ''}`,
    id: (p) => `📊 <b>CFO AI Pulse Harian</b>\n\nKas: <b>${p.cash}</b>\nCadangan: ${p.runway} hari\nPiutang terlambat: ${p.recvOverdue}\nPembayaran segera: ${p.payDueSoon}\nMenunggu persetujuan: ${p.pendingApprovals}\n\n${p.topAction ? `Tindakan utama:\n${p.topAction}` : ''}`,
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
  try {
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canViewBusinessFinance(biz.role))
      return res.status(403).json({ error: 'Your role does not allow viewing business wallets' });
    const bizOr = bizOrFilter(biz);

    const { data: wallets, error: wErr } = await supabase
      .from('wallets')
      .select('*')
      .or(bizOr)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (wErr) throw wErr;

    if (!wallets || wallets.length === 0) return res.json({ wallets: [] });

    // Fetch transactions to compute per-wallet balances
    const { data: txs, error: tErr } = await supabase
      .from('transactions')
      .select('wallet_id, source, type, amount_idr')
      .or(bizOr);
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
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canManageWallets(biz.role))
      return res.status(403).json({ error: 'Your role does not allow managing wallets' });

    // ── Feature gate: wallet limit ───────────────────────────────────────────
    const access = await getCurrentAccess(userId);
    if (access) {
      const maxWallets = access.limits.max_wallets;
      if (maxWallets !== null && maxWallets !== undefined) {
        const { count: currentCount } = await supabase
          .from('wallets')
          .select('id', { count: 'exact', head: true })
          .or(bizOrFilter(biz))
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
        ...bizWriteFields(biz, userId),
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
        ...bizWriteFields(biz, userId),
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
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canViewBusinessFinance(biz.role))
      return res.status(403).json({ error: 'Your role does not allow viewing wallet details' });
    const bizOr = bizOrFilter(biz);

    const { data: wRows } = await supabase
      .from('wallets').select('id, name, currency, type')
      .eq('id', id).or(bizOr).limit(1);
    const wallet = wRows?.[0];
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });

    let query = supabase.from('transactions')
      .select('*')
      .or(bizOr)
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
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canManageWallets(biz.role))
      return res.status(403).json({ error: 'Your role does not allow managing wallets' });

    // If renaming, sync source text on legacy transactions for balance continuity
    if (name) {
      const { data: exRows } = await supabase
        .from('wallets').select('name').eq('id', id).or(bizOrFilter(biz)).limit(1);
      const existing = exRows?.[0];
      if (existing && existing.name !== name) {
        await supabase.from('transactions')
          .update({ source: name })
          .or(bizOrFilter(biz))
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
      .or(bizOrFilter(biz))
      .select()
      .single();
    if (error) throw error;
    res.json({ wallet: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/wallets/:id', auth, async (req, res) => {
  const { id } = req.params;
  try {
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canManageWallets(biz.role))
      return res.status(403).json({ error: 'Your role does not allow managing wallets' });
    const { error } = await supabase
      .from('wallets')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .or(bizOrFilter(biz));
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

    // Role check: only owner/admin/cfo of the active business can adjust balance
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canManageWallets(biz.role)) {
      return res.status(403).json({ error: 'Only business owner, admin or CFO can adjust wallet balances' });
    }
    const bizOr = bizOrFilter(biz);

    // Load wallet — business-scoped
    const { data: wRows } = await supabase
      .from('wallets')
      .select('id, user_id, name, currency, scope')
      .eq('id', walletId)
      .or(bizOr)
      .limit(1);
    const wallet = wRows?.[0];
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });

    // Compute current balance
    const { data: txs, error: tErr } = await supabase
      .from('transactions')
      .select('wallet_id, source, type, amount_idr')
      .or(bizOr);
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
        ...bizWriteFields(biz, userId),
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

  const biz = await requireBusiness(req, res);
  if (!biz) return;
  if (!canCreateConfirmedFinancialRecord(biz.role))
    return res.status(403).json({ error: 'Your role does not allow recording payments' });

  const { data: debtRows } = await supabase.from('debts')
    .select('*').eq('id', req.params.id).or(bizOrFilter(biz)).limit(1);
  const debt = debtRows?.[0];
  if (!debt) return res.status(404).json({ error: 'Debt not found' });

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

  // Wallet must belong to the same business (legacy: owner's user_id)
  let payWallet = null;
  if (wallet_id) {
    const { data: wRows } = await supabase.from('wallets')
      .select('id, name, scope').eq('id', wallet_id).or(bizOrFilter(biz)).limit(1);
    if (!wRows?.length) return res.status(400).json({ error: 'Invalid or inaccessible wallet' });
    payWallet = wRows[0];
  }

  // 1. Create transaction
  const txType = debt.type === 'payable' ? 'expense' : 'income';
  const { data: tx, error: txErr } = await supabase.from('transactions').insert({
    ...bizWriteFields(biz, req.user.userId),
    type:              txType,
    amount_original:   paymentAmount,
    currency_original: 'IDR',
    amount_idr:        paymentAmount,
    description:       `Payment: ${debt.counterparty}`,
    source:            account || (payWallet ? payWallet.name : null),
    wallet_id:         wallet_id || null,
    scope:             debt.scope || (payWallet ? payWallet.scope : null) || 'business',
    transaction_date:  date ? new Date(date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
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
    .update(debtUpdates).eq('id', debt.id).select().single();
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
async function buildAiCfoContext(userId, language = 'en', biz = null) {
  const now       = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // Business-scoped when biz provided (the normal path); legacy user_id
  // fallback kept for internal callers that have no business context.
  const scopeQ = (q) => biz ? q.or(bizOrFilter(biz)) : q.eq('user_id', userId);

  const [
    { data: allTxs    },
    { data: monthTxs  },
    { data: rawDebts  },
    { data: wallets   },
    accessData,
  ] = await Promise.all([
    scopeQ(supabase.from('transactions').select('type,amount_original,amount_idr,currency_original,created_at,wallet_id,source,scope')).order('created_at', { ascending: false }),
    scopeQ(supabase.from('transactions').select('type,amount_original,amount_idr,created_at,wallet_id,source,scope')).gte('created_at', monthStart),
    scopeQ(supabase.from('debts').select('*')).or('is_training.is.null,is_training.eq.false'),
    scopeQ(supabase.from('wallets').select('id,name,currency,type,scope')).eq('is_active', true),
    getCurrentAccess(biz ? biz.ownerUserId : userId),
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
  // Only approved records count as real obligations / expected cash.
  // pending_approval (Telegram submissions awaiting admin review) are tracked
  // separately as potential cash pressure; rejected are excluded entirely.
  const openDebts  = debts.filter(d =>
    !['paid','cancelled'].includes(d.status) &&
    (d.approval_status === 'approved' || !d.approval_status)
  );
  const pendingSubmissions = debts.filter(d =>
    d.approval_status === 'pending_approval' && !['paid','cancelled'].includes(d.status)
  );
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
    // Unconfirmed Telegram submissions — NOT included in totals above.
    // AI should mention these as potential cash pressure awaiting approval.
    pending_submissions: {
      count:             pendingSubmissions.length,
      receivables_total: pendingSubmissions.filter(d=>d.type==='receivable').reduce((s,d)=>s+Number(d.remaining_amount||d.amount||0),0),
      payables_total:    pendingSubmissions.filter(d=>d.type==='payable').reduce((s,d)=>s+Number(d.remaining_amount||d.amount||0),0),
      items: pendingSubmissions.slice(0,5).map(d=>({type:d.type,counterparty:d.counterparty,amount:d.remaining_amount||d.amount,due_date:d.due_date,created_by:d.created_by_name,role:d.created_by_role,source:d.source_channel})),
    },
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

// ═════════════════════════════════════════════════════════════════════════════
// AI CFO DECISION ENGINE — deterministic. The LLM never recomputes these.
// Approval ≠ Payment: approval only confirms an obligation (no cash move);
// payment/receipt is the only thing that changes cash.
// ═════════════════════════════════════════════════════════════════════════════

// V1 default risk policy (centralized — not universal accounting rules).
// Business-configurable policy is a later task.
const DEFAULT_DECISION_POLICY = {
  critical_runway_days: 15,
  caution_runway_days:  30,
  target_runway_days:   60,
  protected_cash_days:  30,
  large_payment_pct:    15,   // % of current business cash
};

function daysUntilDate(dateStr, now = new Date()) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - now) / 86400000);
}

// Build a deterministic business financial snapshot. Reuses the same CASH model
// and computeBurnAndRunway() used by Pulse and AI CFO — no separate formula.
async function buildBusinessFinancialSnapshot(biz, language = 'en', asOfDate = null) {
  const now = asOfDate ? new Date(asOfDate) : new Date();
  const bizOr = bizOrFilter(biz);

  const [{ data: wallets }, { data: txs }, { data: rawDebts }, { data: employees }] = await Promise.all([
    supabase.from('wallets').select('id,name,currency,type,scope').or(bizOr).eq('is_active', true),
    supabase.from('transactions').select('type,amount_original,created_at,wallet_id,source,scope').or(bizOr),
    supabase.from('debts').select('*').or(bizOr).or('is_training.is.null,is_training.eq.false'),
    supabase.from('payroll_employees').select('default_salary,pay_day,status').or(bizOr).neq('status', 'archived'),
  ]);

  const CASH_IN = ['income'], CASH_OUT = ['expense', 'payroll'];
  const allWallets = wallets || [];
  const businessWallets = allWallets.filter(w => (w.scope || 'business') === 'business');
  const bizWalletIds = new Set(businessWallets.map(w => w.id));

  const isBizTx = (t) => t.wallet_id ? bizWalletIds.has(t.wallet_id)
    : (businessWallets.some(w => w.name === t.source) || (!t.source && (t.scope || 'business') === 'business'));
  const bizTxs = (txs || []).filter(isBizTx);

  const walletBalance = (w) => (txs || [])
    .filter(t => t.wallet_id === w.id || (!t.wallet_id && t.source === w.name))
    .reduce((s, t) => {
      if (CASH_IN.includes(t.type))  return s + Number(t.amount_original || 0);
      if (CASH_OUT.includes(t.type)) return s - Number(t.amount_original || 0);
      if (t.type === 'correction')   return s + Number(t.amount_original || 0);
      return s;
    }, 0);

  const byWallet = businessWallets.map(w => ({ id: w.id, name: w.name, currency: w.currency, type: w.type, balance: walletBalance(w) }));
  const totalCash = bizTxs.reduce((s, t) => {
    if (CASH_IN.includes(t.type))  return s + Number(t.amount_original || 0);
    if (CASH_OUT.includes(t.type)) return s - Number(t.amount_original || 0);
    if (t.type === 'correction')   return s + Number(t.amount_original || 0);
    return s;
  }, 0);

  const burn = computeBurnAndRunway(bizTxs, totalCash);
  const dailyBurn = burn.burn_rate_daily;

  // Debts — only approved/open count as confirmed; pending tracked separately.
  const debts = enrichDebts(rawDebts);
  const confirmed = debts.filter(d => !['paid', 'cancelled'].includes(d.status) && (d.approval_status === 'approved' || !d.approval_status));
  const pending   = debts.filter(d => d.approval_status === 'pending_approval' && !['paid', 'cancelled'].includes(d.status));

  function debtBuckets(list) {
    const rem = (d) => Number(d.remaining_amount || d.amount || 0);
    const overdue = list.filter(d => d.status === 'overdue');
    const within = (n) => list.filter(d => { const dd = daysUntilDate(d.due_date, now); return dd !== null && dd >= 0 && dd <= n; });
    return {
      active_remaining: list.reduce((s, d) => s + rem(d), 0),
      overdue_amount:   overdue.reduce((s, d) => s + rem(d), 0),
      overdue_count:    overdue.length,
      due_7_days:       within(7).reduce((s, d) => s + rem(d), 0),
      due_14_days:      within(14).reduce((s, d) => s + rem(d), 0),
      due_30_days:      within(30).reduce((s, d) => s + rem(d), 0),
      top_items:        list.slice(0, 5).map(d => ({ id: d.id, counterparty: d.counterparty, remaining: rem(d), due_date: d.due_date, status: d.status })),
    };
  }
  const payList = confirmed.filter(d => d.type === 'payable');
  const recvList = confirmed.filter(d => d.type === 'receivable');

  // Payroll — best-effort estimate from employees' pay_day (no scheduled table).
  const dom = now.getDate();
  const daysToPayDay = (pd) => { if (!pd) return null; const d = pd - dom; return d >= 0 ? d : d + 30; };
  const payroll7 = (employees || []).filter(e => { const d = daysToPayDay(e.pay_day); return d !== null && d <= 7; }).reduce((s, e) => s + Number(e.default_salary || 0), 0);
  const payroll30 = (employees || []).reduce((s, e) => s + Number(e.default_salary || 0), 0);

  return {
    business_id: biz.business.id,
    currency: biz.business.base_currency || 'IDR',
    cash: { total: totalCash, by_wallet: byWallet, available_business_cash: totalCash },
    burn: { daily_burn: dailyBurn, monthly_expenses: dailyBurn * 30, rolling_window_days: burn.burn_window_days, runway_days: burn.runway_days },
    payables: { ...debtBuckets(payList), pending_amount: pending.filter(d => d.type === 'payable').reduce((s, d) => s + Number(d.remaining_amount || d.amount || 0), 0) },
    receivables: { ...debtBuckets(recvList), pending_amount: pending.filter(d => d.type === 'receivable').reduce((s, d) => s + Number(d.remaining_amount || d.amount || 0), 0) },
    payroll: { due_7_days: payroll7, due_30_days: payroll30 },
    policy: DEFAULT_DECISION_POLICY,
    _confirmedPayables: payList,
  };
}

function runwayAfter(cash, dailyBurn) {
  if (!dailyBurn || dailyBurn <= 0) return null;
  return Math.round(cash / dailyBurn);
}

// ── Approval assessment: confirms an obligation, no cash movement ────────────
function assessDebtApproval(snap, debt) {
  const amount = Number(debt.remaining_amount || debt.original_amount || debt.amount || 0);
  const cash = snap.cash.total;
  const isRecv = debt.type === 'receivable';
  const confirmedBefore = snap.payables.due_30_days;
  const confirmedAfter = isRecv ? confirmedBefore : confirmedBefore + amount;
  const coverage = confirmedAfter > 0 ? cash / confirmedAfter : null;

  const factors = [];
  let recommendation = 'safe', risk = 'low';

  if (!amount || amount <= 0) { recommendation = 'insufficient_data'; risk = 'medium'; factors.push({ key: 'no_amount', severity: 'high', label: 'Amount missing', value: amount }); }
  if (['paid', 'cancelled'].includes(debt.status) || debt.approval_status === 'rejected') {
    recommendation = 'not_recommended'; risk = 'high';
    factors.push({ key: 'invalid_state', severity: 'high', label: 'Already resolved', value: debt.status });
  }

  if (isRecv) {
    factors.push({ key: 'expected_cash', severity: 'info', label: 'Expected, not guaranteed cash', value: amount });
  } else {
    factors.push({ key: 'obligation_added', severity: 'info', label: 'Confirmed obligation added', value: amount });
    if (coverage !== null && coverage < 1.2 && recommendation === 'safe') { recommendation = 'caution'; risk = 'medium'; factors.push({ key: 'tight_coverage', severity: 'medium', label: 'Cash barely covers 30d obligations', value: coverage }); }
    if (snap.burn.runway_days !== null && snap.burn.runway_days < snap.policy.caution_runway_days && recommendation === 'safe') { recommendation = 'caution'; risk = 'medium'; }
  }

  return {
    decision_type: isRecv ? 'approve_receivable' : 'approve_payable',
    recommendation, risk_level: risk,
    current: { cash, runway_days: snap.burn.runway_days, confirmed_obligations_30d: confirmedBefore },
    after:   { cash, runway_days: snap.burn.runway_days, confirmed_obligations_30d: confirmedAfter },
    impact:  { cash_change: 0, runway_change_days: 0, obligation_change: isRecv ? 0 : amount, coverage_after: coverage },
    upcoming: { payroll_7d: snap.payroll.due_7_days, payables_7d: snap.payables.due_7_days, payables_30d: snap.payables.due_30_days, overdue_payables: snap.payables.overdue_amount, overdue_receivables: snap.receivables.overdue_amount },
    factors,
    note: isRecv ? 'Approval marks expected cash. It does not change current cash.' : 'Approval confirms the obligation. It does not pay it or change cash.',
  };
}

// ── Payment simulation: real cash impact (simulated, never persisted) ────────
function assessDebtPayment(snap, debt, paymentAmount, walletId) {
  const isRecv = debt.type === 'receivable';
  const amount = Number(paymentAmount || debt.remaining_amount || debt.amount || 0);
  const cashBefore = snap.cash.total;
  const cashAfter = isRecv ? cashBefore + amount : cashBefore - amount;
  const runwayBefore = snap.burn.runway_days;
  const runwayAfterVal = runwayAfter(cashAfter, snap.burn.daily_burn);

  const wallet = walletId ? snap.cash.by_wallet.find(w => String(w.id) === String(walletId)) : null;
  const walletBefore = wallet ? wallet.balance : null;
  const walletAfter = wallet ? (isRecv ? walletBefore + amount : walletBefore - amount) : null;

  // Obligations excluding THIS debt (avoid double counting on payment).
  const thisRem = Number(debt.remaining_amount || debt.amount || 0);
  const payables7 = Math.max(0, snap.payables.due_7_days - (isRecv ? 0 : thisRem));
  const payables30 = Math.max(0, snap.payables.due_30_days - (isRecv ? 0 : thisRem));
  const protectedCash = snap.burn.daily_burn * snap.policy.protected_cash_days;
  const pctOfCash = cashBefore > 0 ? (amount / cashBefore) * 100 : 0;

  const factors = [];
  let recommendation = 'safe', risk = 'low';
  const flag = (rec, rk) => { const order = { safe: 0, caution: 1, not_recommended: 2 }; if (order[rec] > order[recommendation]) { recommendation = rec; } const rorder = { low: 0, medium: 1, high: 2, critical: 3 }; if (rorder[rk] > rorder[risk]) risk = rk; };

  if (!snap.burn.daily_burn) { recommendation = 'insufficient_data'; risk = 'medium'; factors.push({ key: 'no_burn', severity: 'medium', label: 'No expense history — runway unknown' }); }

  if (!isRecv) {
    if (amount > cashBefore) { flag('not_recommended', 'critical'); factors.push({ key: 'exceeds_cash', severity: 'critical', label: 'Payment exceeds total business cash', value: amount }); }
    if (wallet && walletAfter < 0) { flag('not_recommended', 'critical'); factors.push({ key: 'wallet_negative', severity: 'critical', label: `${wallet.name} would go negative`, value: walletAfter }); }
    if (runwayAfterVal !== null && runwayAfterVal < snap.policy.critical_runway_days) { flag('not_recommended', 'high'); factors.push({ key: 'runway_critical', severity: 'high', label: `Runway after payment below ${snap.policy.critical_runway_days}d`, value: runwayAfterVal }); }
    else if (runwayAfterVal !== null && runwayAfterVal < snap.policy.caution_runway_days) { flag('caution', 'medium'); factors.push({ key: 'runway_low', severity: 'medium', label: `Runway after payment below ${snap.policy.caution_runway_days}d`, value: runwayAfterVal }); }
    if (pctOfCash > snap.policy.large_payment_pct) { flag('caution', 'medium'); factors.push({ key: 'large_payment', severity: 'medium', label: `Payment is ${Math.round(pctOfCash)}% of cash`, value: pctOfCash }); }
    if (snap.payroll.due_7_days > 0 && cashAfter < snap.payroll.due_7_days + payables7) { flag('caution', 'high'); factors.push({ key: 'payroll_pressure', severity: 'high', label: 'Payroll + near-term payables may not be covered after payment', value: snap.payroll.due_7_days }); }
    if (cashAfter < protectedCash && recommendation === 'safe') { flag('caution', 'medium'); factors.push({ key: 'below_reserve', severity: 'medium', label: `Cash after payment below ${snap.policy.protected_cash_days}d reserve`, value: protectedCash }); }
  }

  return {
    decision_type: isRecv ? 'receive_receivable' : 'pay_payable',
    recommendation, risk_level: risk,
    current: { cash: cashBefore, wallet_balance: walletBefore, runway_days: runwayBefore },
    after:   { cash: cashAfter, wallet_balance: walletAfter, runway_days: runwayAfterVal },
    impact:  { cash_change: isRecv ? amount : -amount, runway_change_days: runwayAfterVal !== null && runwayBefore !== null ? runwayAfterVal - runwayBefore : null, wallet_change: walletAfter !== null ? walletAfter - walletBefore : null, payment_pct_of_cash: Math.round(pctOfCash) },
    upcoming: { payroll_7d: snap.payroll.due_7_days, payables_7d: payables7, payables_30d: payables30, overdue_payables: snap.payables.overdue_amount, overdue_receivables: snap.receivables.overdue_amount },
    factors,
    wallet_known: !!wallet,
    note: isRecv ? 'Marking received creates an income transaction and increases the selected wallet.' : 'Paying creates an expense transaction and decreases the selected wallet.',
  };
}

// Ranked list of approved unpaid payables for "which should I pay first?".
function buildPaymentPriority(snap) {
  const now = new Date();
  return (snap._confirmedPayables || []).map(d => {
    const rem = Number(d.remaining_amount || d.amount || 0);
    const dd = daysUntilDate(d.due_date, now);
    let score = 0;
    if (d.status === 'overdue') score += 100;
    if (dd !== null && dd >= 0 && dd <= 7) score += 50;
    else if (dd !== null && dd >= 0 && dd <= 30) score += 20;
    if (snap.cash.total > 0 && rem / snap.cash.total > 0.15) score += 10;
    return {
      debt_id: d.id, counterparty: d.counterparty, amount: rem, due_date: d.due_date,
      priority_score: score,
      reason: d.status === 'overdue' ? 'Overdue' : (dd !== null && dd <= 7 ? 'Due within 7 days' : 'Upcoming'),
      recommended_action: 'pay',
    };
  }).sort((a, b) => b.priority_score - a.priority_score);
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
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canUseAiCfo(biz.role))
      return res.status(403).json({ error: 'Your role does not allow using AI CFO' });
    const language = normalizeLanguage(req.query.language || await getUserLanguage(req.user.userId));
    const ctx = await buildAiCfoContext(req.user.userId, language, biz);
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

    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canUseAiCfo(biz.role))
      return res.status(403).json({ error: 'Your role does not allow using AI CFO' });

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
    const ctx = await buildAiCfoContext(userId, language, biz);
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

DECISION RULES (deterministic engine is the source of truth):
- A backend Decision Engine computes all approval/payment recommendations and before/after cash & runway. NEVER redo this arithmetic and NEVER contradict it.
- ALWAYS separate two decisions: APPROVE confirms an obligation and changes NO cash; PAY/RECEIVE is the only thing that moves cash and a wallet. A request can be safe to approve but not safe to pay today.
- A receivable is EXPECTED cash, never current/guaranteed cash. Pending submissions are not confirmed.

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
${(ctx.pending_submissions?.count > 0) ? `- Pending team submissions (NOT confirmed — do NOT count in obligations, mention as potential cash pressure): ${ctx.pending_submissions.count} item(s), receivables ${ctx.pending_submissions.receivables_total.toLocaleString()}, payables ${ctx.pending_submissions.payables_total.toLocaleString()} ${currency} — ${ctx.pending_submissions.items.map(i => `${i.counterparty || '—'} ${Number(i.amount||0).toLocaleString()} (${i.type}, by ${i.created_by || 'team'})`).join(', ')}` : ''}
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
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canManagePayroll(biz.role))
      return res.status(403).json({ error: 'Your role does not allow accessing payroll' });
    const { data, error } = await supabase
      .from('payroll_employees')
      .select('*')
      .or(bizOrFilter(biz))
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

    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canManagePayroll(biz.role))
      return res.status(403).json({ error: 'Your role does not allow managing payroll' });

    // Validate wallet belongs to the business if supplied
    if (default_wallet_id) {
      const { data: w } = await supabase.from('wallets').select('id').eq('id', default_wallet_id).or(bizOrFilter(biz)).limit(1);
      if (!w?.length) return res.status(400).json({ error: 'Invalid wallet.' });
    }

    const { data, error } = await supabase.from('payroll_employees').insert({
      ...bizWriteFields(biz, userId),
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

    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canManagePayroll(biz.role))
      return res.status(403).json({ error: 'Your role does not allow managing payroll' });

    const { data: exRows } = await supabase.from('payroll_employees').select('id').eq('id', id).or(bizOrFilter(biz)).limit(1);
    if (!exRows?.length) return res.status(404).json({ error: 'Employee not found.' });

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
    const { id } = req.params;
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canManagePayroll(biz.role))
      return res.status(403).json({ error: 'Your role does not allow managing payroll' });
    const { data: exRows } = await supabase.from('payroll_employees').select('id').eq('id', id).or(bizOrFilter(biz)).limit(1);
    if (!exRows?.length) return res.status(404).json({ error: 'Employee not found.' });

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
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canManagePayroll(biz.role))
      return res.status(403).json({ error: 'Your role does not allow accessing payroll' });
    const { data, error } = await supabase
      .from('payroll_payments')
      .select('*, payroll_employees(name, role)')
      .or(bizOrFilter(biz))
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
    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canManagePayroll(biz.role))
      return res.status(403).json({ error: 'Your role does not allow accessing payroll' });
    const bizOr = bizOrFilter(biz);

    const [empRes, payRes] = await Promise.all([
      supabase.from('payroll_employees').select('id, name, role, default_salary, currency, pay_day, default_wallet_id').or(bizOr).neq('status', 'archived').order('name'),
      supabase.from('payroll_payments').select('*, payroll_payment_items(*)').or(bizOr).order('payment_date', { ascending: false }),
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

    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canManagePayroll(biz.role))
      return res.status(403).json({ error: 'Your role does not allow managing payroll' });

    // ── Validate wallet (must belong to same business) ───────────────────────
    let wallet = null;
    if (wallet_id) {
      const { data: wRows } = await supabase.from('wallets').select('id, name, scope, currency').eq('id', wallet_id).or(bizOrFilter(biz)).limit(1);
      if (!wRows?.length) return res.status(400).json({ error: 'Invalid or inaccessible wallet.' });
      wallet = wRows[0];
    }

    const payDate     = payment_date || new Date().toISOString().slice(0, 10);
    const periodLabel = period_month ? ` — ${period_month}` : '';
    const description = `Payroll payment for ${employee_name.trim()}${periodLabel}`;

    // ── 1. Create transaction (net paid only — single cash impact) ───────────
    const { data: tx, error: txErr } = await supabase.from('transactions').insert({
      ...bizWriteFields(biz, userId),
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
      ...bizWriteFields(biz, userId),
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
        user_id:            biz.ownerUserId,
        business_id:        biz.business.id,
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
    const transactionId = Number(req.params.transactionId);
    if (!transactionId) return res.status(400).json({ error: 'Invalid transaction ID.' });

    const biz = await requireBusiness(req, res);
    if (!biz) return;
    if (!canManagePayroll(biz.role))
      return res.status(403).json({ error: 'Your role does not allow accessing payroll' });

    // Security: verify transaction belongs to the business
    const { data: txRows } = await supabase
      .from('transactions').select('id, user_id, type').eq('id', transactionId).or(bizOrFilter(biz)).limit(1);
    if (!txRows?.length) return res.status(404).json({ error: 'Transaction not found.' });

    // Fetch payroll_payment linked to this transaction
    const { data: pmtRows } = await supabase
      .from('payroll_payments')
      .select('*')
      .eq('transaction_id', transactionId)
      .or(bizOrFilter(biz))
      .limit(1);
    const payment = pmtRows?.[0];

    if (!payment) return res.json({ payroll_payment: null, items: [] });

    // Fetch items
    const { data: items } = await supabase
      .from('payroll_payment_items')
      .select('*')
      .eq('payroll_payment_id', payment.id)
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