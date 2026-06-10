import { useNavigate } from 'react-router-dom'
import { useAccess } from '../hooks/useAccess'
import LockedFeature from '../components/LockedFeature'

const HOW_IT_WORKS = [
  { step: '1', title: 'Transaction submitted',    sub: 'A team member adds a payment or expense'         },
  { step: '2', title: 'Approval requested',       sub: 'CFO or admin is notified to review'              },
  { step: '3', title: 'Approve or reject',        sub: 'Decision is logged with timestamp and reason'    },
  { step: '4', title: 'Cash flow updated',        sub: 'Approved items affect your Pulse automatically'  },
]

export default function Approvals() {
  const navigate = useNavigate()
  const { hasFeature, effectivePlan, loading: accessLoading } = useAccess()

  const header = (
    <div className="hf-page-header">
      <div>
        <div className="hf-page-title">Approvals</div>
        <div className="hf-page-subtitle">Review and approve financial actions before they affect cash</div>
      </div>
    </div>
  )

  // ── Feature gate ────────────────────────────────────────────────────────────
  if (!accessLoading && !hasFeature('approval_flow_enabled')) {
    return (
      <div className="hf-page">
        {header}
        <LockedFeature
          title="Approval Flow"
          description="Require team members to get CFO approval before transactions affect your cash flow. Prevent unauthorised spending."
          requiredPlan="business"
          currentPlan={effectivePlan}
          icon="✅"
          bullets={[
            'Multi-level approval chains',
            'Approve or reject with reason and timestamp',
            'Approved transactions auto-apply to Pulse',
            'Full audit trail of all financial decisions',
          ]}
        />
      </div>
    )
  }

  return (
    <div className="hf-page">

      {header}

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
          {HOW_IT_WORKS.map((item) => (
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
