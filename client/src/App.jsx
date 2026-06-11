import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { useAccess } from './hooks/useAccess'
import { useSwipeBack } from './hooks/useSwipeBack'
import { useTranslation } from './hooks/useTranslation'
import { getLang, setLang } from './i18n/index'
import { apiFetch } from './lib/api'

// ── Localize text from backend (AI insight strings) ──────────────────────────
const RU_TEXT_MAP = {
  'Business is financially stable': 'Финансы бизнеса стабильны',
  'Immediate cash action required': 'Требуются действия по деньгам',
  'Cash is strong with no urgent payment risks detected. Keep monitoring monthly.': 'Денежная позиция стабильная, срочных рисков нет. Продолжайте контролировать финансы.',
  'Not enough expense history': 'Недостаточно истории расходов',
  'Runway unknown — add expenses': 'Запас денег неизвестен — добавьте расходы',
  'No payables': 'Обязательств нет',
  'No receivables': 'Дебиторки нет',
  'No monthly data yet': 'За месяц пока нет данных',
  'No significant risks': 'Существенных рисков нет',
  'Finances look stable': 'Финансы выглядят стабильно',
  'No urgent actions detected. Keep adding transactions daily and review cash weekly.': 'Срочных действий нет. Продолжайте добавлять операции и проверять деньги еженедельно.',
  'Healthy': 'Хорошо',
  'Critical': 'Критично',
  'Not enough data': 'Недостаточно данных',
  'No risks detected.': 'Рисков не обнаружено.',
  'Income covers obligations.': 'Доход покрывает обязательства.',
}
function localizeText(text, lang) {
  if (!text) return text
  if (lang !== 'ru') return text
  return RU_TEXT_MAP[text] || text
}
import Login from './pages/Login'
import Pulse from './pages/Pulse'
import Accounts from './pages/Accounts'
import Add from './pages/Add'
import Radar from './pages/Radar'
import Settings from './pages/Settings'
import Transactions from './pages/Transactions'
import AICFO from './pages/AICFO'
import Receivables from './pages/Receivables'
import Payables from './pages/Payables'
import Invoices from './pages/Invoices'
import Payroll from './pages/Payroll'
import Tasks from './pages/Tasks'
import Approvals from './pages/Approvals'
import Admin from './pages/Admin'
import AdminUser from './pages/AdminUser'
import WalletDetail from './pages/WalletDetail'
import Onboarding, { shouldShowOnboarding, clearOnboardingFlags } from './pages/Onboarding'

