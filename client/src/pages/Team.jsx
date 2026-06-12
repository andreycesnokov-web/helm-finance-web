import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from '../hooks/useTranslation'
import { apiFetch } from '../lib/api'

const ROLE_LABELS = {
  owner:    { label: 'Owner',    color: '#1565C0', bg: '#E3F2FD' },
  admin:    { label: 'Admin',    color: '#6A1B9A', bg: '#F3E5F5' },
  cfo:      { label: 'CFO',      color: '#085041', bg: '#E1F5EE' },
  manager:  { label: 'Manager',  color: '#E65100', bg: '#FFF3E0' },
  employee: { label: 'Employee', color: '#424242', bg: '#F5F5F5' },
}

const ROLE_OPTS = [
  { value: 'employee', label: 'Employee' },
  { value: 'manager',  label: 'Manager'  },
  { value: 'cfo',      label: 'CFO'      },
  { value: 'admin',    label: 'Admin'    },
]

function RoleBadge({ role }) {
  const r = ROLE_LABELS[role] || { label: role, color: 'var(--text-3)', bg: 'var(--bg-3)' }
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: r.bg, color: r.color }}>
      {r.label}
    </span>
  )
}

function fmtDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Invite modal ──────────────────────────────────────────────────────────────
function InviteModal({ token, onClose, onCreated }) {
  const [role,    setRole]    = useState('employee')
  const [label,   setLabel]   = useState('')
  const [maxUses, setMaxUses] = useState(1)
  const [days,    setDays]    = useState(7)
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState(null)
  const [copied,  setCopied]  = useState(false)

  const handleCreate = async () => {
    setLoading(true)
    try {
      const data = await apiFetch('/team/invite', token, {
        method: 'POST',
        body: { role, label: label || undefined, max_uses: maxUses, expires_days: days },
      })
      setResult(data)
      onCreated()
    } catch (e) {
      alert(e.message)
    }
    setLoading(false)
  }

  const inviteUrl = result ? `${window.location.origin}/invite/${result.invite.code}` : ''

  const copyLink = () => {
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const ROLE_DESCS = {
    employee: 'Can submit requests via Telegram. Needs approval for financial records.',
    manager:  'Can manage receivables and payables. Submits drafts for owner approval.',
    cfo:      'Full financial visibility. Can approve records and view all reports.',
    admin:    'Full access except billing. Can invite and manage team members.',
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: 'var(--bg)', borderRadius: 20, padding: '28px 28px 24px',
        width: '100%', maxWidth: 440,
        boxShadow: '0 24px 64px rgba(0,0,0,0.22)',
        animation: 'modalIn .18s ease',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>
              {result ? '✅' : '👥'}
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>
              {result ? 'Invite Ready' : 'Invite Member'}
            </div>
          </div>
          <button onClick={onClose}
            style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: 'var(--text-3)', cursor: 'pointer', lineHeight: 1 }}>
            ×
          </button>
        </div>

        {!result ? (
          <>
            {/* Role picker */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>Role</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {ROLE_OPTS.map(r => (
                  <button key={r.value} onClick={() => setRole(r.value)}
                    style={{
                      padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                      cursor: 'pointer', textAlign: 'left', transition: 'all .12s',
                      border: role === r.value ? '1.5px solid var(--text)' : '1px solid var(--border)',
                      background: role === r.value ? 'var(--text)' : 'var(--bg-2)',
                      color:      role === r.value ? 'var(--bg)'   : 'var(--text-2)',
                    }}>
                    {r.label}
                  </button>
                ))}
              </div>
              {/* Role description */}
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5, padding: '8px 12px', background: 'var(--bg-2)', borderRadius: 8 }}>
                {ROLE_DESCS[role]}
              </div>
            </div>

            {/* Note */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>Note <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional)</span></div>
              <input
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder='e.g. "For accountant Fenia"'
                style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box', outline: 'none' }}
              />
            </div>

            {/* Max uses + expiry */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 22 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 7 }}>Max uses</div>
                <select value={maxUses} onChange={e => setMaxUses(Number(e.target.value))}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 14 }}>
                  {[1,2,5,10,50,100].map(n => <option key={n} value={n}>{n} {n === 1 ? 'person' : 'people'}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 7 }}>Expires in</div>
                <select value={days} onChange={e => setDays(Number(e.target.value))}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 14 }}>
                  <option value={1}>1 day</option>
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                </select>
              </div>
            </div>

            <button onClick={handleCreate} disabled={loading}
              style={{ width: '100%', padding: '14px', borderRadius: 12, background: 'var(--text)', color: 'var(--bg)', fontSize: 15, fontWeight: 700, border: 'none', cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1, transition: 'opacity .15s' }}>
              {loading ? 'Creating…' : '🔗 Create Invite Link'}
            </button>
          </>
        ) : (
          <>
            {/* Success state */}
            <div style={{ background: 'linear-gradient(135deg, #E1F5EE 0%, #F0FBF7 100%)', border: '1px solid rgba(18,183,106,.2)', borderRadius: 14, padding: '16px', marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#085041', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>Invite link</div>
              <div style={{ fontSize: 13, color: '#085041', wordBreak: 'break-all', fontFamily: 'monospace', lineHeight: 1.5, marginBottom: 10 }}>{inviteUrl}</div>
              <div style={{ display: 'flex', gap: 10, fontSize: 12, color: '#085041', flexWrap: 'wrap' }}>
                <span style={{ background: 'rgba(8,80,65,.1)', padding: '2px 8px', borderRadius: 6 }}>
                  Role: <b>{result.invite.role}</b>
                </span>
                <span style={{ background: 'rgba(8,80,65,.1)', padding: '2px 8px', borderRadius: 6 }}>
                  Expires: {fmtDate(result.invite.expires_at)}
                </span>
                <span style={{ background: 'rgba(8,80,65,.1)', padding: '2px 8px', borderRadius: 6 }}>
                  Uses: {result.invite.max_uses}
                </span>
              </div>
            </div>

            <button onClick={copyLink}
              style={{ width: '100%', padding: '14px', borderRadius: 12, background: copied ? '#085041' : 'var(--brand)', color: '#fff', fontSize: 15, fontWeight: 700, border: 'none', cursor: 'pointer', marginBottom: 8, transition: 'background .2s' }}>
              {copied ? '✓ Copied to clipboard!' : '📋 Copy Link'}
            </button>
            <button onClick={onClose}
              style={{ width: '100%', padding: '12px', borderRadius: 12, background: 'var(--bg-2)', color: 'var(--text-3)', fontSize: 14, fontWeight: 600, border: '1px solid var(--border)', cursor: 'pointer' }}>
              Done
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Team() {
  const { token } = useAuth()
  const { t } = useTranslation()

  const [data,        setData]        = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState('')
  const [showInvite,  setShowInvite]  = useState(false)
  const [revoking,    setRevoking]    = useState(null)
  const [removing,    setRemoving]    = useState(null)
  const [editRole,    setEditRole]    = useState(null) // { memberId, current }
  const [newRole,     setNewRole]     = useState('')

  const load = useCallback(() => {
    setLoading(true)
    apiFetch('/team', token)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => { load() }, [load])

  const handleRevoke = async (code) => {
    if (!confirm('Revoke this invite link?')) return
    setRevoking(code)
    try { await apiFetch(`/team/invites/${code}`, token, { method: 'DELETE' }); load() }
    catch (e) { alert(e.message) }
    setRevoking(null)
  }

  const handleRemove = async (memberId, name) => {
    if (!confirm(`Remove ${name} from the team?`)) return
    setRemoving(memberId)
    try { await apiFetch(`/team/members/${memberId}`, token, { method: 'DELETE' }); load() }
    catch (e) { alert(e.message) }
    setRemoving(null)
  }

  const handleRoleChange = async (memberId) => {
    if (!newRole) return
    try {
      await apiFetch(`/team/members/${memberId}`, token, { method: 'PATCH', body: { role: newRole } })
      setEditRole(null)
      setNewRole('')
      load()
    } catch (e) { alert(e.message) }
  }

  const copyInviteLink = (code) => {
    navigator.clipboard.writeText(`${window.location.origin}/invite/${code}`)
    alert('Link copied!')
  }

  if (loading && !data) return <div className="page-loading">Loading team…</div>

  const d       = data || {}
  const members = d.members || []
  const invites = d.invites || []
  const myRole  = d.my_role || 'employee'
  const canManage = ['owner', 'admin'].includes(myRole)

  return (
    <div className="hf-page">

      {/* Header */}
      <div className="hf-page-header">
        <div>
          <div className="hf-page-title">Team</div>
          <div className="hf-page-subtitle">Manage your team members and invites</div>
        </div>
        {canManage && (
          <div className="hf-page-actions" style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-md" onClick={() => { window.location.href = '/team-onboarding' }}
              style={{ border: '1px solid var(--border-2)', background: 'var(--surface)' }}>
              🎓 {t('onboarding.title')}
            </button>
            <button className="btn btn-primary btn-md" onClick={() => setShowInvite(true)}>+ Invite</button>
          </div>
        )}
      </div>

      {error && <div className="page-error">{error}</div>}

      {/* Summary */}
      <div className="summary-grid" style={{ marginBottom: 20 }}>
        <div className="summary-card">
          <div className="summary-card-label">Members</div>
          <div className="summary-card-value">{members.filter(m => m.status === 'active').length}</div>
          <div className="summary-card-sub">Active in team</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">Pending invites</div>
          <div className="summary-card-value" style={{ color: invites.length > 0 ? 'var(--amber-dark)' : 'var(--text)' }}>
            {invites.length}
          </div>
          <div className="summary-card-sub">Open invite links</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">Your role</div>
          <div className="summary-card-value" style={{ fontSize: 18 }}><RoleBadge role={myRole} /></div>
          <div className="summary-card-sub">In this business</div>
        </div>
      </div>

      {/* Members list */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
          Team Members · {members.length}
        </div>
        <div className="item-list-card">
          {members.map(m => (
            <div key={m.id} style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                  {/* Avatar */}
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: 'var(--text-2)', flexShrink: 0 }}>
                    {(m.name?.[0] || '?').toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{m.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 1 }}>
                      Joined {fmtDate(m.joined_at)}
                      {m.telegram_id && <span> · @tg</span>}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <RoleBadge role={m.role} />
                  {canManage && m.role !== 'owner' && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={() => { setEditRole(m.id); setNewRole(m.role) }}
                        style={{ padding: '4px 8px', borderRadius: 7, fontSize: 11, background: 'var(--bg-2)', color: 'var(--text-3)', border: '0.5px solid var(--border)', cursor: 'pointer' }}
                      >✏</button>
                      <button
                        onClick={() => handleRemove(m.id, m.name)}
                        disabled={removing === m.id}
                        style={{ padding: '4px 8px', borderRadius: 7, fontSize: 11, background: 'var(--red-light)', color: 'var(--red-dark)', border: 'none', cursor: 'pointer' }}
                      >✕</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Inline role edit */}
              {editRole === m.id && (
                <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select value={newRole} onChange={e => setNewRole(e.target.value)}
                    style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13 }}>
                    {ROLE_OPTS.filter(r => r.value !== 'owner').map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                  <button onClick={() => handleRoleChange(m.id)}
                    style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--text)', color: 'var(--bg)', fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer' }}>
                    Save
                  </button>
                  <button onClick={() => setEditRole(null)}
                    style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg-2)', color: 'var(--text-3)', fontSize: 12, border: '0.5px solid var(--border)', cursor: 'pointer' }}>
                    ✕
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Active invites */}
      {canManage && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Active Invite Links · {invites.length}
            </div>
            <button onClick={() => setShowInvite(true)}
              style={{ fontSize: 12, padding: '4px 12px', borderRadius: 20, background: 'var(--bg-2)', color: 'var(--text-2)', border: '0.5px solid var(--border)', cursor: 'pointer', fontWeight: 600 }}>
              + New
            </button>
          </div>

          {invites.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-4)', fontSize: 13 }}>
              No active invite links
            </div>
          ) : (
            <div className="item-list-card">
              {invites.map(inv => (
                <div key={inv.id} style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 800, color: 'var(--text)', letterSpacing: '0.05em' }}>{inv.code}</span>
                      <RoleBadge role={inv.role} />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
                      {inv.label && <span>{inv.label} · </span>}
                      {inv.uses_count}/{inv.max_uses} used · expires {fmtDate(inv.expires_at)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                    <button onClick={() => copyInviteLink(inv.code)}
                      style={{ padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: 'var(--bg-2)', color: 'var(--text-2)', border: '0.5px solid var(--border)', cursor: 'pointer' }}>
                      📋 Copy
                    </button>
                    <button onClick={() => handleRevoke(inv.code)} disabled={revoking === inv.code}
                      style={{ padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: 'var(--red-light)', color: 'var(--red-dark)', border: 'none', cursor: 'pointer' }}>
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showInvite && (
        <InviteModal token={token} onClose={() => setShowInvite(false)} onCreated={load} />
      )}
    </div>
  )
}
