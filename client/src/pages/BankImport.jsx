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
    history: 'Recent imports', createTx: 'Will create transactions for included rows only.' },
  ru: { title: 'Импорт из банка', subtitle: 'Загрузи выписку CSV/XLSX — проверь, затем создадим транзакции',
    upload: 'Загрузить выписку (CSV / XLSX)', wallet: 'Счёт назначения', map: 'Сопоставь колонки', date: 'Дата', amount: 'Сумма',
    desc: 'Описание', direction: 'Направление (необязательно)', ref: 'Референс (необязательно)', preview: 'Превью и проверка',
    debit: 'Колонка Debit (необязательно)', credit: 'Колонка Credit (необязательно)', dcHint: 'Если в выписке отдельные колонки Debit/Credit — укажи обе, тогда «Сумма» игнорируется.',
    opening: 'Входящий остаток (необязательно)', closing: 'Исходящий остаток (необязательно)', parse: 'Разобрать файл', back: 'Назад',
    rows: 'строк', duplicates: 'дубликатов', toImport: 'к импорту', confirmImport: 'Подтвердить импорт', imported: 'Импортировано',
    category: 'Категория', type: 'Тип', income: 'Доход', expense: 'Расход', dup: 'Дубликат', include: 'Включить', reconciled: 'Сверка',
    balanced: 'Сходится', unbalanced: 'Не сходится', difference: 'Разница', noWallet: 'Сначала выбери счёт назначения.',
    history: 'Последние импорты', createTx: 'Транзакции создаются только для включённых строк.' },
  id: { title: 'Impor bank', subtitle: 'Impor rekening koran CSV/XLSX — tinjau, lalu buat transaksi',
    upload: 'Unggah rekening (CSV / XLSX)', wallet: 'Akun tujuan', map: 'Petakan kolom', date: 'Tanggal', amount: 'Jumlah',
    desc: 'Deskripsi', direction: 'Arah (opsional)', ref: 'Referensi (opsional)', preview: 'Pratinjau & tinjau',
    debit: 'Kolom Debit (opsional)', credit: 'Kolom Credit (opsional)', dcHint: 'Jika rekening punya kolom Debit/Credit terpisah, petakan keduanya — Jumlah diabaikan.',
    opening: 'Saldo awal (opsional)', closing: 'Saldo akhir (opsional)', parse: 'Urai file', back: 'Kembali',
    rows: 'baris', duplicates: 'duplikat', toImport: 'akan diimpor', confirmImport: 'Konfirmasi impor', imported: 'Terimpor',
    category: 'Kategori', type: 'Tipe', income: 'Pemasukan', expense: 'Pengeluaran', dup: 'Duplikat', include: 'Sertakan', reconciled: 'Rekonsiliasi',
    balanced: 'Seimbang', unbalanced: 'Tidak seimbang', difference: 'Selisih', noWallet: 'Pilih akun tujuan dulu.',
    history: 'Impor terbaru', createTx: 'Transaksi hanya dibuat untuk baris yang disertakan.' },
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')
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
  const [history, setHistory] = useState([])
  const [categories, setCategories] = useState([])

  const loadHistory = useCallback(() => {
    apiFetch('/bank-import/batches', token).then(d => setHistory(d.batches || [])).catch(() => {})
  }, [token])
  useEffect(() => {
    apiFetch('/wallets', token).then(d => setWallets(d.wallets || [])).catch(() => {})
    apiFetch('/cashflow-categories', token).then(d => setCategories((d.categories || []).map(c => c.name))).catch(() => {})
    loadHistory()
  }, [token, loadHistory])

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
      const val = r.map(c => num(c)).filter(n => n !== null && n !== 0).pop()
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

  const parseAndUpload = async () => {
    if (!walletId) { alert(l.noWallet); return }
    setBusy(true)
    try {
      const built = buildRows()
      const d = await apiFetch('/bank-import/batches', token, { method: 'POST', body: {
        wallet_id: walletId, file_name: fileName, file_type: fileName.split('.').pop(),
        currency: 'IDR', opening_balance: num(opening), closing_balance: num(closing), rows: built,
      } })
      // default: include non-duplicate rows
      setBatch(d.batch)
      setRows((d.rows || []).map(r => ({ ...r, _include: r.match_status !== 'duplicate', _category: r.suggested_category || '' })))
    } catch (e) { alert(e.message) } finally { setBusy(false) }
  }

  const confirm = async () => {
    setBusy(true)
    try {
      // mark included rows confirmed (+ persist edited type/category), others stay
      for (const r of rows) {
        const target = r._include && r.match_status !== 'duplicate' ? 'confirmed' : (r.match_status === 'duplicate' ? 'duplicate' : 'rejected')
        const patch = {}
        if (target !== r.match_status) patch.match_status = target
        if (target === 'confirmed') {
          if (r.suggested_type) patch.suggested_type = r.suggested_type
          if (r._category) patch.suggested_category = r._category
        }
        if (Object.keys(patch).length) await apiFetch(`/bank-import/rows/${r.id}`, token, { method: 'PATCH', body: patch })
      }
      const res = await apiFetch(`/bank-import/batches/${batch.id}/confirm`, token, { method: 'POST' })
      setRecon(res.reconciliation || null)
      alert(`${l.imported}: ${res.imported}`)
      setBatch(null); setRows([]); setHeaders([]); setRawRows([]); loadHistory()
    } catch (e) { alert(e.message) } finally { setBusy(false) }
  }

  const includeCount = rows.filter(r => r._include && r.match_status !== 'duplicate').length
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontWeight: 700 }}>{l.preview} · {rows.length} {l.rows} · {dupCount} {l.duplicates} · {includeCount} {l.toImport}</div>
            <button className="btn btn-ghost btn-sm" onClick={() => { setBatch(null); setRows([]) }}>{l.back}</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>{l.createTx}</div>
          <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead><tr style={{ position: 'sticky', top: 0, background: 'var(--bg-3)' }}>
                <th style={{ padding: 6 }}>✓</th><th style={{ padding: 6, textAlign: 'left' }}>{l.date}</th>
                <th style={{ padding: 6, textAlign: 'left' }}>{l.desc}</th><th style={{ padding: 6, textAlign: 'right' }}>{l.amount}</th>
                <th style={{ padding: 6 }}>{l.type}</th><th style={{ padding: 6, textAlign: 'left' }}>{l.category}</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} style={{ borderTop: '0.5px solid var(--border)', opacity: r.match_status === 'duplicate' ? 0.5 : 1 }}>
                    <td style={{ padding: 6, textAlign: 'center' }}>
                      <input type="checkbox" disabled={r.match_status === 'duplicate'} checked={!!r._include && r.match_status !== 'duplicate'}
                        onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, _include: e.target.checked } : x))} />
                    </td>
                    <td style={{ padding: 6 }}>{r.tx_date}</td>
                    <td style={{ padding: 6, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}{r.match_status === 'duplicate' && <span style={{ color: 'var(--amber-dark)', marginLeft: 6 }}>· {l.dup}</span>}</td>
                    <td style={{ padding: 6, textAlign: 'right', color: r.suggested_type === 'income' ? 'var(--green-dark)' : 'var(--red-dark)' }}>{r.suggested_type === 'income' ? '+' : '−'}{fmt(r.amount)}</td>
                    <td style={{ padding: 6, textAlign: 'center' }}>
                      <select value={r.suggested_type} onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, suggested_type: e.target.value } : x))} style={{ fontSize: 11 }}>
                        <option value="income">{l.income}</option><option value="expense">{l.expense}</option>
                      </select>
                    </td>
                    <td style={{ padding: 6 }}>
                      <input list="bank-import-cats" value={r._category || ''} placeholder={l.category}
                        onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, _category: e.target.value } : x))}
                        style={{ fontSize: 11, width: 130, padding: '3px 6px', border: '1px solid var(--border-2)', borderRadius: 6 }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="bank-import-cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
          </div>
          <button className="btn btn-primary btn-md" disabled={busy || includeCount === 0} onClick={confirm} style={{ marginTop: 12 }}>
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