// ── Mobile bottom nav keys (labels resolved at render time via t()) ───────────
const NAV_KEYS = [
  { path: '/',         labelKey: 'nav.pulse',    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
  { path: '/add',      labelKey: 'nav.add',      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> },
  { path: '/radar',    labelKey: 'nav.radar',    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> },
  { path: '/cfo',      labelKey: 'nav.cfo',      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> },
  { path: '/accounts', labelKey: 'nav.accounts', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> },
  { path: '/settings', labelKey: 'nav.settings', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
]

// ── Desktop sidebar nav groups ────────────────────────────────────────────────
// Titles resolved at render time via t() in Sidebar component
// active: true  → page exists, link is clickable
// active: false → coming soon, rendered as disabled (no navigation, no crash)
const SIDEBAR_GROUPS = [
  {
    titleKey: 'nav.sectionOverview',
    items: [
      { path: '/',      labelKey: 'nav.pulse',  label: 'Pulse',  active: true,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
      { path: '/radar', labelKey: 'nav.radar',  label: 'Radar',  active: true,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> },
      { path: '/cfo',   labelKey: 'nav.cfo',    label: 'AI CFO', active: true,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> },
    ],
  },
  {
    titleKey: 'nav.sectionFinance',
    items: [
      { path: '/transactions', labelKey: 'nav.transactions', label: 'Transactions', active: true,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6" strokeWidth="2.5"/><line x1="3" y1="12" x2="3.01" y2="12" strokeWidth="2.5"/><line x1="3" y1="18" x2="3.01" y2="18" strokeWidth="2.5"/></svg> },
      { path: '/accounts',    labelKey: 'nav.accounts',    label: 'Accounts',     active: true,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> },
      { path: '/invoices',    labelKey: 'nav.invoices',    label: 'Invoices',     active: true,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> },
      { path: '/receivables', labelKey: 'nav.receivables', label: 'Receivables',  active: true,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg> },
      { path: '/payables',    labelKey: 'nav.payables',    label: 'Payables',     active: true,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg> },
    ],
  },
  {
    titleKey: 'nav.sectionOperations',
    items: [
      { path: '/payroll',   labelKey: 'nav.payroll',   label: 'Payroll',   active: true,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
      { path: '/tasks',     labelKey: 'nav.tasks',     label: 'Tasks',     active: true,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> },
      { path: '/approvals', labelKey: 'nav.approvals', label: 'Approvals', active: true,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> },
    ],
  },
]

const fmtShort = (n) => {
  const abs = Math.abs(Number(n))
  if (abs >= 1000000) return (abs / 1000000).toFixed(1) + 'M'
  if (abs >= 1000) return (abs / 1000).toFixed(0) + 'K'
  return abs.toLocaleString()
}

// ── Settings icon (reused in sidebar user block) ──────────────────────────────
const SettingsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)

// ── Desktop Sidebar V2 ────────────────────────────────────────────────────────
function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { planLabel, isTrialActive, effectivePlan, hasFeature } = useAccess()
  const { t } = useTranslation()

  const initials = (user?.firstName?.[0] || user?.first_name?.[0] || 'A').toUpperCase()
  const displayName = user?.firstName || user?.first_name || 'Account'

  // Badge style: amber for trial, green for paid, default for free
  const badgeStyle = isTrialActive
    ? { background: 'rgba(254,243,199,0.15)', color: '#FCD34D', border: '1px solid rgba(252,211,77,0.3)' }
    : effectivePlan !== 'free'
      ? { background: 'rgba(209,250,229,0.12)', color: '#6EE7B7', border: '1px solid rgba(110,231,183,0.25)' }
      : {}

  return (
    <div className="sidebar">

      {/* ── CFO AI brand block ─── */}
      <div className="sidebar-business-block">
        {/* CSS-only logo mark — no external images */}
        <div className="cfo-logo-mark">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Bar chart bars */}
            <rect x="2" y="14" width="4" height="7" rx="1" fill="rgba(255,255,255,0.55)"/>
            <rect x="8" y="9"  width="4" height="12" rx="1" fill="rgba(255,255,255,0.80)"/>
            <rect x="14" y="5" width="4" height="16" rx="1" fill="#fff"/>
            {/* AI spark line */}
            <path d="M18.5 5L20 3" stroke="rgba(255,255,255,0.65)" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="20.5" cy="2.5" r="1" fill="rgba(255,255,255,0.5)"/>
          </svg>
        </div>
        <div>
          <div className="sidebar-business-name">CFO AI</div>
          <div className="sidebar-business-sub">Financial OS</div>
        </div>
      </div>

      {/* ── Nav groups ─── */}
      <div className="sidebar-nav-scroll">
        {SIDEBAR_GROUPS.map(group => (
          <div key={group.titleKey} className="sidebar-section">
            <div className="sidebar-section-title">{t(group.titleKey)}</div>
            {group.items.map(item => {
              const isActive = location.pathname === item.path

              if (!item.active) {
                // Disabled / coming soon — not clickable, no route crash
                return (
                  <div key={item.path} className="sidebar-nav-item disabled">
                    <span className="sidebar-nav-item-icon">{item.icon}</span>
                    <span className="sidebar-nav-item-label">{t(item.labelKey)}</span>
                    <span className="coming-soon-badge">Soon</span>
                  </div>
                )
              }

              // Determine if this item requires a locked feature
              const FEATURE_MAP = {
                '/payroll':   'payroll_enabled',
                '/approvals': 'approval_flow_enabled',
              }
              const featureKey = FEATURE_MAP[item.path]
              const isLocked   = featureKey ? !hasFeature(featureKey) : false

              return (
                <button
                  key={item.path}
                  className={`sidebar-nav-item${isActive ? ' active' : ''}`}
                  onClick={() => navigate(item.path)}
                >
                  <span className="sidebar-nav-item-icon">{item.icon}</span>
                  <span className="sidebar-nav-item-label">{t(item.labelKey)}</span>
                  {isLocked && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, lineHeight: 1,
                      background: 'rgba(107,114,128,0.15)',
                      color: 'var(--text-3)',
                      padding: '2px 6px', borderRadius: 6,
                      letterSpacing: '0.03em',
                    }}>🔒</span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {/* ── User block ─── */}
      <div className="sidebar-user-block">
        <div className="sidebar-user-info">
          <div className="sidebar-user-avatar">{initials}</div>
          <div className="sidebar-user-details">
            <div className="sidebar-user-name">{displayName}</div>
            <span className="sidebar-plan-badge" style={badgeStyle}>{planLabel}</span>
          </div>
        </div>
        <button className="sidebar-settings-btn" onClick={() => navigate('/settings')} title="Settings">
          <SettingsIcon />
        </button>
      </div>

    </div>
  )
}

function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation()
  return (
    <nav className="nav">
      {NAV_KEYS.map(item => (
        <button key={item.path} className={`nav-btn${location.pathname === item.path ? ' active' : ''}`} onClick={() => navigate(item.path)}>
          {item.icon}<span>{t(item.labelKey)}</span>
        </button>
      ))}
    </nav>
  )
}

export function RightPanel({ data }) {
  const { t } = useTranslation()
  const lang = getLang()
  const d = data || {}
  const upcoming = (d.debts || []).filter(x => !x.is_settled).slice(0, 5)
  const statusDot = d.aiStatus === 'critical' ? '#F04438' : d.aiStatus === 'attention' ? '#F79009' : '#12B76A'
  const statusLabel = d.aiStatus === 'critical' ? t('pulse.critical') : d.aiStatus === 'attention' ? t('common.attention') : t('pulse.healthy')
  const runwayColor = (d.runway || 0) > 14 ? 'var(--green-dark)' : (d.runway || 0) > 7 ? 'var(--amber-dark)' : 'var(--red)'

  const recRu = lang === 'ru'
    ? ((d.runway || 0) < 7
        ? 'Собирайте дебиторку немедленно — высокий риск для денег.'
        : (d.runway || 0) < 14
          ? 'Проверьте ближайшие платежи и защитите запас дней.'
          : 'Финансы стабильны. Сосредоточьтесь на росте дохода.')
    : lang === 'id'
      ? ((d.runway || 0) < 7
          ? 'Segera tagih piutang — risiko kas tinggi.'
          : (d.runway || 0) < 14
            ? 'Periksa pembayaran mendatang dan lindungi cadangan kas.'
            : 'Keuangan terlihat stabil. Fokus pada pertumbuhan pemasukan.')
      : ((d.runway || 0) < 7
          ? 'Collect receivables immediately — cash risk is high.'
          : (d.runway || 0) < 14
            ? 'Review upcoming payments and protect runway.'
            : 'Finances look stable. Focus on growing income.')

  const SecTitle = ({ children }) => (
    <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 10 }}>{children}</div>
  )

  return (
    <div className="desktop-right" style={{ position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}>

      {/* ── AI CFO Card — premium dark navy ─── */}
      <div style={{ marginBottom: 18 }}>
        <SecTitle>AI CFO</SecTitle>
        <div style={{
          background: 'linear-gradient(140deg, #0D1B2E 0%, #162035 100%)',
          borderRadius: 14,
          padding: '14px 14px 12px',
          borderLeft: `3px solid ${statusDot}`,
          boxShadow: '0 4px 16px rgba(11,18,32,0.18)',
        }}>
          {/* Status row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,.08)', border: '0.5px solid rgba(255,255,255,.12)', borderRadius: 20, padding: '2px 8px 2px 7px' }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: statusDot, flexShrink: 0, boxShadow: `0 0 5px ${statusDot}` }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: '#fff' }}>{statusLabel}</span>
            </div>
          </div>
          {/* AI text */}
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,.80)', lineHeight: 1.6, marginBottom: 10 }}>
            {localizeText(d.aiText, lang) || (lang === 'ru' ? 'Анализируем финансовую позицию...' : 'Analysing your financial position...')}
          </div>
          {/* Recommendation */}
          <div style={{ borderTop: '0.5px solid rgba(255,255,255,.08)', paddingTop: 10 }}>
            <div style={{ fontSize: 11, color: 'rgba(99,152,255,.8)', letterSpacing: '0.07em', marginBottom: 5, fontWeight: 800 }}>{t('pulse.recommendation2')}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.65)', lineHeight: 1.55 }}>
              {recRu}
            </div>
          </div>
        </div>
      </div>

      {/* ── Upcoming ─── */}
      <div style={{ marginBottom: 18 }}>
        <SecTitle>{t('pulse.upcoming')}</SecTitle>
        {upcoming.length === 0
          ? <div style={{ fontSize: 13, color: 'var(--text-4)', padding: '8px 0' }}>{t('pulse.noUpcoming')}</div>
          : upcoming.map(debt => {
              const days = Math.round((new Date(debt.due_date) - new Date()) / 86400000)
              const isOverdue = days < 0
              return (
                <div key={debt.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '0.5px solid var(--border)' }}>
                  <div>
                    <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600, marginBottom: 2 }}>{debt.counterparty}</div>
                    <div style={{ fontSize: 12, color: isOverdue ? 'var(--red)' : 'var(--text-4)', fontWeight: isOverdue ? 600 : 400 }}>
                      {isOverdue ? `⚠ ${t('pulse.overdue')}` : days === 0 ? t('pulse.today') : `in ${days}d`}
                    </div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: debt.type === 'receivable' ? 'var(--green-dark)' : 'var(--red-dark)' }}>
                    {debt.type === 'receivable' ? '+' : '−'}{fmtShort(debt.amount)}
                  </div>
                </div>
              )
            })
        }
      </div>

      {/* ── Quick Stats ─── */}
      <div>
        <SecTitle>{t('pulse.quickStats')}</SecTitle>
        <div style={{ background: 'var(--surface-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
          {[
            { label: t('pulse.runway'),      value: (!d.runway || d.runway >= 999) ? '—' : `${d.runway} days`,             color: runwayColor },
            { label: t('pulse.burnRate'),    value: `${fmtShort(d.burnRate || 0)} / ${lang === 'ru' ? 'день' : 'day'}`,     color: 'var(--text)' },
            { label: t('pulse.netPosition'), value: `${(d.netPosition || 0) >= 0 ? '+' : ''}${fmtShort(d.netPosition || 0)}`, color: (d.netPosition || 0) >= 0 ? 'var(--green-dark)' : 'var(--red)' },
            { label: t('common.receivables'), value: `+${fmtShort(d.receivables || 0)}`,                                     color: 'var(--green-dark)' },
            { label: t('common.payables'),    value: `−${fmtShort(d.payables || 0)}`,                                        color: 'var(--red-dark)' },
          ].map((s, i, arr) => (
            <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: i < arr.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{s.label}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

function Layout({ children, rightPanel }) {
  const { user, token, loading } = useAuth()

  // Sync language from user profile on startup
  useEffect(() => {
    if (!token) return
    apiFetch('/profile', token)
      .then(profile => {
        if (profile?.language && profile.language !== getLang()) {
          setLang(profile.language)
        }
      })
      .catch(() => {})
  }, [token])

  if (loading) return <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}>Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  return (
    <>
      <Sidebar />
      <div className="desktop-layout">
        <div className="desktop-main">{children}</div>
        {rightPanel}
      </div>
      <BottomNav />
    </>
  )
}

function PulseWrapper() {
  const [pulseData, setPulseData]       = useState(null)
  const [showOnboarding, setOnboarding] = useState(false)

  // After pulse loads, run detection via exported shouldShowOnboarding()
  const handleDataLoad = (d) => {
    setPulseData(d)
    if (shouldShowOnboarding(d)) setOnboarding(true)
  }

  // Skip: stores cfo_onboarding_skipped, hides wizard
  const handleSkip     = () => setOnboarding(false)
  // Complete: stores cfo_onboarded, hides wizard
  const handleComplete = () => setOnboarding(false)

  if (showOnboarding) {
    return <Onboarding onSkip={handleSkip} onComplete={handleComplete} />
  }

  return (
    <Layout rightPanel={<RightPanel data={pulseData} />}>
      <Pulse onDataLoad={handleDataLoad} />
    </Layout>
  )
}

// Standalone onboarding route — clears both flags, shows wizard, then redirects home
function OnboardingRoute() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  if (loading) return null
  if (!user)   return <Navigate to="/login" replace />
  // Clear both flags so the full wizard runs fresh
  clearOnboardingFlags()
  return (
    <Onboarding
      onSkip={() => navigate('/', { replace: true })}
      onComplete={() => navigate('/', { replace: true })}
    />
  )
}

// ── Swipe-back arc indicator ──────────────────────────────────────────────────
function SwipeBackIndicator() {
  const { progress, arcY } = useSwipeBack()
  if (progress <= 0) return null

  const SIZE    = 56                          // max arc diameter
  const radius  = 20 + progress * 14         // arc grows from 20→34
  const opacity = 0.35 + progress * 0.55     // fades in
  const translateX = -SIZE / 2 + progress * (SIZE / 2 + 4) // slides in from left

  return (
    <div style={{
      position: 'fixed',
      left: 0,
      top: arcY - SIZE / 2,
      width: SIZE,
      height: SIZE,
      zIndex: 9999,
      pointerEvents: 'none',
      transform: `translateX(${translateX}px)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {/* Arc background */}
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ position: 'absolute', inset: 0 }}>
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={radius}
          fill={`rgba(255,255,255,${opacity * 0.18})`}
          stroke={`rgba(255,255,255,${opacity * 0.6})`}
          strokeWidth="1.5"
        />
      </svg>
      {/* Arrow chevron */}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke={`rgba(255,255,255,${opacity})`} strokeWidth="2.5" strokeLinecap="round"
        style={{ position: 'relative', transform: `scale(${0.7 + progress * 0.3})` }}
      >
        <path d="M15 18l-6-6 6-6"/>
      </svg>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SwipeBackIndicator />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<PulseWrapper />} />
          <Route path="/add"          element={<Layout><Add /></Layout>} />
          <Route path="/radar"        element={<Layout><Radar /></Layout>} />
          <Route path="/accounts"     element={<Layout><Accounts /></Layout>} />
          <Route path="/accounts/:id" element={<Layout><WalletDetail /></Layout>} />
          <Route path="/transactions" element={<Layout><Transactions /></Layout>} />
          <Route path="/settings"     element={<Layout><Settings /></Layout>} />
          <Route path="/cfo"          element={<Layout><AICFO /></Layout>} />
          <Route path="/receivables"  element={<Layout><Receivables /></Layout>} />
          <Route path="/payables"     element={<Layout><Payables /></Layout>} />
          <Route path="/invoices"     element={<Layout><Invoices /></Layout>} />
          <Route path="/payroll"      element={<Layout><Payroll /></Layout>} />
          <Route path="/tasks"        element={<Layout><Tasks /></Layout>} />
          <Route path="/approvals"    element={<Layout><Approvals /></Layout>} />
          {/* Standalone onboarding — accessible directly to re-run setup */}
          <Route path="/onboarding" element={<OnboardingRoute />} />
          {/* Hidden admin routes — not in sidebar, protected by ADMIN_TELEGRAM_IDS on backend */}
          <Route path="/admin"           element={<Layout><Admin /></Layout>} />
          <Route path="/admin/users/:id" element={<Layout><AdminUser /></Layout>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}