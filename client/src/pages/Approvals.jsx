import { useNavigate } from 'react-router-dom'
import { useAccess } from '../hooks/useAccess'
import { useTranslation } from '../hooks/useTranslation'
import LockedFeature from '../components/LockedFeature'

export default function Approvals() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { hasFeature, effectivePlan, loading: accessLoading } = useAccess()

  const HOW_IT_WORKS = [
    { step: '1', titleKey: 'approvals.step1title', subKey: 'approvals.step1desc' },
    { step: '2', titleKey: 'approvals.step2title', subKey: 'approvals.step2desc' },
    { step: '3', titleKey: 'approvals.step3title', subKey: 'approvals.step3desc' },
    { step: '4', titleKey: 'approvals.step4title', subKey: 'approvals.step4desc' },
  ]

  const header = (
    <div className="hf-page-header">
      <div>
        <div className="hf-page-title">{t('approvals.title')}</div>
        <div className="hf-page-subtitle">{t('approvals.subtitle')}</div>
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
          {t('approvals.teamMsg')}
        </div>
      </div>

      {/* ── Empty state ─── */}
      <div className="empty-state" style={{ marginBottom: 28 }}>
        <div className="empty-state-icon">✅</div>
        <div className="empty-state-title">{t('approvals.empty')}</div>
        <div className="empty-state-sub">
          {t('approvals.emptyHint')}
        </div>
        <button className="empty-state-cta secondary" style={{ cursor: 'default' }}>{t('approvals.teamAccess')}</button>
      </div>

      {/* ── How it will work ─── */}
      <div style={{ marginBottom: 8 }}>
        <div className="section-title">{t('approvals.howTitle')}</div>
        <div className="item-list-card">
          {HOW_IT_WORKS.map((item) => (
            <div key={item.step} className="item-row">
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--brand-light)', color: 'var(--brand-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                {item.step}
              </div>
              <div className="item-row-left">
                <div className="item-row-name">{t(item.titleKey)}</div>
                <div className="item-row-sub">{t(item.subKey)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ textAlign: 'center', paddingBottom: 12 }}>
        <button className="link-btn" onClick={() => navigate('/')}>{t('approvals.backToPulse')}</button>
      </div>

    </div>
  )
}
