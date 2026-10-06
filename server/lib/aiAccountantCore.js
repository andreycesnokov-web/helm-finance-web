// Core deterministic logic and prompt builder for AI Accountant (PR 132)
// Extracted so production routes and tests run the exact same implementation.

const WALLET_CASH_IN  = ['income', 'topup', 'funding', 'refund'];
const WALLET_CASH_OUT = ['expense', 'withdrawal', 'fee', 'payroll'];

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
      if (t.counterparty && t.counterparty.trim().toLowerCase() === dCounterparty) return true;
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
    date: (t.date || t.created_at || '').slice(0, 10),
    type: t.type,
    amount: Number(t.amount_original ?? t.amount_idr ?? 0),
    currency: (t.currency_original || 'IDR').toUpperCase(),
    counterparty: t.counterparty || '',
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
  return `You are the Helm Finance AI Accountant for business "${business?.name || 'Company'}". Answer in ${language === 'ru' ? 'Russian' : language === 'id' ? 'Indonesian' : 'English'}.

STRICT RULES:
- Use ONLY the deterministic facts below. NEVER invent a tax rate, deadline, filing frequency, threshold, legal interpretation, or financial figure.
- For company financial questions (wallets, balances, debts, payables, receivables, counterparties, vendor payments, transactions): use the data in "facts.company". Report exact numbers, currencies, paid amounts, remaining amounts, and settlement statuses from "counterparties", "debts", or "wallets".
- Internal transfers between business wallets are neutral liquidity movements, NEVER business revenue/income or operating expense.
- When describing a counterparty's debt history, report the original debt amount, each payment made (amount, date, transaction id link), remaining debt, and settlement status.
- For tax compliance and legal obligations: cite rule_code, version, and official source title from "applicable_rules". If the facts do not contain an active rule needed to answer, say the determination is not possible yet and state what is missing.
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
};
