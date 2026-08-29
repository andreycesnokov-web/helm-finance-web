// Platform Admin — Payment Connections monitor (READ-ONLY).
//
// Observes provider routing configuration across every business. There is deliberately no
// write action here: an admin watches connections, they do not reconfigure a customer's
// accounting routing. The backing endpoint exposes no credential because none is ever
// stored (migration 051 has no secret column).
import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { apiFetch } from '../lib/api'
import { AdminTabs } from './AdminBusinesses'

const fmt = (d) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

const TONE = {
  connected:    ['#085041', '#E1F5EE'],
  disconnected: ['#1e40af', '#EFF6FF'],
  error:        ['#991B1B', '#FEE2E2'],
  disabled:     ['#6B7280', '#F3F4F6'],
}
const Pill = ({ s }) => {
  const [fg, bg] = TONE[s] || ['#374151', '#F3F4F6']
  return <span style={{ background: bg, color: fg, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{s}</span>
}

export default function AdminPaymentConnections() {
  const { token } = useAuth()
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!token) return
    apiFetch('/admin/payment-connections?limit=300', token)
      .then(r => setRows(r.connections || []))
      .catch(setError)
  }, [token])

  if (error) {
    // A 404 here means PAYMENT_CONNECTIONS_ENABLED is off for this deployment, not a fault.
    const disabled = /not_found|404/i.test(error.message || '')
    return <div style={{ padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 48 }}>{disabled ? '🔌' : /Forbidden|access/.test(error.message) ? '🔒' : '⚠️'}</div>
      <div>{disabled ? 'Payment Connections is not enabled on this deployment.' : error.message}</div>
    </div>
  }

  const headers = ['Business', 'Provider', 'Env', 'Status', 'Account ID', 'Linked wallet', 'Last sync', 'Last webhook', 'Last error', 'Created']

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>🛠 Platform Admin</h1>
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>
        Payment provider connections (read-only · no credentials are stored)
      </div>
      <AdminTabs active="payments" />
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: 'var(--bg-3)', textAlign: 'left' }}>
            {headers.map(h => <th key={h} style={{ padding: 8, whiteSpace: 'nowrap' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={headers.length} style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>No connections</td></tr>}
            {rows.map(c => (
              <tr key={c.id} style={{ borderTop: '0.5px solid var(--border)' }}>
                <td style={{ padding: 8 }}>{c.business_name || c.business_code || c.business_id?.slice(0, 8)}</td>
                <td style={{ padding: 8, fontWeight: 600 }}>{c.provider}</td>
                <td style={{ padding: 8 }}>{c.environment}</td>
                <td style={{ padding: 8 }}><Pill s={c.status} /></td>
                <td style={{ padding: 8, fontFamily: 'monospace' }}>{c.provider_account_id || '—'}</td>
                <td style={{ padding: 8 }}>{c.linked_wallet_name || '—'}</td>
                <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{fmt(c.last_sync_at)}</td>
                <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{fmt(c.last_webhook_at)}</td>
                <td style={{ padding: 8, color: c.last_error ? '#991B1B' : 'var(--text-3)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.last_error || '—'}</td>
                <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{fmt(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 12 }}>
        Sync and webhook columns stay empty until provider integration ships. A connection
        records routing intent only — it moves no money and creates no ledger entries.
      </div>
    </div>
  )
}
