import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useAccess } from '../hooks/useAccess'
import { useTranslation } from '../hooks/useTranslation'
import { apiFetch, fmt } from '../lib/api'
import LockedFeature from '../components/LockedFeature'
import { getLang } from '../i18n/index'

function fmtDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtPeriod(str) {
  if (!str) return '—'
  const [y, m] = str.split('-')
  if (!y || !m) return str
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// item_type → default direction
const ITEM_DIRECTION = {
  salary:            'addition',
  bonus:             'addition',
  commission:        'addition',
  allowance:         'addition',
  overtime:          'addition',
  reimbursement:     'addition',
  advance:           'addition',
  advance_repayment: 'deduction',
  penalty:           'deduction',
  deduction:         'deduction',
  other:             'addition',
}

// Quick-add item type presets
const QUICK_ITEMS = [
  { item_type: 'salary',            labelKey: 'payroll.baseSalary',       direction: 'addition'  },
  { item_type: 'bonus',             labelKey: 'payroll.bonus',            direction: 'addition'  },
  { item_type: 'commission',        labelKey: 'payroll.commission',       direction: 'addition'  },
  { item_type: 'allowance',         labelKey: 'payroll.allowance',        direction: 'addition'  },
  { item_type: 'overtime',          labelKey: 'payroll.overtime',         direction: 'addition'  },
  { item_type: 'reimbursement',     labelKey: 'payroll.reimbursement',    direction: 'addition'  },
  { item_type: 'penalty',           labelKey: 'payroll.penalty',          direction: 'deduction' },
  { item_type: 'advance_repayment', labelKey: 'payroll.advanceRepayment', direction: 'deduction' },
  { item_type: 'deduction',         labelKey: 'payroll.deduction',        direction: 'deduction' },
]

// ── Add Payroll Payment Modal ─────────────────────────────────────────────────
function PayrollModal({ token, employees, wallets, onClose, onSuccess, t }) {
  const defaultPeriod = (() => {
    const n = new Date()
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
  })()

  const [employeeId,   setEmployeeId]   = useState('')
  const [employeeName, setEmployeeName] = useState('')
  const [walletId,     setWalletId]     = useState('')
  const [periodMonth,  setPeriodMonth]  = useState(defaultPeriod)
  const [paymentDate,  setPaymentDate]  = useState(new Date().toISOString().slice(0, 10))
  const [notes,        setNotes]        = useState('')
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')

  // Line items
  const [items, setItems] = useState([
    { id: Date.now(), item_type: 'salary', label: t('payroll.baseSalary'), amount: '', direction: 'addition' },
  ])

  const addItem = (preset) => {
    setItems(prev => [...prev, {
      id: Date.now() + Math.random(),
      item_type: preset.item_type,
      label: t(preset.labelKey),
      amount: '',
      direction: preset.direction,
    }])
  }

  const updateItem = (id, field, value) => {
    setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: value } : it))
  }

  const removeItem = (id) => {
    setItems(prev => prev.filter(it => it.id !== id))
  }

  // When employee selected — prefill name, wallet, salary
  const handleEmployeeSelect = (empId) => {
    setEmployeeId(empId)
    if (!empId) { setEmployeeName(''); return }
    const emp = employees.find(e => e.id === empId)
    if (!emp) return
    setEmployeeName(emp.name)
    if (emp.default_wallet_id) setWalletId(emp.default_wallet_id)
    if (emp.default_salary) {
      setItems(prev => prev.map((it, idx) =>
        idx === 0 && it.item_type === 'salary' ? { ...it, amount: String(emp.default_salary) } : it
      ))
    }
  }

  // Calculated totals
  const grossAmount     = items.filter(i => i.direction === 'addition').reduce((s, i) => s + (Number(i.amount) || 0), 0)
  const deductionAmount = items.filter(i => i.direction === 'deduction').reduce((s, i) => s + (Number(i.amount) || 0), 0)
  const netAmount       = grossAmount - deductionAmount
  const canSubmit       = employeeName.trim().length > 0 && netAmount > 0 && items.every(i => i.label.trim()) && !saving

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSaving(true); setError('')
    try {
      const body = {
        employee_id:   employeeId || null,
        employee_name: employeeName.trim(),
        currency:      'IDR',
        wallet_id:     walletId || null,
        period_month:  periodMonth || null,
        payment_date:  paymentDate || null,
        notes:         notes.trim() || null,
        items: items.map(i => ({
          item_type: i.item_type,
          label:     i.label.trim(),
          amount:    Number(i.amount) || 0,
          direction: i.direction,
        })).filter(i => i.amount > 0),
      }
      const data = await apiFetch('/payroll/payments', token, { method: 'POST', body })
      onSuccess(data)
    } catch (e) {
      setError(e.message || t('payroll.failMsg'))
    } finally {
      setSaving(false)
    }
  }

  const inputSt  = { width: '100%', padding: '10px 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 'var(--text-sm)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
  const labelSt  = { display: 'block', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 5, marginTop: 14 }
  const lang     = getLang()

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="modal-drag-handle" />
        <button className="modal-close-btn" onClick={onClose}>✕</button>

        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{t('payroll.modalTitle')}</div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', marginBottom: 18 }}>💼 {t('payroll.subtitle')}</div>

        {/* Employee */}
        {employees.length > 0 && (
          <>
            <label style={labelSt}>{t('payroll.employees')}</label>
            <select style={{ ...inputSt }} value={employeeId} onChange={e => handleEmployeeSelect(e.target.value)}>
              <option value="">— {lang === 'ru' ? 'Выберите сотрудника' : lang === 'id' ? 'Pilih karyawan' : 'Select employee'} —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}{e.role ? ` · ${e.role}` : ''}</option>)}
            </select>
          </>
        )}

        <label style={labelSt}>{t('payroll.employeeName')}</label>
        <input type="text" style={inputSt} value={employeeName}
          onChange={e => { setEmployeeName(e.target.value); setError('') }}
          placeholder="Ahmad, Kevin, Marina…" />

        {/* Wallet + Period + Date */}
        {wallets.length > 0 && (
          <>
            <label style={labelSt}>{t('payroll.wallet')}</label>
            <select style={inputSt} value={walletId} onChange={e => setWalletId(e.target.value)}>
              <option value="">— {t('payroll.wallet')} —</option>
              {wallets.map(w => <option key={w.id} value={w.id}>{w.name}{w.scope === 'personal' ? ' (Personal)' : ''}</option>)}
            </select>
          </>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={labelSt}>{t('payroll.periodMonth')}</label>
            <input type="month" style={inputSt} value={periodMonth} onChange={e => setPeriodMonth(e.target.value)} />
          </div>
          <div>
            <label style={labelSt}>{t('payroll.paymentDate')}</label>
            <input type="date" style={inputSt} value={paymentDate} onChange={e => setPaymentDate(e.target.value)} />
          </div>
        </div>

        {/* ── Payroll Components ── */}
        <div style={{ marginTop: 18, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text-3)', textTransform: 'uppercase' }}>
            {t('payroll.components')}
          </div>
        </div>

        {/* Item rows */}
        {items.map((item) => (
          <div key={item.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            {/* Direction indicator */}
            <div style={{
              width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: item.direction === 'addition' ? '#E1F5EE' : '#FEE2E2',
              color: item.direction === 'addition' ? '#085041' : '#991B1B',
              fontSize: 14, fontWeight: 700,
            }}>
              {item.direction === 'addition' ? '+' : '−'}
            </div>

            {/* Label */}
            <input type="text" value={item.label}
              onChange={e => updateItem(item.id, 'label', e.target.value)}
              style={{ ...inputSt, flex: 2, marginBottom: 0 }}
              placeholder={lang === 'ru' ? 'Компонент' : lang === 'id' ? 'Komponen' : 'Component'} />

            {/* Amount */}
            <input type="number" value={item.amount}
              onChange={e => updateItem(item.id, 'amount', e.target.value)}
              style={{ ...inputSt, flex: 1.5, marginBottom: 0 }}
              placeholder="0" min="0" />

            {/* Remove */}
            {items.length > 1 && (
              <button onClick={() => removeItem(item.id)} style={{
                width: 28, height: 28, borderRadius: 8, border: 'none', background: 'var(--bg-3)',
                color: 'var(--text-3)', cursor: 'pointer', fontSize: 14, flexShrink: 0,
              }}>✕</button>
            )}
          </div>
        ))}

        {/* Quick-add chips */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14, marginTop: 6 }}>
          {QUICK_ITEMS.map(qi => (
            <button key={qi.item_type} onClick={() => addItem(qi)} style={{
              padding: '5px 11px', borderRadius: 20, fontSize: 11, border: '0.5px solid var(--border)',
              background: qi.direction === 'addition' ? '#E1F5EE' : '#FEE2E2',
              color: qi.direction === 'addition' ? '#085041' : '#991B1B',
              cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
            }}>
              {qi.direction === 'addition' ? '+' : '−'} {t(qi.labelKey)}
            </button>
          ))}
        </div>

        {/* ── Summary ── */}
        <div style={{ background: 'var(--bg-2)', borderRadius: 12, padding: '12px 14px', marginBottom: 14, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', color: 'var(--text-2)', marginBottom: 4 }}>
            <span>{t('payroll.grossAdditions')}</span>
            <span style={{ color: '#085041' }}>+{fmt(grossAmount)} IDR</span>
          </div>
          {deductionAmount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', color: 'var(--text-2)', marginBottom: 4 }}>
              <span>{t('payroll.totalDeductions')}</span>
              <span style={{ color: '#991B1B' }}>−{fmt(deductionAmount)} IDR</span>
            </div>
          )}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 'var(--text-base)' }}>
            <span style={{ color: 'var(--text)' }}>{t('payroll.netPaid')}</span>
            <span style={{ color: netAmount > 0 ? 'var(--text)' : 'var(--red-dark)' }}>{fmt(netAmount)} IDR</span>
          </div>
        </div>

        {/* Deduction disclaimer */}
        {deductionAmount > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12, lineHeight: 1.5, fontStyle: 'italic' }}>
            ⚠️ {lang === 'ru'
              ? 'Используйте удержания только если они согласованы и разрешены правилами компании.'
              : lang === 'id'
              ? 'Gunakan potongan hanya jika sudah disepakati dan sesuai aturan perusahaan.'
              : 'Use deductions only when they are agreed and allowed by your company policy.'}
          </div>
        )}

        <label style={labelSt}>{t('payroll.notes')}</label>
        <input type="text" style={{ ...inputSt, marginBottom: 16 }} value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder={lang === 'ru' ? 'Заметка (необязательно)' : lang === 'id' ? 'Catatan (opsional)' : 'Optional note'} />

        {error && (
          <div style={{ background: 'var(--red-light)', color: 'var(--red-dark)', borderRadius: 10, padding: '9px 13px', fontSize: 'var(--text-sm)', border: '1px solid rgba(240,68,56,.2)', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <button disabled={!canSubmit} onClick={handleSubmit} className="btn btn-block btn-lg"
          style={{ background: canSubmit ? 'var(--brand)' : 'var(--bg-3)', color: canSubmit ? '#fff' : 'var(--text-4)', marginBottom: 8, opacity: saving ? 0.7 : 1 }}>
          {saving ? t('payroll.saving') : `${t('payroll.create')} · ${fmt(netAmount)} IDR`}
        </button>
        <button onClick={onClose} disabled={saving} className="btn btn-ghost btn-block btn-lg">{t('payroll.cancel')}</button>
      </div>
    </div>,
    document.body
  )
}

// ── Add Employee Modal ────────────────────────────────────────────────────────
function EmployeeModal({ token, wallets, onClose, onSuccess, t }) {
  const [name,     setName]     = useState('')
  const [role,     setRole]     = useState('')
  const [salary,   setSalary]   = useState('')
  const [walletId, setWalletId] = useState('')
  const [payDay,   setPayDay]   = useState('')
  const [notes,    setNotes]    = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')
  const lang = getLang()

  const canSubmit = name.trim().length > 0 && !saving

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSaving(true); setError('')
    try {
      const body = { name: name.trim(), role: role.trim() || null, default_salary: salary ? Number(salary) : null, default_wallet_id: walletId || null, pay_day: payDay ? Number(payDay) : null, notes: notes.trim() || null }
      const data = await apiFetch('/payroll/employees', token, { method: 'POST', body })
      onSuccess(data.employee)
    } catch (e) {
      setError(e.message || t('payroll.empFail'))
    } finally {
      setSaving(false)
    }
  }

  const inputSt = { width: '100%', padding: '10px 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 'var(--text-sm)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
  const labelSt = { display: 'block', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 5, marginTop: 12 }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-drag-handle" />
        <button className="modal-close-btn" onClick={onClose}>✕</button>
        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text)', marginBottom: 16 }}>{t('payroll.employeeModalTitle')}</div>

        <label style={labelSt}>{t('payroll.empName')}</label>
        <input type="text" style={inputSt} value={name} autoFocus
          onChange={e => { setName(e.target.value); setError('') }}
          onKeyDown={e => { if (e.key === 'Enter' && canSubmit) handleSubmit() }}
          placeholder="Ahmad Rizky, Kevin…" />

        <label style={labelSt}>{t('payroll.empRole')}</label>
        <input type="text" style={inputSt} value={role} onChange={e => setRole(e.target.value)} placeholder="Developer, Designer…" />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={labelSt}>{t('payroll.empSalary')}</label>
            <input type="number" style={inputSt} value={salary} onChange={e => setSalary(e.target.value)} placeholder="5000000" />
          </div>
          <div>
            <label style={labelSt}>{t('payroll.empPayDay')}</label>
            <input type="number" style={inputSt} value={payDay} onChange={e => setPayDay(e.target.value)} placeholder="25" min="1" max="31" />
            <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 3 }}>
              {lang === 'ru' ? 'День месяца, когда обычно выплачивается зарплата'
               : lang === 'id' ? 'Tanggal bulanan saat gaji biasanya dibayarkan'
               : 'Day of month when salary is usually paid'}
            </div>
          </div>
        </div>

        {wallets.length > 0 && (
          <>
            <label style={labelSt}>{t('payroll.empWallet')}</label>
            <select style={inputSt} value={walletId} onChange={e => setWalletId(e.target.value)}>
              <option value="">— {t('payroll.wallet')} —</option>
              {wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </>
        )}

        <label style={labelSt}>{t('payroll.empNotes')}</label>
        <input type="text" style={{ ...inputSt, marginBottom: 16 }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />

        {error && (
          <div style={{ background: 'var(--red-light)', color: 'var(--red-dark)', borderRadius: 10, padding: '9px 13px', fontSize: 'var(--text-sm)', border: '1px solid rgba(240,68,56,.2)', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <button disabled={!canSubmit} onClick={handleSubmit} className="btn btn-block btn-lg"
          style={{ background: canSubmit ? 'var(--brand)' : 'var(--bg-3)', color: canSubmit ? '#fff' : 'var(--text-4)', marginBottom: 8, opacity: saving ? 0.7 : 1 }}>
          {saving ? t('payroll.empSaving') : t('payroll.empCreate')}
        </button>
        <button onClick={onClose} disabled={saving} className="btn btn-ghost btn-block btn-lg">{t('payroll.cancel')}</button>
      </div>
    </div>,
    document.body
  )
}

// ── Payment history card ──────────────────────────────────────────────────────
function PaymentCard({ p, t }) {
  const [expanded, setExpanded] = useState(false)
  const net   = Number(p.net_amount ?? p.amount ?? 0)
  const gross = Number(p.gross_amount ?? net)
  const deductions = Number(p.deduction_amount ?? 0)
  const items = p.payroll_payment_items || []

  return (
    <div className="item-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 0, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>💼</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="item-row-name">{p.employee_name}</div>
          <div className="item-row-sub">
            {fmtDate(p.payment_date)}
            {p.period_month ? ` · ${fmtPeriod(p.period_month)}` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="item-row-amount" style={{ color: 'var(--red-dark)' }}>−{fmt(net)} IDR</div>
          {deductions > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Gross {fmt(gross)}</div>
          )}
        </div>
      </div>

      {/* Deduction / gross summary row */}
      {deductions > 0 && (
        <div style={{ display: 'flex', gap: 12, marginTop: 6, paddingLeft: 46, fontSize: 11 }}>
          <span style={{ color: '#085041' }}>+{fmt(gross)}</span>
          <span style={{ color: '#991B1B' }}>−{fmt(deductions)}</span>
          <span style={{ color: 'var(--text-3)' }}>{t('payroll.netPaid')}: {fmt(net)}</span>
        </div>
      )}

      {/* Items expand */}
      {items.length > 0 && (
        <>
          <button onClick={() => setExpanded(e => !e)} style={{
            marginTop: 6, marginLeft: 46, background: 'none', border: 'none', padding: 0,
            fontSize: 11, color: 'var(--brand)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          }}>
            {expanded ? '▲ ' : '▼ '}{t('payroll.showComponents')} ({items.length})
          </button>
          {expanded && (
            <div style={{ marginTop: 6, marginLeft: 46, background: 'var(--bg-2)', borderRadius: 8, padding: '8px 10px', border: '1px solid var(--border)' }}>
              {items.map(item => (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '0.5px solid var(--border)', color: 'var(--text-2)' }}>
                  <span>{item.label}</span>
                  <span style={{ fontWeight: 600, color: item.direction === 'addition' ? '#085041' : '#991B1B' }}>
                    {item.direction === 'addition' ? '+' : '−'}{fmt(item.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Main Payroll Page ─────────────────────────────────────────────────────────
export default function Payroll() {
  const { token }  = useAuth()
  const navigate   = useNavigate()
  const { t } = useTranslation()
  const { hasFeature, effectivePlan, loading: accessLoading } = useAccess()

  const [overview,  setOverview]  = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [wallets,   setWallets]   = useState([])
  const [showPaymentModal,  setShowPaymentModal]  = useState(false)
  const [showEmployeeModal, setShowEmployeeModal] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  const load = () => {
    setLoading(true)
    Promise.all([
      apiFetch('/payroll/overview', token),
      apiFetch('/wallets', token),
    ])
      .then(([ov, wRes]) => { setOverview(ov); setWallets(wRes.wallets || []) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { if (token) load() }, [token])

  // ── Feature gate ──────────────────────────────────────────────────────────
  if (!accessLoading && !hasFeature('payroll_enabled')) {
    return (
      <div className="hf-page">
        <div className="hf-page-header">
          <div>
            <div className="hf-page-title">{t('payroll.title')}</div>
            <div className="hf-page-subtitle">{t('payroll.subtitle')}</div>
          </div>
        </div>
        <LockedFeature
          title="Payroll"
          description="Track and manage employee salary payments, bonuses and payroll history — all connected to your cash flow."
          requiredPlan="business"
          currentPlan={effectivePlan}
          icon="💼"
          bullets={[
            'Manage employees and salary schedules',
            'Log salary + bonus + deductions per payment',
            'Net paid automatically creates a transaction',
            'Monthly payroll cost summary',
          ]}
        />
      </div>
    )
  }

  if (loading) return <div className="page-loading">Loading payroll…</div>

  const employees = overview?.employees || []
  const payments  = overview?.payments  || []
  const summary   = overview?.summary   || {}
  const hasAny    = employees.length > 0 || payments.length > 0

  const handlePaymentSuccess = () => {
    setShowPaymentModal(false)
    setSuccessMsg(t('payroll.success'))
    setTimeout(() => setSuccessMsg(''), 3500)
    load()
  }

  return (
    <div className="hf-page">

      {/* ── Header ─── */}
      <div className="hf-page-header">
        <div>
          <div className="hf-page-title">{t('payroll.title')}</div>
          <div className="hf-page-subtitle">{t('payroll.subtitle')}</div>
        </div>
        <div className="hf-page-actions" style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-md" onClick={() => setShowEmployeeModal(true)}>{t('payroll.addEmployee')}</button>
          <button className="btn btn-primary btn-md" onClick={() => setShowPaymentModal(true)}>{t('payroll.addPayment')}</button>
        </div>
      </div>

      {error && <div className="page-error" style={{ marginBottom: 16 }}>{error}</div>}

      {successMsg && (
        <div style={{ background: 'var(--green-light)', color: 'var(--green-dark)', borderRadius: 12, padding: '11px 16px', fontSize: 'var(--text-sm)', fontWeight: 500, marginBottom: 16, border: '1px solid rgba(5,150,105,.2)' }}>
          ✓ {successMsg}
        </div>
      )}

      {/* ── Empty state ─── */}
      {!hasAny && (
        <div className="empty-state">
          <div className="empty-state-icon">💼</div>
          <div className="empty-state-title">{t('payroll.noEmployees')}</div>
          <div className="empty-state-sub">{t('payroll.noEmployeesSub')}</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="empty-state-cta" onClick={() => setShowEmployeeModal(true)}>{t('payroll.addEmployeeCta')}</button>
            <button className="btn btn-secondary btn-md" style={{ borderRadius: 12 }} onClick={() => setShowPaymentModal(true)}>{t('payroll.addCta')}</button>
          </div>
        </div>
      )}

      {hasAny && (
        <>
          {/* ── Summary cards ─── */}
          <div className="summary-grid" style={{ marginBottom: 20 }}>
            <div className="summary-card">
              <div className="summary-card-label">{t('payroll.paidThisMonth')}</div>
              <div className="summary-card-value" style={{ color: 'var(--text)' }}>{fmt(summary.paid_this_month || 0)}</div>
              <div className="summary-card-sub">IDR · {summary.payments_this_month || 0} payments</div>
            </div>
            <div className="summary-card">
              <div className="summary-card-label">{t('payroll.employees')}</div>
              <div className="summary-card-value" style={{ color: 'var(--text)' }}>{summary.employee_count || 0}</div>
              <div className="summary-card-sub">active</div>
            </div>
            <div className="summary-card">
              <div className="summary-card-label">{t('payroll.totalRecords')}</div>
              <div className="summary-card-value" style={{ color: 'var(--text)' }}>{payments.length}</div>
              <div className="summary-card-sub">{t('payroll.allPayrollTx')}</div>
            </div>
            <div className="summary-card">
              <div className="summary-card-label">{t('payroll.totalPaid')}</div>
              <div className="summary-card-value" style={{ color: 'var(--red-dark)' }}>{fmt(summary.total_paid_all || 0)}</div>
              <div className="summary-card-sub">{t('payroll.allTime')}</div>
            </div>
          </div>

          {/* ── Employees ─── */}
          {employees.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div className="section-title">{t('payroll.employees')} · {employees.length}</div>
                <button className="link-btn" onClick={() => setShowEmployeeModal(true)}>+ {t('payroll.addEmployee')}</button>
              </div>
              <div className="item-list-card">
                {employees.map(emp => (
                  <div key={emp.id} className="item-row">
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--brand-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>👤</div>
                    <div className="item-row-left">
                      <div className="item-row-name">{emp.name}</div>
                      <div className="item-row-sub">
                        {emp.role || '—'}
                        {emp.pay_day ? ` · ${t('payroll.scheduledPayday')} ${emp.pay_day}` : ''}
                      </div>
                    </div>
                    <div className="item-row-right">
                      {emp.default_salary
                        ? <div className="item-row-amount">{fmt(emp.default_salary)} IDR</div>
                        : <div className="item-row-amount" style={{ color: 'var(--text-4)' }}>—</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Payroll history ─── */}
          <div style={{ marginBottom: 24 }}>
            <div className="section-title">{t('payroll.history')} · {payments.length}</div>
            {payments.length === 0 ? (
              <div style={{ background: 'var(--bg-2)', borderRadius: 14, padding: '24px 16px', textAlign: 'center', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>💼</div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', marginBottom: 12 }}>{t('payroll.noRecords')}</div>
                <button className="btn btn-primary btn-md" onClick={() => setShowPaymentModal(true)}>{t('payroll.addCta')}</button>
              </div>
            ) : (
              <div className="item-list-card" style={{ padding: 0 }}>
                {payments.map(p => <PaymentCard key={p.id} p={p} t={t} />)}
              </div>
            )}
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button className="link-btn" onClick={() => navigate('/transactions')}>{t('payroll.viewAllTx')}</button>
            </div>
          </div>
        </>
      )}

      {/* ── Modals ─── */}
      {showPaymentModal && (
        <PayrollModal token={token} employees={employees} wallets={wallets}
          onClose={() => setShowPaymentModal(false)} onSuccess={handlePaymentSuccess} t={t} />
      )}
      {showEmployeeModal && (
        <EmployeeModal token={token} wallets={wallets}
          onClose={() => setShowEmployeeModal(false)} onSuccess={() => { setShowEmployeeModal(false); load() }} t={t} />
      )}
    </div>
  )
}
