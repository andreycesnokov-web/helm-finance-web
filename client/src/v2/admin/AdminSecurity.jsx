// Platform admin — Security & Administrators (/admin/security, /admin/administrators).
// Manages platform_admins: listing, assignment and revocation (super_admin only).
import React, { useState } from 'react'
import { PageHead, Card, Pill, Btn, Skeleton } from '../ui'
import { useT, useLang } from '../i18n'
import { useAdminApi } from '../data'
import { useAuth } from '../../hooks/useAuth'
import { grantAdmin, revokeAdmin } from '../lib/actions'
import { shortDate } from '../lib/format'
import { AdminGate } from './AdminOverview'

export default function AdminSecurity() {
  const t = useT()
  const lang = useLang()
  const { token } = useAuth()

  const adminsApi = useAdminApi('/admin/administrators')
  const auditApi = useAdminApi('/admin/administrators/audit')

  const [emailInput, setEmailInput] = useState('')
  const [roleInput, setRoleInput] = useState('platform_admin')
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)
  const [successMsg, setSuccessMsg] = useState(null)

  const head = <PageHead title={t('admin.security')} sub={t('admin.adminsSub')} />

  if (adminsApi.loading) {
    return (
      <div className="v2-page">
        {head}
        <Card><Skeleton rows={6} /></Card>
      </div>
    )
  }

  if (adminsApi.error) {
    return (
      <div className="v2-page">
        {head}
        <AdminGate error={adminsApi.error} onRetry={adminsApi.reload} />
      </div>
    )
  }

  const admins = adminsApi.data?.administrators || []
  const currentRole = adminsApi.data?.current_role || 'platform_admin'
  const isSuperAdmin = currentRole === 'super_admin'
  const audits = auditApi.data?.audit || []

  const handleGrant = async (e) => {
    e.preventDefault()
    if (!emailInput.trim()) return
    setErrorMsg(null)
    setSuccessMsg(null)
    setBusy(true)
    try {
      await grantAdmin(token, emailInput.trim(), roleInput)
      setEmailInput('')
      setSuccessMsg(t('admin.grantDone') || 'Saved')
      adminsApi.reload()
      auditApi.reload()
    } catch (err) {
      if (err.message === 'user_not_found') {
        setErrorMsg(t('admin.errUserNotFound') || 'User with this email not found')
      } else if (err.message === 'email_not_verified') {
        setErrorMsg(t('admin.errEmailNotVerified') || 'Email is not verified')
      } else {
        setErrorMsg(err.message || 'Operation failed')
      }
    } finally {
      setBusy(false)
    }
  }

  const handleRevoke = async (admin) => {
    const confirmPrompt = t('admin.revokeConfirm', { email: admin.email || String(admin.userId) })
    if (!window.confirm(confirmPrompt)) return
    setErrorMsg(null)
    setSuccessMsg(null)
    setBusy(true)
    try {
      await revokeAdmin(token, admin.userId)
      setSuccessMsg(t('admin.revokeDone') || 'Revoked')
      adminsApi.reload()
      auditApi.reload()
    } catch (err) {
      if (err.code === 'cannot_revoke_last_super_admin' || err.message?.includes('cannot_revoke_last_super_admin')) {
        setErrorMsg(t('admin.selfRevokeBlocked'))
      } else {
        setErrorMsg(err.message || 'Revocation failed')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="v2-page">
      {head}

      {errorMsg && (
        <Card className="v2-card-crit">
          <p style={{ color: 'var(--text-crit,#990000)', fontWeight: 600 }}>{errorMsg}</p>
        </Card>
      )}

      {successMsg && (
        <Card className="v2-card-good">
          <p style={{ color: 'var(--text-good,#007733)', fontWeight: 600 }}>{successMsg}</p>
        </Card>
      )}

      <Card
        title={t('admin.admins')}
        aside={
          <Pill tone={isSuperAdmin ? 'good' : 'neutral'}>
            {isSuperAdmin ? t('admin.superAdmin') : t('admin.platformAdmin')}
          </Pill>
        }
      >
        {admins.length === 0 ? (
          <p className="v2-muted">{t('admin.noAdmins')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="v2-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-default,#ccc)' }}>
                  <th style={{ padding: '8px 12px' }}>{t('admin.email')}</th>
                  <th style={{ padding: '8px 12px' }}>{t('admin.role')}</th>
                  <th style={{ padding: '8px 12px' }}>{t('admin.status')}</th>
                  <th style={{ padding: '8px 12px' }}>{t('admin.assigned')}</th>
                  <th style={{ padding: '8px 12px' }}>{t('admin.assignedBy')}</th>
                  {isSuperAdmin && <th style={{ padding: '8px 12px', textAlign: 'right' }}>{t('admin.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.userId} style={{ borderBottom: '1px solid var(--border-subtle,#eee)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                      {a.email || <span className="v2-muted">ID: {a.userId}</span>}
                      {a.displayName ? <span className="v2-muted v2-small" style={{ display: 'block' }}>{a.displayName}</span> : null}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <Pill tone={a.role === 'super_admin' ? 'good' : 'info'}>
                        {a.role === 'super_admin' ? t('admin.superAdmin') : t('admin.platformAdmin')}
                      </Pill>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <Pill tone={a.isActive ? 'good' : 'neutral'}>
                        {a.isActive ? t('admin.active') : t('admin.revoked')}
                      </Pill>
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 13 }} className="v2-muted">
                      {shortDate(a.createdAt, lang)}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 13 }} className="v2-muted">
                      {a.creatorEmail || (a.createdBy ? `ID: ${a.createdBy}` : '—')}
                    </td>
                    {isSuperAdmin && (
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        {a.isActive ? (
                          <button
                            type="button"
                            className="v2-btn v2-btn-secondary v2-btn-small"
                            onClick={() => handleRevoke(a)}
                            disabled={busy}
                            style={{ fontSize: 12, padding: '4px 8px' }}
                          >
                            {t('admin.revoke')}
                          </button>
                        ) : (
                          <span className="v2-muted v2-small">{shortDate(a.revokedAt, lang)}</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {isSuperAdmin ? (
        <Card title={t('admin.addAdmin')} aside={<span className="v2-muted v2-small">{t('admin.addAdminSub')}</span>}>
          <form onSubmit={handleGrant} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 240px' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                {t('admin.email')}
              </label>
              <input
                type="email"
                required
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="admin@example.com"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border-default,#ccc)',
                  background: 'var(--surface-input,#fff)',
                }}
              />
            </div>
            <div style={{ flex: '0 1 200px' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                {t('admin.role')}
              </label>
              <select
                value={roleInput}
                onChange={(e) => setRoleInput(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border-default,#ccc)',
                  background: 'var(--surface-input,#fff)',
                }}
              >
                <option value="platform_admin">{t('admin.platformAdmin')}</option>
                <option value="super_admin">{t('admin.superAdmin')}</option>
              </select>
            </div>
            <div>
              <button
                type="submit"
                className="v2-btn v2-btn-primary"
                disabled={busy || !emailInput.trim()}
                style={{ padding: '8px 16px' }}
              >
                {busy ? t('admin.granting') : t('admin.grantBtn')}
              </button>
            </div>
          </form>
        </Card>
      ) : (
        <Card>
          <p className="v2-muted v2-small">{t('admin.superAdminOnly')}</p>
        </Card>
      )}

      <Card title={t('admin.securityLog')} aside={<span className="v2-muted v2-small">{t('admin.securityLogSub')}</span>}>
        {auditApi.error ? (
          <p className="v2-muted">{t('admin.logNa')}</p>
        ) : audits.length === 0 ? (
          <p className="v2-muted">{t('admin.noRecent')}</p>
        ) : (
          <ul className="v2-moves">
            {audits.map((e) => (
              <li key={e.id}>
                <span>
                  {shortDate(e.created_at, lang)} · <strong>{e.action}</strong> · ID: {e.entity_id}
                </span>
                <span className="v2-muted v2-small">
                  {e.actor_role} · {e.after_json?.role || ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
