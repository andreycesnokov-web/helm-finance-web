import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from '../hooks/useTranslation'

const KANBAN_COLS = [
  { key: 'draft',   label: 'Draft',   dot: 'var(--text-4)' },
  { key: 'sent',    label: 'Sent',    dot: 'var(--brand)' },
  { key: 'overdue', label: 'Overdue', dot: 'var(--red)' },
  { key: 'paid',    label: 'Paid',    dot: 'var(--green)' },
]

export default function Invoices() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [view, setView] = useState('cards') // 'cards' | 'list' | 'kanban'

  const MODULE_CARDS = [
    {
      icon: '↓',
      label: t('pulse.addReceivable'),
      sub: t('pulse.receivablesSect'),
      color: 'var(--green-dark)',
      bg: 'var(--green-light)',
      border: 'rgba(2,122,72,.12)',
      count: '—',
      path: '/receivables',
    },
    {
      icon: '↑',
      label: t('pulse.addPayable'),
      sub: t('pulse.payablesSect'),
      color: 'var(--red-dark)',
      bg: 'var(--red-light)',
      border: 'rgba(180,35,24,.12)',
      count: '—',
      path: '/payables',
    },
    {
      icon: '⚠',
      label: t('common.overdue'),
      sub: t('common.overdue'),
      color: 'var(--amber-dark)',
      bg: 'var(--amber-light)',
      border: 'rgba(181,71,8,.12)',
      count: '—',
      path: '/receivables',
    },
  ]

  return (
    <div className="hf-page">

      {/* ── Header ─── */}
      <div className="hf-page-header">
        <div>
          <div className="hf-page-title">{t('invoices.title')}</div>
          <div className="hf-page-subtitle">{t('invoices.subtitle')}</div>
        </div>
        <div className="hf-page-actions">
          {/* View toggle */}
          <div className="view-toggle">
            {[
              { key: 'cards',  label: '⊞' },
              { key: 'list',   label: '≡' },
              { key: 'kanban', label: '⣶' },
            ].map(v => (
              <button key={v.key} className={`view-toggle-btn${view === v.key ? ' active' : ''}`} onClick={() => setView(v.key)}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Coming soon notice ─── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--brand-light)', border: '1px solid rgba(37,99,235,.15)', borderRadius: 14, padding: '12px 18px', marginBottom: 24 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--brand)', flexShrink: 0 }} />
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--brand-dark)', fontWeight: 500 }}>
          {t('invoices.comingSoon')}
        </div>
      </div>

      {/* ── CARDS VIEW ─── */}
      {view === 'cards' && (
        <>
          <div className="hf-card-grid hf-card-grid-3" style={{ marginBottom: 32 }}>
            {MODULE_CARDS.map(c => (
              <div key={c.label} className="invoice-module-card" style={{ border: `1px solid ${c.border}`, background: c.bg, opacity: 0.88 }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(255,255,255,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, color: c.color, marginBottom: 14 }}>{c.icon}</div>
                <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: c.color, marginBottom: 5 }}>{c.label}</div>
                <div style={{ fontSize: 'var(--text-sm)', color: c.color, opacity: 0.75, marginBottom: 18 }}>{c.sub}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="hf-badge hf-badge-muted" style={{ fontSize: 12 }}>{t('invoices.comingSoon')}</span>
                  <button onClick={() => navigate(c.path)} style={{ fontSize: 'var(--text-xs)', color: c.color, background: 'rgba(255,255,255,.5)', border: `1px solid ${c.border}`, borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                    {t('common.viewAll')}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Empty state */}
          <div className="empty-state">
            <div className="empty-state-icon">🧾</div>
            <div className="empty-state-title">{t('invoices.moduleReady')}</div>
            <div className="empty-state-sub">{t('invoices.comingSoon')}</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className="empty-state-cta" onClick={() => navigate('/receivables')}>{t('invoices.viewReceivables')}</button>
              <button className="empty-state-cta secondary" onClick={() => navigate('/payables')}>{t('invoices.viewPayables')}</button>
            </div>
          </div>
        </>
      )}

      {/* ── LIST VIEW ─── */}
      {view === 'list' && (
        <div className="hf-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="hf-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>{t('invoices.invoice')}</th>
                <th></th>
                <th>{t('invoices.amount')}</th>
                <th>{t('invoices.dueDate')}</th>
                <th>{t('invoices.status')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-4)', fontSize: 'var(--text-sm)' }}>
                  <div style={{ fontSize: 28, marginBottom: 10 }}>🧾</div>
                  {t('invoices.noInvoices')}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ── KANBAN VIEW ─── */}
      {view === 'kanban' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          {KANBAN_COLS.map(col => (
            <div key={col.key} className="invoice-kanban-col">
              <div className="invoice-kanban-header">
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: col.dot }} />
                {col.label}
              </div>
              <div className="invoice-kanban-empty">{t('invoices.noInvoices')}</div>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}
