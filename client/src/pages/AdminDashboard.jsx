// Platform Admin Dashboard (foundation) — INTERNAL owner/admin view of the whole customer
// base. Read-only: counts and risk signals from GET /api/admin/dashboard. Never shows
// financial amounts, secrets or tokens. Metrics that cannot be computed safely render as
// "n/a" and are explained in the Warnings section — we never display an invented number.
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch } from '../lib/api'

const AdminTabs = ({ active }) => (
  <div style={{ display: 'flex', gap: 8, padding: '12px 32px 0', flexWrap: 'wrap' }}>
    {[['/admin/dashboard', 'Dashboard'], ['/admin', 'Users'], ['/admin/businesses', 'Businesses'], ['/admin/access-audit', 'Audit Log']].map(([to, label]) => (
      <a key={to} href={to} style={{
        padding: '6px 14px', borderRadius: 20, textDecoration: 'none', fontWeight: 600, fontSize: 13,
        background: to === active ? 'var(--accent,#4F46E5)' : 'var(--bg-3)', color: to === active ? '#fff' : 'var(--text-2)',
      }}>{label}</a>
    ))}
  </div>
)

// null/undefined must READ as unavailable, never as 0.
const val = (v) => (v === null || v === undefined
  ? <span style={{ color: 'var(--text-4,#9aa3ad)', fontWeight: 600 }}>n/a</span>
  : v)

function Card({ label, value, sub, accent, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 14,
      padding: '14px 16px', borderLeft: `3px solid ${accent || 'var(--border)'}`,
      cursor: onClick ? 'pointer' : 'default',
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', margin: '4px 0 2px' }}>{val(value)}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{sub}</div>}
    </div>
  )
}

function Section({ title, action, children }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  )
}

const Grid = ({ children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>{children}</div>
)

const Row = ({ k, children }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '9px 16px', borderTop: '0.5px solid var(--border)', fontSize: 13 }}>
    <span style={{ color: 'var(--text-3)' }}>{k}</span><span style={{ fontWeight: 600 }}>{children}</span>
  </div>
)
const Panel = ({ children }) => (
  <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>{children}</div>
)

