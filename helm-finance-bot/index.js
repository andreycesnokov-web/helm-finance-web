// ─────────────────────────────────────────────────────────────────────────────
// CFO AI Telegram Bot — V1
// Team onboarding (/start deep link), TEST training flow, real submissions MVP.
//
// The bot NEVER writes to the database directly. It only calls the CFO AI
// backend, always with the x-bot-secret header. The backend is the single
// source of truth and enforces all permissions.
// ─────────────────────────────────────────────────────────────────────────────
const TelegramBot = require('node-telegram-bot-api');
const {
  isTestMessage, stripTestPrefix, classifyType,
  parseAmount, parseDueDate, parseCounterparty,
} = require('./parsers');
const { msg, trainingReply } = require('./messages');

const BOT_TOKEN  = process.env.BOT_TOKEN;
const API_URL    = (process.env.CFO_API_URL || '').replace(/\/$/, '');
const BOT_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || process.env.BOT_TOKEN;

if (!BOT_TOKEN)  { console.error('FATAL: BOT_TOKEN is required'); process.exit(1); }
if (!API_URL)    { console.error('FATAL: CFO_API_URL is required'); process.exit(1); }

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('[bot] started; API:', API_URL);

// ── Language resolution: backend user.language → Telegram language_code → en ──
function resolveLang(backendLang, tgCode) {
  const norm = (l) => (['ru', 'id', 'en'].includes(l) ? l : null);
  return norm(backendLang) || norm((tgCode || '').slice(0, 2)) || 'en';
}

// ── Backend calls (always x-bot-secret) ──────────────────────────────────────
async function api(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bot-secret': BOT_SECRET },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-json */ }
  return { ok: res.ok, status: res.status, data };
}

// ── /start cfo_<memberId32>_<hmac10> ─────────────────────────────────────────
bot.onText(/^\/start(?:\s+(.+))?/, async (msgObj, match) => {
  const chatId  = msgObj.chat.id;
  const from    = msgObj.from || {};
  const payload = (match && match[1]) ? match[1].trim() : null;
  const lang    = resolveLang(null, from.language_code);

  if (!payload || !/^cfo_[0-9a-f]{32}_[0-9a-f]{10}$/i.test(payload)) {
    return bot.sendMessage(chatId, msg('notConnected', lang));
  }

  const { ok } = await api('/api/telegram/connect', {
    telegram_id:       from.id,
    telegram_username: from.username || null,
    first_name:        from.first_name || null,
    last_name:         from.last_name || null,
    start_payload:     payload,
  });

  bot.sendMessage(chatId, ok ? msg('connectOk', lang) : msg('connectFail', lang));
});

// ── Free-text messages ───────────────────────────────────────────────────────
bot.on('message', async (msgObj) => {
  const text = msgObj.text;
  if (!text || text.startsWith('/')) return; // commands handled elsewhere

  const chatId = msgObj.chat.id;
  const from   = msgObj.from || {};
  const lang   = resolveLang(null, from.language_code);

  try {
    const training = isTestMessage(text);
    const body     = training ? stripTestPrefix(text) : text;
    const type     = classifyType(body);

    if (!type) {
      return bot.sendMessage(chatId, msg(training ? 'uncertainTest' : 'uncertainReal', lang));
    }

    const amount       = parseAmount(body);
    const due_date     = parseDueDate(body);
    const counterparty = parseCounterparty(text, type);

    if (training) {
      // ── Training submission (is_training=true, zero cash impact) ──────────
      const { ok, data } = await api('/api/team/onboarding/training-submission', {
        telegram_id:    from.id,
        source_channel: 'telegram',
        training_type:  type,
        raw_input_text: text,
        amount, currency: 'IDR', counterparty, due_date,
      });

      if (!ok) {
        if (data?.error === 'Not a member of this business' || data?.error === 'Unauthorized')
          return bot.sendMessage(chatId, msg('notConnected', lang));
        return bot.sendMessage(chatId, msg('genericError', lang));
      }

      await bot.sendMessage(chatId, trainingReply(type, amount, lang));
      if (data.onboarding_done) await bot.sendMessage(chatId, msg('onboardingDone', lang));
      return;
    }

    // ── Real submission MVP → pending approval record ──────────────────────
    if (type === 'expense_request') {
      // Reimbursement modelled as a payable until a dedicated model exists
      // (mirrors the web/training behaviour).
    }
    const { ok, data } = await api('/api/debts/from-telegram', {
      telegram_id:    from.id,
      type:           type === 'receivable' ? 'receivable' : 'payable',
      counterparty, amount, currency: 'IDR', due_date,
      description:    type === 'expense_request' ? 'Reimbursement request' : null,
      raw_input_text: text,
      raw_input_language: lang,
    });

    if (!ok) {
      if (data?.error === 'not_linked' || data?.error === 'not_member')
        return bot.sendMessage(chatId, msg('notConnected', lang));
      if (data?.error === 'multiple_businesses')
        return bot.sendMessage(chatId, msg('genericError', lang)); // future: ask which business
      return bot.sendMessage(chatId, msg('genericError', lang));
    }
    bot.sendMessage(chatId, msg('realCreated', lang));
  } catch (e) {
    console.error('[bot] message error:', e.message);
    bot.sendMessage(chatId, msg('genericError', lang));
  }
});

bot.on('polling_error', (e) => console.error('[bot] polling_error:', e.code || e.message));
