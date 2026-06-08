const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json());
app.use(express.static('client/dist'));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const JWT_SECRET = process.env.JWT_SECRET || 'helm-finance-secret';
const BOT_TOKEN = process.env.BOT_TOKEN;

// ─── Telegram Login verification ──────────────────────────────────────────

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

// ─── Auth ──────────────────────────────────────────────────────────────────

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

// ─── Auth middleware ───────────────────────────────────────────────────────

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

// ─── Pulse API ─────────────────────────────────────────────────────────────

app.get('/api/pulse', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const scope = req.query.scope || 'all';
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // ALL transactions ever — for total balance
    let allTxQuery = supabase.from('transactions').select('*').eq('user_id', userId);
    if (scope !== 'all') allTxQuery = allTxQuery.eq('scope', scope);
    const { data: allTxs } = await allTxQuery;

    // This month transactions — for burn rate
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

    // ── Balance from transactions ──────────────────────────────────────────
    const allIncome = (allTxs || []).filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount_original), 0);
    const allExpenses = (allTxs || []).filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount_original), 0);
    const totalBalance = allIncome - allExpenses;

    // Virtual accounts from transaction sources
    const sourceMap = {};
    (allTxs || []).forEach(t => {
      const src = t.source || (t.scope === 'business' ? 'Helm Care Pay' : 'Personal');
      if (!sourceMap[src]) sourceMap[src] = { id: src, name: src, balance: 0, type: t.scope || 'personal' };
      if (t.type === 'income') sourceMap[src].balance += Number(t.amount_original);
      else sourceMap[src].balance -= Number(t.amount_original);
    });
    const accounts = Object.values(sourceMap)
      .filter(a => Math.abs(a.balance) > 1000)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5);

    // ── This month metrics ─────────────────────────────────────────────────
    const income = (txs || []).filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount_original), 0);
    const expenses = (txs || []).filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount_original), 0);
    const daysInMonth = now.getDate();
    const burnRate = daysInMonth > 0 ? Math.round(expenses / daysInMonth) : 0;
    const runway = burnRate > 0 ? Math.round(totalBalance / burnRate) : 999;

    const receivables = (debts || []).filter(d => d.type === 'receivable').reduce((s, d) => s + Number(d.amount), 0);
    const payables = (debts || []).filter(d => d.type === 'payable').reduce((s, d) => s + Number(d.amount), 0);
    const netPosition = totalBalance + receivables - payables;

    // ── AI status ──────────────────────────────────────────────────────────
    let aiStatus = 'healthy';
    let aiText = '';
    if (runway <= 7) {
      aiStatus = 'critical';
      aiText = `Денег осталось на ${runway} дн. Требуется входящий платёж для восстановления runway.`;
    } else if (runway <= 14) {
      aiStatus = 'attention';
      aiText = `Runway ${runway} дней. Есть обязательства, которые могут снизить запас. Рекомендую проверить дебиторку.`;
    } else {
      aiStatus = 'healthy';
      aiText = `Runway ${runway} дней. Поступления перекрывают обязательства. Рисков не обнаружено.`;
    }

    // ── Today's focus ──────────────────────────────────────────────────────
    const todayFocus = [];
    (debts || []).slice(0, 2).forEach(d => {
      const daysLeft = Math.round((new Date(d.due_date) - now) / 86400000);
      if (daysLeft <= 14) {
        todayFocus.push({
          id: d.id,
          title: d.type === 'receivable'
            ? `Напомнить ${d.counterparty} про оплату`
            : `Оплатить ${d.counterparty}`,
          meta: `${Number(d.amount).toLocaleString('ru-RU')} IDR · ${daysLeft > 0 ? daysLeft + ' дней' : 'сегодня'}`,
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

// ─── Debts API ─────────────────────────────────────────────────────────────

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

// ─── Transactions API ──────────────────────────────────────────────────────

app.get('/api/transactions', auth, async (req, res) => {
  const { scope, period = 'month' } = req.query;
  const now = new Date();
  let from;
  if (period === 'today') from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  else if (period === 'week') { from = new Date(now); from.setDate(now.getDate() - 7); }
  else from = new Date(now.getFullYear(), now.getMonth(), 1);

  let query = supabase.from('transactions').select('*, categories(name, emoji)')
    .eq('user_id', req.user.userId)
    .gte('created_at', from.toISOString())
    .order('created_at', { ascending: false });
  if (scope && scope !== 'all') query = query.eq('scope', scope);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─── Reminders API ─────────────────────────────────────────────────────────

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

// ─── Accounts API ─────────────────────────────────────────────────────────

app.post('/api/accounts', auth, async (req, res) => {
  const { name, type, balance } = req.body
  // Save as an "opening balance" transaction
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

// ─── Serve React app ───────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile('index.html', { root: 'client/dist' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Helm Finance Web running on port ${PORT}`));

// NOTE: append before the last app.get('*') handler — this is a patch
