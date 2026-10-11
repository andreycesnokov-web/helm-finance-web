// CFO AI Telegram Bot
// Thin Telegram interface. The bot never touches the database directly; all
// writes and permission checks stay in the CFO AI backend.
const TelegramBot = require('node-telegram-bot-api');
const {
  isTestMessage, stripTestPrefix, classifyType,
  parseAmount, parseDueDate, parseCounterparty,
} = require('./parsers');
const { msg, trainingReply, fmtAmount } = require('./messages');

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_URL = (process.env.CFO_API_URL || '').replace(/\/$/, '');
const BOT_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || process.env.BOT_TOKEN;

if (!BOT_TOKEN) { console.error('FATAL: BOT_TOKEN is required'); process.exit(1); }
if (!API_URL) { console.error('FATAL: CFO_API_URL is required'); process.exit(1); }

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('[bot] started; API:', API_URL);

const pendingByChat = new Map();

function resolveLang(backendLang, tgCode) {
  const norm = (l) => (['ru', 'id', 'en'].includes(l) ? l : null);
  return norm(backendLang) || norm((tgCode || '').slice(0, 2)) || 'en';
}

function normalizeRole(role) {
  return String(role || '').toLowerCase();
}

function roleCanSeeReports(role) {
  return ['owner', 'ceo', 'admin', 'cfo'].includes(normalizeRole(role));
}

function businessLabel(b) {
  if (!b) return 'Company';
  return `${b.name || 'Company'}${b.business_code ? ` - ${b.business_code}` : ''}`;
}

