import { useNavigate } from 'react-router-dom'

const SECTIONS = [
  { icon: '↓', label: 'Receivable Invoices', sub: 'Money clients owe you',        color: 'var(--green-light)', textColor: 'var(--green-dark)' },
  { icon: '↑', label: 'Payable Invoices',    sub: 'Bills you need to pay',         color: 'var(--red-light)',   textColor: 'var(--red-dark)'   },
  { icon: '⚠', label: 'Overdue Invoices',    sub: 'Past due date — needs action',  color: 'var(--amber-light)', textColor: 'var(--amber-dark)'  },
]

export default function Invoices() {
  const navigate = useNavigate()

  return (
    <div className="page">

      {/* ── Header ─── */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-header-title">Invoices</div>
          <div className="page-header-sub">Create and track money owed to or by your business</div>
        </div>
      </div>

      {/* ── Coming soon banner ─── */}
      <div className="module-coming-soon" style={{ marginBottom: 24 }}>
        <div className="module-coming-soon-dot" />
        <div className="module-coming-soon-text">
          Invoices module is ready for setup — full invoice creation and payment tracking coming soon.
        </div>
      </div>

      {/* ── Section previews ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 28 }}>
        {SECTIONS.map(s => (
          <div key={s.label} style={{ background: s.color, borderRadius: 14, padding: '18px 16px', opacity: 0.75, cursor: 'default' }}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>{s.icon}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: s.textColor, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 12, color: s.textColor, opacity: 0.75 }}>{s.sub}</div>
            <div style={{ marginTop: 14 }}>
              <span style={{ fontSize: 10, fontWeight: 600, background: 'rgba(255,255,255,.6)', color: s.textColor, padding: '3px 10px', borderRadius: 20 }}>Coming soon</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Empty state ─── */}
      <div className="empty-state">
        <div className="empty-state-icon">🧾</div>
        <div className="empty-state-title">Invoices module is ready for setup</div>
        <div className="empty-state-sub">
          The next step is connecting invoice creation and payment tracking. Until then, use Receivables and Payables to track what's owed.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="empty-state-cta" onClick={() => navigate('/receivables')}>View Receivables</button>
          <button className="empty-state-cta secondary" onClick={() => navigate('/payables')}>View Payables</button>
        </div>
      </div>

    </div>
  )
}
