/**
 * DebtFormModal — create a new receivable or payable.
 */

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch } from '../lib/api'
import { getLang } from '../i18n/index'

function cfg(mode) {
  const lang = getLang()
  const map = {
    receivable: {
      en: {
        title: 'New Receivable', submit: 'Create Receivable',
        subtitle: 'Track money a client owes you',
        counterpartyLabel: 'WHO OWES YOU?', counterpartyPlaceholder: 'Client or partner name',
        descPlaceholder: 'Invoice, contract, or note (optional)',
      },
      ru: {
        title: 'Новая дебиторка', submit: 'Создать дебиторку',
        subtitle: 'Отслеживайте деньги, которые должны клиенты',
        counterpartyLabel: 'КТО ВАМ ДОЛЖЕН?', counterpartyPlaceholder: 'Имя клиента или партнёра',
        descPlaceholder: 'Счёт, договор или заметка (необязательно)',
      },
      id: {
        title: 'Piutang Baru', submit: 'Buat Piutang',
        subtitle: 'Pantau uang yang harus dibayar klien kepada Anda',
        counterpartyLabel: 'SIAPA YANG BERUTANG?', counterpartyPlaceholder: 'Nama klien atau partner',
        descPlaceholder: 'Invoice, kontrak, atau catatan (opsional)',
      },
    },
    payable: {
      en: {
        title: 'New Payable', submit: 'Create Payable',
        subtitle: 'Track money you need to pay',
        counterpartyLabel: 'WHO DO YOU OWE?', counterpartyPlaceholder: 'Vendor, supplier, or landlord',
        descPlaceholder: 'Rent, salary, bill, or note (optional)',
      },
      ru: {
        title: 'Новое обязательство', submit: 'Создать обязательство',
        subtitle: 'Отслеживайте деньги, которые нужно заплатить',
        counterpartyLabel: 'КОМУ ВЫ ДОЛЖНЫ?', counterpartyPlaceholder: 'Поставщик, арендодатель, партнёр',
        descPlaceholder: 'Аренда, зарплата, счёт или заметка (необязательно)',
      },
      id: {
        title: 'Kewajiban Baru', submit: 'Buat Kewajiban',
        subtitle: 'Pantau uang yang perlu Anda bayar',
        counterpartyLabel: 'KEPADA SIAPA ANDA BERUTANG?', counterpartyPlaceholder: 'Vendor, pemasok, atau pemilik',
        descPlaceholder: 'Sewa, gaji, tagihan, atau catatan (opsional)',
      },
    },
  }
  const base = map[mode] || map.receivable
  return base[lang] || base.en
}

const LABELS = {
  en: { amount: 'AMOUNT (IDR)', dueDate: 'DUE DATE', desc: 'DESCRIPTION (OPTIONAL)', scope: 'SCOPE', business: '💼 Business', personal: '👤 Personal', saving: 'Saving…', cancel: 'Cancel', failMsg: 'Failed to create. Please try again.' },
  ru: { amount: 'СУММА (IDR)', dueDate: 'ДАТА ОПЛАТЫ', desc: 'ОПИСАНИЕ (НЕОБЯЗАТЕЛЬНО)', scope: 'ТИП', business: '💼 Бизнес', personal: '👤 Личное', saving: 'Сохранение…', cancel: 'Отмена', failMsg: 'Не удалось создать. Попробуйте ещё раз.' },
  id: { amount: 'JUMLAH (IDR)', dueDate: 'TANGGAL JATUH TEMPO', desc: 'DESKRIPSI (OPSIONAL)', scope: 'LINGKUP', business: '💼 Bisnis', personal: '👤 Pribadi', saving: 'Menyimpan…', cancel: 'Batal', failMsg: 'Gagal membuat. Coba lagi.' },
}

function defaultDueDate() {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d.toISOString().slice(0, 10)
}