function text(key, vars = {}) {
  const dict = {
    menu: 'CFO AI bot\n\nChoose an action:',
    helpEmployee: [
      'How to record an expense:',
      '',
      'Spent 100000 on fuel',
      'Paid delivery 74000',
      '',
      'If you belong to several companies, use /company first.',
      'Company reports and balances are only for Owner / CEO / CFO / Admin.',
    ].join('\n'),
    helpManager: [
      'Commands:',
      '/company - select company',
      '/help - help',
      '/menu - menu',
      '',
      'You can send expenses, income, payables and receivables.',
      'Reports and approvals stay in the web app for now.',
    ].join('\n'),
    chooseCompany: 'Select company:',
    activeCompany: `Active company: ${vars.company || ''}\nNew entries will be saved here.`,
    oneCompany: `Active company: ${vars.company || ''}`,
    noCompany: 'Telegram is connected, but you have no active business company. Ask an owner/admin to invite you.',
    selectorOff: 'Company selector is not enabled on the server yet. Ask an admin to enable Telegram routing (043).',
    reportsEmployee: 'Company reports and balances are only available to Owner / CEO / CFO / Admin.',
    reportsManager: 'Telegram reports are coming soon. Please use the Business Workspace in the web app for now.',
    clarify: 'I am not sure what this is. Please choose:',
    cancelled: 'Cancelled.',
    writeExpense: 'Send an expense in one message, for example:\nspent 100000 on fuel',
    expenseSaved: `Entry created in ${vars.company || 'company'}.\nAmount: ${vars.amount || '-'} IDR\nStatus: ${vars.status || 'pending approval'}`,
    upgrade: 'Telegram bot is available on a paid plan for this company.',
  };
  return dict[key] || key;
}

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'x-bot-secret': BOT_SECRET },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_URL}${path}`, opts);
  let data = {};
  try { data = await res.json(); } catch { /* non-json */ }
  return { ok: res.ok, status: res.status, data };
}

function apiPost(path, body) {
  return api('POST', path, body);
}

function apiGet(path) {
  return api('GET', path);
}

function mainKeyboard(role) {
  const rows = [
    [{ text: 'Select company', callback_data: 'cmd:company' }],
    [
      { text: 'Add expense', callback_data: 'cmd:add_expense' },
      { text: 'Help', callback_data: 'cmd:help' },
    ],
  ];
  if (roleCanSeeReports(role)) {
    rows.push([
      { text: 'Reports', callback_data: 'cmd:reports' },
      { text: 'Approvals', callback_data: 'cmd:approvals' },
    ]);
  }
  return { inline_keyboard: rows };
}

function companyKeyboard(options, activeId) {
  return {
    inline_keyboard: options.map((b) => [{
      text: `${b.id === activeId ? '* ' : ''}${businessLabel(b)}`,
      callback_data: `setbiz:${b.id}`,
    }]),
  };
}

function clarifyKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Expense', callback_data: 'type:expense_request' },
        { text: 'Income', callback_data: 'type:receivable' },
      ],
      [
        { text: 'Payable', callback_data: 'type:payable' },
        { text: 'Receivable', callback_data: 'type:receivable' },
      ],
      [{ text: 'Cancel', callback_data: 'cmd:cancel' }],
    ],
  };
}

function optionsArray(data) {
  return Array.isArray(data?.options) ? data.options : [];
}

function activeRole(data) {
  return data?.business?.role || optionsArray(data)[0]?.role || null;
}

async function getActiveBusiness(from) {
  return apiGet(`/api/telegram/active-business?telegram_id=${encodeURIComponent(from.id)}`);
}

async function sendMenu(chatId, from) {
  let role = null;
  const r = await getActiveBusiness(from).catch(() => null);
  if (r?.ok) role = activeRole(r.data);
  await bot.sendMessage(chatId, text('menu'), { reply_markup: mainKeyboard(role) });
}

async function showCompanySelector(chatId, from, intro) {
  const r = await getActiveBusiness(from);
  if (r.status === 404) {
    await bot.sendMessage(chatId, text('selectorOff'));
    return r;
  }
  if (r.status === 402 || r.data?.upgrade_required) {
    await bot.sendMessage(chatId, text('upgrade'));
    return r;
  }
  if (!r.ok) {
    await bot.sendMessage(chatId, msg('genericError', 'en'));
    return r;
  }
  const data = r.data || {};
  if (data.status === 'none') {
    await bot.sendMessage(chatId, text('noCompany'));
    return r;
  }
  if (data.status === 'auto' || data.status === 'active') {
    await bot.sendMessage(chatId, intro || text('oneCompany', { company: businessLabel(data.business) }));
    return r;
  }
  if (data.status === 'choose') {
    await bot.sendMessage(chatId, intro || text('chooseCompany'), {
      reply_markup: companyKeyboard(optionsArray(data), data.active_business_id),
    });
    return r;
  }
  await bot.sendMessage(chatId, msg('genericError', 'en'));
  return r;
}

async function roleAwareHelp(chatId, from) {
  const r = await getActiveBusiness(from).catch(() => null);
  const role = r?.ok ? activeRole(r.data) : null;
  await bot.sendMessage(chatId, roleCanSeeReports(role) ? text('helpManager') : text('helpEmployee'));
}

async function handleReports(chatId, from) {
  const r = await getActiveBusiness(from);
  if (r.status === 404) return bot.sendMessage(chatId, text('selectorOff'));
  if (r.status === 402 || r.data?.upgrade_required) return bot.sendMessage(chatId, text('upgrade'));
  if (!r.ok) return bot.sendMessage(chatId, msg('genericError', 'en'));
  if (r.data?.status === 'choose') {
    pendingByChat.set(chatId, { command: 'reports' });
    return bot.sendMessage(chatId, text('chooseCompany'), {
      reply_markup: companyKeyboard(optionsArray(r.data), r.data.active_business_id),
    });
  }
  const role = activeRole(r.data);
  return bot.sendMessage(chatId, roleCanSeeReports(role) ? text('reportsManager') : text('reportsEmployee'));
}

function backendDebtType(type) {
  return type === 'receivable' ? 'receivable' : 'payable';
}

function buildSubmissionBody(from, lang, textValue, type, forcedBusinessId) {
  const amount = parseAmount(textValue);
  const due_date = parseDueDate(textValue);
  const counterparty = parseCounterparty(textValue, type);
  const body = {
    telegram_id: from.id,
    type: backendDebtType(type),
    counterparty,
    amount,
    currency: 'IDR',
    due_date,
    description: type === 'expense_request' ? 'Reimbursement request' : null,
    raw_input_text: textValue,
    raw_input_language: lang,
  };
  if (forcedBusinessId) body.business_id = forcedBusinessId;
  return body;
}

async function submitTraining(chatId, from, lang, raw) {
  const textValue = stripTestPrefix(raw);
  const type = classifyType(textValue);
  const amount = parseAmount(textValue);
  const due_date = parseDueDate(textValue);
  const counterparty = parseCounterparty(textValue, type);
  const body = {
    telegram_id: from.id,
    source_channel: 'telegram',
    training_type: type,
    raw_input_text: raw,
    amount,
    currency: 'IDR',
    due_date,
    counterparty,
  };
  const r = await apiPost('/api/team/onboarding/training-submission', body);
  if (!r.ok) {
    await bot.sendMessage(chatId, msg('genericError', lang));
    return;
  }
  await bot.sendMessage(chatId, trainingReply(type, amount, lang));
}

async function submitReal(chatId, from, lang, raw, forcedType, forcedBusinessId) {
  const type = forcedType || classifyType(raw);
  const amount = parseAmount(raw);

  if (!forcedType && (!type || !amount)) {
    pendingByChat.set(chatId, { text: raw, business_id: forcedBusinessId });
    await bot.sendMessage(chatId, text('clarify'), { reply_markup: clarifyKeyboard() });
    return;
  }

  const body = buildSubmissionBody(from, lang, raw, type, forcedBusinessId);
  const r = await apiPost('/api/debts/from-telegram', body);

  if (!r.ok) {
    const err = r.data?.error;
    if (err === 'multiple_businesses' || err === 'company_selection_required') {
      pendingByChat.set(chatId, { text: raw, forcedType });
      const active = await getActiveBusiness(from);
      if (active.ok && active.data?.status === 'choose') {
        await bot.sendMessage(chatId, text('chooseCompany'), {
          reply_markup: companyKeyboard(optionsArray(active.data), active.data.active_business_id),
        });
        return;
      }
      if (active.status === 404) {
        await bot.sendMessage(chatId, text('selectorOff'));
        return;
      }
    }
    if (err === 'not_connected') {
      await bot.sendMessage(chatId, msg('notConnected', lang));
      return;
    }
    if (r.status === 402 || r.data?.upgrade_required) {
      await bot.sendMessage(chatId, text('upgrade'));
      return;
    }
    await bot.sendMessage(chatId, msg('genericError', lang));
    return;
  }

  let company = null;
  const active = await getActiveBusiness(from).catch(() => null);
  if (active?.ok && active.data?.business) company = businessLabel(active.data.business);
  await bot.sendMessage(chatId, text('expenseSaved', {
    company,
    amount: fmtAmount(amount),
    status: r.data?.debt?.status || 'pending approval',
  }));
}

async function processTextMessage(msgObj) {
  const chatId = msgObj.chat.id;
  const from = msgObj.from || {};
  const lang = resolveLang(null, from.language_code);
  const raw = msgObj.text || '';
  if (isTestMessage(raw)) {
    await submitTraining(chatId, from, lang, raw);
    return;
  }
  await submitReal(chatId, from, lang, raw);
}

bot.onText(/^\/start(?:\s+(.+))?/, async (msgObj, match) => {
  const chatId = msgObj.chat.id;
  const from = msgObj.from || {};
  const lang = resolveLang(null, from.language_code);
  const payload = (match && match[1]) || '';

  if (payload.startsWith('cfo_')) {
    const r = await apiPost('/api/telegram/connect', {
      telegram_id: from.id,
      username: from.username || null,
      first_name: from.first_name || null,
      last_name: from.last_name || null,
      start_payload: payload,
    });
    await bot.sendMessage(chatId, r.ok ? msg('connectOk', lang) : msg('connectFail', lang));
  }

  await sendMenu(chatId, from);
});

bot.onText(/^\/menu/, async (msgObj) => {
  await sendMenu(msgObj.chat.id, msgObj.from || {});
});

bot.onText(/^\/help/, async (msgObj) => {
  await roleAwareHelp(msgObj.chat.id, msgObj.from || {});
});

bot.onText(/^\/company/, async (msgObj) => {
  await showCompanySelector(msgObj.chat.id, msgObj.from || {});
});

bot.onText(/^\/(reports|balance)/, async (msgObj) => {
  await handleReports(msgObj.chat.id, msgObj.from || {});
});

bot.on('callback_query', async (q) => {
  const data = q.data || '';
  const chatId = q.message?.chat?.id;
  const from = q.from || {};
  const lang = resolveLang(null, from.language_code);
  if (!chatId) return;

  try {
    await bot.answerCallbackQuery(q.id).catch(() => {});
    if (data === 'cmd:company') return showCompanySelector(chatId, from);
    if (data === 'cmd:help') return roleAwareHelp(chatId, from);
    if (data === 'cmd:reports' || data === 'cmd:approvals') return handleReports(chatId, from);
    if (data === 'cmd:add_expense') return bot.sendMessage(chatId, text('writeExpense'));
    if (data === 'cmd:cancel') {
      pendingByChat.delete(chatId);
      return bot.sendMessage(chatId, text('cancelled'));
    }
    if (data.startsWith('type:')) {
      const pending = pendingByChat.get(chatId);
      if (!pending?.text) return bot.sendMessage(chatId, text('cancelled'));
      pendingByChat.delete(chatId);
      return submitReal(chatId, from, lang, pending.text, data.slice(5), pending.business_id);
    }
    if (data.startsWith('setbiz:')) {
      const business_id = data.slice('setbiz:'.length);
      const r = await apiPost('/api/telegram/active-business', { telegram_id: from.id, business_id });
      if (r.status === 404) return bot.sendMessage(chatId, text('selectorOff'));
      if (r.status === 402 || r.data?.upgrade_required) return bot.sendMessage(chatId, text('upgrade'));
      if (!r.ok) return bot.sendMessage(chatId, msg('genericError', lang));
      const label = businessLabel(r.data.business);
      await bot.sendMessage(chatId, text('activeCompany', { company: label }));
      const pending = pendingByChat.get(chatId);
      if (pending?.text || pending?.command) {
        pendingByChat.delete(chatId);
        if (pending.command === 'reports') return handleReports(chatId, from);
        return submitReal(chatId, from, lang, pending.text, pending.forcedType, business_id);
      }
      return sendMenu(chatId, from);
    }
  } catch (e) {
    console.error('[bot] callback error:', e.message);
    await bot.sendMessage(chatId, msg('genericError', lang));
  }
});

bot.on('message', async (msgObj) => {
  const raw = msgObj.text;
  if (!raw || raw.startsWith('/')) return;
  try {
    await processTextMessage(msgObj);
  } catch (e) {
    console.error('[bot] message error:', e.message);
    const lang = resolveLang(null, msgObj.from?.language_code);
    await bot.sendMessage(msgObj.chat.id, msg('genericError', lang));
  }
});

bot.on('polling_error', (e) => console.error('[bot] polling_error:', e.code || e.message));
