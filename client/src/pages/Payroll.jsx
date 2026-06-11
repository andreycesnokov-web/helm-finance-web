import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useAccess } from '../hooks/useAccess'
import { useTranslation } from '../hooks/useTranslation'
import { apiFetch, fmt } from '../lib/api'
import LockedFeature from '../components/LockedFeature'

function fmtDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * isPayrollTx — strict guard, returns true only for genuine payroll transactions.
 *
 * A transaction is payroll if:
 *   tx.type === 'payroll'
 *   OR tx.category is a payroll category
 *   OR tx.description matches explicit payroll keywords
 *
 * NOT payroll:
 *   Opening balance, Balance adjustment, server payment, food, transport,
 *   ordinary income, ordinary expense, transfers, corrections, etc.
 */
function isPayrollTx(tx) {
  // Primary: explicit type field (set when created via /add with type:payroll)
  if (tx.type === 'payroll') return true

  const cat  = (tx.category    || '').toLowerCase().trim()
  const desc = (tx.description || '').toLowerCase().trim()

  // Category-based
  if (['payroll', 'salary', 'gaji', 'bonus', 'commission'].includes(cat)) return true

  // Description-based — only explicit payroll keywords
  const KEYWORDS = ['payroll', 'salary', 'gaji', 'bonus', 'commission', 'thr', 'employee payment', 'employee salary', 'staff salary', 'worker salary']
  if (KEYWORDS.some(kw => desc.includes(kw))) return true

  // "Payment: <name>" pattern is created by the debt payment flow — NOT payroll
  // Explicitly exclude common non-payroll patterns
  const EXCLUDE = ['opening balance', 'balance adjustment', 'adjustment', 'correction', 'server', 'food', 'transport', 'ticket', 'coffee', 'kopi']
  if (EXCLUDE.some(kw => desc.includes(kw))) return false

  return false
}

export default function Payroll() {
  const { token }  = useAuth()
  const navigate   = useNavigate()
  const { t } = useTranslation()
  const { hasFeature, effectivePlan, loading: accessLoading } = useAccess()
  const [txs, setTxs]         = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    // Request type=payroll (now filtered by backend) + period=all (full history)
    // Client-side isPayrollTx() acts as a defense-in-depth guard
    apiFetch('/transactions?type=payroll&period=all', token)
      .then(data => {
        const all = Array.isArray(data) ? data : []
        // Defense-in-depth: even if backend returns extras, filter strictly
        setTxs(all.filter(isPayrollTx))
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading && !txs.length) return <div className="page-loading">Loading payroll…</div>

  const now       = new Date()
  const thisMonth = txs.filter(t => {
    const d = new Date(t.created_at)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  })

  const totalPaidThisMonth = thisMonth.reduce((s, t) => s + Number(t.amount_original || t.amount_idr || 0), 0)
  const totalAll           = txs.reduce((s, t)      => s + Number(t.amount_original || t.amount_idr || 0), 0)

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
            'Log salary and bonus payments',
            'Payroll automatically affects Pulse cash flow',
            'Monthly payroll cost summary',
            'Payroll history per employee',
          ]}
        />
      </div>
    )
  }

  return (
    <div className="hf-page">

      {/* ── Header ─── */}
      <div className="hf-page-header">
        <div>
          <div className="hf-page-title">{t('payroll.title')}</div>
          <div className="hf-page-subtitle">{t('payroll.subtitle')}</div>
        </div>
        <div className="hf-page-actions">
          {/* Routes to /add with payroll context — AI parser creates type:payroll if user describes salary */}
          <button className="btn btn-primary btn-md" onClick={() => navigate('/add?type=payroll')}>{t('payroll.addPayroll')}</button>
        </div>
      </div>

      {error && <div className="page-error" style={{ marginBottom: 16 }}>{error}</div>}

      {/* ── Empty state — honest, no fake data ─── */}
      {!loading && txs.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">💼</div>
          <div className="empty-state-title">{t('payroll.noRecords')}</div>
          <div className="empty-state-sub">{t('payroll.noRecordsSub')}</div>
          <button className="empty-state-cta" onClick={() => navigate('/add?type=payroll')}>{t('payroll.addCta')}</button>
        </div>
      )}

      {/* ── Summary — only shown when payroll data exists ─── */}
      {txs.length > 0 && (
        <>
          <div className="summary-grid" style={{ marginBottom: 20 }}>
            <div className="summary-card">
              <div className="summary-card-label">{t('payroll.paidThisMonth')}</div>
              <div className="summary-card-value" style={{ color: 'var(--text)' }}>{fmt(totalPaidThisMonth)}</div>
              <div className="summary-card-sub">IDR · {thisMonth.length}</div>
            </div>
            <div className="summary-card">
              <div className="summary-card-label">{t('payroll.totalRecords')}</div>
              <div className="summary-card-value" style={{ color: 'var(--text)' }}>{txs.length}</div>
              <div className="summary-card-sub">{t('payroll.allPayrollTx')}</div>
            </div>
            <div className="summary-card">
              <div className="summary-card-label">{t('payroll.dueToday')}</div>
              <div className="summary-card-value" style={{ color: 'var(--text-3)' }}>—</div>
              <div className="summary-card-sub">{t('payroll.scheduledPayroll')}</div>
            </div>
            <div className="summary-card">
              <div className="summary-card-label">{t('payroll.totalPaid')}</div>
              <div className="summary-card-value" style={{ color: 'var(--red-dark)' }}>{fmt(totalAll)}</div>
              <div className="summary-card-sub">{t('payroll.allTime')}</div>
            </div>
          </div>

          {/* ── Payroll history ─── */}
          <div style={{ marginBottom: 24 }}>
            <div className="section-title">{t('payroll.history')} · {txs.length}</div>
            <div className="item-list-card">
              {txs.map(t => {
                const amount = Number(t.amount_original || t.amount_idr || 0)
                const cur    = t.currency_original && t.currency_original !== 'IDR' ? t.currency_original : 'IDR'
                return (
                  <div key={t.id} className="item-row">
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--amber-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                      💼
                    </div>
                    <div className="item-row-left">
                      <div className="item-row-name">{t.description || t.category || 'Payroll'}</div>
                      <div className="item-row-sub">
                        {fmtDate(t.created_at)}
                        {t.source ? ` · ${t.source}` : ''}
                        {t.category && t.category !== t.description ? ` · ${t.category}` : ''}
                      </div>
                    </div>
                    <div className="item-row-right">
                      <div className="item-row-amount" style={{ color: 'var(--red-dark)' }}>−{fmt(amount)} {cur}</div>
                      <span className="status-pill open">Payroll</span>
                    </div>
                  </div>
                )
              })}
            </div>

            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button className="link-btn" onClick={() => navigate('/transactions')}>{t('payroll.viewAllTx')}</button>
            </div>
          </div>

          {/* ── AI parser hint ─── */}
          <div className="hf-card" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800, marginBottom: 8 }}>{t('payroll.howToAdd')}</div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)', lineHeight: 1.6 }}>
              Use <strong>Add</strong> and describe the payment as a salary or payroll transaction. The AI parser will classify it correctly.<br />
              <span style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>Example: "paid salary to Ahmad 5 million" or "gaji karyawan 5 juta"</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
