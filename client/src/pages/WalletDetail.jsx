import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt } from '../lib/api'

function fmtDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const TYPE_CONFIG = {
  income:   { label: 'Income',   bg: '#E1F5EE', color: '#085041', sign: '+' },
  expense:  { label: 'Expense',  bg: '#FEE2E2', color: '#991B1B', sign: '−' },
  transfer: { label: 'Transfer', bg: '#E8EDFB', color: '#1e3a6e', sign: '↔' },
  payroll:  { label: 'Payroll',  bg: '#FEF3C7', color: '#92400E', sign: '−' },
}
function getType(type) {
  return TYPE_CONFIG[type] || { label: type || 'Other', bg: 'var(--bg-3)', color: 'var(--text-3)', sign: '' }
}

const WALLET_TYPES = {
  bank: 'Bank account', cash: 'Cash', ewallet: 'E-Wallet',
  alipay: 'Alipay', wechat_pay: 'WeChat Pay', crypto: 'Crypto',
  payment_gateway: 'Payment gateway', other: 'Other',
}

const PERIODS = [
  { key: 'all',   label: 'All time' },
  { key: 'month', label: 'This month' },
  { key: '3m',    label: '3 months' },
  { key: 'week',  label: 'This week' },
]

export default function WalletDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { token } = useAuth()

  const [wallet, setWallet]   = useState(null)
  const [txs,    setTxs]      = useState([])
  const [loading, setLoading] = useState(true)
  const [period,  setPeriod]  = useState('month')

  useEffect(() => {
    setLoading(true)
    apiFetch(`/wallets/${id}/transactions?period=${period}`, token)
      .then(r => { setWallet(r.wallet); setTxs(r.transactions || []) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id, period, token])

  // Summary stats
  const income   = txs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount_idr || 0), 0)
  const expenses = txs.filter(t => ['expense','payroll'].includes(t.type)).reduce((s, t) => s + Number(t.amount_idr || 0), 0)
  const net      = income - expenses

  return (
    <div className="hf-page">

      {/* Back header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <button
          onClick={() => navigate('/accounts')}
          style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2.2" strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <div>
          <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--text)', letterSpacing: -0.5 }}>
            {wallet?.name || 'Wallet'}
          </div>
          {wallet && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', marginTop: 1 }}>
              {wallet.currency} · {WALLET_TYPES[wallet.type] || wallet.type || 'Account'}
            </div>
          )}
        </div>
      </div>

      {/* Summary stats */}
      {!loading && txs.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
          {[
            { label: 'Income',   value: '+' + fmt(income),   color: 'var(--green-dark)' },
            { label: 'Expenses', value: '−' + fmt(expenses), color: 'var(--red-dark)' },
            { label: 'Net',      value: (net >= 0 ? '+' : '−') + fmt(Math.abs(net)), color: net >= 0 ? 'var(--green-dark)' : 'var(--red-dark)' },
          ].map(s => (
            <div key={s.label} className="summary-card" style={{ textAlign: 'center' }}>
              <div className="summary-card-label">{s.label}</div>
              <div className="summary-card-value" style={{ color: s.color, fontSize: 'clamp(13px, 3.5vw, 16px)' }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Period filter */}
      <div className="filter-tabs" style={{ marginBottom: 16 }}>
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)} style={{
            padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            whiteSpace: 'nowrap', cursor: 'pointer', transition: 'all .12s',
            background: period === p.key ? 'var(--text)' : 'var(--bg-2)',
            color:      period === p.key ? 'var(--bg)'  : 'var(--text-3)',
            border:     period === p.key ? 'none'       : '0.5px solid var(--border)',
          }}>{p.label}</button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <div style={{ width: 24, height: 24, border: '2.5px solid var(--border-2)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'tx-spin 0.7s linear infinite' }} />
        </div>
      )}

      {/* Transaction list */}
      {!loading && txs.length > 0 && (
        <div className="item-list-card" style={{ marginBottom: 16 }}>
          {txs.map((tx, i) => {
            const tc   = getType(tx.type)
            const isIn = tx.type === 'income'
            const amt  = Number(tx.amount_idr || 0)
            return (
              <div key={tx.id} className="item-row" style={{ padding: '12px 14px', borderBottom: i < txs.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                <div className="item-row-left" style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, background: tc.bg, color: tc.color, fontWeight: 700 }}>{tc.label}</span>
                    {tx.category && <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{tx.category}</span>}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tx.description || tx.source || '—'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{fmtDate(tx.transaction_date || tx.created_at)}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: isIn ? 'var(--green-dark)' : 'var(--red-dark)', letterSpacing: -0.3 }}>
                    {isIn ? '+' : '−'}{fmt(amt)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{tx.currency || 'IDR'}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Empty state */}
      {!loading && txs.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 20px' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>💳</div>
          <div style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>No transactions</div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)' }}>
            No transactions found for this wallet{period !== 'all' ? ' in this period' : ''}.
          </div>
        </div>
      )}
    </div>
  )
}
