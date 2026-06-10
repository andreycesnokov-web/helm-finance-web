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

// --- Pulse API -------------------------------------------------------------

app.get('/api/pulse', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
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

    // Debts
    const { data: debts } = await supabase.from('debts')
      .select('*').eq('user_id', userId).eq('is_settled', false)
      .order('due_date', { ascending: true });

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
      .from('wallets').select('id, name, currency, type, entity_name')
      .eq('user_id', userId).eq('is_active', true)
      .order('sort_order', { ascending: true });

    let accounts;
    if (userWallets && userWallets.length > 0) {
      accounts = userWallets.map(w => {
        const related = (allTxs || []).filter(t =>
          t.wallet_id === w.id || (!t.wallet_id && t.source === w.name)
        );
        const balance = related.reduce((sum, t) => {
          if (CASH_IN.includes(t.type))  return sum + Number(t.amount_original || 0);
          if (CASH_OUT.includes(t.type)) return sum - Number(t.amount_original || 0);
          if (t.type === 'correction')   return sum + Number(t.amount_original || 0); // signed delta
          return sum;
        }, 0);
        return { id: w.id, name: w.name, balance, currency: w.currency || 'IDR', type: w.type || 'bank', entity_name: w.entity_name || null };
      });
    } else {
      // Legacy mode: virtual accounts derived from transactions.source
      accounts = Object.values(sourceMap)
        .filter(a => a.balance !== 0 || true)
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 10);
    }

    // -- This month metrics -------------------------------------------------
    // Uses the same CASH_IN / CASH_OUT model for consistency.
    const income   = (txs || []).filter(t => CASH_IN.includes(t.type)).reduce((s, t) => s + Number(t.amount_original), 0);
    const expenses = (txs || []).filter(t => CASH_OUT.includes(t.type)).reduce((s, t) => s + Number(t.amount_original), 0);
    const daysInMonth = now.getDate();
    const burnRate = daysInMonth > 0 ? Math.round(expenses / daysInMonth) : 0;
    const runway = burnRate > 0 ? Math.round(totalBalance / burnRate) : 999;

    const receivables = (debts || []).filter(d => d.type === 'receivable').reduce((s, d) => s + Number(d.amount), 0);
    const payables = (debts || []).filter(d => d.type === 'payable').reduce((s, d) => s + Number(d.amount), 0);
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
      aiText = `Runway ${runway} days. Income covers obligations. No risks detected.`;
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
      receivables, payables, netPosition,
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

app.get('/api/debts', auth, async (req, res) => {
  const { data, error } = await supabase.from('debts')
    .select('*').eq('user_id', req.user.userId).eq('is_settled', false)
    .order('due_date', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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
  const { data, error } = await supabase.from('debts')
    .insert({ ...req.body, user_id: userId }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/debts/:id/settle', auth, async (req, res) => {
  const { data, error } = await supabase.from('debts')
    .update({ is_settled: true, settled_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('user_id', req.user.userId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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

// GET /api/cashflow-categories — system + user custom categories
app.get('/api/cashflow-categories', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { data, error } = await supabase
      .from('cashflow_categories')
      .select('*')
      .eq('is_active', true)
      .or(`is_system.eq.true,user_id.eq.${userId}`)
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
    const { data, error } = await supabase
      .from('cashflow_categories')
      .update({ name, group_type, activity_type, sub_category, description, is_active, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', userId)   // can only edit own categories, not system ones
      .eq('is_system', false)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Category not found or not editable' });
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

// GET /api/business-directions — system + user directions
app.get('/api/business-directions', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { data, error } = await supabase
      .from('business_directions')
      .select('*')
      .eq('is_active', true)
      .or(`is_system.eq.true,user_id.eq.${userId}`)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    res.json({ directions: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/activity-types — system + user activity types
app.get('/api/activity-types', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { data, error } = await supabase
      .from('activity_types')
      .select('*')
      .eq('is_active', true)
      .or(`is_system.eq.true,user_id.eq.${userId}`)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    res.json({ activityTypes: data || [] });
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
  const { name, currency, type, entity_name, color, opening_balance, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
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
        scope:            'business',
      });
    }

    res.json({ wallet });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/wallets/:id', auth, async (req, res) => {
  const userId = req.user.userId;
  const { id } = req.params;
  const { name, currency, type, entity_name, color, sort_order } = req.body;
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
      .select('id, user_id, name, currency')
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
        scope:             'business',
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
      .select('id, user_id, name, currency')
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
      scope:             'business',
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
  const { amount, account, date } = req.body
  if (!amount) return res.status(400).json({ error: 'Missing amount' })
  const { data: debt, error: debtErr } = await supabase.from('debts')
    .select('*').eq('id', req.params.id).eq('user_id', req.user.userId).single()
  if (debtErr) return res.status(500).json({ error: debtErr.message })
  const paidAmount = Number(amount)
  const totalAmount = Number(debt.amount)
  const isFullyPaid = paidAmount >= totalAmount
  const { error: txErr } = await supabase.from('transactions').insert({
    user_id: req.user.userId,
    type: debt.type === 'payable' ? 'expense' : 'income',
    amount_original: paidAmount,
    currency_original: 'IDR',
    amount_idr: paidAmount,
    description: `Payment: ${debt.counterparty}`,
    source: account || null,
    scope: debt.scope || 'business',
  })
  if (txErr) return res.status(500).json({ error: txErr.message })
  if (isFullyPaid) {
    await supabase.from('debts').update({ is_settled: true, settled_at: new Date().toISOString() })
      .eq('id', req.params.id)
  } else {
    await supabase.from('debts').update({ amount: totalAmount - paidAmount })
      .eq('id', req.params.id)
  }
  res.json({ ok: true, isFullyPaid, remaining: totalAmount - paidAmount })
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

app.get('*', (req, res) => {
  res.sendFile('index.html', { root: 'client/dist' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Helm Finance Web running on port ${PORT}`));