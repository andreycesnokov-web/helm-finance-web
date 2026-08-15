import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch } from '../lib/api'
import { getLang } from '../i18n/index'
import { Badge } from './AdminBusinesses'

const L = {
  en: { back: 'Businesses', overview: 'Overview', access: 'Plans & Access', members: 'Members', usage: 'Usage', auditL: 'Audit Log', manage: 'Manage access',
    owner: 'Owner', type: 'Type', created: 'Created', stored: 'Stored plan', effective: 'Effective plan', source: 'Source', trial: 'Trial', override: 'Admin override', endsAt: 'Ends',
    grant: 'Grant', activateTrial: 'Activate 7-day trial', extend: 'Extend', remove: 'Remove override', returnFree: 'Return to Free', reason: 'Reason', reasonPh: 'e.g. internal owner testing', none: 'none', done: 'Done' },
  ru: { back: 'Бизнесы', overview: 'Обзор', access: 'Тариф и доступ', members: 'Участники', usage: 'Использование', auditL: 'Аудит', manage: 'Управление доступом',
    owner: 'Владелец', type: 'Тип', created: 'Создан', stored: 'Stored план', effective: 'Effective план', source: 'Источник', trial: 'Trial', override: 'Admin override', endsAt: 'До',
    grant: 'Выдать', activateTrial: 'Включить 7-дн trial', extend: 'Продлить', remove: 'Снять override', returnFree: 'Вернуть Free', reason: 'Причина', reasonPh: 'напр. internal owner testing', none: 'нет', done: 'Готово' },
  id: { back: 'Bisnis', overview: 'Ringkasan', access: 'Paket & Akses', members: 'Anggota', usage: 'Penggunaan', auditL: 'Log Audit', manage: 'Kelola akses',
    owner: 'Pemilik', type: 'Tipe', created: 'Dibuat', stored: 'Paket stored', effective: 'Paket effective', source: 'Sumber', trial: 'Trial', override: 'Admin override', endsAt: 'Berakhir',
    grant: 'Beri', activateTrial: 'Aktifkan trial 7 hari', extend: 'Perpanjang', remove: 'Hapus override', returnFree: 'Kembali ke Free', reason: 'Alasan', reasonPh: 'mis. internal owner testing', none: 'tidak ada', done: 'Selesai' },
}
const fmt = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const Row = ({ k, children }) => <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderTop: '0.5px solid var(--border)', fontSize: 13 }}><span style={{ color: 'var(--text-3)' }}>{k}</span><span>{children}</span></div>