export default function DebtFormModal({ mode, token, onClose, onSuccess, initialDebt = null, lockBusinessScope = false }) {
  const isEdit = !!initialDebt
  const c = cfg(mode)
  const l = LABELS[getLang()] || LABELS.en

  const [counterparty, setCounterparty] = useState(initialDebt?.counterparty || '')
  const [description,  setDescription]  = useState(initialDebt?.description || '')
  const [amount,       setAmount]        = useState(initialDebt ? String(initialDebt.original_amount || initialDebt.amount || '') : '')
  const [dueDate,      setDueDate]       = useState(initialDebt?.due_date ? initialDebt.due_date.slice(0, 10) : defaultDueDate())
  const [scope,        setScope]         = useState(lockBusinessScope ? 'business' : (initialDebt?.scope || 'business'))
  const [saving,       setSaving]        = useState(false)
  const [error,        setError]         = useState('')

  const amountNum = Number(amount)
  const canSubmit = counterparty.trim().length > 0 && amountNum > 0 && !saving

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSaving(true)
    setError('')
    try {
      const body = { type: mode, counterparty: counterparty.trim(), amount: amountNum, due_date: dueDate || null, scope }
      body.description = description.trim() || null
      const debt = isEdit
        ? await apiFetch(`/debts/${initialDebt.id}`, token, { method: 'PATCH', body })
        : await apiFetch('/debts', token, { method: 'POST', body })
      onSuccess(debt)
    } catch (e) {
      setError(e.message || l.failMsg)
    } finally {
      setSaving(false)
    }
  }

  const onKey = (e) => { if (e.key === 'Enter' && canSubmit) handleSubmit() }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-drag-handle" />
        <button className="modal-close-btn" onClick={onClose}>✕</button>

        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>
          {isEdit ? ({ en: 'Edit record', ru: 'Редактировать заявку', id: 'Edit catatan' }[getLang()] || 'Edit record') : c.title}
        </div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', marginBottom: 20 }}>{c.subtitle}</div>

        <label className="modal-label">{c.counterpartyLabel}</label>
        <input type="text" className="modal-input" value={counterparty}
          onChange={e => { setCounterparty(e.target.value); setError('') }}
          onKeyDown={onKey} placeholder={c.counterpartyPlaceholder}
          style={{ marginBottom: 12 }} autoFocus />

        <label className="modal-label">{l.amount}</label>
        <input type="number" className="modal-input" value={amount}
          onChange={e => { setAmount(e.target.value); setError('') }}
          onKeyDown={onKey} placeholder="e.g. 5000000" min="1"
          style={{ marginBottom: 12 }} />

        <label className="modal-label">{l.dueDate}</label>
        <input type="date" className="modal-input" value={dueDate}
          onChange={e => setDueDate(e.target.value)} style={{ marginBottom: 12 }} />

        <label className="modal-label">{l.desc}</label>
        <input type="text" className="modal-input" value={description}
          onChange={e => setDescription(e.target.value)}
          onKeyDown={onKey} placeholder={c.descPlaceholder}
          style={{ marginBottom: 12 }} />

        {/* Scope selector — hidden in Business Workspace (lockBusinessScope): business
            pages never create personal records; the record always belongs to the
            active business. Personal scope returns only in the (gated) Personal UI. */}
        {!lockBusinessScope && (
          <>
            <label className="modal-label">{l.scope}</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
              {[
                { value: 'business', label: l.business },
                { value: 'personal', label: l.personal },
              ].map(s => (
                <button key={s.value} type="button" onClick={() => setScope(s.value)} style={{
                  padding: '10px 0', borderRadius: 10,
                  fontSize: 'var(--text-sm)', fontWeight: 500,
                  border: scope === s.value ? 'none' : '0.5px solid var(--border)',
                  background: scope === s.value ? 'var(--brand-light)' : 'none',
                  color: scope === s.value ? 'var(--brand-dark)' : 'var(--text-3)',
                  cursor: 'pointer', transition: 'all .12s', fontFamily: 'inherit',
                }}>{s.label}</button>
              ))}
            </div>
          </>
        )}

        {error && (
          <div style={{ background: 'var(--red-light)', color: 'var(--red-dark)', borderRadius: 10, padding: '9px 13px', fontSize: 'var(--text-sm)', border: '1px solid rgba(240,68,56,.2)', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <button disabled={!canSubmit} onClick={handleSubmit} className="btn btn-block btn-lg"
          style={{ background: canSubmit ? (mode === 'receivable' ? 'var(--green-dark)' : 'var(--brand)') : 'var(--bg-3)', color: canSubmit ? '#fff' : 'var(--text-4)', marginBottom: 8, opacity: saving ? 0.7 : 1 }}>
          {saving ? l.saving : c.submit}
        </button>

        <button onClick={onClose} disabled={saving} className="btn btn-ghost btn-block btn-lg">{l.cancel}</button>
      </div>
    </div>,
    document.body
  )
}
