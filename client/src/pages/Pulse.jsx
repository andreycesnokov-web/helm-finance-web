import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from '../hooks/useTranslation'
import { apiFetch, fmt, fmtFull, daysUntil } from '../lib/api'

// ── Constants ─────────────────────────────────────────────────────────────────

const SCOPE_KEYS = ['all', 'business', 'personal']

// All real routes registered in App.jsx
const ALLOWED_ROUTES = ['/', '/add', '/radar', '/accounts', '/settings', '/cfo',
  '/transactions', '/receivables', '/payables', '/invoices', '/payroll', '/tasks', '/approvals']

const CFO_SCORE_COLOR = (score) =>
  score >= 75 ? '#12B76A' : score >= 50 ? '#F79009' : '#F04438'

const ALERT_COLORS = {
  healthy:  { bg: 'var(--green-light)',  text: 'var(--green-dark)',  border: 'rgba(18,183,106,.2)',  dot: '#12B76A' },
  warning:  { bg: 'var(--amber-light)',  text: 'var(--amber-dark)',  border: 'rgba(247,144,9,.2)',   dot: '#F79009' },
  critical: { bg: 'var(--red-light)',    text: 'var(--red-dark)',    border: 'rgba(240,68,56,.2)',   dot: '#F04438' },
}

const STATUS_LABEL_KEY = {
  healthy:  'pulse.healthy',
  warning:  'pulse.attention',
  critical: 'pulse.critical',
}

const ACTION_ICONS = {
  collect_receivable: '↓',
  pay_payable:        '↑',
  protect_cash:       '⚡',
  review_expenses:    '↔',
  consider_hiring:    '＋',
  add_transactions:   '+',
  default:            '→',
}

const ACTION_COLORS = {
  collect_receivable: { bg: 'var(--green-light)', color: 'var(--green-dark)' },
  pay_payable:        { bg: 'var(--red-light)',   color: 'var(--red-dark)'   },
  protect_cash:       { bg: 'var(--amber-light)', color: 'var(--amber-dark)' },
  review_expenses:    { bg: 'var(--amber-light)', color: 'var(--amber-dark)' },
  consider_hiring:    { bg: 'var(--blue-light)',  color: 'var(--blue-dark)'  },
  add_transactions:   { bg: 'var(--bg-3)',        color: 'var(--text-3)'     },
  default:            { bg: 'var(--bg-3)',        color: 'var(--text-3)'     },
}

const WALLET_ICONS = {
  bank:    '🏦',
  cash:    '💵',
  crypto:  '₿',
  ewallet: '📱',
  other:   '💼',
}

const TX_TYPE_COLORS = {
  income:     { bg: 'var(--green-light)', color: 'var(--green-dark)',  sign: '+' },
  expense:    { bg: 'var(--red-light)',   color: 'var(--red-dark)',    sign: '−' },
  payroll:    { bg: 'var(--red-light)',   color: 'var(--red-dark)',    sign: '−' },
  transfer:   { bg: 'var(--bg-3)',        color: 'var(--text-3)',      sign: '→' },
  correction: { bg: 'var(--amber-light)', color: 'var(--amber-dark)',  sign: '±' },
}

const FACTOR_KEY = {
  cash_health:     'pulse.factorCashHealth',
  runway:          'pulse.factorRunway',
  payables:        'pulse.factorPayables',
  receivables:     'pulse.factorReceivables',
  expense_control: 'pulse.factorExpenseControl',
}

