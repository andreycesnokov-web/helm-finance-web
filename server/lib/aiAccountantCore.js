// Core deterministic logic and prompt builder for AI Accountant (PR 132)
// Extracted so production routes and tests run the exact same implementation.

const path = require('node:path');
const fs = require('node:fs');

const WALLET_CASH_IN  = ['income', 'topup', 'funding', 'refund'];
const WALLET_CASH_OUT = ['expense', 'withdrawal', 'fee', 'payroll'];

let _sourcesMap = null;
function getSourcesMap() {
  if (!_sourcesMap) {
    try {
      const sourcesPath = path.resolve(__dirname, '../../knowledge/indonesia_tax_kb/sources.json');
      const data = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
      _sourcesMap = new Map((data.sources || []).map(s => [s.id, s]));
    } catch (e) {
      _sourcesMap = new Map();
    }
  }
  return _sourcesMap;
}

const BLOCKER_EXPLANATIONS = {
  tax_period_missing: {
    ru: 'Не указан налоговый период',
    en: 'Tax period is not specified',
    id: 'Periode pajak belum ditentukan',
  },
  current_provision_currency_unconfirmed: {
    ru: 'Актуальность нормы пока не подтверждена',
    en: 'Statutory currency is not yet confirmed',
    id: 'Keberlakuan ketentuan belum dikonfirmasi',
  },
  dependency_source_missing: {
    ru: 'Не хватает связанного нормативного источника',
    en: 'Related statutory source is missing',
    id: 'Sumber hukum terkait belum tersedia',
  },
  amendment_review_incomplete: {
    ru: 'Проверка изменений законодательства ещё не завершена',
    en: 'Amendment review is not yet complete',
    id: 'Peninjauan perubahan peraturan belum selesai',
  },
  TER_table_not_verified: {
    ru: 'Таблицы расчёта удержаний пока не проверены',
    en: 'Withholding calculation tables are not yet verified',
    id: 'Tabel perhitungan pemotongan belum diverifikasi',
  },
};

const UNKNOWN_BLOCKER_FALLBACK = {
  ru: 'Требуется дополнительная проверка условий',
  en: 'Additional requirement verification needed',
  id: 'Verifikasi persyaratan tambahan diperlukan',
};

function getBlockerReasons({ blockers = [], language = 'ru' }) {
  const lang = ['ru', 'en', 'id'].includes(language) ? language : 'en';
  const seenCodes = new Set();
  const reasons = [];
  const diagnostics = [];

  for (const b of blockers) {
    const code = typeof b === 'string' ? b : b?.code;
    if (!code || seenCodes.has(code)) continue;
    seenCodes.add(code);

    const mapped = BLOCKER_EXPLANATIONS[code];
    if (mapped) {
      reasons.push(mapped[lang]);
      diagnostics.push({ code, label: mapped[lang], status: 'known' });
    } else {
      reasons.push(UNKNOWN_BLOCKER_FALLBACK[lang]);
      diagnostics.push({ code, label: UNKNOWN_BLOCKER_FALLBACK[lang], status: 'unknown' });
    }
  }

  return { reasons, diagnostics, rawCodes: Array.from(seenCodes) };
}

