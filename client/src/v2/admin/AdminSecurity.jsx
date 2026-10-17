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
  // The caller's own role comes from /admin/status (the list response carries no current role). Until it loads the
  // screen shows the read-only view; grant/revoke are enforced server-side (super_admin only) either way.
  const statusApi = useAdminApi('/admin/status')

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
  const currentRole = statusApi.data?.role || 'platform_admin'
  const isSuperAdmin = currentRole === 'super_admin'
  const audits = auditApi.data?.events || []
  // Internal user ids are never shown: people are named by email (or a dash when none is known).
  const emailOf = (id) => admins.find((x) => String(x.userId) === String(id))?.email || '—'
  const actLabel = (code) => { const k = 'admin.actRole.' + code, v = t(k); return v === k ? code : v }

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
        <div className="v2-error" role="alert">{errorMsg}</div>
      )}

      {successMsg && (
        <Card>
          <p className="v2-pos" role="status" style={{ fontWeight: 600 }}>{successMsg}</p>
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
            <table className="v2-table">
              <thead>
                <tr>
                  <th>{t('admin.email')}</th>
                  <th>{t('admin.role')}</th>
                  <th>{t('admin.status')}</th>
                  <th>{t('admin.assigned')}</th>
                  <th>{t('admin.assignedBy')}</th>
                  {isSuperAdmin && <th className="v2-r">{t('admin.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.userId}>
                    <td style={{ fontWeight: 600 }}>
                      {a.email || <span className="v2-muted">—</span>}
                      {a.displayName ? <span className="v2-muted v2-small" style={{ display: 'block' }}>{a.displayName}</span> : null}
                    </td>
                    <td>
                      <Pill tone={a.role === 'super_admin' ? 'good' : 'info'}>
                        {a.role === 'super_admin' ? t('admin.superAdmin') : t('admin.platformAdmin')}
                      </Pill>
                    </td>
                    <td>
                      <Pill tone={a.isActive ? 'good' : 'neutral'}>
                        {a.isActive ? t('admin.active') : t('admin.revoked')}
                      </Pill>
                    </td>
                    <td className="v2-muted">
                      {shortDate(a.createdAt, lang)}
                    </td>
                    <td className="v2-muted">
                      {a.creatorEmail || '—'}
                    </td>
                    {isSuperAdmin && (
                      <td className="v2-r">
                        {a.isActive ? (
                          <button
                            type="button"
                            className="v2-btn v2-btn-secondary v2-btn-small"
                            onClick={() => handleRevoke(a)}
                            disabled={busy}
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
          <form onSubmit={handleGrant} className="v2-field-row" style={{ alignItems: 'end' }}>
            <div className="v2-field">
              <label htmlFor="admin-grant-email" className="v2-field-label">{t('admin.email')}</label>
              <input
                id="admin-grant-email"
                className="v2-input"
                type="email"
                required
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="admin@example.com"
                autoComplete="off"
              />
            </div>
            <div className="v2-field">
              <label htmlFor="admin-grant-role" className="v2-field-label">{t('admin.role')}</label>
              <select
                id="admin-grant-role"
                className="v2-select"
                value={roleInput}
                onChange={(e) => setRoleInput(e.target.value)}
              >
                <option value="platform_admin">{t('admin.platformAdmin')}</option>
                <option value="super_admin">{t('admin.superAdmin')}</option>
              </select>
            </div>
            <div className="v2-field">
              <button
                type="submit"
                className="v2-btn v2-btn-primary"
                disabled={busy || !emailInput.trim()}
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
                  {shortDate(e.created_at, lang)} · <strong>{actLabel(e.action)}</strong> · {emailOf(e.entity_id)}
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