export default function AdminBusinessDetail() {
  const { businessId } = useParams()
  const { token } = useAuth()
  const lang = ['ru', 'id'].includes(getLang()) ? getLang() : 'en'; const l = L[lang]
  const [d, setD] = useState(null); const [members, setMembers] = useState([]); const [usage, setUsage] = useState(null); const [audit, setAudit] = useState([])
  // Cleanup preflight is a SAFETY GATE: archive stays disabled unless it loaded OK, so a
  // failed/pending preflight can never leave a live Archive button behind.
  const [pf, setPf] = useState(null); const [pfState, setPfState] = useState('loading'); const [pfError, setPfError] = useState('')
  // Cleanup & Reset panel inputs
  const [reason, setReason] = useState(''); const [typedName, setTypedName] = useState(''); const [cleanupMsg, setCleanupMsg] = useState(null)
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null)

  const load = useCallback(() => {
    apiFetch(`/admin/businesses/${businessId}`, token).then(setD).catch(setError)
    apiFetch(`/admin/businesses/${businessId}/members`, token).then(r => setMembers(r.members || [])).catch(() => {})
    apiFetch(`/admin/businesses/${businessId}/usage`, token).then(r => setUsage(r.usage)).catch(() => {})
    setPfState('loading'); setPfError('')
    apiFetch(`/admin/businesses/${businessId}/cleanup-preflight`, token)
      .then(r => {
        // Treat a malformed/incomplete payload as NOT loaded — never guess.
        if (!r || !r.business || !r.counts) { setPf(null); setPfState('error'); setPfError('Preflight returned incomplete data.'); return }
        setPf(r); setPfState('ok')
      })
      .catch(e => { setPf(null); setPfState('error'); setPfError(e?.message || 'Preflight request failed.') })
    apiFetch(`/admin/access-audit?business_id=${businessId}`, token).then(r => setAudit(r.events || [])).catch(() => {})
  }, [token, businessId])
  useEffect(() => { if (token) load() }, [token, load])

  const act = async (fn) => { setBusy(true); try { await fn(); load() } catch (e) { alert(e.message) } finally { setBusy(false) } }
  const grant = (plan) => { const reason = prompt(l.reason + ':', 'internal owner testing'); if (!reason) return; act(() => apiFetch(`/admin/businesses/${businessId}/access`, token, { method: 'PATCH', body: { plan, reason } })) }
  const activateTrial = () => act(() => apiFetch(`/admin/businesses/${businessId}/trial`, token, { method: 'POST', body: { action: 'activate' } }))
  const extendTrial = (days) => act(() => apiFetch(`/admin/businesses/${businessId}/trial`, token, { method: 'POST', body: { action: 'extend', days } }))
  const removeOverride = () => { if (confirm(l.remove + '?')) act(() => apiFetch(`/admin/businesses/${businessId}/override`, token, { method: 'DELETE' })) }
  // Archive = soft hide (status='archived'); reversible, deletes NO data. Both actions need a
  // reason (stored in the audit trail); archive additionally needs the exact workspace name
  // typed, so a real workspace (e.g. Helm Care) can never be archived by accident.
  const runCleanup = async (path, body) => {
    setCleanupMsg(null); setBusy(true)
    try {
      await apiFetch(`/admin/businesses/${businessId}/${path}`, token, { method: 'POST', body })
      setCleanupMsg({ ok: true, text: path === 'archive' ? 'Workspace archived. It is hidden from the workspace switcher; no data was deleted.' : 'Workspace restored to active.' })
      setReason(''); setTypedName(''); load()
    } catch (e) {
      setCleanupMsg({ ok: false, text: e.message || 'Action failed.' })
    } finally { setBusy(false) }
  }
  const archive = () => {
    // Hard gate: never archive from unverified state (defense in depth behind the disabled button).
    if (pfState !== 'ok' || !pf?.business) return
    runCleanup('archive', { confirm: true, confirm_name: typedName.trim(), reason: reason.trim() })
  }
  const unarchive = () => runCleanup('unarchive', { reason: reason.trim() })

  if (error) return <div style={{ padding: 40, textAlign: 'center' }}><div style={{ fontSize: 48 }}>{/Forbidden|access/.test(error.message) ? '🔒' : '⚠️'}</div><div>{error.message}</div></div>
  if (!d) return <div style={{ padding: 40, color: 'var(--text-3)' }}>Loading…</div>
  const a = d.access, id = d.identity

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <Link to="/admin/businesses" style={{ fontSize: 13, color: 'var(--accent,#4F46E5)', textDecoration: 'none' }}>← {l.back}</Link>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '6px 0 0' }}>{id.name} <span style={{ fontSize: 13, color: 'var(--text-3)', fontWeight: 600 }}>{id.business_code}</span></h1>
      <div style={{ fontSize: 11, color: 'var(--text-4)', fontFamily: 'monospace', marginBottom: 14 }}>{id.business_id}</div>

      {/* Overview */}
      <Card title={l.overview}>
        <Row k={l.owner}>{d.owner?.name || d.owner?.user_id || '—'}</Row>
        <Row k={l.type}>{id.type}</Row>
        <Row k="Currency">{id.currency || '—'}</Row>
        <Row k={l.created}>{fmt(id.created_at)}</Row>
        <Row k={l.members}>{d.members_summary?.total ?? members.length}</Row>
      </Card>

      {/* Plans & Access */}
      <Card title={l.access}>
        <Row k={l.effective}><Badge s={a.effective_plan} /> · {a.effective_access_source === 'admin_override' ? <Badge s="override" /> : a.effective_access_source}</Row>
        <Row k={l.stored}><Badge s={a.stored_plan} /></Row>
        <Row k={l.trial}><Badge s={a.trial_status_effective} /> {a.trial_ends_at && `· ${l.endsAt} ${fmt(a.trial_ends_at)}`}</Row>
        <Row k={l.override}>{a.admin_override_plan ? <><Badge s={a.admin_override_plan} /> {a.override_ends_at ? `· ${l.endsAt} ${fmt(a.override_ends_at)}` : '· ∞'}</> : l.none}</Row>
      </Card>

      {/* Manage access */}
      <Card title={l.manage}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['starter', 'business', 'founder', 'enterprise'].map(p => <button key={p} disabled={busy} onClick={() => grant(p)} style={btn}>{l.grant} {p}</button>)}
          {a.admin_override_plan && <button disabled={busy} onClick={removeOverride} style={{ ...btn, color: 'var(--red-dark)' }}>{l.remove}</button>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <button disabled={busy} onClick={activateTrial} style={btn}>{l.activateTrial}</button>
          {[7, 14, 30].map(dd => <button key={dd} disabled={busy} onClick={() => extendTrial(dd)} style={btn}>{l.extend} +{dd}d</button>)}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 8 }}>Override is an admin grant (not a payment). Recorded in the audit log; remove any time.</div>
      </Card>

      {/* Usage */}
      {usage && <Card title={l.usage}>
        {Object.entries(usage).map(([k, v]) => <Row key={k} k={k}>{v == null ? <span style={{ color: 'var(--text-4)' }}>—</span> : v}</Row>)}
      </Card>}

      {/* Members */}
      <Card title={`${l.members} · ${members.length}`}>
        {members.map(m => <Row key={m.user_id} k={`${m.name || m.user_id}${m.username ? ' @' + m.username : ''}`}>{m.role} · {m.status}{m.telegram_connected ? ' · TG✓' : ''}</Row>)}
      </Card>

      {/* Audit */}
      <Card title={l.auditL}>
        {audit.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>—</div>}
        {audit.map(e => <Row key={e.id} k={`${fmt(e.changed_at)} · ${e.action}`}>{e.previous_effective_plan} → <b>{e.new_effective_plan}</b>{e.reason ? ` · ${e.reason}` : ''}</Row>)}
      </Card>

      {/* Cleanup — archive (soft, reversible). Never a hard delete.
          Archive is GATED on a successful cleanup preflight: while it is loading, failed,
          or returned incomplete data, the action stays disabled and the reason is visible. */}
      <Card title="Cleanup">
        {pfState === 'loading' && <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '4px 0' }}>Loading cleanup preflight…</div>}

        {pfState === 'error' && (
          <div style={{ fontSize: 12.5, color: 'var(--red-dark,#b3261e)', background: 'var(--red-soft,#FDECEA)', border: '1px solid var(--red-dark,#b3261e)', borderRadius: 8, padding: '10px 12px', lineHeight: 1.5 }}>
            <strong>Cleanup preflight failed.</strong> {pfError}
            <div style={{ marginTop: 6 }}>Archive is disabled until the preflight loads successfully.</div>
            <button disabled={busy} onClick={load} style={{ ...btn, marginTop: 8 }}>Retry preflight</button>
          </div>
        )}

        {pfState === 'ok' && <>
          <Row k="Status">
            {pf.business.status === 'archived'
              ? <span style={{ color: 'var(--red-dark,#b3261e)', fontWeight: 700 }}>Archived (hidden from switcher)</span>
              : <span style={{ color: 'var(--green-dark,#1a7f37)', fontWeight: 700 }}>Active</span>}
          </Row>
          {Object.entries(pf.counts).map(([k, v]) => <Row key={k} k={k}>{v == null ? '—' : v}</Row>)}
          <Row k="Empty (no financial/doc data)">{pf.is_empty ? 'yes' : 'no'}</Row>
        </>}

        {/* Reason is mandatory for BOTH archive and restore — it is stored in the audit trail. */}
        {pfState === 'ok' && <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-3)' }}>
            Reason (required, stored in audit)
            <input value={reason} onChange={e => { setReason(e.target.value); setCleanupMsg(null) }}
              placeholder="e.g. duplicate test workspace from onboarding QA" style={inp} />
          </label>
          {pf.business.status !== 'archived' && (
            <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-3)' }}>
              Type the exact workspace name to confirm: <code style={{ color: 'var(--text)' }}>{pf.business.name}</code>
              <input value={typedName} onChange={e => { setTypedName(e.target.value); setCleanupMsg(null) }}
                placeholder={pf.business.name} style={inp} />
            </label>
          )}
        </div>}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {pfState === 'ok' && pf.business.status === 'archived'
            ? <button disabled={busy || reason.trim().length < 3} onClick={unarchive}
                title={reason.trim().length < 3 ? 'A reason is required.' : undefined}
                style={{ ...btn, opacity: reason.trim().length < 3 ? 0.5 : 1 }}>Restore workspace</button>
            : <button disabled={busy || pfState !== 'ok' || reason.trim().length < 3 || !typedName.trim()} onClick={archive}
                title={pfState !== 'ok' ? 'Cleanup preflight must load successfully before archive is allowed.' : 'Reason and exact name are required.'}
                style={{ ...btn, color: 'var(--red-dark,#b3261e)', borderColor: 'var(--red-dark,#b3261e)',
                  opacity: (pfState === 'ok' && reason.trim().length >= 3 && typedName.trim()) ? 1 : 0.5 }}>
                Archive workspace
              </button>}
          {/* Blocked actions — visible so the operator knows WHY, but they call nothing. */}
          <button disabled title="Reset is not enabled yet. Use archive/restore for now." style={{ ...btn, opacity: 0.45, cursor: 'not-allowed' }}>Reset test data (disabled)</button>
          <button disabled title="Hard delete is not available in production." style={{ ...btn, opacity: 0.45, cursor: 'not-allowed' }}>Hard delete (unavailable)</button>
        </div>

        {cleanupMsg && (
          <div style={{ marginTop: 10, fontSize: 12.5, borderRadius: 8, padding: '9px 12px',
            color: cleanupMsg.ok ? '#085041' : 'var(--red-dark,#b3261e)', background: cleanupMsg.ok ? '#E1F5EE' : 'var(--red-soft,#FDECEA)' }}>
            {cleanupMsg.text}
          </div>
        )}

        {pfState !== 'ok' && (
          <div style={{ fontSize: 11.5, color: 'var(--red-dark,#b3261e)', marginTop: 8, fontWeight: 600 }}>
            Cleanup preflight must load successfully before archive is allowed.
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 8, lineHeight: 1.5 }}>
          Archive is a reversible soft-hide — no wallets, transactions, documents, or audit history are deleted.
          Archived workspaces disappear from the user's workspace switcher but stay visible here.
          Every archive/restore writes an audit event with your reason; if the audit cannot be written the action is rolled back.
          <br />Reset is not enabled yet. Use archive/restore for now.
          <br />Hard delete is not available in production. Use archive/restore or reset-test-data workflows.
        </div>
      </Card>
    </div>
  )
}
function Card({ title, children }) {
  return <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
    <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 4 }}>{title}</div>{children}</div>
}
const btn = { fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', cursor: 'pointer', color: 'var(--text-2)' }
const inp = { display: 'block', width: '100%', marginTop: 4, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', fontWeight: 400, boxSizing: 'border-box' }