function formatHumanSources(card, language = 'ru') {
  const isRu = language === 'ru';
  const isId = language === 'id';
  const evidences = card?.claim_evidence || [];
  const sourcesMap = getSourcesMap();

  const bySource = new Map();
  for (const ev of evidences) {
    if (!ev?.source_id) continue;
    if (!bySource.has(ev.source_id)) {
      bySource.set(ev.source_id, {
        sourceId: ev.source_id,
        articles: new Set(),
        links: Array.isArray(ev.links) ? ev.links : [],
      });
    }
    const item = bySource.get(ev.source_id);
    if (ev.article) item.articles.add(ev.article);
    if (Array.isArray(ev.links) && ev.links.length > 0 && item.links.length === 0) {
      item.links = ev.links;
    }
  }

  const formattedSources = [];
  for (const [srcId, item] of bySource.entries()) {
    const meta = sourcesMap.get(srcId);
    let docName = srcId;
    let url = meta?.original_url || (item.links && item.links[0]) || '';

    if (srcId === 'PMK168_2023') docName = 'PMK 168/2023';
    else if (srcId === 'PP58_2023') docName = 'PP 58/2023';
    else if (srcId === 'PP34_2017') docName = 'PP 34/2017';
    else if (srcId === 'PMK141_2015') docName = 'PMK 141/2015';
    else if (srcId === 'PP55_2022') docName = 'PP 55/2022';
    else if (srcId === 'PP20_2026') docName = 'PP 20/2026';
    else if (srcId === 'PMK164_2023') docName = 'PMK 164/2023';
    else if (srcId === 'PMK131_2024') docName = 'PMK 131/2024';
    else if (srcId === 'PMK11_2025') docName = 'PMK 11/2025';
    else if (srcId === 'PMK53_2025') docName = 'PMK 53/2025';
    else if (srcId === 'PMK81_2024') docName = 'PMK 81/2024';
    else if (srcId === 'PMK1_2026') docName = 'PMK 1/2026';
    else if (srcId === 'PMK54_2025') docName = 'PMK 54/2025';
    else if (srcId === 'DJP_SDSN_2023') docName = 'UU PPh (UU 6/2023)';
    else if (meta?.document_number) {
      docName = meta.document_number.replace(/\s+Tahun\s+/i, '/');
    }

    const arts = Array.from(item.articles).sort((a, b) => Number(a) - Number(b));
    let artStr = '';
    if (arts.length === 1) {
      artStr = isRu ? `статья ${arts[0]}` : isId ? `Pasal ${arts[0]}` : `Article ${arts[0]}`;
    } else if (arts.length === 2) {
      artStr = isRu ? `статьи ${arts[0]} и ${arts[1]}` : isId ? `Pasal ${arts[0]} dan ${arts[1]}` : `Articles ${arts[0]} and ${arts[1]}`;
    } else if (arts.length > 2) {
      const allExceptLast = arts.slice(0, -1).join(', ');
      const last = arts[arts.length - 1];
      artStr = isRu ? `статьи ${allExceptLast} и ${last}` : isId ? `Pasal ${allExceptLast}, dan ${last}` : `Articles ${allExceptLast} and ${last}`;
    }

    const docLinked = url ? `[${docName}](${url})` : docName;
    formattedSources.push(artStr ? `${docLinked} — ${artStr}` : docLinked);
  }

  return formattedSources.join('; ');
}