const FACTOR_ORDER = ['cash_health', 'runway', 'payables', 'receivables', 'expense_control']

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Safely round a CFO factor value; returns null if input is not a finite number */
function safeScore(v) {
  const n = Number(v)
  return isFinite(n) ? Math.round(n) : null
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ScoreBar({ score, color }) {
  const pct = score != null && isFinite(score) ? Math.min(100, Math.max(0, score)) : 0
  return (
    <div style={{ height: 4, background: 'var(--border)', borderRadius: 4, overflow: 'hidden', marginTop: 6 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width .6s ease' }} />
    </div>
  )
}

function SectionLabel({ children, count }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.08em', padding: '0 16px', marginBottom: 8 }}>
      {children}{count != null ? ` · ${count}` : ''}
    </div>
  )
}

function EmptyState({ icon, title, sub }) {
  return (
    <div style={{ margin: '0 16px 14px', background: 'var(--bg-2)', border: '0.5px solid var(--border)', borderRadius: 16, padding: '20px 16px', textAlign: 'center' }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>{sub}</div>}
    </div>
  )
}

const Modal = ({ onClose, children }) => createPortal(
  <div className="modal-overlay" onClick={onClose}>
    <div className="modal-sheet" onClick={e => e.stopPropagation()}>
      <div className="modal-drag-handle" />
      <button className="modal-close-btn" onClick={onClose}>✕</button>
      {children}
    </div>
  </div>,
  document.body
)

// ── Main component ────────────────────────────────────────────────────────────

export default function Pulse({ onDataLoad }) {
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()

  // Safe navigation — ignores unknown/empty routes to prevent blank pages
  const safeNav = (route, fallback = '/') => {
    const target = route && ALLOWED_ROUTES.includes(route) ? route : fallback
    navigate(target)
  }

  const [scope, setScope]         = useState('all')
  const [pulse, setPulse]         = useState(null)
  const [cfo, setCfo]             = useState(null)
  const [loading, setLoading]     = useState(true)

  // modals
  const [payModal, setPayModal]       = useState(null)
  const [payForm, setPayForm]         = useState({ amount: '', account: '' })
  const [paying, setPaying]           = useState(false)
  const [snoozeModal, setSnoozeModal] = useState(null)
  const [snoozing, setSnoozing]       = useState(false)
  const [snoozeError, setSnoozeError] = useState('')
  const [customDate, setCustomDate]   = useState('')

  const load = (sc) => {
    setLoading(true)
    Promise.all([
      apiFetch(`/pulse?scope=${sc}`, token),
      apiFetch('/ai-cfo/context', token),
    ]).then(([p, c]) => {
      setPulse(p)
      setCfo(c)
      if (onDataLoad) onDataLoad(p)
    }).catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(scope) }, [scope, token])

  const reload = () => load(scope)

  const handlePay = async () => {
    setPaying(true)
    try {
      await apiFetch(`/debts/${payModal.id}/pay`, token, {
        method: 'POST', body: { amount: Number(payForm.amount), account: payForm.account }
      })
      setPayModal(null)
      reload()
    } catch(e) { alert(e.message) }
    finally { setPaying(false) }
  }

  const openSnooze = (item) => {
    setSnoozeError('')
    setCustomDate('')
    setSnoozeModal(item)
  }

  const handleSnooze = async (days) => {
    if (!snoozeModal) return
    if (days === 0) {
      if (!customDate) { setSnoozeError(t('pulse.pickADate')); return }
      if (new Date(customDate) <= new Date()) { setSnoozeError(t('pulse.dateFuture')); return }
    }
    if (snoozeModal.entityType !== 'reminder') { setSnoozeModal(null); return }
    setSnoozing(true)
    setSnoozeError('')
    try {
      const body = days > 0 ? { days } : { until: new Date(customDate).toISOString() }
      await apiFetch(`/reminders/${snoozeModal.id}/snooze`, token, { method: 'PATCH', body })
      setSnoozeModal(null)
      reload()
    } catch(e) { setSnoozeError(e.message) }
    finally { setSnoozing(false) }
  }

  if (loading && !pulse) return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 14 }}>
      {t('common.loading')}
    </div>
  )

  // ── Derived data ────────────────────────────────────────────────────────────

  const p = pulse || {}
  const c = cfo   || {}

  const totalBalance = p.totalBalance ?? 0
  const runway       = p.runway       ?? 999
  const burnRate     = p.burnRate     ?? 0
  const income       = p.income       ?? 0
  const expenses     = p.expenses     ?? 0
  const netPosition  = p.netPosition  ?? 0
  const receivables  = p.receivables  ?? 0
  const payables     = p.payables     ?? 0
  const accounts     = p.accounts     || []
  const allDebts     = p.debts        || []
  const recentTxs    = p.recentTxs    || []

  const cfoScore   = c.cfo_score        || null
  const aiAlert    = c.ai_alert         || null
  const nextActs   = c.next_actions     || []
  const hiringR    = c.hiring_readiness || null

  const openDebts       = allDebts.filter(d => !['paid', 'cancelled'].includes(d.status))
  const overduePayables = openDebts.filter(d => d.type === 'payable'    && daysUntil(d.due_date) < 0)
  const overdueRecv     = openDebts.filter(d => d.type === 'receivable' && daysUntil(d.due_date) < 0)
  const topRecv         = openDebts
    .filter(d => d.type === 'receivable')
    .sort((a,b) => Number(b.remaining_amount||b.amount) - Number(a.remaining_amount||a.amount))[0]
  const topPay          = openDebts
    .filter(d => d.type === 'payable')
    .sort((a,b) => daysUntil(a.due_date) - daysUntil(b.due_date))[0]

  const scoreVal   = cfoScore?.score   ?? 0
  const scoreColor = CFO_SCORE_COLOR(scoreVal)

  const alertStatus = aiAlert?.status || 'healthy'
  const alertStyle  = ALERT_COLORS[alertStatus] || ALERT_COLORS.healthy

  const netFlow      = income - expenses
  const netFlowColor = netFlow >= 0 ? 'var(--green-dark)' : 'var(--red-dark)'

  const hour    = new Date().getHours()
  const greet   = hour < 12 ? t('pulse.goodMorning') : hour < 17 ? t('pulse.goodAfternoon') : t('pulse.goodEvening')
  const firstName = (user?.firstName || 'there').replace(/[\u{1F600}-\u{1FFFF}\u{2700}-\u{27BF}\u{FE00}-\u{FEFF}]/gu, '').trim() || 'there'

  const btnP = 'btn btn-block btn-lg'
  const btnS = 'btn btn-ghost btn-block btn-lg'

  return (
    <div className="page">

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div style={{ padding: '14px 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
        </div>
        <div onClick={() => navigate('/settings')}
          style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--brand-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--brand-dark)', cursor: 'pointer', border: '1px solid rgba(21,94,239,.15)' }}>
          {firstName[0]?.toUpperCase() || 'A'}
        </div>
      </div>

      {/* ── Scope filter ─────────────────────────────────────────────────────── */}
      <div style={{ padding: '0 16px 10px', display: 'flex', gap: 6 }}>
        {SCOPE_KEYS.map((k) => (
          <button key={k} onClick={() => setScope(k)} style={{
            padding: '5px 16px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
            border: scope === k ? 'none' : '0.5px solid var(--border)',
            background: scope === k ? 'var(--brand)' : 'none',
            color: scope === k ? '#fff' : 'var(--text-3)',
            fontWeight: scope === k ? 500 : 400,
          }}>{t(`common.${k}`)}</button>
        ))}
      </div>

      {/* ── All-scope warning banner ─────────────────────────────────────────── */}
      {scope === 'all' && (
        <div style={{ margin: '0 16px 10px', padding: '9px 14px', borderRadius: 10, background: 'rgba(247,144,9,.08)', border: '1px solid rgba(247,144,9,.25)', fontSize: 11, color: 'var(--amber-dark)', lineHeight: 1.4 }}>
          {t('pulse.allScopeWarning')}
        </div>
      )}

      {/* ── Personal Overview header (personal tab only) ──────────────────────── */}
      {scope === 'personal' && (
        <div style={{ margin: '0 16px 10px', padding: '9px 14px', borderRadius: 10, background: 'rgba(126,34,206,.07)', border: '1px solid rgba(126,34,206,.2)', fontSize: 11, color: '#7E22CE', fontWeight: 600 }}>
          {t('pulse.personalOverview')}
        </div>
      )}

      {/* ── CEO Status Hero ──────────────────────────────────────────────────── */}
      <div style={{
        margin: '0 16px 16px',
        background: 'linear-gradient(140deg, #0D1B2E 0%, #162035 100%)',
        borderRadius: 24, padding: '20px 18px 18px',
        position: 'relative', overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(11,18,32,0.28)',
        borderLeft: `3px solid ${alertStyle.dot}`,
      }}>
        {/* decorative blobs */}
        <div style={{ position: 'absolute', top: -50, right: -50, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,.03)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -30, left: 20, width: 120, height: 120, borderRadius: '50%', background: 'rgba(21,94,239,.06)', pointerEvents: 'none' }} />

        {/* greeting + alert badge */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginBottom: 2 }}>{greet},</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', lineHeight: 1.1 }}>{firstName}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,.08)', border: '0.5px solid rgba(255,255,255,.14)', borderRadius: 20, padding: '4px 10px 4px 8px', flexShrink: 0, marginLeft: 10 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: alertStyle.dot, flexShrink: 0, boxShadow: `0 0 6px ${alertStyle.dot}` }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: '#fff' }}>{aiAlert?.status ? t(STATUS_LABEL_KEY[aiAlert.status] || 'pulse.aiStatus') : t('pulse.aiStatus')}</span>
          </div>
        </div>

        {/* cash + runway KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16, position: 'relative' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.4)', letterSpacing: '0.08em', marginBottom: 3 }}>{t('pulse.totalCashLabel')}</div>
            <div style={{ fontSize: 'clamp(22px, 6.5vw, 28px)', fontWeight: 700, color: totalBalance < 0 ? '#F87171' : '#fff', letterSpacing: -0.5, lineHeight: 1, wordBreak: 'break-word' }}>
              {fmt(totalBalance)}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', marginTop: 3 }}>IDR</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.4)', letterSpacing: '0.08em', marginBottom: 3 }}>{t('pulse.runwayLabel')}</div>
            <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1,
              color: !runway || runway >= 999 ? 'rgba(255,255,255,.5)'
                : runway > 30 ? '#34D399'
                : runway > 14 ? '#FCD34D'
                : '#F87171',
            }}>
              {!runway || runway >= 999 ? '∞' : runway}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', marginTop: 3 }}>
              {!runway || runway >= 999 ? t('pulse.noData') : `${t('pulse.daysLeft')} · ${p.burnWindowDays >= 30 ? t('pulse.avg30') : p.burnWindowDays > 0 ? `${p.burnWindowDays}d avg` : t('pulse.atCurrentBurn')}`}
            </div>
          </div>
        </div>

        {/* CFO score strip — business only, not shown in personal tab */}
        {cfoScore && scope !== 'personal' && (
          <div style={{ background: 'rgba(255,255,255,.06)', borderRadius: 12, padding: '10px 12px', border: '0.5px solid rgba(255,255,255,.1)', marginBottom: 14, position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.45)', letterSpacing: '0.08em', fontWeight: 600 }}>{t('pulse.cfoScore')}</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: scoreColor }}>{scoreVal}</div>
            </div>
            <div style={{ height: 4, background: 'rgba(255,255,255,.1)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${scoreVal}%`, background: scoreColor, borderRadius: 4 }} />
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', marginTop: 5 }}>{t(STATUS_LABEL_KEY[cfoScore.status] || 'pulse.attention')}</div>
          </div>
        )}

        {/* AI insight */}
        {aiAlert?.headline && (
          <div style={{ background: 'rgba(21,94,239,.12)', borderRadius: 12, padding: '10px 12px', border: '0.5px solid rgba(21,94,239,.25)', marginBottom: 14, position: 'relative' }}>
            <div style={{ fontSize: 9, color: 'rgba(99,152,255,.75)', letterSpacing: '0.08em', marginBottom: 4, fontWeight: 600 }}>AI CFO</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.82)', lineHeight: 1.5, fontWeight: 500 }}>{aiAlert.headline}</div>
          </div>
        )}

        {/* Account chips */}
        {accounts.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 14, position: 'relative' }}>
            {accounts.slice(0, 4).map(a => (
              <div key={a.id} style={{ background: a.balance < 0 ? 'rgba(248,113,113,.12)' : 'rgba(255,255,255,.07)', border: `0.5px solid ${a.balance < 0 ? 'rgba(248,113,113,.25)' : 'rgba(255,255,255,.12)'}`, borderRadius: 20, padding: '3px 10px', fontSize: 10, color: a.balance < 0 ? '#F87171' : 'rgba(255,255,255,.8)' }}>
                {a.name} <span style={{ fontWeight: 600 }}>{fmt(a.balance)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Hero CTA buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, position: 'relative' }}>
          <button onClick={() => navigate('/add')} style={{ background: '#fff', border: 'none', borderRadius: 14, padding: '10px 0', fontSize: 12, fontWeight: 600, color: '#0D1B2E', cursor: 'pointer' }}>
            {t('pulse.addTransaction')}
          </button>
          <button onClick={() => navigate('/cfo')} style={{ background: 'rgba(255,255,255,.1)', border: '0.5px solid rgba(255,255,255,.2)', borderRadius: 14, padding: '10px 0', fontSize: 12, color: '#fff', cursor: 'pointer', fontWeight: 500 }}>
            {t('pulse.askAICFO')}
          </button>
        </div>
      </div>

      <div className="pulse-desktop-grid">
        <div className="pulse-main-col">

          {/* ── CFO Score card — business only, not shown in personal tab ──── */}
          {cfoScore && scope !== 'personal' && (
            <>
              <SectionLabel>{t('pulse.cfoScore')}</SectionLabel>
              <div style={{ margin: '0 16px 16px', background: 'var(--bg-2)', border: '0.5px solid var(--border)', borderRadius: 20, padding: '16px 16px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 36, fontWeight: 700, color: scoreColor, lineHeight: 1 }}>{scoreVal}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>{t(STATUS_LABEL_KEY[cfoScore.status] || 'pulse.attention')}</div>
                  </div>
                  <div style={{ width: 56, height: 56, borderRadius: '50%', border: `3px solid ${scoreColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', flexShrink: 0 }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: scoreColor }}>{scoreVal}</span>
                  </div>
                </div>

                {cfoScore.factors && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {FACTOR_ORDER.filter(k => cfoScore.factors[k] != null).map(k => {
                      const val = safeScore(cfoScore.factors[k])
                      const col = val != null ? CFO_SCORE_COLOR(val) : 'var(--text-4)'
                      return (
                        <div key={k}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{t(FACTOR_KEY[k] || k)}</span>
                            <span style={{ fontSize: 11, fontWeight: 600, color: col }}>{val != null ? val : '—'}</span>
                          </div>
                          <ScoreBar score={val} color={col} />
                        </div>
                      )
                    })}
                  </div>
                )}

                {cfoScore.summary && (
                  <div style={{ marginTop: 12, padding: '9px 12px', background: 'var(--bg-3)', borderRadius: 12, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
                    {cfoScore.summary}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── AI Alert + Hiring Readiness (2-col) ────────────────────────── */}
          {(aiAlert || hiringR) && (
            <>
              <SectionLabel>{t('pulse.businessStatus')}</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: aiAlert && hiringR ? '1fr 1fr' : '1fr', gap: 10, margin: '0 16px 16px' }}>
                {aiAlert && (
                  <div style={{ background: alertStyle.bg, border: `0.5px solid ${alertStyle.border}`, borderRadius: 16, padding: '14px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: alertStyle.dot, boxShadow: `0 0 5px ${alertStyle.dot}` }} />
                      <span style={{ fontSize: 9, fontWeight: 700, color: alertStyle.text, letterSpacing: '0.06em' }}>AI ALERT</span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: alertStyle.text, lineHeight: 1.3, marginBottom: 4 }}>{aiAlert.label}</div>
                    {aiAlert.description && (
                      <div style={{ fontSize: 11, color: alertStyle.text, opacity: 0.75, lineHeight: 1.45 }}>{aiAlert.description}</div>
                    )}
                  </div>
                )}
                {hiringR && (
                  <div style={{ background: 'var(--bg-2)', border: '0.5px solid var(--border)', borderRadius: 16, padding: '14px 14px' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 8 }}>HIRING READINESS</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3, marginBottom: 4 }}>{hiringR.label}</div>
                    {hiringR.safe_monthly_salary > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.4 }}>
                        Safe salary: {fmt(hiringR.safe_monthly_salary)} {hiringR.currency || 'IDR'}/mo
                      </div>
                    )}
                    <button onClick={() => navigate('/cfo')}
                      style={{ marginTop: 10, fontSize: 10, padding: '5px 10px', borderRadius: 10, background: 'none', border: '0.5px solid var(--border)', color: 'var(--brand)', cursor: 'pointer' }}>
                      Ask CFO →
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Cash Snapshot (4 KPIs) ─────────────────────────────────────── */}
          <SectionLabel>{t('pulse.cashSnapshot')}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '0 16px 16px' }}>
            {[
              {
                label: t('pulse.totalCash'), unit: 'IDR', sub: t('pulse.availableNow'),
                value: fmt(totalBalance),
                color: totalBalance >= 0 ? 'var(--text)' : 'var(--red)',
              },
              {
                label: t('pulse.runway'), unit: (!runway || runway >= 999) ? '' : t('radar.days'),
                sub: p.burnWindowDays >= 30 ? t('pulse.avg30') : p.burnWindowDays > 0 ? `${p.burnWindowDays}d avg` : t('pulse.basedOnBurn'),
                value: (!runway || runway >= 999) ? '∞' : String(runway),
                color: (!runway || runway >= 999) ? 'var(--text-3)'
                  : runway > 30 ? 'var(--green-dark)'
                  : runway > 14 ? 'var(--amber-dark)'
                  : 'var(--red)',
              },
              {
                label: t('pulse.burnRate'), unit: '/day', sub: t('pulse.cashOutflow'),
                value: fmt(burnRate),
                color: 'var(--text)',
              },
              {
                label: t('pulse.netPosition'), unit: 'IDR', sub: t('pulse.cashRecPay'),
                value: fmt(netPosition),
                color: netPosition >= 0 ? 'var(--green-dark)' : 'var(--red-dark)',
              },
            ].map(k => (
              <div key={k.label} style={{ background: 'var(--bg-2)', borderRadius: 16, padding: '13px 14px', border: '0.5px solid var(--border)' }}>
                <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-3)', marginBottom: 5 }}>{k.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: k.color, lineHeight: 1, letterSpacing: -0.3 }}>
                  {k.value}
                  {k.unit && <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-3)', marginLeft: 3 }}>{k.unit}</span>}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* ── Net Flow this month ─────────────────────────────────────────── */}
          <SectionLabel>{t('pulse.netFlowMonth')}</SectionLabel>
          <div style={{ margin: '0 16px 16px', background: 'var(--bg-2)', border: '0.5px solid var(--border)', borderRadius: 20, padding: '14px 16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div style={{ background: 'var(--green-light)', borderRadius: 14, padding: '12px 13px' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--green-dark)', letterSpacing: '0.07em', marginBottom: 4 }}>{t('pulse.income')}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--green-dark)', lineHeight: 1 }}>+{fmt(income)}</div>
                <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 3 }}>{t('pulse.idrEarned')}</div>
              </div>
              <div style={{ background: 'var(--red-light)', borderRadius: 14, padding: '12px 13px' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--red-dark)', letterSpacing: '0.07em', marginBottom: 4 }}>{t('pulse.expenses')}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--red-dark)', lineHeight: 1 }}>−{fmt(expenses)}</div>
                <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 3 }}>{t('pulse.idrSpent')}</div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '0.5px solid var(--border)', paddingTop: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{t('pulse.netFlowThisMonth')}</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: netFlowColor }}>
                {netFlow >= 0 ? '+' : ''}{fmt(netFlow)} IDR
              </span>
            </div>
            {income === 0 && expenses === 0 && (
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-4)', textAlign: 'center' }}>{t('pulse.noTransactionsMonth')}</div>
            )}
          </div>

          {/* ── Receivables / Payables Pressure ────────────────────────────── */}
          <SectionLabel>{t('pulse.cashPressure')}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '0 16px 16px' }}>
            {/* Receivables */}
            <div style={{ background: 'var(--bg-2)', border: '0.5px solid var(--border)', borderRadius: 16, padding: '13px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--green-dark)', letterSpacing: '0.07em' }}>{t('pulse.receivablesSect')}</span>
                {overdueRecv.length > 0 && (
                  <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 8, background: 'var(--red-light)', color: 'var(--red-dark)' }}>{overdueRecv.length} {t('common.overdue')}</span>
                )}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--green-dark)', lineHeight: 1 }}>{fmt(receivables)}</div>
              <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 3 }}>
                {openDebts.filter(d => d.type === 'receivable').length} {t('common.incoming')} · IDR
              </div>
              {topRecv && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-3)', borderTop: '0.5px solid var(--border)', paddingTop: 7 }}>
                  {t('pulse.top')} <span style={{ color: 'var(--text)', fontWeight: 500 }}>{topRecv.counterparty}</span><br />
                  {fmt(topRecv.remaining_amount || topRecv.amount)} IDR
                </div>
              )}
              <button onClick={() => navigate('/receivables')}
                style={{ marginTop: 10, width: '100%', padding: '7px 0', borderRadius: 10, fontSize: 11, border: '0.5px solid var(--border)', background: 'none', color: 'var(--brand)', cursor: 'pointer' }}>
                {t('pulse.viewAllReceivables')}
              </button>
            </div>

            {/* Payables */}
            <div style={{ background: 'var(--bg-2)', border: '0.5px solid var(--border)', borderRadius: 16, padding: '13px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--red-dark)', letterSpacing: '0.07em' }}>{t('pulse.payablesSect')}</span>
                {overduePayables.length > 0 && (
                  <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 8, background: 'var(--red-light)', color: 'var(--red-dark)' }}>{overduePayables.length} {t('common.overdue')}</span>
                )}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--red-dark)', lineHeight: 1 }}>{fmt(payables)}</div>
              <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 3 }}>
                {openDebts.filter(d => d.type === 'payable').length} {t('common.outgoing')} · IDR
              </div>
              {topPay && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-3)', borderTop: '0.5px solid var(--border)', paddingTop: 7 }}>
                  {t('pulse.next')} <span style={{ color: 'var(--text)', fontWeight: 500 }}>{topPay.counterparty}</span><br />
                  {daysUntil(topPay.due_date) < 0 ? t('pulse.overdue') : daysUntil(topPay.due_date) + t('pulse.daysLeft')}
                </div>
              )}
              <button onClick={() => navigate('/payables')}
                style={{ marginTop: 10, width: '100%', padding: '7px 0', borderRadius: 10, fontSize: 11, border: '0.5px solid var(--border)', background: 'none', color: 'var(--brand)', cursor: 'pointer' }}>
                {t('pulse.viewAllPayables')}
              </button>
            </div>
          </div>

        </div>{/* end pulse-main-col */}

        <div className="pulse-side-col">

          {/* ── Today's Actions (AI CFO V2 next_actions) ─────────────────── */}
          <SectionLabel count={nextActs.length}>{t('pulse.todaysActions')}</SectionLabel>
          {nextActs.length === 0 ? (
            <EmptyState icon="✓" title={t('pulse.allClear')} sub={t('pulse.allClearSub')} />
          ) : (
            <div style={{ margin: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {nextActs.map((act, i) => {
                const col  = ACTION_COLORS[act.action_type] || ACTION_COLORS.default
                const icon = ACTION_ICONS[act.action_type]  || ACTION_ICONS.default
                const route = act.route || null
                return (
                  <button key={i} onClick={() => route && safeNav(route)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-2)', border: '0.5px solid var(--border)', borderRadius: 16, padding: '12px 14px', cursor: route ? 'pointer' : 'default', textAlign: 'left', width: '100%' }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: col.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: col.color, flexShrink: 0, fontWeight: 700 }}>
                      {icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>{act.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{act.description}</div>
                    </div>
                    {act.amount > 0 && (
                      <div style={{ fontSize: 12, fontWeight: 600, color: col.color, flexShrink: 0 }}>{fmt(act.amount)}</div>
                    )}
                    {route && <span style={{ fontSize: 12, color: 'var(--text-4)', flexShrink: 0, marginLeft: 2 }}>→</span>}
                  </button>
                )
              })}
            </div>
          )}

          {/* ── Wallet Breakdown ─────────────────────────────────────────── */}
          <SectionLabel count={accounts.length}>{t('pulse.wallets')}</SectionLabel>
          {accounts.length === 0 ? (
            <EmptyState icon="💳" title={t('pulse.noWallets')} sub={t('pulse.noWalletsSub')} />
          ) : (
            <div style={{ margin: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 7 }}>
              {accounts.map(a => {
                const icon  = WALLET_ICONS[a.type] || WALLET_ICONS.other
                const isNeg = a.balance < 0
                return (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-2)', border: '0.5px solid var(--border)', borderRadius: 16, padding: '12px 14px' }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: isNeg ? 'var(--red-light)' : 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                      {icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1, textTransform: 'uppercase' }}>{a.currency || 'IDR'} · {a.type || 'bank'}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: isNeg ? 'var(--red)' : 'var(--text)' }}>{fmt(a.balance)}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-4)', marginTop: 1 }}>IDR</div>
                    </div>
                  </div>
                )
              })}
              <button onClick={() => navigate('/accounts')}
                style={{ padding: '9px 0', borderRadius: 14, fontSize: 12, border: '0.5px solid var(--border)', background: 'none', color: 'var(--brand)', cursor: 'pointer', fontWeight: 500 }}>
                {t('pulse.manageWallets')}
              </button>
            </div>
          )}

          {/* ── Recent Activity ───────────────────────────────────────────── */}
          <SectionLabel>{t('pulse.recentActivity')}</SectionLabel>
          {recentTxs.length === 0 ? (
            <EmptyState icon="📊" title={t('pulse.noTransactions')} sub={t('pulse.noTransactionsSub')} />
          ) : (
            <div style={{ margin: '0 16px 16px', background: 'var(--bg-2)', border: '0.5px solid var(--border)', borderRadius: 20, overflow: 'hidden' }}>
              {recentTxs.slice(0, 8).map((tx, i) => {
                const tc     = TX_TYPE_COLORS[tx.type] || TX_TYPE_COLORS.expense
                const isLast = i === Math.min(recentTxs.length, 8) - 1
                const txDate = tx.created_at
                  ? new Date(tx.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                  : ''
                const amt = Math.abs(Number(tx.amount_original || tx.amount_idr || 0))
                return (
                  <div key={tx.id || i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', borderBottom: isLast ? 'none' : '0.5px solid var(--border)' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 9, background: tc.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: tc.color, fontWeight: 700, flexShrink: 0 }}>
                      {tc.sign}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tx.description || tx.source || tx.type}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>
                        {txDate}{tx.source ? ` · ${tx.source}` : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: tc.color }}>{tc.sign}{fmt(amt)}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-4)', marginTop: 1 }}>{tx.currency_original || 'IDR'}</div>
                    </div>
                  </div>
                )
              })}
              <button onClick={() => navigate('/transactions')}
                style={{ display: 'block', width: '100%', padding: '11px 0', fontSize: 12, border: 'none', borderTop: '0.5px solid var(--border)', background: 'none', color: 'var(--brand)', cursor: 'pointer', fontWeight: 500 }}>
                {t('pulse.viewAllTransactions')}
              </button>
            </div>
          )}

          {/* ── Quick Actions ─────────────────────────────────────────────── */}
          <SectionLabel>{t('pulse.quickActions')}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '0 16px 28px' }}>
            {[
              { icon: '+',  labelKey: 'pulse.addTransaction', route: '/add',          bg: 'var(--brand)',       color: '#fff' },
              { icon: '↓',  labelKey: 'pulse.addReceivable',  route: '/receivables',  bg: 'var(--green-light)', color: 'var(--green-dark)' },
              { icon: '↑',  labelKey: 'pulse.addPayable',     route: '/payables',     bg: 'var(--red-light)',   color: 'var(--red-dark)'   },
              { icon: '🤖', labelKey: 'pulse.askAICFO',       route: '/cfo',          bg: 'var(--blue-light)',  color: 'var(--blue-dark)'  },
              { icon: '💳', labelKey: 'pulse.accounts',       route: '/accounts',     bg: 'var(--bg-3)',        color: 'var(--text-2)'     },
              { icon: '📊', labelKey: 'pulse.viewRadar',      route: '/radar',        bg: 'var(--bg-3)',        color: 'var(--text-2)'     },
            ].map(a => (
              <button key={a.labelKey} onClick={() => safeNav(a.route)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 14px', borderRadius: 16, border: 'none', background: a.bg, color: a.color, cursor: 'pointer', fontWeight: 500, fontSize: 12, minHeight: 44 }}>
                <span style={{ fontSize: 16 }}>{a.icon}</span>
                {t(a.labelKey)}
              </button>
            ))}
          </div>

        </div>{/* end pulse-side-col */}
      </div>{/* end pulse-desktop-grid */}

      {/* ── Pay modal ────────────────────────────────────────────────────────── */}
      {payModal && (
        <Modal onClose={() => setPayModal(null)}>
          <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>
            {payModal.type === 'receivable' ? t('pulse.markAsReceived') : t('pulse.markAsPaid')}
          </div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', marginBottom: 14 }}>
            {payModal.counterparty} · {fmt(payModal.amount)} IDR total
          </div>
          <label className="modal-label">{t('pulse.amountIDR')}</label>
          <input type="number" value={payForm.amount}
            onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))}
            className="modal-input" style={{ marginBottom: 10 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 12 }}>
            {[25, 50, 75, 100].map(pct => (
              <button key={pct}
                onClick={() => setPayForm(p => ({ ...p, amount: String(Math.round(payModal.amount * pct / 100)) }))}
                className="btn btn-ghost btn-sm">{pct}%</button>
            ))}
          </div>
          <label className="modal-label">{t('add.source')}</label>
          <select value={payForm.account}
            onChange={e => setPayForm(p => ({ ...p, account: e.target.value }))}
            className="modal-input" style={{ marginBottom: 14 }}>
            <option value="">{t('pulse.selectAccount')}</option>
            {accounts.map(a => <option key={a.name} value={a.name}>{a.name} · {fmt(a.balance)}</option>)}
          </select>
          <button disabled={!payForm.amount || paying} onClick={handlePay} className={btnP}
            style={{ background: payForm.amount ? (payModal.type === 'receivable' ? 'var(--green-dark)' : 'var(--brand)') : 'var(--bg-3)', color: payForm.amount ? '#fff' : 'var(--text-4)', marginBottom: 8 }}>
            {paying ? t('pulse.processing')
              : Number(payForm.amount) >= Number(payModal.amount)
                ? t('pulse.payInFull') + fmt(Number(payForm.amount)) + ' IDR'
                : t('pulse.pay') + fmt(Number(payForm.amount)) + ' IDR'}
          </button>
          <button onClick={() => setPayModal(null)} className={btnS}>{t('common.cancel')}</button>
        </Modal>
      )}

      {/* ── Snooze modal ─────────────────────────────────────────────────────── */}
      {snoozeModal && (
        <Modal onClose={() => { setSnoozeModal(null); setSnoozeError(''); setCustomDate('') }}>
          <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{t('pulse.snoozeReminder')}</div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', marginBottom: 16 }}>
            {snoozeModal.title}{snoozeModal.subtitle ? ' · ' + snoozeModal.subtitle : ''}
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 8 }}>{t('pulse.remindMeIn')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 10 }}>
            {[
              { label: t('pulse.oneDay'),    days: 1, sub: new Date(Date.now() + 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) },
              { label: t('pulse.threeDays'), days: 3, sub: new Date(Date.now() + 3*86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), active: true },
              { label: t('pulse.sevenDays'), days: 7, sub: new Date(Date.now() + 7*86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) },
              { label: t('pulse.custom'),    days: 0, sub: t('pulse.pickDate') },
            ].map(opt => (
              <div key={opt.label} onClick={() => { if (opt.days > 0) handleSnooze(opt.days) }}
                style={{ background: opt.active ? 'var(--text)' : 'var(--bg-2)', border: opt.active ? 'none' : '0.5px solid var(--border)', borderRadius: 14, padding: 14, textAlign: 'center', cursor: snoozing ? 'not-allowed' : 'pointer', opacity: snoozing ? 0.6 : 1 }}>
                <div style={{ fontSize: 'var(--text-xl)', fontWeight: 500, color: opt.active ? '#fff' : 'var(--text)' }}>{opt.label}</div>
                <div style={{ fontSize: 'var(--text-sm)', color: opt.active ? 'rgba(255,255,255,.6)' : 'var(--text-3)', marginTop: 2 }}>{opt.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ marginBottom: 10 }}>
            <input type="date" value={customDate}
              min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
              onChange={e => { setCustomDate(e.target.value); setSnoozeError('') }}
              className="modal-input"
              style={{ border: snoozeError && !customDate ? '1px solid var(--red)' : undefined }} />
            {customDate && (
              <button disabled={snoozing} onClick={() => handleSnooze(0)} className={btnP}
                style={{ marginTop: 7, background: 'var(--text)', color: '#fff', opacity: snoozing ? 0.6 : 1 }}>
                {snoozing ? t('common.saving') : t('pulse.snoozeUntil') + new Date(customDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </button>
            )}
          </div>
          {snoozeError && (
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--red)', marginBottom: 8, padding: '9px 13px', background: 'var(--red-light)', borderRadius: 10 }}>{snoozeError}</div>
          )}
          {snoozeModal.entityType === 'debt' && (
            <div style={{ background: 'var(--blue-light)', border: '0.5px solid rgba(21,94,239,.2)', borderRadius: 14, padding: '10px 13px', marginBottom: 10 }}>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--brand-dark)', lineHeight: 1.5 }}>{t('pulse.debtSnoozeSoon')}</div>
            </div>
          )}
          <button onClick={() => { setSnoozeModal(null); setSnoozeError(''); setCustomDate('') }} className={btnS}>{t('common.cancel')}</button>
        </Modal>
      )}

    </div>
  )
}
