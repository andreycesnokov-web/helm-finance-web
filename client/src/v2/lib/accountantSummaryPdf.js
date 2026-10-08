// Accountant Month Close Summary PDF Generator
// Generates accountant-summary.pdf for the export package
// Pure and isomorphic: runs in both Vite/browser and Node environments.
import pdfMake from 'pdfmake/build/pdfmake.js'
import pdfFonts from 'pdfmake/build/vfs_fonts.js'

const pm = pdfMake.default || pdfMake
const pf = pdfFonts.default || pdfFonts
if (typeof pm.addVirtualFileSystem === 'function') {
  pm.addVirtualFileSystem(pf)
} else {
  pm.vfs = pf?.pdfMake ? pf.pdfMake.vfs : pf
}

const I18N = {
  ru: {
    title: 'Сводный отчёт закрытия месяца',
    subTitle: (m) => `Отчётный период: ${m}`,
    noticeTitle: 'Внимание: Пакет подготовлен для проверки бухгалтером',
    noticeBody: 'Финансовый и налоговый период НЕ считается закрытым без явного подтверждения и аудита бухгалтера. Настоящий отчёт и архив подготовлены для проведения сверки.',
    secOverview: '1. Общие сведения и статус месяца',
    secChecks: '2. Результаты проверок закрытия месяца',
    secUnlinked: '3. Несверенные банковские операции',
    secDiscrepancies: '4. Расхождения и ограничения',
    secRegistry: '5. Реестр файлов пакета',
    lblCompany: 'Компания:',
    lblBusinessId: 'ID компании:',
    lblMonth: 'Отчётный месяц:',
    lblGeneratedAt: 'Время формирования:',
    lblStatus: 'Статус готовности:',
    lblReadiness: 'Полнота записей:',
    lblClosed: 'Статус закрытия:',
    lblFilesAvailable: 'Доступность файлов:',
    lblReconStatus: 'Статус сверки банка:',
    statusReady: 'Готов к проверке бухгалтером (все автоматические проверки пройдены)',
    statusReconRequired: 'Требуется сверка (полнота записей 100%, сверка не завершена)',
    statusInProgress: 'В процессе подготовки (требуется доработка сверок/документов)',
    statusNeedsAttention: 'Требует внимания',
    closedNo: 'НЕ ЗАКРЫТ (ожидает проверки бухгалтера)',
    closedYes: 'ЗАКРЫТ (подтверждено бухгалтером)',
    filesAll: 'Все оригиналы файлов включены в архив',
    filesMissing: 'Обнаружены недоступные оригиналы (см. раздел 4)',
    reconBalanced: 'Сверено (все счета и выписки согласованы)',
    reconUnreconciled: 'Не сверено (есть расхождения или несопоставленные операции)',
    reconNone: 'Банковские счета не привязаны',
    checkName: 'Проверка',
    checkResult: 'Результат',
    checkState: 'Статус',
    chkStatements: 'Банковские выписки',
    chkStatementsVal: (up, tot) => `${up} из ${tot} счетов с выписками`,
    chkReconciliation: 'Банковская сверка',
    chkReconciliationVal: (rec, tot) => `${rec} из ${tot} счетов сверены`,
    chkBills: 'Счета и инвойсы с документами',
    chkBillsVal: (has, tot) => `${has} из ${tot} счетов с оригиналом`,
    chkCategories: 'Операции с категорией',
    chkCategoriesVal: (has, tot) => `${has} из ${tot} операций категоризированы`,
    chkSignoff: 'Проверка бухгалтера',
    chkSignoffVal: 'Ожидает проверки бухгалтера',
    stateDone: 'Пройдено',
    statePending: 'Не готово',
    stateWaiting: 'Ожидает',
    colId: 'ID',
    colDate: 'Дата',
    colAmount: 'Сумма',
    colType: 'Тип',
    colDesc: 'Описание / Назначение платежа',
    colWallet: 'Счёт компании',
    walletUnknown: 'Счёт не указан',
    typeIncome: 'Приход',
    typeExpense: 'Расход',
    typeOpening: 'Начальный остаток',
    typeTransfer: 'Перевод',
    noUnlinked: 'Несверенные банковские операции отсутствуют. Все операции периода сопоставлены со строками выписок.',
    unlinkedCount: (n) => `Обнаружено несверенных банковских операций: ${n}. Данные операции отражены в учёте, но отсутствуют в подтверждённых выписках:`,
    missingStatementsTitle: 'Отсутствующие банковские выписки:',
    unreconciledStatementsTitle: 'Несверенные банковские счета:',
    billsWithoutDocsTitle: 'Счета и инвойсы без подтверждающих документов:',
    unavailableFilesTitle: 'Недоступные оригиналы файлов (не удалось выгрузить из хранилища):',
    limitationsTitle: 'Ограничения и системные предупреждения:',
    noDiscrepancies: 'Расхождений и замечаний не зафиксировано.',
    colFileName: 'Файл / Путь в архиве',
    colFileType: 'Назначение',
    colFileStatus: 'Статус в пакете',
    typeReport: 'Сводный PDF-отчёт',
    typeSummary: 'Машиночитаемый JSON-отчёт',
    typeDiscrepancies: 'Реестр расхождений JSON',
    typeRegistry: 'Реестр операций JSON',
    typeDoc: 'Финансовый документ / оригинал',
    typeReadme: 'Инструкция к архиву',
    statusIncluded: 'Приложен в ZIP',
    statusMissing: 'Недоступен',
    footerBrand: 'Helm Finance OS · Бухгалтерский пакет документов',
    footerPage: (cur, tot) => `Страница ${cur} из ${tot}`,
  },
  en: {
    title: 'Month Close Summary Report',
    subTitle: (m) => `Reporting Period: ${m}`,
    noticeTitle: 'Notice: Package Prepared for Accountant Review',
    noticeBody: 'The financial and tax period is NOT closed until formal accountant review and sign-off. This summary report and package are prepared for auditing and reconciliation.',
    secOverview: '1. Overview & Month Status',
    secChecks: '2. Month Close Verification Checks',
    secUnlinked: '3. Unreconciled Bank Transactions',
    secDiscrepancies: '4. Discrepancies & Limitations',
    secRegistry: '5. Package Files Registry',
    lblCompany: 'Company:',
    lblBusinessId: 'Business ID:',
    lblMonth: 'Reporting Month:',
    lblGeneratedAt: 'Generated At:',
    lblStatus: 'Readiness Status:',
    lblReadiness: 'Record Completeness:',
    lblClosed: 'Month Closed State:',
    lblFilesAvailable: 'Originals Availability:',
    lblReconStatus: 'Bank Reconciliation:',
    statusReady: 'Ready for accountant review (all automated checks passed)',
    statusReconRequired: 'Reconciliation required (100% record completeness, reconciliation pending)',
    statusInProgress: 'In progress (reconciliations or documents required)',
    statusNeedsAttention: 'Needs attention',
    closedNo: 'NOT CLOSED (awaiting accountant verification)',
    closedYes: 'CLOSED (verified by accountant)',
    filesAll: 'All original files are attached in the archive',
    filesMissing: 'Some original files are missing (see Section 4)',
    reconBalanced: 'Reconciled (all accounts and statements balanced)',
    reconUnreconciled: 'Unreconciled (discrepancies or unlinked items detected)',
    reconNone: 'No active bank accounts',
    checkName: 'Verification Check',
    checkResult: 'Result',
    checkState: 'State',
    chkStatements: 'Bank Statements',
    chkStatementsVal: (up, tot) => `${up} of ${tot} accounts with uploaded statements`,
    chkReconciliation: 'Bank Reconciliation',
    chkReconciliationVal: (rec, tot) => `${rec} of ${tot} accounts reconciled`,
    chkBills: 'Bills & Invoices with Documents',
    chkBillsVal: (has, tot) => `${has} of ${tot} bills with original document`,
    chkCategories: 'Categorized Transactions',
    chkCategoriesVal: (has, tot) => `${has} of ${tot} transactions categorized`,
    chkSignoff: 'Accountant Sign-off',
    chkSignoffVal: 'Awaiting accountant review',
    stateDone: 'Passed',
    statePending: 'Incomplete',
    stateWaiting: 'Pending',
    colId: 'ID',
    colDate: 'Date',
    colAmount: 'Amount',
    colType: 'Type',
    colDesc: 'Description / Purpose',
    colWallet: 'Company Account',
    walletUnknown: 'Account not specified',
    typeIncome: 'Income',
    typeExpense: 'Expense',
    typeOpening: 'Opening balance',
    typeTransfer: 'Transfer',
    noUnlinked: 'No unreconciled bank transactions. All ledger transactions in this period are linked to bank statement rows.',
    unlinkedCount: (n) => `Found ${n} unreconciled bank transactions not present in bank statements:`,
    missingStatementsTitle: 'Missing Bank Statements:',
    unreconciledStatementsTitle: 'Unreconciled Bank Accounts:',
    billsWithoutDocsTitle: 'Bills Without Original Documents:',
    unavailableFilesTitle: 'Unavailable Original Files (storage fetch error):',
    limitationsTitle: 'Limitations & System Warnings:',
    noDiscrepancies: 'No discrepancies or warnings recorded.',
    colFileName: 'File / Archive Path',
    colFileType: 'Purpose',
    colFileStatus: 'Package Status',
    typeReport: 'Summary PDF Report',
    typeSummary: 'Machine-readable Summary JSON',
    typeDiscrepancies: 'Discrepancies Registry JSON',
    typeRegistry: 'Records Registry JSON',
    typeDoc: 'Original Financial Document',
    typeReadme: 'Archive Readme',
    statusIncluded: 'Included in ZIP',
    statusMissing: 'Unavailable',
    footerBrand: 'Helm Finance OS · Accountant Package',
    footerPage: (cur, tot) => `Page ${cur} of ${tot}`,
  },
  id: {
    title: 'Laporan Ringkasan Tutup Buku Bulanan',
    subTitle: (m) => `Periode Laporan: ${m}`,
    noticeTitle: 'Perhatian: Paket Disiapkan untuk Peninjauan Akuntan',
    noticeBody: 'Periode keuangan dan pajak BELUM ditutup sebelum verifikasi dan persetujuan resmi akuntan. Laporan ringkasan dan arsip ini disiapkan untuk audit dan rekonsiliasi.',
    secOverview: '1. Ringkasan & Status Bulan',
    secChecks: '2. Hasil Pemeriksaan Tutup Buku',
    secUnlinked: '3. Transaksi Bank Belum Terekonsiliasi',
    secDiscrepancies: '4. Ketidaksesuaian & Batasan',
    secRegistry: '5. Registri Berkas Paket',
    lblCompany: 'Perusahaan:',
    lblBusinessId: 'ID Perusahaan:',
    lblMonth: 'Bulan Laporan:',
    lblGeneratedAt: 'Waktu Dibuat:',
    lblStatus: 'Status Kesiapan:',
    lblReadiness: 'Kelengkapan Catatan:',
    lblClosed: 'Status Tutup Buku:',
    lblFilesAvailable: 'Ketersediaan Berkas Asli:',
    lblReconStatus: 'Status Rekonsiliasi Bank:',
    statusReady: 'Siap untuk peninjauan akuntan (semua pemeriksaan otomatis lolos)',
    statusReconRequired: 'Rekonsiliasi diperlukan (kelengkapan catatan 100%, rekonsiliasi belum selesai)',
    statusInProgress: 'Sedang berlangsung (rekonsiliasi atau dokumen diperlukan)',
    statusNeedsAttention: 'Perlu perhatian',
    closedNo: 'BELUM DITUTUP (menunggu verifikasi akuntan)',
    closedYes: 'DITUTUP (dikonfirmasi oleh akuntan)',
    filesAll: 'Semua berkas asli terlampir dalam arsip',
    filesMissing: 'Beberapa berkas asli tidak tersedia (lihat Bagian 4)',
    reconBalanced: 'Terekonsiliasi (semua rekening dan mutasi seimbang)',
    reconUnreconciled: 'Belum rekonsiliasi (ada selisih atau transaksi tak terhubung)',
    reconNone: 'Tidak ada rekening bank aktif',
    checkName: 'Pemeriksaan',
    checkResult: 'Hasil',
    checkState: 'Status',
    chkStatements: 'Rekening Koran Bank',
    chkStatementsVal: (up, tot) => `${up} dari ${tot} rekening memiliki rekening koran`,
    chkReconciliation: 'Rekonsiliasi Bank',
    chkReconciliationVal: (rec, tot) => `${rec} dari ${tot} rekening terekonsiliasi`,
    chkBills: 'Tagihan & Faktur dengan Dokumen',
    chkBillsVal: (has, tot) => `${has} dari ${tot} tagihan dengan dokumen asli`,
    chkCategories: 'Transaksi Berkategori',
    chkCategoriesVal: (has, tot) => `${has} dari ${tot} transaksi berkategori`,
    chkSignoff: 'Persetujuan Akuntan',
    chkSignoffVal: 'Menunggu peninjauan akuntan',
    stateDone: 'Lolos',
    statePending: 'Belum Selesai',
    stateWaiting: 'Menunggu',
    colId: 'ID',
    colDate: 'Tanggal',
    colAmount: 'Jumlah',
    colType: 'Jenis',
    colDesc: 'Keterangan',
    colWallet: 'Rekening Perusahaan',
    walletUnknown: 'Rekening tidak ditentukan',
    typeIncome: 'Pemasukan',
    typeExpense: 'Pengeluaran',
    typeOpening: 'Saldo awal',
    typeTransfer: 'Transfer',
    noUnlinked: 'Tidak ada transaksi bank yang belum terekonsiliasi. Semua transaksi terhubung dengan rekening koran.',
    unlinkedCount: (n) => `Ditemukan ${n} transaksi belum terekonsiliasi di luar rekening koran:`,
    missingStatementsTitle: 'Rekening Koran Hilang:',
    unreconciledStatementsTitle: 'Rekening Bank Belum Rekonsiliasi:',
    billsWithoutDocsTitle: 'Tagihan Tanpa Dokumen Asli:',
    unavailableFilesTitle: 'Berkas Asli Tidak Tersedia:',
    limitationsTitle: 'Batasan & Catatan Sistem:',
    noDiscrepancies: 'Tidak ada ketidaksesuaian atau peringatan yang tercatat.',
    colFileName: 'Berkas / Jalur Arsip',
    colFileType: 'Tujuan',
    colFileStatus: 'Status Paket',
    typeReport: 'Laporan Ringkasan PDF',
    typeSummary: 'Ringkasan JSON Mesin',
    typeDiscrepancies: 'Registri Ketidaksesuaian JSON',
    typeRegistry: 'Registri Catatan JSON',
    typeDoc: 'Dokumen Keuangan Asli',
    typeReadme: 'Petunjuk Arsip',
    statusIncluded: 'Terlampir dalam ZIP',
    statusMissing: 'Tidak Tersedia',
    footerBrand: 'Helm Finance OS · Paket Akuntan',
    footerPage: (cur, tot) => `Halaman ${cur} dari ${tot}`,
  },
}