function formatUnconfirmedSection({ card, language = 'ru' }) {
  const lang = ['ru', 'en', 'id'].includes(language) ? language : 'en';
  const blockers = card?.blockers || [];
  const { reasons, diagnostics, rawCodes } = getBlockerReasons({ blockers, language: lang });

  const heading = {
    ru: '### Что пока не подтверждено',
    en: '### What is not yet confirmed',
    id: '### Hal yang belum dikonfirmasi',
  }[lang];

  const hasPeriod = rawCodes.includes('tax_period_missing');
  const hasCurrency = rawCodes.includes('current_provision_currency_unconfirmed') || rawCodes.includes('amendment_review_incomplete');
  const hasDeps = rawCodes.includes('dependency_source_missing');
  const hasTer = rawCodes.includes('TER_table_not_verified');

  let body = '';
  if (lang === 'ru') {
    const actions = [];
    if (hasPeriod) actions.push('уточнить налоговый период');
    if (hasCurrency && hasTer) {
      actions.push('проверить актуальность правил и таблиц расчёта');
    } else if (hasCurrency && hasDeps) {
      actions.push('проверить актуальность правил и связанные нормативные источники');
    } else {
      if (hasCurrency) actions.push('проверить актуальность правил');
      if (hasDeps) actions.push('связанные нормативные источники');
      if (hasTer) actions.push('таблицы расчёта удержаний');
    }
    const unknownCount = diagnostics.filter(d => d.status === 'unknown').length;
    if (unknownCount > 0) actions.push('проверить дополнительные условия');

    const actionText = actions.length > 0 ? actions.join(' и ') : 'проверить актуальность правил';
    const intro = hasTer
      ? 'Это общее пояснение по архивным источникам. Чтобы определить налог для вашей компании, нужно '
      : 'Это общее пояснение по архивным источникам. Для ответа по вашей компании нужно ';

    body = `${intro}${actionText}. Пока я не могу подтвердить ставку или сумму налога.`;
  } else if (lang === 'id') {
    const actions = [];
    if (hasPeriod) actions.push('menentukan periode pajak');
    if (hasCurrency && hasTer) {
      actions.push('memverifikasi keberlakuan peraturan dan tabel perhitungan');
    } else if (hasCurrency && hasDeps) {
      actions.push('memverifikasi keberlakuan peraturan dan sumber hukum terkait');
    } else {
      if (hasCurrency) actions.push('memverifikasi keberlakuan peraturan');
      if (hasDeps) actions.push('meninjau sumber hukum terkait');
      if (hasTer) actions.push('tabel perhitungan pemotongan');
    }
    const unknownCount = diagnostics.filter(d => d.status === 'unknown').length;
    if (unknownCount > 0) actions.push('memverifikasi ketentuan tambahan');

    const actionText = actions.length > 0 ? actions.join(' serta ') : 'memverifikasi keberlakuan peraturan';
    const intro = hasTer
      ? 'Ini adalah penjelasan umum berdasarkan sumber arsip. Untuk menentukan pajak bagi perusahaan Anda, perlu '
      : 'Ini adalah penjelasan umum berdasarkan sumber arsip. Untuk menjawab bagi perusahaan Anda, perlu ';

    body = `${intro}${actionText}. Saya belum dapat mengonfirmasi tarif atau jumlah pajak saat ini.`;
  } else {
    // English
    const actions = [];
    if (hasPeriod) actions.push('specify the tax period');
    if (hasCurrency && hasTer) {
      actions.push('verify the currency of rules and calculation tables');
    } else if (hasCurrency && hasDeps) {
      actions.push('verify the currency of rules, and review related statutory sources');
    } else {
      if (hasCurrency) actions.push('verify the currency of rules');
      if (hasDeps) actions.push('review related statutory sources');
      if (hasTer) actions.push('withholding calculation tables');
    }
    const unknownCount = diagnostics.filter(d => d.status === 'unknown').length;
    if (unknownCount > 0) actions.push('verify additional statutory conditions');

    const actionText = actions.length > 0 ? actions.join(' and ') : 'verify the currency of rules';
    const intro = hasTer
      ? 'This is a general explanation based on archived sources. To determine tax for your company, you need to '
      : 'This is a general explanation based on archived sources. To answer for your company, you need to ';

    body = `${intro}${actionText}. I cannot confirm the tax rate or amount yet.`;
  }

  return { heading, body, text: `${heading}\n\n${body}`, reasons, diagnostics, rawCodes };
}

