import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useAccess } from '../hooks/useAccess'
import { useTranslation } from '../hooks/useTranslation'
import { apiFetch, fmt } from '../lib/api'

function fmtDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtPeriod(str) {
  if (!str) return '—'
  const [y, m] = str.split('-')
  if (!y || !m) return str
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

const PAYMENT_TYPE_COLORS = {
  salary:     { bg: '#FEF3C7', color: '#92400E' },
  bonus:      { bg: '#E1F5EE', color: '#085041' },
  advance:    { bg: '#E8EDFB', color: '#1e3a6e' },
  commission: { bg: '#F3E8FF', color: '#6b21a8' },
  other:      { bg: '#F1F5F9', color: '#475569' },
}

// ── Add Payroll Payment Modal ─────────────────────────────────────────────────
function PayrollModal({ token, employees, wallets, onClose, onSuccess, t }) {
  const defaultPeriod = (() => {
    const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
  })()

  const [employeeId,   setEmployeeId]   = useState('')
  const [employeeName, setEmployeeName] = useState('')
  const [paymentType,  setPaymentType]  = useState('salary')
  const [amount,       setAmount]       = useState('')
  const [walletId,     setWalletId]     = useState('')
  const [periodMonth,  setPeriodMonth]  = useState(defaultPeriod)
  const [paymentDate,  setPaymentDate]  = useState(new Date().toISOString().slice(0, 10))
  const [notes,        setNotes]        = useState('')
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')

  // When employee selected from dropdown — prefill name + wallet
  const handleEmployeeSelect = (empId) => {
    setEmployeeId(empId)
    if (!empId) { setEmployeeName(''); return }
    const emp = employees.find(e => e.id === empId)
    if (!emp) return
    setEmployeeName(emp.name)
    if (emp.default_wallet_id) setWalletId(emp.default_wallet_id)
    if (emp.default_salary) setAmount(String(emp.default_salary))
  }

  const canSubmit = employeeName.trim().length > 0 && Number(amount) > 0 && !saving

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSaving(true); setError('')
    try {
      const body = {
        employee_id:   employeeId || null,
        employee_name: employeeName.trim(),
        payment_type:  paymentType,
        amount:        Number(amount),
        currency:      'IDR',
        wallet_id:     walletId || null,
        period_month:  periodMonth || null,
        payment_date:  paymentDate || null,
        notes:         notes.trim() || null,
      }
      const data = await apiFetch('/payroll/payments', token, { method: 'POST', body })
      onSuccess(data)
    } catch (e) {
      setError(e.message || t('payroll.failMsg'))
    } finally {
      setSaving(false)
    }
  }

  const inputSt = {
    width: '100%', padding: '10px 13px', borderRadius: 10, border: '1px solid var(--border)',
    background: 'var(--bg-2)', color: 'var(--text)', fontSize: 'var(--text-sm)',
    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  }
  const labelSt = {
    display: 'block', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em',
    color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 5, marginTop: 12,
  }

  const TYPES = ['salary', 'bonus', 'advance', 'commission', 'other']

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="modal-drag-handle" />
        <button className="modal-close-btn" onClick={onClose}>✕</button>

        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{t('payroll.modalTitle')}</div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', marginBottom: 18 }}>💼 {t('payroll.subtitle')}</div>

        {/* Employee select (optional) */}
        {employees.length > 0 && (
          <>
            <label style={labelSt}>{t('payroll.employees')}</label>
            <select style={{ ...inputSt, marginBottom: 4 }} value={employeeId} onChange={e => handleEmployeeSelect(e.target.value)}>
              <option value="">— {t('payroll.employeeName')} —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}{e.role ? ` · ${e.role}` : ''}</option>)}
            </select>
          </>
        )}

        <label style={labelSt}>{t('payroll.employeeName')}</label>
        <input type="text" style={inputSt} value={employeeName}
          onChange={e => { setEmployeeName(e.target.value); setError('') }}
          placeholder="Ahmad, Kevin, Marina…" />

        <label style={labelSt}>{t('payroll.paymentType')}</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 4 }}>
          {TYPES.map(tp => (
            <button key={tp} type="button" onClick={() => setPaymentType(tp)} style={{
              padding: '8px 4px', borderRadius: 10, fontSize: 12, fontWeight: 500,
              border: paymentType === tp ? 'none' : '0.5px solid var(--border)',
              background: paymentType === tp ? 'var(--brand-light)' : 'none',
              color: paymentType === tp ? 'var(--brand-dark)' : 'var(--text-3)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>{t(`payroll.${tp}`)}</button>
          ))}
        </div>

        <label style={labelSt}>{t('payroll.amount')}</label>
        <input type="number" style={inputSt} value={amount}
          onChange={e => { setAmount(e.target.value); setError('') }}
          placeholder="e.g. 5000000" min="1" />

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

        <label style={labelSt}>{t('payroll.notes')}</label>
        <input type="text" style={{ ...inputSt, marginBottom: 16 }} value={notes}
          onChange={e => setNotes(e.target.value)} placeholder="Optional note" />

        {error && (
          <div style={{ background: 'var(--red-light)', color: 'var(--red-dark)', borderRadius: 10, padding: '9px 13px', fontSize: 'var(--text-sm)', border: '1px solid rgba(240,68,56,.2)', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <button disabled={!canSubmit} onClick={handleSubmit} className="btn btn-block btn-lg"
          style={{ background: canSubmit ? 'var(--brand)' : 'var(--bg-3)', color: canSubmit ? '#fff' : 'var(--text-4)', marginBottom: 8, opacity: saving ? 0.7 : 1 }}>
          {saving ? t('payroll.saving') : t('payroll.create')}
        </button>
        <button onClick={onClose} disabled={saving} className="btn btn-ghost btn-block btn-lg">{t('payroll.cancel')}</button>
      </div>
    </div>,
    document.body
  )
}

// ── Add Employee Modal ────────────────────────────────────────────────────────
function EmployeeModal({ token, wallets, onClose, onSuccess, t }) {
  const [name,    setName]    = useState('')
  const [role,    setRole]    = useState('')
  const [salary,  setSalary]  = useState('')
  const [walletId, setWalletId] = useState('')
  const [payDay,  setPayDay]  = useState('')
  const [notes,   setNotes]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  const canSubmit = name.trim().length > 0 && !saving

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSaving(true); setError('')
    try {
      const body = {
        name: name.trim(),
        role: role.trim() || null,
        default_salary: salary ? Number(salary) : null,
        default_wallet_id: walletId || null,
        pay_day: payDay ? Number(payDay) : null,
        notes: notes.trim() || null,
      }
      const data = await apiFetch('/payroll/employees', token, { method: 'POST', body })
      onSuccess(data.employee)
    } catch (e) {
      setError(e.message || t('payroll.empFail'))
    } finally {
      setSaving(false)
    }
  }

  const inputSt = {
    width: '100%', padding: '10px 13px', borderRadius: 10, border: '1px solid var(--border)',
    background: 'var(--bg-2)', color: 'var(--text)', fontSize: 'var(--text-sm)',
    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  }
  const labelSt = {
    display: 'block', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em',
    color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 5, marginTop: 12,
  }

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
        <input type="text" style={inputSt} value={role}
          onChange={e => setRole(e.target.value)} placeholder="Developer, Designer, Manager…" />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={labelSt}>{t('payroll.empSalary')}</label>
            <input type="number" style={inputSt} value={salary}
              onChange={e => setSalary(e.target.value)} placeholder="5000000" />
          </div>
          <div>
            <label style={labelSt}>{t('payroll.empPayDay')}</label>
            <input type="number" style={inputSt} value={payDay}
              onChange={e => setPayDay(e.target.value)} placeholder="25" min="1" max="31" />
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
        <input type="text" style={{ ...inputSt, marginBottom: 16 }} value={notes}
          onChange={e => setNotes(e.target.value)} placeholder="Optional" />

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
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showEmployeeModal, setShowEmployeeModal] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  const load = () => {
    setLoading(true)
    Promise.all([
      apiFetch('/payroll/overview', token),
      apiFetch('/wallets', token),
    ])
      .then(([ov, wRes]) => {
        setOverview(ov)
        setWallets(wRes.wallets || [])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { if (token) load() }, [token])

  // ── Feature gate ──────────────────────────────────────────────────────────
  const LockedFeature = require('../components/LockedFeature').default
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
            'Log salary, bonus and advance payments',
            'Payroll automatically affects Pulse cash flow',
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

  const handlePaymentSuccess = (data) => {
    setShowPaymentModal(false)
    setSuccessMsg(t('payroll.success'))
    setTimeout(() => setSuccessMsg(''), 3500)
    load()
  }

  const handleEmployeeSuccess = (emp) => {
    setShowEmployeeModal(false)
    load()
  }

  const hasAny = employees.length > 0 || payments.length > 0

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
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--brand-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                      👤
                    </div>
                    <div className="item-row-left">
                      <div className="item-row-name">{emp.name}</div>
                      <div className="item-row-sub">
                        {emp.role || '—'}
                        {emp.pay_day ? ` · Payday: ${emp.pay_day}` : ''}
                      </div>
                    </div>
                    <div className="item-row-right">
                      {emp.default_salary
                        ? <div className="item-row-amount">{fmt(emp.default_salary)} IDR</div>
                        : <div className="item-row-amount" style={{ color: 'var(--text-4)' }}>—</div>}
                      <span className="status-pill open">{t('payroll.salary')}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Payroll payments ─── */}
          <div style={{ marginBottom: 24 }}>
            <div className="section-title">{t('payroll.history')} · {payments.length}</div>
            {payments.length === 0 ? (
              <div style={{ background: 'var(--bg-2)', borderRadius: 14, padding: '24px 16px', textAlign: 'center', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>💼</div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', marginBottom: 12 }}>{t('payroll.noRecords')}</div>
                <button className="btn btn-primary btn-md" onClick={() => setShowPaymentModal(true)}>{t('payroll.addCta')}</button>
              </div>
            ) : (
              <div className="item-list-card">
                {payments.map(p => {
                  const colors = PAYMENT_TYPE_COLORS[p.payment_type] || PAYMENT_TYPE_COLORS.other
                  return (
                    <div key={p.id} className="item-row">
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: colors.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                        💼
                      </div>
                      <div className="item-row-left">
                        <div className="item-row-name">{p.employee_name}</div>
                        <div className="item-row-sub">
                          {fmtDate(p.payment_date)}
                          {p.period_month ? ` · ${fmtPeriod(p.period_month)}` : ''}
                          {p.notes ? ` · ${p.notes}` : ''}
                        </div>
                      </div>
                      <div className="item-row-right">
                        <div className="item-row-amount" style={{ color: 'var(--red-dark)' }}>−{fmt(p.amount)} IDR</div>
                        <span className="status-pill open" style={{ background: colors.bg, color: colors.color }}>
                          {t(`payroll.${p.payment_type}`) || p.payment_type}
                        </span>
                      </div>
                    </div>
                  )
                })}
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
        <PayrollModal
          token={token}
          employees={employees}
          wallets={wallets}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={handlePaymentSuccess}
          t={t}
        />
      )}
      {showEmployeeModal && (
        <EmployeeModal
          token={token}
          wallets={wallets}
          onClose={() => setShowEmployeeModal(false)}
          onSuccess={handleEmployeeSuccess}
          t={t}
        />
      )}
    </div>
  )
}
