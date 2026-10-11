// ── Parsing & classification helpers for CFO AI Telegram bot ────────────────
// Pure functions, no side effects — easy to unit test.

const TEST_PREFIX = /^\s*(test|тест)\s*:/i;

function isTestMessage(text) {
  return TEST_PREFIX.test(text || '');
}
function stripTestPrefix(text) {
  return (text || '').replace(TEST_PREFIX, '').trim();
}

// ── Type classification ───────────────────────────────────────────────────────
// Order matters: expense_request (personal money) is checked before payable,
// because "я оплатил ... своими деньгами" also contains "оплатил".
const EXPENSE_WORDS = [
  'своими деньгами', 'свои деньги', 'личными деньгами', 'из своего кармана',
  'uang pribadi', 'pakai uang sendiri', 'uang sendiri',
  'my own money', 'with my own', 'own money', 'reimburs', 'компенсаци',
];
const RECEIVABLE_WORDS = [
  'клиент', 'должен оплатить', 'должен', 'дебитор',
  'belum bayar', 'piutang', 'akan bayar', 'harus bayar',
  'client', 'should pay', 'owes', 'receivable', 'will pay',
];
const PAYABLE_WORDS = [
  'оплатить поставщик', 'заплатить поставщик', 'оплатить', 'заплатить', 'поставщик', 'счёт', 'счет',
  'bayar supplier', 'bayar', 'supplier', 'vendor', 'invoice', 'tagihan',
  'pay supplier', 'need to pay', 'pay vendor', 'payable', 'bill',
];

function classifyType(text) {
  const t = (text || '').toLowerCase();
  const has = (list) => list.some(w => t.includes(w));
  if (has(EXPENSE_WORDS))    return 'expense_request';
  if (has(RECEIVABLE_WORDS)) return 'receivable';
  if (has(PAYABLE_WORDS))    return 'payable';
  return null;
}

// ── Amount parsing ────────────────────────────────────────────────────────────
// Handles: 100,000 / 100000 / 100k / 100 ribu / 5 juta / 10 млн / 10 million
function parseAmount(text) {
  const t = (text || '').toLowerCase().replace(/ /g, ' ');

  // multiplier suffixes
  // Note: \b is ASCII-only and fails after Cyrillic (млн/тыс), so we use an
  // explicit "end of token" lookahead instead.
  const END = '(?=\\s|$|[^\\wа-яё])';
  const scales = [
    { re: new RegExp(`(\\d[\\d.,\\s]*)\\s*(?:juta|млн|million|jt)${END}`, 'i'),  mul: 1e6 },
    { re: new RegExp(`(\\d[\\d.,\\s]*)\\s*(?:ribu|rb|тыс|thousand)${END}`, 'i'), mul: 1e3 },
    { re: new RegExp(`(\\d[\\d.,]*)\\s*k${END}`, 'i'),                           mul: 1e3 },
    { re: new RegExp(`(\\d[\\d.,]*)\\s*m${END}`, 'i'),                           mul: 1e6 },
  ];
  for (const s of scales) {
    const m = t.match(s.re);
    if (m) {
      const base = parseFloat(m[1].replace(/[\s,](?=\d{3}\b)/g, '').replace(',', '.'));
      if (!isNaN(base)) return Math.round(base * s.mul);
    }
  }

  // plain number with thousands separators: 100,000 / 100.000 / 100000
  const plain = t.match(/(\d{1,3}(?:[.,\s]\d{3})+|\d{4,})/);
  if (plain) {
    const n = parseInt(plain[1].replace(/[.,\s]/g, ''), 10);
    if (!isNaN(n)) return n;
  }
  return 0;
}

// ── Due date parsing (MVP) ────────────────────────────────────────────────────
function parseDueDate(text, now = new Date()) {
  const t = (text || '').toLowerCase();
  const iso = (d) => d.toISOString().slice(0, 10);

  if (/(завтра|tomorrow|besok)/.test(t)) {
    const d = new Date(now); d.setDate(d.getDate() + 1); return iso(d);
  }
  if (/(послезавтра|lusa)/.test(t)) {
    const d = new Date(now); d.setDate(d.getDate() + 2); return iso(d);
  }
  // "до пятницы" / "by Friday" / "sampai Jumat"
  const weekdays = {
    0: ['воскресень', 'sunday', 'minggu'], 1: ['понедельник', 'monday', 'senin'],
    2: ['вторник', 'tuesday', 'selasa'],   3: ['сред', 'wednesday', 'rabu'],
    4: ['четверг', 'thursday', 'kamis'],   5: ['пятниц', 'friday', 'jumat'],
    6: ['суббот', 'saturday', 'sabtu'],
  };
  for (const [dow, words] of Object.entries(weekdays)) {
    if (words.some(w => t.includes(w))) {
      const target = Number(dow);
      const d = new Date(now);
      let diff = (target - d.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      d.setDate(d.getDate() + diff);
      return iso(d);
    }
  }
  return null; // unknown — backend keeps it as draft
}

// ── Counterparty (best-effort) ────────────────────────────────────────────────
function parseCounterparty(text, type) {
  const t = stripTestPrefix(text);
  // "клиент ABC", "supplier XYZ", "PT ABC"
  const m = t.match(/\b(PT\.?\s+[A-Za-zА-Яа-я0-9]+|[A-ZА-Я]{2,}[A-Za-zА-Яа-я0-9]*)\b/);
  if (m) return m[1].trim();
  if (type === 'payable')         return 'Supplier';
  if (type === 'receivable')      return 'Client';
  if (type === 'expense_request') return 'Reimbursement';
  return null;
}

module.exports = {
  isTestMessage, stripTestPrefix, classifyType,
  parseAmount, parseDueDate, parseCounterparty,
};