function buildAccountantCompanyFacts({ business, rawWallets = [], rawTxs = [], enrichedDebts = [] }) {
  // Calculate balances for each active wallet
  const walletsWithBalance = (rawWallets || []).map(w => {
    const related = (rawTxs || []).filter(t => t.wallet_id === w.id || (!t.wallet_id && t.source === w.name));
    const balance = related.reduce((sum, t) => {
      const amt = Number(t.amount_original ?? t.amount_idr ?? 0);
      if (WALLET_CASH_IN.includes(t.type))  return sum + amt;
      if (WALLET_CASH_OUT.includes(t.type)) return sum - amt;
      if (t.type === 'correction')          return sum + amt;
      return sum;
    }, 0);
    return {
      id: w.id,
      name: w.name,
      currency: (w.currency || 'IDR').toUpperCase(),
      type: w.type,
      balance
    };
  });

  // Clean debt summaries with attached payment history breakdown
  const debtsSummary = enrichedDebts.map(d => {
    const dCounterparty = (d.counterparty || '').trim().toLowerCase();
    const debtPayments = (rawTxs || []).filter(t => {
      if (t.id === d.linked_transaction_id) return true;
      const tCp = (t.counterparty_name || t.counterparty || '').trim().toLowerCase();
      if (tCp && tCp === dCounterparty) return true;
      if (t.description && (
        t.description.toLowerCase().includes(`payment: ${dCounterparty}`) ||
        t.description.toLowerCase().includes(`debt #${d.id}`)
      )) return true;
      return false;
    }).map(ptx => ({
      transaction_id: ptx.id,
      amount: Number(ptx.amount_original ?? ptx.amount_idr ?? 0),
      currency: (ptx.currency_original || d.currency || 'IDR').toUpperCase(),
      date: (ptx.transaction_date || ptx.date || ptx.created_at || '').slice(0, 10),
      source: ptx.source || null,
      description: ptx.description || null,
    }));

    return {
      id: d.id,
      type: d.type, // 'payable' or 'receivable'
      counterparty: d.counterparty || '',
      currency: (d.currency || 'IDR').toUpperCase(),
      original_amount: Number(d.original_amount ?? d.amount ?? 0),
      paid_amount: Number(d.paid_amount || 0),
      remaining_amount: Number(d.remaining_amount || 0),
      status: d.status,
      due_date: d.due_date || null,
      description: d.description || '',
      payments: debtPayments,
    };
  });

  // Aggregate counterparties across all debts (partitioned by counterparty + currency to guarantee currency isolation)
  const counterpartiesMap = {};
  for (const d of debtsSummary) {
    const name = (d.counterparty || '').trim();
    if (!name) continue;
    const ccy = (d.currency || 'IDR').toUpperCase();
    const key = `${name.toLowerCase()}:${ccy}`;
    if (!counterpartiesMap[key]) {
      counterpartiesMap[key] = {
        name,
        currency: ccy,
        total_payable_original: 0,
        total_payable_paid: 0,
        total_payable_remaining: 0,
        total_receivable_original: 0,
        total_receivable_paid: 0,
        total_receivable_remaining: 0,
        debts_count: 0,
        payments: [],
      };
    }
    const cp = counterpartiesMap[key];
    if (d.type === 'payable') {
      cp.total_payable_original += d.original_amount;
      cp.total_payable_paid += d.paid_amount;
      cp.total_payable_remaining += d.remaining_amount;
    } else if (d.type === 'receivable') {
      cp.total_receivable_original += d.original_amount;
      cp.total_receivable_paid += d.paid_amount;
      cp.total_receivable_remaining += d.remaining_amount;
    }
    cp.debts_count += 1;
    if (Array.isArray(d.payments)) {
      for (const p of d.payments) {
        if (!cp.payments.some(existing => existing.transaction_id === p.transaction_id)) {
          cp.payments.push(p);
        }
      }
    }
  }

  // Recent 30 transactions
  const recentTransactions = (rawTxs || []).slice(0, 30).map(t => ({
    id: t.id,
    date: (t.transaction_date || t.date || t.created_at || '').slice(0, 10),
    type: t.type,
    amount: Number(t.amount_original ?? t.amount_idr ?? 0),
    currency: (t.currency_original || 'IDR').toUpperCase(),
    counterparty: t.counterparty_name || t.counterparty || '',
    category: t.category || '',
    description: t.description || '',
    transfer_id: t.transfer_id || null,
  }));

  return {
    company: {
      id: business.id,
      name: business.name || 'Company',
      wallets: walletsWithBalance,
      counterparties: Object.values(counterpartiesMap),
      debts: debtsSummary,
      recent_transactions: recentTransactions,
    },
    counterpartiesMap,
    walletsWithBalance,
  };
}

