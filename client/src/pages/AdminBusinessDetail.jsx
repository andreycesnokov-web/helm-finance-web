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
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null)

  const load = useCallback(() => {
    apiFetch(`/admin/businesses/${businessId}`, token).then(setD).catch(setError)
    apiFetch(`/admin/businesses/${businessId}/members`, token).then(r => setMembers(r.members || [])).catch(() => {})
    apiFetch(`/admin/businesses/${businessId}/usage`, token).then(r => setUsage(r.usage)).catch(() => {})
    apiFetch(`/admin/access-audit?business_id=${businessId}`, token).then(r => setAudit(r.events || [])).catch(() => {})
  }, [token, businessId])
  useEffect(() => { if (token) load() }, [token, load])

  const act = async (fn) => { setBusy(true); try { await fn(); load() } catch (e) { alert(e.message) } finally { setBusy(false) } }
  const grant = (plan) => { const reason = prompt(l.reason + ':', 'internal owner testing'); if (!reason) return; act(() => apiFetch(`/admin/businesses/${businessId}/access`, token, { method: 'PATCH', body: { plan, reason } })) }
  const activateTrial = () => act(() => apiFetch(`/admin/businesses/${businessId}/trial`, token, { method: 'POST', body: { action: 'activate' } }))
  const extendTrial = (days) => act(() => apiFetch(`/admin/businesses/${businessId}/trial`, token, { method: 'POST', body: { action: 'extend', days } }))
  const removeOverride = () => { if (confirm(l.remove + '?')) act(() => apiFetch(`/admin/businesses/${businessId}/override`, token, { method: 'DELETE' })) }

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
    </div>
  )
}
function Card({ title, children }) {
  return <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
    <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 4 }}>{title}</div>{children}</div>
}
const btn = { fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', cursor: 'pointer', color: 'var(--text-2)' }
