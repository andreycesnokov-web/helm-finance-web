import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { apiFetch } from '../lib/api'
import { AdminTabs, Badge } from './AdminBusinesses'

const fmt = (d) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

export default function AdminAccessAudit() {
  const { token } = useAuth()
  const [events, setEvents] = useState([]); const [error, setError] = useState(null)
  useEffect(() => { if (token) apiFetch('/admin/access-audit?limit=200', token).then(r => setEvents(r.events || [])).catch(setError) }, [token])

  if (error) return <div style={{ padding: 40, textAlign: 'center' }}><div style={{ fontSize: 48 }}>{/Forbidden|access/.test(error.message) ? '🔒' : '⚠️'}</div><div>{error.message}</div></div>
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>🛠 Platform Admin</h1>
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>Access change history (append-only)</div>
      <AdminTabs active="audit" />
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: 'var(--bg-3)', textAlign: 'left' }}>{['When', 'Business', 'Action', 'Effective', 'Reason', 'By'].map(h => <th key={h} style={{ padding: 8 }}>{h}</th>)}</tr></thead>
          <tbody>
            {events.length === 0 && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>No events</td></tr>}
            {events.map(e => (
              <tr key={e.id} style={{ borderTop: '0.5px solid var(--border)' }}>
                <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{fmt(e.changed_at)}</td>
                <td style={{ padding: 8 }}>{e.business_code || e.business_id?.slice(0, 8)}</td>
                <td style={{ padding: 8 }}>{e.action}</td>
                <td style={{ padding: 8 }}>{e.previous_effective_plan} → <b>{e.new_effective_plan}</b></td>
                <td style={{ padding: 8 }}>{e.reason || '—'}</td>
                <td style={{ padding: 8 }}>{e.changed_by_user_id || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