function buildAccountantPrompt({ business, facts, question, language = 'en' }) {
  const langName = language === 'ru' ? 'Russian' : language === 'id' ? 'Indonesian' : 'English';
  return `You are the Helm Finance AI Accountant for business "${business?.name || 'Company'}". Answer in ${langName}.

STRICT RULES:
- Use ONLY the deterministic facts below. NEVER invent a tax rate, deadline, filing frequency, threshold, legal interpretation, or financial figure.
- For company financial questions (wallets, balances, debts, payables, receivables, counterparties, vendor payments, transactions): use the data in "facts.company". Report exact numbers, currencies, paid amounts, remaining amounts, and settlement statuses from "counterparties", "debts", or "wallets".
- Internal transfers between business wallets are neutral liquidity movements, NEVER business revenue/income or operating expense.
- When describing a counterparty's debt history, report the original debt amount, each payment made (amount, date, transaction id link), remaining debt, and settlement status.
- For tax compliance and legal obligations: cite rule_code, version, and official source title from "applicable_rules". If the facts do not contain an active rule needed to answer, say the determination is not possible yet and state what is missing.
- When explaining tax knowledge cards (from "facts.tax_knowledge_card"):
  * Present the card's name, explanation, mechanisms, and conditions based strictly on the facts.
  * Cite official sources in human-readable format (e.g. "PMK 168/2023 — статьи 2, 3, 8, 13 и 15" or "[PMK 168/2023](url) — статьи..."). NEVER expose internal raw IDs like "PMK168_2023" or "DJP_SDSN_2023" directly in user-facing text.
  * NEVER output technical blocker codes (such as "tax_period_missing", "current_provision_currency_unconfirmed", "dependency_source_missing", "amendment_review_incomplete", "TER_table_not_verified").
  * NEVER use phrasing like "Применимость к компании заблокирована".
  * Instead, present unconfirmed aspects under the section "${language === 'ru' ? '### Что пока не подтверждено' : language === 'id' ? '### Hal yang belum dikonfirmasi' : '### What is not yet confirmed'}", using natural language explaining what must be clarified before determining taxes for the company (e.g. specifying the tax period, confirming currency of rules, reviewing calculation tables or related sources), as provided in facts.tax_knowledge_card.unconfirmed_section.
- You explain and summarise facts; you do not invent information not present in the facts.
- Do not present this as official advice.

FACTS:
${JSON.stringify(facts, null, 2)}

QUESTION: ${question}`;
}

