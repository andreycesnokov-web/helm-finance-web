// Platform Admin Dashboard — INTERNAL owner/admin console. Read-only: counts and risk
// signals from GET /api/admin/dashboard. Never shows financial amounts, secrets or tokens.
// Metrics that cannot be computed safely render as a muted "n/a" and are explained in the
// Warnings panel — we never display an invented number.
//
// Presentation uses the standard CFO AI design system (shell/ui + cfo-* classes) so the
// console matches the product rather than looking like a debug page. No API changes.
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch } from '../lib/api'
import { Card, PageHeader, StatusBadge, Btn, Icon, LoadingSkeleton, ErrorState } from '../shell/ui'

const TABS = [
  ['/admin/dashboard', 'Dashboard'],
  ['/admin', 'Users'],
  ['/admin/businesses', 'Businesses'],
  ['/admin/access-audit', 'Audit Log'],
]

const AdminTabs = ({ active }) => (
  <nav className="admin-dash-tabs" aria-label="Platform admin sections">
    {TABS.map(([to, label]) => (
      <a key={to} href={to} className={`admin-dash-tab${to === active ? ' is-active' : ''}`}>{label}</a>
    ))}
  </nav>
)

// null/undefined must READ as unavailable — never as 0.
const NA = () => <span className="admin-dash-na">n/a</span>
const val = (v) => (v === null || v === undefined ? <NA /> : v)
const num = (v) => (v === null || v === undefined ? <NA /> : Number(v).toLocaleString())

// Compact metric row: label left, value right-aligned and emphasised.
const MRow = ({ k, v, hint, strong }) => (
  <div className="admin-dash-row">
    <span className="admin-dash-row-k">{k}{hint && <span className="admin-dash-row-hint">{hint}</span>}</span>
    <span className={`admin-dash-row-v${strong ? ' is-strong' : ''}`}>{v}</span>
  </div>
)

// Overview stat card with a subtle accent rail.
const StatCard = ({ label, value, hint, accent, onClick }) => (
  <div className={`admin-dash-stat${onClick ? ' is-clickable' : ''}`} style={{ '--stat-accent': accent }}
    onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
    onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}>
    <div className="admin-dash-stat-k">{label}</div>
    <div className="admin-dash-stat-v">{value}</div>
    {hint && <div className="admin-dash-stat-h">{hint}</div>}
  </div>
)

