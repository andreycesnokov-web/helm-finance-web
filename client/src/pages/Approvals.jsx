import { useNavigate } from 'react-router-dom'

const HOW_IT_WORKS = [
  { step: '1', title: 'Transaction submitted',    sub: 'A team member adds a payment or expense'         },
  { step: '2', title: 'Approval requested',       sub: 'CFO or admin is notified to review'              },
  { step: '3', title: 'Approve or reject',        sub: 'Decision is logged with timestamp and reason'    },
  { step: '4', title: 'Cash flow updated',        sub: 'Approved items affect your Pulse automatically'  },
]

export default function Approvals() {
  const navigate = useNavigate()

  return (
    <div className="page">

      {/* ── Header ─── */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-header-title">Approvals</div>
          <div className="page-header-sub">Review and approve financial actions before they affect cash</div>
        </div>
      </div>

      {/* ── Team access banner ─── */}
      <div className="module-coming-soon" style={{ marginBottom: 24 }}>
        <div className="module-coming-soon-dot" />
        <div className="module-coming-soon-text">
          Approval flows will be enabled when team access is added to your workspace.
        </div>
      </div>

      {/* ── Empty state ─── */}
      <div className="empty-state" style={{ marginBottom: 28 }}>
        <div className="empty-state-icon">✅</div>
        <div className="empty-state-title">No approvals pending</div>
        <div className="empty-state-sub">
          When your team submits transactions that require review, they will appear here. Approval flows require multi-user access.
        </div>
        <button className="empty-state-cta secondary" style={{ cursor: 'default' }}>Team access required</button>
      </div>

      {/* ── How it will work ─── */}
      <div style={{ marginBottom: 8 }}>
        <div className="section-title">How Approvals Work</div>
        <div className="item-list-card">
          {HOW_IT_WORKS.map((item, i, arr) => (
            <div key={item.step} className="item-row">
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--brand-light)', color: 'var(--brand-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                {item.step}
              </div>
              <div className="item-row-left">
                <div className="item-row-name">{item.title}</div>
                <div className="item-row-sub">{item.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ textAlign: 'center', paddingBottom: 12 }}>
        <button className="link-btn" onClick={() => navigate('/')}>Back to Pulse →</button>
      </div>

    </div>
  )
}