function generateDeterministicFallbackAnswer({ question, language = 'en', counterpartiesMap = {}, walletsWithBalance = [], taxData = {} }) {
  const qLower = (question || '').toLowerCase();
  const cpList = Object.values(counterpartiesMap);

  // 1. Longest / exact full-name match first
  let matchedCp = cpList
    .filter(cp => qLower.includes(cp.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0] || null;

  // 2. Fallback to scoring specific tokens
  if (!matchedCp) {
    const commonTokens = new Set(['qa-7day-run01', 'pt', 'cv', 'ltd', 'inc', 'llc', 'the', 'vendor', 'supplier']);
    let bestScore = 0;
    for (const cp of cpList) {
      const parts = cp.name.toLowerCase().split(/[\s_\-]+/).filter(p => p.length >= 3 && !commonTokens.has(p));
      const score = parts.filter(p => qLower.includes(p)).length;
      if (score > bestScore) {
        bestScore = score;
        matchedCp = cp;
      }
    }
  }

  const isRu = language === 'ru';
  const isId = language === 'id';
  const fmt = (n, cur) => `${Number(n || 0).toLocaleString(isRu ? 'ru-RU' : isId ? 'id-ID' : 'en-US')} ${cur}`;

  if (matchedCp) {
    const paidStr = fmt(matchedCp.total_payable_paid, matchedCp.currency);
    const remStr = fmt(matchedCp.total_payable_remaining, matchedCp.currency);
    const origStr = fmt(matchedCp.total_payable_original, matchedCp.currency);
    const statusStr = matchedCp.total_payable_remaining === 0
      ? (isRu ? 'полностью оплачен (paid)' : isId ? 'lunas (paid)' : 'fully paid (status: paid)')
      : (isRu ? 'имеет непогашенный остаток' : isId ? 'masih ada sisa' : 'partially open');

    let pmtDetails = '';
    if (matchedCp.payments && matchedCp.payments.length > 0) {
      const pmtLines = matchedCp.payments.map(p =>
        `• ${fmt(p.amount, p.currency)} (${p.date}${p.transaction_id ? `, #${p.transaction_id}` : ''})`
      ).join('\n');
      pmtDetails = isRu
        ? `\nИстория платежей:\n${pmtLines}`
        : isId
        ? `\nRiwayat pembayaran:\n${pmtLines}`
        : `\nPayment breakdown:\n${pmtLines}`;
    }

    if (isRu) {
      return `Поставщику «${matchedCp.name}» (долг: ${origStr}) оплачено ${paidStr}. Текущий остаток долга: ${remStr}. Статус: ${statusStr}.${pmtDetails}`;
    } else if (isId) {
      return `Kepada pemasok "${matchedCp.name}" (total tagihan: ${origStr}) telah dibayar ${paidStr}. Sisa tagihan saat ini: ${remStr}. Status: ${statusStr}.${pmtDetails}`;
    } else {
      return `Vendor "${matchedCp.name}" (original debt: ${origStr}): total paid ${paidStr}, remaining debt ${remStr}, status: ${statusStr}.${pmtDetails}`;
    }
  } else if (/перевод|transfer|pindah/i.test(qLower)) {
    return isRu
      ? 'Внутренние переводы между счетами и кошельками компании являются нейтральными перемещениями ликвидности и не признаются доходом (выручкой) или операционным расходом бизнеса.'
      : isId
      ? 'Transfer internal antar dompet perusahaan adalah pergerakan likuiditas netral dan bukan pendapatan maupun beban operasional bisnis.'
      : 'Internal transfers between company wallets are neutral liquidity movements, not business revenue or operating expenses.';
  } else if (/кошел|wallet|баланс|balance/i.test(qLower) && walletsWithBalance.length > 0) {
    const wList = walletsWithBalance.map(w => `${w.name}: ${fmt(w.balance, w.currency)}`).join(', ');
    return isRu
      ? `Текущие балансы кошельков: ${wList}.`
      : isId
      ? `Saldo dompet saat ini: ${wList}.`
      : `Current wallet balances: ${wList}.`;
  } else if (/поставщик|vendor|клиент|client|supplier/i.test(qLower)) {
    return isRu
      ? 'По указанному контрагенту в активной компании записей не найдено. Проверьте правильность названия или переключитесь на нужную компанию.'
      : isId
      ? 'Tidak ada data untuk pihak terkait yang dicari di perusahaan aktif. Periksa nama atau beralih ke perusahaan yang sesuai.'
      : 'No records found for the specified counterparty in the active company. Please check the name or switch to the correct company.';
  } else {
    // Determine whether this is a company-specific determination question vs a general knowledge explanation
    const isCompanySpecificTaxQuestion = /наш|сво|моей|налог.*компани|обязанност.*компани|должн.*платить|применяется ли к нам|применяется ли к компани|сколько.*нам.*платить|our company|we owe|must we pay|does our business|our tax obligations|perusahaan kami|apakah kami/i.test(qLower);

    // Check if the question is asking about a known tax knowledge card (e.g. PPh 26, PPh 21, etc.)
    let matchedTopic = null;
    if (/\bpph\s*26\b/i.test(qLower)) matchedTopic = 'pph26';
    else if (/\bpph\s*21\b/i.test(qLower)) matchedTopic = 'pph21';
    else if (/\bpph\s*23\b/i.test(qLower)) matchedTopic = 'pph23';
    else if (/\bpph\s*(?:final|sewa)\b/i.test(qLower)) matchedTopic = 'pph_final_rent';
    else if (/\bpph\s*25\b/i.test(qLower)) matchedTopic = 'pph25';
    else if (/\bpph\s*29\b/i.test(qLower)) matchedTopic = 'pph29';
    else if (/\bppn\b/i.test(qLower)) matchedTopic = 'ppn';
    else if (/\bpkp\b/i.test(qLower)) matchedTopic = 'pkp';
    else if (/\b(?:npwp|nik)\b/i.test(qLower)) matchedTopic = 'npwp_nik';

    // If it's a company-specific tax question, do NOT substitute with a generic card explanation.
    // Instead, state explicitly whether verified rules apply to the active company or state blockers/limitations.
    if (isCompanySpecificTaxQuestion) {
      const applicableRules = taxData.applicable_rules || [];
      const overdue = taxData.overdue || [];
      const missing = taxData.missing_profile_fields || [];
      const relevantRule = matchedTopic
        ? applicableRules.find(r => r.rule_code?.toLowerCase().includes(matchedTopic.replace(/_/g, '')) || r.title?.toLowerCase().includes(matchedTopic.replace(/_/g, ' ')))
        : null;

      if (relevantRule) {
        return isRu
          ? `Для активной компании действует подтверждённое правило: ${relevantRule.title} (${relevantRule.rule_code} v${relevantRule.version}). Расчёт точной суммы и применимости требует подтверждения лицензированным бухгалтером.`
          : isId
          ? `Untuk perusahaan aktif berlaku aturan terkonfirmasi: ${relevantRule.title} (${relevantRule.rule_code} v${relevantRule.version}). Perhitungan jumlah pasti memerlukan konfirmasi akuntan berlisensi.`
          : `For the active company, confirmed rule applies: ${relevantRule.title} (${relevantRule.rule_code} v${relevantRule.version}). Exact calculation and applicability must be confirmed by a licensed accountant.`;
      }

      if (matchedTopic) {
        return isRu
          ? `Обязанности компании по ${matchedTopic.toUpperCase()} пока не подтверждены. Требуется уточнить налоговый период и провести проверку актуальности правил с лицензированным бухгалтером.${missing.length ? ` Незаполненные поля профиля: ${missing.join(', ')}.` : ''}`
          : isId
          ? `Kewajiban perusahaan untuk ${matchedTopic.toUpperCase()} belum terkonfirmasi. Perlu menentukan periode pajak dan memverifikasi keberlakuan peraturan bersama akuntan berlisensi.${missing.length ? ` Kolom profil yang belum diisi: ${missing.join(', ')}.` : ''}`
          : `Company obligations for ${matchedTopic.toUpperCase()} are not yet confirmed. You need to specify the tax period and verify the currency of rules with a licensed professional.${missing.length ? ` Missing profile fields: ${missing.join(', ')}.` : ''}`;
      }

      return applicableRules.length
        ? `Applicable obligations: ${applicableRules.map(r => `${r.title} (${r.rule_code} v${r.version})`).join('; ')}. ${overdue.length ? `${overdue.length} overdue. ` : ''}Confirm with a licensed professional.`
        : `No active verified tax rules apply yet${missing.length ? ` — missing profile fields: ${missing.join(', ')}` : ''}. Determination not possible.`;
    }

    if (matchedTopic) {
      try {
        const { getCard } = require('./indonesiaTaxKnowledgeCards.cjs');
        const lang = isRu ? 'ru' : isId ? 'id' : 'en';
        const card = getCard({ topic_id: matchedTopic, language: lang });
        if (card) {
          const what = (card.what_is || []).map(s => s.text).join(' ');
          const how = (card.how_it_works || []).map(s => s.text).join(' ');
          const cond = (card.main_condition || []).map(s => s.text).join(' ');
          const sources = formatHumanSources(card, lang);
          const unconfirmed = formatUnconfirmedSection({ card, language: lang });

          const parts = [
            `**${card.name}**`,
            what,
            how,
            cond,
          ].filter(Boolean);

          if (sources) {
            const srcLabel = isRu ? 'Источники' : isId ? 'Sumber' : 'Sources';
            parts.push(`${srcLabel}: ${sources}`);
          }
          if (unconfirmed?.text) {
            parts.push(unconfirmed.text);
          }
          return parts.join('\n\n');
        }
      } catch (cardErr) {
        // Fall through to general tax summary
      }
    }

    const applicableRules = taxData.applicable_rules || [];
    const overdue = taxData.overdue || [];
    const missing = taxData.missing_profile_fields || [];
    return applicableRules.length
      ? `Applicable obligations: ${applicableRules.map(r => `${r.title} (${r.rule_code} v${r.version})`).join('; ')}. ${overdue.length ? `${overdue.length} overdue. ` : ''}Confirm with a licensed professional.`
      : `No active verified tax rules apply yet${missing.length ? ` — missing profile fields: ${missing.join(', ')}` : ''}. Determination not possible.`;
  }
}

module.exports = {
  buildAccountantCompanyFacts,
  buildAccountantPrompt,
  generateDeterministicFallbackAnswer,
  formatHumanSources,
  formatUnconfirmedSection,
  getBlockerReasons,
  BLOCKER_EXPLANATIONS,
  UNKNOWN_BLOCKER_FALLBACK,
};