const Flag = ({ on, children }) => (
  <span className={`admin-dash-flag${on ? ' is-on' : ''}`}>
    <span className="admin-dash-flag-dot" aria-hidden />{children}
  </span>
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
    const denied = /Admin access|Forbidden|Unauthorized/i.test(error.message || '')
    return (
      <div className="admin-dash">
        <AdminTabs active="/admin/dashboard" />
        <div className="admin-dash-body">
          {denied
            ? <Card><EmptyAccess /></Card>
            : <ErrorState title="Dashboard unavailable" description={error.message} onRetry={() => location.reload()} />}
        </div>
      </div>
    )
  }

  if (!d) {
    return (
      <div className="admin-dash">
        <AdminTabs active="/admin/dashboard" />
        <div className="admin-dash-body">
          <PageHeader eyebrow="Platform Admin" title="Platform Dashboard" />
          <div className="cfo-grid cfo-grid-4 admin-dash-cards"><LoadingSkeleton rows={3} /><LoadingSkeleton rows={3} /><LoadingSkeleton rows={3} /><LoadingSkeleton rows={3} /></div>
          <div style={{ marginTop: 20 }}><Card title="Loading platform metrics…"><LoadingSkeleton rows={5} /></Card></div>
        </div>
      </div>
    )
  }

  const u = d.users || {}, b = d.businesses || {}, r = d.identity_risks || {}
  const a = d.activity_last_7_days || {}, s = d.system || {}, bill = d.billing || {}
  const flags = s.feature_flags || {}
  const warnings = d.warnings || []
  const degraded = s.degraded === true
  const healthy = s.db_reachable === true && !degraded

  return (
    <div className="admin-dash">
      <AdminTabs active="/admin/dashboard" />
      <div className="admin-dash-body">

        <PageHeader
          eyebrow="Platform Admin"
          title="Platform Dashboard"
          actions={<>
            <StatusBadge tone="private" icon={<Icon.lock />}>Admin only</StatusBadge>
            <StatusBadge tone="shared">Read-only</StatusBadge>
            {healthy
              ? <StatusBadge tone="success" icon={<Icon.check />}>Database healthy</StatusBadge>
              : <StatusBadge tone="warning" icon={<Icon.warn />}>{degraded ? 'Degraded — some metrics unavailable' : 'Database unreachable'}</StatusBadge>}
          </>} />

        <p className="admin-dash-sub">
          Internal owner/admin console — not customer-facing. Counts only, no financial amounts.
        </p>

        {/* ── Overview ─────────────────────────────────────────────── */}
        <div className="cfo-grid admin-dash-cards">
          <StatCard label="Total users" value={num(u.total)} hint="All accounts" accent="#6366f1" onClick={() => navigate('/admin/users')} />
          <StatCard label="Workspaces" value={num(b.total)} hint="Company + personal" accent="#2563EB" onClick={() => navigate('/admin/businesses')} />
          <StatCard label="Companies" value={num(b.company_workspaces)} hint="Non-personal" accent="#0EA5E9" onClick={() => navigate('/admin/businesses')} />
          <StatCard label="New users" value={num(u.new_last_30_days)} hint="Last 30 days" accent="#12B76A" />
          <StatCard label="Database" value={s.db_reachable === true ? 'Healthy' : s.db_reachable === false ? 'Unreachable' : <NA />}
            hint={degraded ? 'Degraded response' : 'Live connectivity'} accent={healthy ? '#12B76A' : '#F79009'} />
        </div>

        {/* ── Users + Businesses ───────────────────────────────────── */}
        <div className="cfo-grid cfo-grid-2 admin-dash-section">
          <Card title="Users" action={<Btn sm variant="ghost" onClick={() => navigate('/admin/users')}>Open users</Btn>}>
            <MRow k="Total accounts" v={num(u.total)} strong />
            <MRow k="With email identity" v={num(u.with_email_identity)} />
            <MRow k="Telegram-origin" v={num(u.telegram_origin)} />
            <MRow k="Email-first" v={num(u.email_origin)} />
            <MRow k="Email + Telegram linked" v={num(u.with_email_and_telegram)} />
            <MRow k="Without email" v={num(u.without_email)} />
            <MRow k="Without Telegram" v={num(u.without_telegram)} />
            <MRow k="New — last 7 days" v={num(u.new_last_7_days)} />
            <MRow k="New — last 30 days" v={num(u.new_last_30_days)} />
          </Card>

          <Card title="Businesses & workspaces" action={<Btn sm variant="ghost" onClick={() => navigate('/admin/businesses')}>Open businesses</Btn>}>
            <MRow k="Total workspaces" v={num(b.total)} strong />
            <MRow k="Active" v={num(b.active)} />
            <MRow k="Archived" v={num(b.archived)} />
            <MRow k="Company workspaces" v={num(b.company_workspaces)} />
            <MRow k="Personal workspaces" v={num(b.personal_workspaces)} />
            <MRow k="Without owner" v={num(b.without_owner)} />
            <MRow k="New — last 7 days" v={num(b.new_last_7_days)} />
            <MRow k="New — last 30 days" v={num(b.new_last_30_days)} />
            <MRow k="Inactive" hint="needs per-business aggregation" v={val(b.inactive_no_recent_activity)} />
          </Card>
        </div>

        {/* ── Risk center ──────────────────────────────────────────── */}
        <div className="admin-dash-section">
          <Card title="Risk center" action={<StatusBadge tone="neutral">Identity</StatusBadge>}>
            <MRow k="Telegram-only owners" hint="cannot sign in by email yet" v={num(r.telegram_only_owners)} strong />
            <MRow k="Email-first owners" hint="own a workspace" v={num(r.email_only_owners)} />
            <MRow k="Email identities on email-first users" v={num(r.email_identities_on_email_first_users)} />
            <MRow k="Users with no login identity" v={num(r.users_without_login_identity)} />
            <MRow k="Duplicate email conflicts" hint="detected at link time" v={val(r.duplicate_email_conflicts)} />
            <div className="admin-dash-note">
              Telegram-only owners can be given email access from <a href="/admin/users">Users → user → Link email</a>.
              Duplicate emails are prevented by a database constraint, so conflicts surface when linking.
            </div>
          </Card>
        </div>

        {/* ── Activity ─────────────────────────────────────────────── */}
        <div className="admin-dash-section">
          <div className="admin-dash-sectionhead">Activity — last 7 days</div>
          <div className="cfo-grid admin-dash-cards">
            <StatCard label="Audit events" value={num(a.audit_events)} hint="Recorded actions" accent="#7C3AED" />
            <StatCard label="Transactions" value={num(a.transactions)} hint="Count only" accent="#2563EB" />
            <StatCard label="Documents" value={num(a.documents)} hint="Uploaded" accent="#F79009" />
            <StatCard label="New users" value={num(a.new_users)} hint="Last 7 days" accent="#12B76A" />
            <StatCard label="New businesses" value={num(a.new_businesses)} hint="Last 7 days" accent="#0EA5E9" />
          </div>
        </div>

        {/* ── System health + Billing ──────────────────────────────── */}
        <div className="cfo-grid cfo-grid-2 admin-dash-section">
          <Card title="System health" action={healthy
            ? <StatusBadge tone="success">Healthy</StatusBadge>
            : <StatusBadge tone="warning">{degraded ? 'Degraded' : 'Unreachable'}</StatusBadge>}>
            <MRow k="Database" v={s.db_reachable === true ? 'Reachable' : s.db_reachable === false ? 'Unreachable' : <NA />} strong />
            <MRow k="Response mode" v={degraded ? 'Degraded (timed out)' : 'Complete'} />
            <MRow k="Generated at" v={d.generated_at ? new Date(d.generated_at).toLocaleString() : <NA />} />
            <MRow k="Build" v={s.commit ? <code className="admin-dash-code">{s.commit}</code> : <NA />} />
            <div className="admin-dash-flags">
              <Flag on={!!flags.email_auth}>Email auth</Flag>
              <Flag on={!!flags.personal_account_v1}>Personal v1</Flag>
              <Flag on={!!flags.telegram_active_business}>TG active business</Flag>
              <Flag on={!!flags.telegram_paid_gate}>TG paid gate</Flag>
              <Flag on={!!flags.personal_funding_bridge}>Funding bridge</Flag>
            </div>
          </Card>

          <Card className="admin-dash-muted" title="Billing" action={<StatusBadge tone="neutral">Not implemented</StatusBadge>}>
            <MRow k="Billing enabled" v={bill.billing_enabled ? 'Yes' : 'No'} />
            <MRow k="Paid businesses" v={val(bill.paid_businesses)} />
            <MRow k="MRR" v={val(bill.mrr)} />
            <div className="admin-dash-note">
              {bill.note || 'Billing/entitlements are not implemented yet'} — these fields stay empty on purpose
              rather than showing a placeholder number.
            </div>
          </Card>
        </div>

        {/* ── Warnings ─────────────────────────────────────────────── */}
        <div className="admin-dash-section">
          <Card title={`Unavailable metrics${warnings.length ? ` · ${warnings.length}` : ''}`}
            action={warnings.length
              ? <StatusBadge tone="warning" icon={<Icon.warn />}>Attention</StatusBadge>
              : <StatusBadge tone="success" icon={<Icon.check />}>All computed</StatusBadge>}>
            {warnings.length === 0
              ? <div className="admin-dash-note">No warnings — every metric was computed successfully.</div>
              : <ul className="admin-dash-warnlist">
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>}
            <div className="admin-dash-note">
              Values shown as <span className="admin-dash-na">n/a</span> could not be computed safely and are never estimated.
            </div>
          </Card>
        </div>

      </div>
    </div>
  )
}

function EmptyAccess() {
  return (
    <div className="admin-dash-denied">
      <span className="cfo-state-ic" aria-hidden><Icon.lock /></span>
      <div>
        <div className="admin-dash-denied-t">Admin access required</div>
        <div className="admin-dash-note">This console is available to CFO AI platform owners only.</div>
      </div>
    </div>
  )
}
