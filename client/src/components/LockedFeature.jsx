/**
 * LockedFeature — reusable locked-state card for paid/plan-gated features.
 *
 * Props:
 *   title         — feature name, e.g. "Payroll"
 *   description   — what the feature does / why it's locked
 *   requiredPlan  — plan name string, e.g. "Business"
 *   currentPlan   — current effective plan string
 *   icon          — emoji or string icon
 *   bullets       — optional string[] of feature highlights
 */
export default function LockedFeature({
  title       = 'Feature locked',
  description = 'This feature is available on a higher plan.',
  requiredPlan = 'Business',
  currentPlan  = 'free',
  icon         = '🔒',
  bullets      = [],
}) {
  const PLAN_LABELS = {
    free:       'Free Plan',
    starter:    'Starter',
    business:   'Business',
    founder:    'Founder',
    enterprise: 'Enterprise',
  }
  const currentLabel  = PLAN_LABELS[currentPlan]  || currentPlan
  const requiredLabel = PLAN_LABELS[requiredPlan]  || requiredPlan

  return (
    <div style={{
      margin: '0 16px 24px',
      background: 'var(--bg-2)',
      borderRadius: 20,
      border: '1px solid var(--border)',
      overflow: 'hidden',
    }}>
      {/* Hero */}
      <div style={{
        background: 'linear-gradient(135deg, #0F172A 0%, #1e293b 100%)',
        padding: '32px 24px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Grid overlay */}
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.03,
          backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 24px,#fff 24px,#fff 25px)',
          pointerEvents: 'none',
        }} />

        <div style={{ position: 'relative' }}>
          {/* Lock icon */}
          <div style={{
            width: 64, height: 64, borderRadius: 18,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px', fontSize: 28,
          }}>
            {icon}
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: -0.4, marginBottom: 8 }}>
            {title}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.7, maxWidth: 320, margin: '0 auto' }}>
            {description}
          </div>
        </div>
      </div>

      {/* Plan info */}
      <div style={{ padding: '18px 20px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderRadius: 10,
          background: 'var(--bg-3)', border: '0.5px solid var(--border)',
          marginBottom: bullets.length > 0 ? 14 : 0,
        }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 3 }}>
              Your plan
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              {currentLabel}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 3 }}>
              Required
            </div>
            <div style={{
              fontSize: 13, fontWeight: 700,
              color: '#2563EB',
              background: 'rgba(37,99,235,0.08)',
              padding: '2px 10px', borderRadius: 20,
            }}>
              {requiredLabel}+
            </div>
          </div>
        </div>

        {bullets.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            {bullets.map((b, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '7px 0',
                borderBottom: i < bullets.length - 1 ? '0.5px solid var(--border)' : 'none',
              }}>
                <span style={{ color: '#2563EB', fontSize: 13, flexShrink: 0, marginTop: 1 }}>✓</span>
                <span style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>{b}</span>
              </div>
            ))}
          </div>
        )}

        {/* CTA — no billing, just placeholder */}
        <button
          disabled
          style={{
            width: '100%', padding: '12px',
            borderRadius: 12, border: '0.5px solid var(--border-2)',
            background: 'none', color: 'var(--text-3)',
            fontSize: 13, fontWeight: 500,
            cursor: 'not-allowed', opacity: 0.7,
            fontFamily: 'inherit',
          }}
        >
          ✨ Upgrade plans — coming soon
        </button>
      </div>
    </div>
  )
}
