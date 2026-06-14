import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from '../hooks/useTranslation'
import { apiFetch, fmt } from '../lib/api'
import { getLang } from '../i18n/index'

const L = {
  en: { title: 'Bank import', subtitle: 'Import a CSV/XLSX statement — review, then create transactions',
    upload: 'Upload statement (CSV / XLSX)', wallet: 'Target account', map: 'Map columns', date: 'Date', amount: 'Amount',
    desc: 'Description', direction: 'Direction (optional)', ref: 'Reference (optional)', preview: 'Preview & review',
    debit: 'Debit column (optional)', credit: 'Credit column (optional)', dcHint: 'If the statement has separate Debit/Credit columns, map both — Amount is then ignored.',
    opening: 'Opening balance (optional)', closing: 'Closing balance (optional)', parse: 'Parse file', back: 'Back',
    rows: 'rows', duplicates: 'duplicates', toImport: 'to import', confirmImport: 'Confirm import', imported: 'Imported',
    category: 'Category', type: 'Type', income: 'Income', expense: 'Expense', dup: 'Duplicate', include: 'Include', reconciled: 'Reconciliation',
    balanced: 'Balanced', unbalanced: 'Unbalanced', difference: 'Difference', noWallet: 'Select a target account first.',
    history: 'Recent imports', createTx: 'Will create transactions for included rows only.',
    suggesting: 'Analyzing with rules + AI…', confidence: 'Confidence', match: 'Match', suggestion: 'AI suggestion',
    aiDisclaimer: 'AI only recommends. The final choice remains with your business.',
    noMatchingCategory: 'No matching business category found. Leave uncategorized or create a new category.',
    fAll: 'All', fHigh: 'High confidence', fNeeds: 'Needs review', fMatched: 'Matched', fDup: 'Possible duplicates', fUncat: 'Uncategorized', fTransfer: 'Transfers',
    confirmSelected: 'Confirm selected', confirmHigh: 'Confirm high-confidence', exclude: 'Exclude', markPersonal: 'Mark personal',
    createNewCategory: '+ New category', uncategorized: 'Uncategorized', high: 'High', medium: 'Medium', low: 'Low',
    matchedExisting: 'Matched existing', possibleTransfer: 'Possible transfer', linkedPayable: 'Possible payable', linkedReceivable: 'Possible receivable', possiblePayroll: 'Possible payroll',
    runSuggest: 'Re-run suggestions', total: 'total', selected: 'selected' },
  ru: { title: 'Импорт из банка', subtitle: 'Загрузи выписку CSV/XLSX — проверь, затем создадим транзакции',
    upload: 'Загрузить выписку (CSV / XLSX)', wallet: 'Счёт назначения', map: 'Сопоставь колонки', date: 'Дата', amount: 'Сумма',
    desc: 'Описание', direction: 'Направление (необязательно)', ref: 'Референс (необязательно)', preview: 'Превью и проверка',
    debit: 'Колонка Debit (необязательно)', credit: 'Колонка Credit (необязательно)', dcHint: 'Если в выписке отдельные колонки Debit/Credit — укажи обе, тогда «Сумма» игнорируется.',
    opening: 'Входящий остаток (необязательно)', closing: 'Исходящий остаток (необязательно)', parse: 'Разобрать файл', back: 'Назад',
    rows: 'строк', duplicates: 'дубликатов', toImport: 'к импорту', confirmImport: 'Подтвердить импорт', imported: 'Импортировано',
    category: 'Категория', type: 'Тип', income: 'Доход', expense: 'Расход', dup: 'Дубликат', include: 'Включить', reconciled: 'Сверка',
    balanced: 'Сходится', unbalanced: 'Не сходится', difference: 'Разница', noWallet: 'Сначала выбери счёт назначения.',
    history: 'Последние импорты', createTx: 'Транзакции создаются только для включённых строк.',
    suggesting: 'Анализ правилами + AI…', confidence: 'Уверенность', match: 'Совпадение', suggestion: 'Подсказка AI',
    aiDisclaimer: 'AI только рекомендует. Финальный выбор остаётся за вашим бизнесом.',
    noMatchingCategory: 'Подходящей категории не найдено. Оставь без категории или создай новую.',
    fAll: 'Все', fHigh: 'Высокая уверенность', fNeeds: 'Нужна проверка', fMatched: 'Совпадения', fDup: 'Возможные дубли', fUncat: 'Без категории', fTransfer: 'Переводы',
    confirmSelected: 'Подтвердить выбранные', confirmHigh: 'Подтвердить высокую уверенность', exclude: 'Исключить', markPersonal: 'Личное',
    createNewCategory: '+ Новая категория', uncategorized: 'Без категории', high: 'Высокая', medium: 'Средняя', low: 'Низкая',
    matchedExisting: 'Уже в учёте', possibleTransfer: 'Возможно перевод', linkedPayable: 'Возможно оплата долга', linkedReceivable: 'Возможно поступление', possiblePayroll: 'Возможно зарплата',
    runSuggest: 'Пересчитать подсказки', total: 'всего', selected: 'выбрано' },
  id: { title: 'Impor bank', subtitle: 'Impor rekening koran CSV/XLSX — tinjau, lalu buat transaksi',
    upload: 'Unggah rekening (CSV / XLSX)', wallet: 'Akun tujuan', map: 'Petakan kolom', date: 'Tanggal', amount: 'Jumlah',
    desc: 'Deskripsi', direction: 'Arah (opsional)', ref: 'Referensi (opsional)', preview: 'Pratinjau & tinjau',
    debit: 'Kolom Debit (opsional)', credit: 'Kolom Credit (opsional)', dcHint: 'Jika rekening punya kolom Debit/Credit terpisah, petakan keduanya — Jumlah diabaikan.',
    opening: 'Saldo awal (opsional)', closing: 'Saldo akhir (opsional)', parse: 'Urai file', back: 'Kembali',
    rows: 'baris', duplicates: 'duplikat', toImport: 'akan diimpor', confirmImport: 'Konfirmasi impor', imported: 'Terimpor',
    category: 'Kategori', type: 'Tipe', income: 'Pemasukan', expense: 'Pengeluaran', dup: 'Duplikat', include: 'Sertakan', reconciled: 'Rekonsiliasi',
    balanced: 'Seimbang', unbalanced: 'Tidak seimbang', difference: 'Selisih', noWallet: 'Pilih akun tujuan dulu.',
    history: 'Impor terbaru', createTx: 'Transaksi hanya dibuat untuk baris yang disertakan.',
    suggesting: 'Menganalisis dengan aturan + AI…', confidence: 'Keyakinan', match: 'Kecocokan', suggestion: 'Saran AI',
    aiDisclaimer: 'AI hanya memberikan rekomendasi. Pilihan akhir tetap berada pada bisnis Anda.',
    noMatchingCategory: 'Tidak ada kategori bisnis yang cocok. Biarkan tanpa kategori atau buat baru.',
    fAll: 'Semua', fHigh: 'Keyakinan tinggi', fNeeds: 'Perlu ditinjau', fMatched: 'Cocok', fDup: 'Kemungkinan duplikat', fUncat: 'Tanpa kategori', fTransfer: 'Transfer',
    confirmSelected: 'Konfirmasi terpilih', confirmHigh: 'Konfirmasi keyakinan tinggi', exclude: 'Kecualikan', markPersonal: 'Pribadi',
    createNewCategory: '+ Kategori baru', uncategorized: 'Tanpa kategori', high: 'Tinggi', medium: 'Sedang', low: 'Rendah',
    matchedExisting: 'Sudah tercatat', possibleTransfer: 'Mungkin transfer', linkedPayable: 'Mungkin bayar utang', linkedReceivable: 'Mungkin penerimaan', possiblePayroll: 'Mungkin gaji',
    runSuggest: 'Hitung ulang saran', total: 'total', selected: 'terpilih' },
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  let s = String(v).replace(/[^\d.,-]/g, '')
  if (!s) return null
  // Disambiguate thousands vs decimal separator: the LAST separator is the decimal.
  // "2,426,050.00" → 2426050  |  "1.000.000,00" → 1000000  |  "700,000" → 700000
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',')
  if (lastDot > -1 && lastComma > -1) {
    if (lastDot > lastComma) s = s.replace(/,/g, '')            // dot is decimal
    else s = s.replace(/\./g, '').replace(',', '.')             // comma is decimal
  } else if (lastComma > -1) {
    // only commas: decimal if a single comma with 1-2 trailing digits, else thousands
    s = (s.indexOf(',') === lastComma && /,\d{1,2}$/.test(s)) ? s.replace(',', '.') : s.replace(/,/g, '')
  } else if (lastDot > -1) {
    // only dots: decimal if a single dot with 1-2 trailing digits, else thousands
    s = (s.indexOf('.') === lastDot && /\.\d{1,2}$/.test(s)) ? s : s.replace(/\./g, '')
  }
  const n = Number(s); return isFinite(n) ? n : null
}
const toISO = (v) => {
  if (!v) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/); if (m) { const y = m[3].length===2?'20'+m[3]:m[3]; return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` }
  const d = new Date(s); return isNaN(d) ? null : d.toISOString().slice(0, 10)
}

export default function BankImport() {
  const { token } = useAuth()
  const { t } = useTranslation()
  const lang = ['ru','id'].includes(getLang()) ? getLang() : 'en'
  const l = L[lang]

  const [wallets, setWallets] = useState([])
  const [walletId, setWalletId] = useState('')
  const [headers, setHeaders] = useState([])
  const [rawRows, setRawRows] = useState([])
  const [fileName, setFileName] = useState('')
  const [map, setMap] = useState({ date: '', amount: '', debit: '', credit: '', description: '', direction: '', reference: '' })
  const [opening, setOpening] = useState('')
  const [closing, setClosing] = useState('')
  const [batch, setBatch] = useState(null)
  const [rows, setRows] = useState([])
  const [recon, setRecon] = useState(null)
  const [busy, setBusy] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [history, setHistory] = useState([])
  const [cats, setCats] = useState([])              // [{id,name,group_type}]
  const [cps, setCps] = useState([])                // [{id,name}]
  const [summary, setSummary] = useState(null)
  const [filter, setFilter] = useState('fAll')
  const [canMakeCat, setCanMakeCat] = useState(false)

  const loadHistory = useCallback(() => {
    apiFetch('/bank-import/batches', token).then(d => setHistory(d.batches || [])).catch(() => {})
  }, [token])
  useEffect(() => {
    apiFetch('/wallets', token).then(d => setWallets(d.wallets || [])).catch(() => {})
    apiFetch('/cashflow-categories', token).then(d => setCats(d.categories || [])).catch(() => {})
    loadHistory()
  }, [token, loadHistory])
  const catName = useCallback((id) => cats.find(c => c.id === id)?.name || '', [cats])

  const onFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    setFileName(file.name)
    const buf = await file.arrayBuffer()
    // raw:false + no cellDates → cells come as their displayed text, so a
    // DD/MM/YY date is NOT misread by XLSX as US MM/DD. Our toISO parses it.
    const wb = XLSX.read(buf, { type: 'array', cellDates: false })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const arr = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
    const firstNonEmpty = arr.findIndex(r => r.some(c => String(c).trim() !== ''))
    const row1 = (arr[firstNonEmpty] || []).map(h => String(h).trim())
    const row2 = (arr[firstNonEmpty + 1] || []).map(h => String(h).trim())
    // Two-header layout (e.g. Permata: "Amount" split into Debit/Credit on the
    // next row). If row2 looks like sub-headers (has Debit/Credit-style labels,
    // no parseable date), merge: a non-empty sub-header overrides the main one.
    const looksSubHeader = row2.length && row2.some(c => /^(debit|credit|kredit|d|c)$/i.test(c)) && !toISO(row2[0])
    const hdr = looksSubHeader ? row1.map((h, i) => row2[i] && row2[i].trim() ? row2[i].trim() : h) : row1
    const bodyStart = firstNonEmpty + (looksSubHeader ? 2 : 1)

    // Capture opening/closing balance rows (skipped as transactions, used for reconcile).
    let openBal = '', closeBal = ''
    arr.slice(bodyStart).forEach(r => {
      const first = String(r[0] || '').toLowerCase()
      // Skip col 0 (the label) — "Opening balance per 01/05/26" would yield 010526.
      const val = r.slice(1).map(c => num(c)).filter(n => n !== null && n !== 0).pop()
      if (/opening balance|saldo awal/.test(first) && val) openBal = String(val)
      if (/closing balance|saldo akhir/.test(first) && val) closeBal = String(val)
    })
    if (openBal) setOpening(openBal)
    if (closeBal) setClosing(closeBal)

    const body = arr.slice(bodyStart).filter(r => r.some(c => String(c).trim() !== ''))
    setHeaders(hdr); setRawRows(body); setBatch(null); setRows([]); setRecon(null)

    const guess = (keys) => hdr.findIndex(h => keys.some(k => h.toLowerCase() === k || h.toLowerCase().includes(k)))
    setMap({
      date: hdr[guess(['date','tanggal','дата'])] || '',
      debit: hdr[guess(['debit'])] || '',
      credit: hdr[guess(['credit','kredit'])] || '',
      amount: (hdr[guess(['debit'])] || hdr[guess(['credit','kredit'])]) ? '' : (hdr[guess(['amount','nominal','сумма','mutasi'])] || ''),
      description: hdr[guess(['description','keterangan','описание','berita','uraian'])] || '',
      direction: hdr[guess(['transaction type','type','d/c','dc','dir'])] || '',
      reference: hdr[guess(['reference number','reference','ref'])] || '',
    })
  }

  const dirFrom = (v) => {
    const dv = String(v || '').trim().toLowerCase()
    if (/^(c|cr|credit|kredit|in|masuk)$/.test(dv) || /(credit|kredit|masuk)/.test(dv)) return 'in'
    if (/^(d|dr|db|debit|out|keluar)$/.test(dv) || /(debit|keluar)/.test(dv)) return 'out'
    return null
  }

  // Summary / balance rows (Opening/Closing/Total) are not transactions — their
  // date cell carries a label like "Opening balance per 01/05/26".
  const SUMMARY_RE = /balance|saldo|total|grand|opening|closing/i

  const buildRows = () => {
    const idx = (name) => headers.indexOf(name)
    const useDC = map.debit || map.credit
    return rawRows.map((r, i) => {
      const rawObj = {}; headers.forEach((h, j) => { rawObj[h] = r[j] })
      const dateCell = String(r[idx(map.date)] || '')
      if (SUMMARY_RE.test(dateCell)) return null  // skip Opening/Closing/Total rows
      let amount = null, direction = null
      if (useDC) {
        const debit = num(r[idx(map.debit)]) || 0
        const credit = num(r[idx(map.credit)]) || 0
        amount = debit > 0 ? debit : credit
        direction = debit > 0 ? 'out' : credit > 0 ? 'in' : null
      } else {
        const amt = num(r[idx(map.amount)])
        amount = amt === null ? null : Math.abs(amt)
        if (amt !== null) direction = amt >= 0 ? 'in' : 'out'
      }
      // Transaction Type column refines/overrides direction (D/C).
      if (map.direction && r[idx(map.direction)]) {
        const d = dirFrom(r[idx(map.direction)]); if (d) direction = d
      }
      return {
        row_index: i, raw: rawObj, tx_date: toISO(r[idx(map.date)]),
        description: String(r[idx(map.description)] || '').trim() || null,
        amount, direction,
        bank_reference: map.reference ? String(r[idx(map.reference)] || '').trim() || null : null,
      }
    }).filter(r => r && r.amount !== null && r.amount > 0 && r.tx_date)  // drop summary/balance rows and unparseable lines
  }

  // Map a /review row into local editable state (final decision defaults to suggestion).
  const toLocal = (r) => ({
    ...r,
    _include: r.match_status !== 'duplicate' && r.review_status !== 'excluded',
    _type: r.final_transaction_type || r.suggested_transaction_type || r.suggested_type || (r.direction === 'in' ? 'income' : 'expense'),
    _categoryId: r.final_category_id || r.suggested_category_id || '',
    _counterpartyId: r.final_counterparty_id || r.suggested_counterparty_id || '',
    _scope: r.final_scope || r.suggested_scope || 'business',
  })

  const loadReview = async (batchId) => {
    const d = await apiFetch(`/bank-imports/${batchId}/review`, token)
    setCats(d.categories || []); setCps(d.counterparties || [])
    setSummary(d.summary || null); setCanMakeCat(!!d.canManageCategories)
    setRows((d.rows || []).map(toLocal))
  }

  const parseAndUpload = async () => {
    if (!walletId) { alert(l.noWallet); return }
    setBusy(true)
    try {
      const built = buildRows()
      const d = await apiFetch('/bank-import/batches', token, { method: 'POST', body: {
        wallet_id: walletId, file_name: fileName, file_type: fileName.split('.').pop(),
        currency: 'IDR', opening_balance: num(opening), closing_balance: num(closing), rows: built,
      } })
      setBatch(d.batch)
      setSuggesting(true)
      // Run rules + AI cascade, then load the enriched review queue.
      try { await apiFetch(`/bank-imports/${d.batch.id}/suggest`, token, { method: 'POST' }) } catch { /* AI optional */ }
      await loadReview(d.batch.id)
    } catch (e) { alert(e.message) } finally { setBusy(false); setSuggesting(false) }
  }

  const reSuggest = async () => {
    if (!batch) return
    setSuggesting(true)
    try { await apiFetch(`/bank-imports/${batch.id}/suggest`, token, { method: 'POST' }); await loadReview(batch.id) }
    catch (e) { alert(e.message) } finally { setSuggesting(false) }
  }

  const confirm = async (onlyRows) => {
    const target = (onlyRows || rows).filter(r => r._include && r.match_status !== 'duplicate' && r.review_status !== 'imported')
    if (!target.length) return
    setBusy(true)
    try {
      const payload = target.map(r => ({
        row_id: r.id, transaction_type: r._type,
        category_id: r._categoryId || null, counterparty_id: r._counterpartyId || null,
        scope: r._scope, match_action: r.suggested_match_type && r._action === 'link' ? 'link' : 'create_transaction',
      }))
      const res = await apiFetch(`/bank-imports/${batch.id}/confirm`, token, { method: 'POST', body: { rows: payload } })
      setRecon(res.reconciliation || null)
      alert(`${l.imported}: ${res.imported}`)
      setBatch(null); setRows([]); setHeaders([]); setRawRows([]); setSummary(null); loadHistory()
    } catch (e) { alert(e.message) } finally { setBusy(false) }
  }

  const excludeRow = async (r) => {
    try { await apiFetch(`/bank-imports/${batch.id}/rows/${r.id}/exclude`, token, { method: 'POST' }) } catch { /* */ }
    setRows(rows.map(x => x.id === r.id ? { ...x, review_status: 'excluded', _include: false } : x))
  }

  const createCategory = async () => {
    const name = window.prompt(l.createNewCategory)
    if (!name || !name.trim()) return
    const group_type = cats[0]?.group_type || 'operating'
    try {
      const d = await apiFetch('/cashflow-categories', token, { method: 'POST', body: { name: name.trim(), group_type } })
      if (d.category) setCats([...cats, d.category])
    } catch (e) { alert(e.message) }
  }

  // Confidence badge: High >=0.9, Medium >=0.7, Low otherwise.
  const confBadge = (r) => {
    const c = Number(r.suggestion_confidence) || 0
    if (r.suggested_match_type) return { label: ({ existing_tx: l.matchedExisting, payable: l.linkedPayable, receivable: l.linkedReceivable, payroll: l.possiblePayroll, transfer: l.possibleTransfer }[r.suggested_match_type] || l.match), bg: '#EEF2FF', fg: '#3730A3' }
    if (!r.suggestion_source || r.suggestion_source === 'none') return null
    if (c >= 0.9) return { label: `${l.high} ${Math.round(c * 100)}%`, bg: '#E1F5EE', fg: '#085041' }
    if (c >= 0.7) return { label: `${l.medium} ${Math.round(c * 100)}%`, bg: '#FEF3C7', fg: '#92400E' }
    return { label: `${l.low} ${Math.round(c * 100)}%`, bg: '#FEE2E2', fg: '#991B1B' }
  }

  const matchFilter = (r) => {
    if (filter === 'fAll') return true
    if (filter === 'fHigh') return r.review_status === 'high_confidence'
    if (filter === 'fNeeds') return r.review_status === 'needs_review'
    if (filter === 'fMatched') return r.review_status === 'matched_existing'
    if (filter === 'fDup') return r.match_status === 'duplicate'
    if (filter === 'fUncat') return !r._categoryId
    if (filter === 'fTransfer') return r._type === 'transfer' || r.suggested_match_type === 'transfer'
    return true
  }
  const visibleRows = rows.filter(matchFilter)

  const includeCount = rows.filter(r => r._include && r.match_status !== 'duplicate' && r.review_status !== 'imported').length
  const highRows = rows.filter(r => r.review_status === 'high_confidence' && r._include)
  const dupCount = rows.filter(r => r.match_status === 'duplicate').length

  const sel = (val, onChange, opts) => (
    <select className="modal-input" value={val} onChange={e => onChange(e.target.value)} style={{ marginBottom: 8 }}>
      <option value="">—</option>{opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )

  return (
    <div style={{ maxWidth: 920, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>🏦 {l.title}</h1>
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>{l.subtitle}</div>

      {!batch && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 16 }}>
          <label className="modal-label">{l.wallet}</label>
          <select className="modal-input" value={walletId} onChange={e => setWalletId(e.target.value)} style={{ marginBottom: 12 }}>
            <option value="">—</option>
            {wallets.map(w => <option key={w.id} value={w.id}>{w.name} · {fmt(w.balance)} IDR</option>)}
          </select>

          <label className="modal-label">{l.upload}</label>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={onFile} style={{ marginBottom: 12, display: 'block' }} />

          {headers.length > 0 && (
            <>
              <div style={{ fontWeight: 700, fontSize: 13, margin: '8px 0' }}>{l.map} · {rawRows.length} {l.rows}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div><label className="modal-label">{l.date} *</label>{sel(map.date, v => setMap({ ...map, date: v }), headers)}</div>
                <div><label className="modal-label">{l.desc}</label>{sel(map.description, v => setMap({ ...map, description: v }), headers)}</div>
                <div><label className="modal-label">{l.amount}{!(map.debit || map.credit) ? ' *' : ''}</label>{sel(map.amount, v => setMap({ ...map, amount: v }), headers)}</div>
                <div><label className="modal-label">{l.direction}</label>{sel(map.direction, v => setMap({ ...map, direction: v }), headers)}</div>
                <div><label className="modal-label">{l.debit}</label>{sel(map.debit, v => setMap({ ...map, debit: v }), headers)}</div>
                <div><label className="modal-label">{l.credit}</label>{sel(map.credit, v => setMap({ ...map, credit: v }), headers)}</div>
                <div><label className="modal-label">{l.opening}</label><input className="modal-input" value={opening} onChange={e => setOpening(e.target.value)} /></div>
                <div><label className="modal-label">{l.closing}</label><input className="modal-input" value={closing} onChange={e => setClosing(e.target.value)} /></div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>{l.dcHint}</div>
              <button className="btn btn-primary btn-md" disabled={busy || !map.date || !(map.amount || map.debit || map.credit)} onClick={parseAndUpload} style={{ marginTop: 12 }}>
                {busy ? '…' : l.parse}
              </button>
            </>
          )}
        </div>
      )}

      {batch && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontWeight: 700 }}>{l.preview} · {rows.length} {l.total} · {includeCount} {l.toImport}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm" disabled={suggesting} onClick={reSuggest}>{suggesting ? '…' : l.runSuggest}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setBatch(null); setRows([]); setSummary(null) }}>{l.back}</button>
            </div>
          </div>

          {/* AI disclaimer — the final choice is always the user's */}
          <div style={{ fontSize: 12, color: 'var(--text-2)', background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '7px 10px', marginBottom: 10 }}>
            💡 {l.aiDisclaimer}
          </div>

          {suggesting && <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>⏳ {l.suggesting}</div>}

          {/* Summary chips */}
          {summary && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, fontSize: 11 }}>
              {[['fAll', summary.total], ['fHigh', summary.high_confidence], ['fNeeds', summary.needs_review], ['fMatched', summary.matched_existing], ['fDup', summary.possible_duplicate], ['fUncat', summary.uncategorized], ['fTransfer', null]].map(([key, n]) => (
                <button key={key} onClick={() => setFilter(key)}
                  style={{ padding: '4px 10px', borderRadius: 20, border: '1px solid var(--border)', cursor: 'pointer',
                    background: filter === key ? 'var(--accent,#4F46E5)' : 'var(--bg-3)', color: filter === key ? '#fff' : 'var(--text-2)', fontWeight: 600 }}>
                  {l[key]}{n != null ? ` · ${n}` : ''}
                </button>
              ))}
            </div>
          )}

          {/* Bulk actions */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            <button className="btn btn-primary btn-sm" disabled={busy || includeCount === 0} onClick={() => confirm()}>{busy ? '…' : `${l.confirmSelected} · ${includeCount}`}</button>
            <button className="btn btn-ghost btn-sm" disabled={busy || highRows.length === 0} onClick={() => confirm(highRows)}>{l.confirmHigh} · {highRows.length}</button>
            {canMakeCat && <button className="btn btn-ghost btn-sm" onClick={createCategory}>{l.createNewCategory}</button>}
          </div>

          <div style={{ maxHeight: 460, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead><tr style={{ position: 'sticky', top: 0, background: 'var(--bg-3)', zIndex: 1 }}>
                <th style={{ padding: 6 }}>✓</th><th style={{ padding: 6, textAlign: 'left' }}>{l.date}</th>
                <th style={{ padding: 6, textAlign: 'left' }}>{l.desc}</th><th style={{ padding: 6, textAlign: 'right' }}>{l.amount}</th>
                <th style={{ padding: 6 }}>{l.type}</th><th style={{ padding: 6, textAlign: 'left' }}>{l.category}</th>
                <th style={{ padding: 6, textAlign: 'left' }}>{l.suggestion}</th><th style={{ padding: 6 }}></th></tr></thead>
              <tbody>
                {visibleRows.map((r) => {
                  const isDup = r.match_status === 'duplicate'
                  const isExcluded = r.review_status === 'excluded'
                  const badge = confBadge(r)
                  const setRow = (patch) => setRows(rows.map(x => x.id === r.id ? { ...x, ...patch } : x))
                  return (
                    <tr key={r.id} style={{ borderTop: '0.5px solid var(--border)', opacity: isDup || isExcluded ? 0.45 : 1 }}>
                      <td style={{ padding: 6, textAlign: 'center' }}>
                        <input type="checkbox" disabled={isDup || isExcluded} checked={!!r._include && !isDup && !isExcluded}
                          onChange={e => setRow({ _include: e.target.checked })} />
                      </td>
                      <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{r.tx_date}</td>
                      <td style={{ padding: 6, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description}>
                        {r.description}{isDup && <span style={{ color: 'var(--amber-dark)', marginLeft: 6 }}>· {l.dup}</span>}
                      </td>
                      <td style={{ padding: 6, textAlign: 'right', whiteSpace: 'nowrap', color: r._type === 'income' ? 'var(--green-dark)' : 'var(--red-dark)' }}>
                        {r._type === 'income' ? '+' : '−'}{fmt(r.amount)}
                      </td>
                      <td style={{ padding: 6, textAlign: 'center' }}>
                        <select value={r._type} onChange={e => setRow({ _type: e.target.value })} style={{ fontSize: 11 }}>
                          <option value="income">{l.income}</option><option value="expense">{l.expense}</option>
                          <option value="transfer">transfer</option><option value="payroll">payroll</option>
                          <option value="owner_injection">owner in</option><option value="owner_withdrawal">owner out</option>
                          <option value="correction">correction</option>
                        </select>
                      </td>
                      <td style={{ padding: 6 }}>
                        <select value={r._categoryId || ''} onChange={e => setRow({ _categoryId: e.target.value })}
                          style={{ fontSize: 11, maxWidth: 150, padding: '3px 6px', border: '1px solid var(--border-2)', borderRadius: 6 }}>
                          <option value="">{l.uncategorized}</option>
                          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: 6 }}>
                        {badge && <span style={{ background: badge.bg, color: badge.fg, borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }} title={r.suggestion_reason || ''}>{badge.label}</span>}
                        {r.suggested_category_id && r._categoryId !== r.suggested_category_id && (
                          <span style={{ marginLeft: 4, color: 'var(--text-3)', fontSize: 10 }}>({catName(r.suggested_category_id)})</span>
                        )}
                      </td>
                      <td style={{ padding: 6, textAlign: 'center' }}>
                        {!isExcluded && !isDup && <button className="btn btn-ghost btn-sm" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => excludeRow(r)}>✕</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <button className="btn btn-primary btn-md" disabled={busy || includeCount === 0} onClick={() => confirm()} style={{ marginTop: 12 }}>
            {busy ? '…' : `${l.confirmImport} · ${includeCount}`}
          </button>
        </div>
      )}

      {recon && (
        <div style={{ background: recon.status === 'balanced' ? 'var(--green-light,#E1F5EE)' : '#FEF3F2', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 16, fontSize: 13 }}>
          <b>{l.reconciled}: {recon.status === 'balanced' ? '✓ ' + l.balanced : '⚠ ' + l.unbalanced}</b> · {l.difference}: {fmt(recon.difference)} IDR
        </div>
      )}

      {history.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{l.history}</div>
          {history.map(b => (
            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: '0.5px solid var(--border)' }}>
              <span>{b.file_name || '—'} · {b.row_count} {l.rows}</span>
              <span style={{ color: 'var(--text-3)' }}>{b.status} · {b.imported_count} {l.imported.toLowerCase()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
