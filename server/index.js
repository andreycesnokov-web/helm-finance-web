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

    const allIncome   = (allTxs || []).filter(t => CASH_IN.includes(t.type)).reduce((s, t) => s + Number(t.amount_original), 0);
    const allExpenses = (allTxs || []).filter(t => CASH_OUT.includes(t.type)).reduce((s, t) => s + Number(t.amount_original), 0);
    const totalBalance = allIncome - allExpenses;

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
      // transfer / unknown → neutral: no effect on account balance (Phase 1)
    });
    const accounts = Object.values(sourceMap)
      .filter(a => a.balance !== 0 || true) // show all accounts
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 10);

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
  const { data, error } = await supabase.from('debts')
    .insert({ ...req.body, user_id: req.user.userId }).select().single();
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
    const { transactions } = req.body;
    const rows = transactions.map(t => ({
      user_id:           req.user.userId,
      type:              t.type,
      amount_original:   t.amount,
      currency_original: t.currency || 'IDR',
      amount_idr:        t.currency === 'IDR' ? t.amount : (t.amount_idr || t.amount),
      description:       t.description,
      source:            t.source   || null,
      scope:             t.scope    || 'personal',
      project:           t.project  || null,
      category:          t.category || null,
    }));
    const { error } = await supabase.from('transactions').insert(rows);
    if (error) throw error;
    res.json({ saved: rows.length });
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

// --- Serve React app -------------------------------------------------------


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

app.get('*', (req, res) => {
  res.sendFile('index.html', { root: 'client/dist' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Helm Finance Web running on port ${PORT}`));