export default function AdminDashboard() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!token) return
    apiFetch('/admin/dashboard', token).then(setD).catch(setError)
  }, [token])

  if (error) {
    const is403 = /Admin access|Forbidden/i.test(error.message || '')
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <div style={{ textAlign: 'center', maxWidth: 380 }}>
          <div style={{ fontSize: 44, marginBottom: 14 }}>{is403 ? '🔒' : '⚠️'}</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{is403 ? 'Admin access required' : 'Dashboard unavailable'}</div>
          <div style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.6 }}>{is403 ? 'This page is for CFO AI platform owners only.' : error.message}</div>
        </div>
      </div>
    )
  }
  if (!d) return <div style={{ padding: 40, color: 'var(--text-3)' }}>Loading dashboard…</div>

  const u = d.users || {}, b = d.businesses || {}, r = d.identity_risks || {}
  const a = d.activity_last_7_days || {}, s = d.system || {}, bill = d.billing || {}
  const flags = s.feature_flags || {}

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <AdminTabs active="/admin/dashboard" />

      <div style={{ background: 'linear-gradient(135deg, #0F172A 0%, #1e293b 100%)', padding: '28px 32px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#6366f1', letterSpacing: '0.12em', textTransform: 'uppercase', background: 'rgba(99,102,241,0.15)', padding: '3px 10px', borderRadius: 20 }}>Platform Admin</span>
        <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', letterSpacing: -0.5, margin: '8px 0 4px' }}>Platform Dashboard</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
          Internal owner/admin console — not customer-facing. Counts only, no financial amounts.
        </div>
      </div>

      <div style={{ padding: '24px 28px', maxWidth: 1200 }}>
        {/* Overview */}
        <Section title="Overview">
          <Grid>
            <Card label="Total users" value={u.total} sub="all accounts" accent="#6366f1" onClick={() => navigate('/admin/users')} />
            <Card label="Workspaces" value={b.total} sub="business + personal" accent="#2563EB" onClick={() => navigate('/admin/businesses')} />
            <Card label="Companies" value={b.company_workspaces} sub="non-personal" accent="#0EA5E9" onClick={() => navigate('/admin/businesses')} />
            <Card label="New users (30d)" value={u.new_last_30_days} sub="last 30 days" accent="#12B76A" />
            <Card label="DB reachable" value={s.db_reachable === true ? 'yes' : s.db_reachable === false ? 'no' : null} sub="live connectivity" accent={s.db_reachable ? '#12B76A' : '#D92D20'} />
          </Grid>
        </Section>

        {/* Users */}
        <Section title="Users" action={<a href="/admin/users" style={{ fontSize: 12, color: 'var(--accent,#4F46E5)' }}>Open users →</a>}>
          <Panel>
            <Row k="Total">{val(u.total)}</Row>
            <Row k="With email identity">{val(u.with_email_identity)}</Row>
            <Row k="Telegram-origin (positive id)">{val(u.telegram_origin)}</Row>
            <Row k="Email-first (negative id)">{val(u.email_origin)}</Row>
            <Row k="Email + Telegram (linked)">{val(u.with_email_and_telegram)}</Row>
            <Row k="Without email">{val(u.without_email)}</Row>
            <Row k="Without Telegram">{val(u.without_telegram)}</Row>
            <Row k="New — last 7 days">{val(u.new_last_7_days)}</Row>
            <Row k="New — last 30 days">{val(u.new_last_30_days)}</Row>
          </Panel>
        </Section>

        {/* Businesses */}
        <Section title="Businesses & workspaces" action={<a href="/admin/businesses" style={{ fontSize: 12, color: 'var(--accent,#4F46E5)' }}>Open businesses →</a>}>
          <Panel>
            <Row k="Total workspace rows">{val(b.total)}</Row>
            <Row k="Active">{val(b.active)}</Row>
            <Row k="Archived">{val(b.archived)}</Row>
            <Row k="Company workspaces">{val(b.company_workspaces)}</Row>
            <Row k="Personal workspaces">{val(b.personal_workspaces)}</Row>
            <Row k="Without owner">{val(b.without_owner)}</Row>
            <Row k="New — last 7 / 30 days">{val(b.new_last_7_days)} / {val(b.new_last_30_days)}</Row>
            <Row k="Inactive (no recent activity)">{val(b.inactive_no_recent_activity)}</Row>
          </Panel>
        </Section>

        {/* Identity risks */}
        <Section title="Identity risks">
          <Panel>
            <Row k="Telegram-only owners (no email login)">{val(r.telegram_only_owners)}</Row>
            <Row k="Email-first owners of a workspace">{val(r.email_only_owners)}</Row>
            <Row k="Email identities on email-first users">{val(r.email_identities_on_email_first_users)}</Row>
            <Row k="Users with no login identity">{val(r.users_without_login_identity)}</Row>
            <Row k="Duplicate email conflicts">{val(r.duplicate_email_conflicts)}</Row>
          </Panel>
          <div style={{ fontSize: 11.5, color: 'var(--text-4)', marginTop: 8, lineHeight: 1.5 }}>
            Telegram-only owners cannot sign in by email until an admin links one (Users → user → Link email).
            Duplicate emails are prevented by a unique DB constraint; conflicts surface at link time.
          </div>
        </Section>

        {/* Activity */}
        <Section title="Activity — last 7 days">
          <Grid>
            <Card label="Audit events" value={a.audit_events} sub="recorded actions" accent="#7C3AED" />
            <Card label="Transactions" value={a.transactions} sub="count only" accent="#2563EB" />
            <Card label="Documents" value={a.documents} sub="uploaded" accent="#F79009" />
            <Card label="New users" value={a.new_users} sub="last 7 days" accent="#12B76A" />
            <Card label="New businesses" value={a.new_businesses} sub="last 7 days" accent="#0EA5E9" />
          </Grid>
        </Section>

        {/* System health */}
        <Section title="System health">
          <Panel>
            <Row k="DB reachable">{s.db_reachable === true ? 'yes' : s.db_reachable === false ? 'no' : val(null)}</Row>
            <Row k="Generated at">{d.generated_at || '—'}</Row>
            <Row k="Commit">{s.commit || val(null)}</Row>
            <Row k="Flag · email auth">{String(!!flags.email_auth)}</Row>
            <Row k="Flag · personal account v1">{String(!!flags.personal_account_v1)}</Row>
            <Row k="Flag · telegram active business">{String(!!flags.telegram_active_business)}</Row>
            <Row k="Flag · telegram paid gate">{String(!!flags.telegram_paid_gate)}</Row>
            <Row k="Flag · personal funding bridge">{String(!!flags.personal_funding_bridge)}</Row>
          </Panel>
        </Section>

        {/* Billing placeholder */}
        <Section title="Billing">
          <Panel>
            <Row k="Billing enabled">{String(!!bill.billing_enabled)}</Row>
            <Row k="Paid businesses">{val(bill.paid_businesses)}</Row>
            <Row k="MRR">{val(bill.mrr)}</Row>
          </Panel>
          <div style={{ fontSize: 11.5, color: 'var(--text-4)', marginTop: 8 }}>{bill.note || 'Billing/entitlements not implemented yet'}</div>
        </Section>

        {/* Warnings */}
        <Section title={`Warnings / unavailable metrics · ${(d.warnings || []).length}`}>
          {(d.warnings || []).length === 0
            ? <Panel><div style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-3)' }}>All metrics computed.</div></Panel>
            : <Panel>{(d.warnings || []).map((w, i) => (
                <div key={i} style={{ padding: '9px 16px', borderTop: i ? '0.5px solid var(--border)' : 'none', fontSize: 12.5, color: '#92400e', background: '#FEF3C7' }}>{w}</div>
              ))}</Panel>}
          <div style={{ fontSize: 11.5, color: 'var(--text-4)', marginTop: 8 }}>
            Metrics shown as <b>n/a</b> could not be computed safely and are never guessed.
          </div>
        </Section>
      </div>
    </div>
  )
}