function formatMoney(amount, currency = 'IDR') {
  const num = Number(amount || 0)
  const formatted = Math.abs(num).toLocaleString('ru-RU')
  const sign = num < 0 ? '-' : num > 0 ? '+' : ''
  return `${sign}${formatted} ${currency}`
}

/**
 * Builds and returns a Uint8Array containing accountant-summary.pdf.
 * Formatted from the exact snapshot of summary.json and discrepancies.json.
 */
export async function generateAccountantSummaryPdf({
  summary,
  discrepancies,
  recordsRegistry = [],
  attachedFiles = [],
  wallets = [],
  lang = 'ru',
}) {
  const t = I18N[lang] || I18N.ru
  const readiness = summary?.readiness || {}
  const bankAccounts = summary?.bank_accounts || {}
  const rawLimitations = summary?.limitations || discrepancies?.limitations || []
  const unlinkedTx = discrepancies?.unlinked_transactions || readiness?.unlinked_transactions || []
  const missingStatements = discrepancies?.missing_bank_statements || []
  const unreconciledStatements = discrepancies?.unreconciled_bank_statements || []
  const billsWithoutDocs = discrepancies?.bills_without_documents || []
  const unavailableFiles = discrepancies?.unavailable_files || []

  // Build wallet lookup map from current company data
  const walletMap = new Map()
  if (Array.isArray(wallets)) {
    for (const w of wallets) {
      if (!w) continue
      const name = w.name || w.account_name || w.wallet_name || ''
      if (w.id != null) walletMap.set(String(w.id), name)
      if (w.account_number != null) walletMap.set(String(w.account_number), name)
    }
  }

  // Type localization helper
  const formatType = (rawType) => {
    const k = String(rawType || '').toLowerCase()
    if (k === 'income') return t.typeIncome
    if (k === 'expense') return t.typeExpense
    if (k === 'opening' || k === 'opening_balance') return t.typeOpening
    if (k === 'transfer') return t.typeTransfer
    return rawType || '—'
  }

  // Limitations localization helper
  const localizeLimitation = (lim) => {
    const s = String(lim || '')
    if (s.startsWith('Month is not closed')) {
      return lang === 'ru'
        ? 'Месяц не закрыт: ожидает проверки и подтверждения бухгалтером.'
        : lang === 'id'
          ? 'Bulan belum ditutup: menunggu verifikasi dan persetujuan akuntan.'
          : 'Month is not closed: awaiting accountant sign-off and verification.'
    }
    const missingStmtMatch = s.match(/^Missing bank statements for:\s*(.*)$/)
    if (missingStmtMatch) {
      return lang === 'ru'
        ? `Отсутствуют банковские выписки для: ${missingStmtMatch[1]}`
        : lang === 'id'
          ? `Rekening koran hilang untuk: ${missingStmtMatch[1]}`
          : `Missing bank statements for: ${missingStmtMatch[1]}`
    }
    const unrecStmtMatch = s.match(/^Unreconciled bank statements for:\s*(.*)$/)
    if (unrecStmtMatch) {
      return lang === 'ru'
        ? `Несверенные банковские счета: ${unrecStmtMatch[1]}`
        : lang === 'id'
          ? `Rekening bank belum terekonsiliasi: ${unrecStmtMatch[1]}`
          : `Unreconciled bank statements for: ${unrecStmtMatch[1]}`
    }
    const unrecLedgerMatch = s.match(/^Unreconciled ledger transactions not present in bank statement:\s*(\d+)$/)
    if (unrecLedgerMatch) {
      return lang === 'ru'
        ? `Несверенных банковских операций, отсутствующих в выписке: ${unrecLedgerMatch[1]}`
        : lang === 'id'
          ? `Transaksi belum terekonsiliasi di luar rekening koran: ${unrecLedgerMatch[1]}`
          : `Unreconciled ledger transactions not present in bank statement: ${unrecLedgerMatch[1]}`
    }
    const missingBillsMatch = s.match(/^Bills without original documents:\s*(\d+)$/)
    if (missingBillsMatch) {
      return lang === 'ru'
        ? `Счетов без подтверждающих документов: ${missingBillsMatch[1]}`
        : lang === 'id'
          ? `Tagihan tanpa dokumen asli: ${missingBillsMatch[1]}`
          : `Bills without original documents: ${missingBillsMatch[1]}`
    }
    const missingCatsMatch = s.match(/^Transactions without category:\s*(\d+)$/)
    if (missingCatsMatch) {
      return lang === 'ru'
        ? `Операций без категории: ${missingCatsMatch[1]}`
        : lang === 'id'
          ? `Transaksi tanpa kategori: ${missingCatsMatch[1]}`
          : `Transactions without category: ${missingCatsMatch[1]}`
    }
    return s
  }

  const limitations = rawLimitations.map(localizeLimitation)

  // Month readiness status label
  const checksList = readiness?.checks || []
  const stmtCheck = checksList.find((c) => c.key === 'statements')
  const reconCheck = checksList.find((c) => c.key === 'reconciliation')
  const bankReconPending = (reconCheck && !reconCheck.done) || (stmtCheck && !stmtCheck.done)

  const isReady = readiness.status === 'ready_for_review' || readiness.status === 'prepared_for_review' || readiness.automated_checks_passed === true
  const statusLabel = isReady
    ? t.statusReady
    : (readiness.percent === 100 && bankReconPending)
      ? t.statusReconRequired
      : readiness.status === 'needs_attention'
        ? t.statusNeedsAttention
        : t.statusInProgress

  // Bank reconciliation status label
  const reconStatus = readiness.bank_reconciliation_status === 'reconciled'
    ? t.reconBalanced
    : readiness.bank_reconciliation_status === 'unreconciled'
      ? t.reconUnreconciled
      : t.reconNone

  const billCheck = checksList.find((c) => c.key === 'bills')
  const catCheck = checksList.find((c) => c.key === 'categories')

  // Checks table rows
  const checksRows = [
    [
      { text: t.checkName, bold: true, fillColor: '#f1f5f9' },
      { text: t.checkResult, bold: true, fillColor: '#f1f5f9' },
      { text: t.checkState, bold: true, fillColor: '#f1f5f9', alignment: 'center' },
    ],
    [
      t.chkStatements,
      t.chkStatementsVal(stmtCheck?.ok ?? bankAccounts.statements_uploaded ?? 0, stmtCheck?.total ?? bankAccounts.total_banks ?? 0),
      {
        text: stmtCheck?.done ? t.stateDone : t.statePending,
        color: stmtCheck?.done ? '#166534' : '#991b1b',
        bold: true,
        alignment: 'center',
      },
    ],
    [
      t.chkReconciliation,
      t.chkReconciliationVal(reconCheck?.ok ?? bankAccounts.balances_reconciled ?? 0, reconCheck?.total ?? bankAccounts.total_banks ?? 0),
      {
        text: reconCheck?.done ? t.stateDone : t.statePending,
        color: reconCheck?.done ? '#166534' : '#991b1b',
        bold: true,
        alignment: 'center',
      },
    ],
    [
      t.chkBills,
      t.chkBillsVal(billCheck?.ok ?? 0, billCheck?.total ?? 0),
      {
        text: billCheck?.done ? t.stateDone : t.statePending,
        color: billCheck?.done ? '#166534' : '#991b1b',
        bold: true,
        alignment: 'center',
      },
    ],
    [
      t.chkCategories,
      t.chkCategoriesVal(catCheck?.ok ?? 0, catCheck?.total ?? 0),
      {
        text: catCheck?.done ? t.stateDone : t.statePending,
        color: catCheck?.done ? '#166534' : '#991b1b',
        bold: true,
        alignment: 'center',
      },
    ],
    [
      t.chkSignoff,
      t.chkSignoffVal,
      { text: t.stateWaiting, color: '#854d0e', bold: true, alignment: 'center' },
    ],
  ]

  // Unlinked transactions table body
  const unlinkedRows = [
    [
      { text: t.colId, bold: true, fillColor: '#f1f5f9' },
      { text: t.colDate, bold: true, fillColor: '#f1f5f9' },
      { text: t.colAmount, bold: true, fillColor: '#f1f5f9' },
      { text: t.colType, bold: true, fillColor: '#f1f5f9' },
      { text: t.colDesc, bold: true, fillColor: '#f1f5f9' },
      { text: t.colWallet, bold: true, fillColor: '#f1f5f9' },
    ],
  ]

  for (const row of unlinkedTx) {
    const rawNum = Number(row.amount || 0)
    const isExp = row.type === 'expense' || rawNum < 0
    const sign = isExp ? '-' : '+'
    const formattedAmount = `${sign}${Math.abs(rawNum).toLocaleString('ru-RU')} ${row.currency || 'IDR'}`

    // Resolve wallet name from current company data without technical IDs
    const resolvedWalletName = row.wallet_name || (row.wallet_id ? walletMap.get(String(row.wallet_id)) : null) || t.walletUnknown

    unlinkedRows.push([
      String(row.id ?? ''),
      String(row.date ?? ''),
      {
        text: formattedAmount,
        color: isExp ? '#991b1b' : '#166534',
        bold: true,
      },
      formatType(row.type),
      String(row.description ?? row.name ?? ''),
      resolvedWalletName,
    ])
  }

  // Attached files registry table
  const registryRows = [
    [
      { text: t.colFileName, bold: true, fillColor: '#f1f5f9' },
      { text: t.colFileType, bold: true, fillColor: '#f1f5f9' },
      { text: t.colFileStatus, bold: true, fillColor: '#f1f5f9', alignment: 'center' },
    ],
  ]

  // Default core files
  registryRows.push(['accountant-summary.pdf', t.typeReport, { text: t.statusIncluded, color: '#166534', bold: true, alignment: 'center' }])
  registryRows.push(['summary.json', t.typeSummary, { text: t.statusIncluded, color: '#166534', bold: true, alignment: 'center' }])
  registryRows.push(['discrepancies.json', t.typeDiscrepancies, { text: t.statusIncluded, color: '#166534', bold: true, alignment: 'center' }])
  registryRows.push(['records_registry.json', t.typeRegistry, { text: t.statusIncluded, color: '#166534', bold: true, alignment: 'center' }])

  for (const f of attachedFiles) {
    if (['accountant-summary.pdf', 'summary.json', 'discrepancies.json', 'records_registry.json'].includes(f.name)) continue
    registryRows.push([
      f.name,
      f.name.endsWith('.txt') ? t.typeReadme : t.typeDoc,
      { text: t.statusIncluded, color: '#166534', bold: true, alignment: 'center' },
    ])
  }

  for (const uf of unavailableFiles) {
    registryRows.push([
      uf.file_name || String(uf.document_id || uf.batch_id || 'document'),
      t.typeDoc,
      { text: t.statusMissing, color: '#991b1b', bold: true, alignment: 'center' },
    ])
  }

  const docDef = {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [36, 44, 36, 44],
    footer: function (currentPage, pageCount) {
      return {
        columns: [
          { text: `${t.footerBrand} · ${summary.month || ''} · ${summary.company?.name || ''}`, fontSize: 8, color: '#64748b' },
          { text: t.footerPage(currentPage, pageCount), alignment: 'right', fontSize: 8, color: '#64748b' },
        ],
        margin: [36, 12, 36, 0],
      }
    },
    content: [
      // Title
      { text: t.title, fontSize: 18, bold: true, color: '#0f172a', margin: [0, 0, 0, 2] },
      { text: t.subTitle(summary.month || ''), fontSize: 11, color: '#475569', margin: [0, 0, 0, 10] },

      // Notice Callout (Month not closed until accountant verification)
      {
        table: {
          widths: ['100%'],
          body: [
            [
              {
                fillColor: '#fffbeb',
                borderColor: ['#f59e0b', '#f59e0b', '#f59e0b', '#f59e0b'],
                margin: [8, 8, 8, 8],
                stack: [
                  { text: t.noticeTitle, bold: true, fontSize: 10, color: '#b45309', margin: [0, 0, 0, 3] },
                  { text: t.noticeBody, fontSize: 8.5, color: '#92400e', lineHeight: 1.25 },
                ],
              },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 1,
          vLineWidth: () => 1,
          hLineColor: () => '#f59e0b',
          vLineColor: () => '#f59e0b',
        },
        margin: [0, 0, 0, 14],
      },

      // Section 1: Overview
      { text: t.secOverview, fontSize: 12, bold: true, color: '#0f172a', margin: [0, 0, 0, 6] },
      {
        table: {
          widths: ['28%', '72%'],
          body: [
            [{ text: t.lblCompany, bold: true }, summary.company?.name || '—'],
            [{ text: t.lblBusinessId, bold: true }, summary.company?.business_id || '—'],
            [{ text: t.lblMonth, bold: true }, summary.month || '—'],
            [{ text: t.lblGeneratedAt, bold: true }, summary.generated_at || '—'],
            [{ text: t.lblStatus, bold: true }, { text: statusLabel, bold: true, color: isReady ? '#166534' : '#b45309' }],
            [{ text: t.lblReadiness, bold: true }, `${readiness.percent ?? 0}% (${readiness.complete_records ?? 0} / ${readiness.total_records ?? 0})`],
            [{ text: t.lblClosed, bold: true }, { text: readiness.is_closed ? t.closedYes : t.closedNo, bold: true, color: readiness.is_closed ? '#166534' : '#991b1b' }],
            [{ text: t.lblReconStatus, bold: true }, reconStatus],
            [{ text: t.lblFilesAvailable, bold: true }, summary.files_available ? t.filesAll : t.filesMissing],
          ],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 14],
      },

      // Section 2: Checks
      { text: t.secChecks, fontSize: 12, bold: true, color: '#0f172a', margin: [0, 0, 0, 6] },
      {
        table: {
          headerRows: 1,
          dontBreakRows: true,
          widths: ['40%', '40%', '20%'],
          body: checksRows,
        },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 14],
      },

      // Section 3: Unreconciled Transactions
      { text: t.secUnlinked, fontSize: 12, bold: true, color: '#0f172a', margin: [0, 0, 0, 6] },
      unlinkedTx.length === 0
        ? {
            text: t.noUnlinked,
            fontSize: 9,
            color: '#166534',
            margin: [0, 0, 0, 14],
          }
        : {
            stack: [
              {
                text: t.unlinkedCount(unlinkedTx.length),
                fontSize: 9,
                color: '#991b1b',
                bold: true,
                margin: [0, 0, 0, 6],
              },
              {
                table: {
                  headerRows: 1,
                  dontBreakRows: true,
                  widths: ['7%', '14%', '20%', '11%', '28%', '20%'],
                  body: unlinkedRows,
                },
                layout: 'lightHorizontalLines',
                margin: [0, 0, 0, 14],
              },
            ],
          },

      // Section 4: Discrepancies & Limitations
      { text: t.secDiscrepancies, fontSize: 12, bold: true, color: '#0f172a', margin: [0, 0, 0, 6] },
      {
        stack: [
          missingStatements.length > 0
            ? {
                stack: [
                  { text: t.missingStatementsTitle, bold: true, fontSize: 9, color: '#991b1b', margin: [0, 2, 0, 2] },
                  { ul: missingStatements.map((s) => ({ text: String(s), fontSize: 8.5, color: '#1e293b' })), margin: [0, 0, 0, 6] },
                ],
              }
            : null,
          unreconciledStatements.length > 0
            ? {
                stack: [
                  { text: t.unreconciledStatementsTitle, bold: true, fontSize: 9, color: '#991b1b', margin: [0, 2, 0, 2] },
                  { ul: unreconciledStatements.map((s) => ({ text: String(s), fontSize: 8.5, color: '#1e293b' })), margin: [0, 0, 0, 6] },
                ],
              }
            : null,
          billsWithoutDocs.length > 0
            ? {
                stack: [
                  { text: t.billsWithoutDocsTitle, bold: true, fontSize: 9, color: '#991b1b', margin: [0, 2, 0, 2] },
                  { ul: billsWithoutDocs.map((b) => ({ text: String(b), fontSize: 8.5, color: '#1e293b' })), margin: [0, 0, 0, 6] },
                ],
              }
            : null,
          unavailableFiles.length > 0
            ? {
                stack: [
                  { text: t.unavailableFilesTitle, bold: true, fontSize: 9, color: '#991b1b', margin: [0, 2, 0, 2] },
                  { ul: unavailableFiles.map((uf) => ({ text: `${uf.file_name || uf.document_id || uf.batch_id}: ${uf.reason || 'Not available'}`, fontSize: 8.5, color: '#1e293b' })), margin: [0, 0, 0, 6] },
                ],
              }
            : null,
          limitations.length > 0
            ? {
                stack: [
                  { text: t.limitationsTitle, bold: true, fontSize: 9, color: '#475569', margin: [0, 2, 0, 2] },
                  { ul: limitations.map((l) => ({ text: String(l), fontSize: 8.5, color: '#1e293b' })), margin: [0, 0, 0, 6] },
                ],
              }
            : null,
          (missingStatements.length === 0 && unreconciledStatements.length === 0 && billsWithoutDocs.length === 0 && unavailableFiles.length === 0 && limitations.length === 0)
            ? { text: t.noDiscrepancies, fontSize: 9, color: '#166534', margin: [0, 2, 0, 6] }
            : null,
        ].filter(Boolean),
        margin: [0, 0, 0, 14],
      },

      // Section 5: Attached Files Registry
      { text: t.secRegistry, fontSize: 12, bold: true, color: '#0f172a', margin: [0, 0, 0, 6] },
      {
        table: {
          headerRows: 1,
          dontBreakRows: true,
          widths: ['50%', '30%', '20%'],
          body: registryRows,
        },
        layout: 'lightHorizontalLines',
      },
    ],
    defaultStyle: {
      font: 'Roboto',
      fontSize: 9,
      lineHeight: 1.25,
      color: '#1e293b',
    },
  }

  const pdfDoc = pm.createPdf(docDef)
  const buf = await pdfDoc.getBuffer()
  return new Uint8Array(buf)
}
