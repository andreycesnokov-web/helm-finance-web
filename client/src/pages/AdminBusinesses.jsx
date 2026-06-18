import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch } from '../lib/api'
import { getLang } from '../i18n/index'

const L = {
  en: { title: 'Platform Admin', sub: 'Business registry & access', users: 'Users', businesses: 'Businesses', audit: 'Audit Log',
    search: 'Search name or code…', allPlans: 'All plans', allTypes: 'All types', allTrials: 'All trials',
    name: 'Business', code: 'Code', owner: 'Owner', members: 'Members', stored: 'Stored', effective: 'Effective', source: 'Source',
    trial: 'Trial', tx: 'Tx (mo)', wallets: 'Wallets', manage: 'Manage', copyId: 'Copy ID', copyCode: 'Copy code', copied: 'Copied', none: 'No businesses' },
  ru: { title: 'Платформенный админ', sub: 'Реестр бизнесов и доступ', users: 'Пользователи', businesses: 'Бизнесы', audit: 'Аудит',
    search: 'Поиск по имени или коду…', allPlans: 'Все тарифы', allTypes: 'Все типы', allTrials: 'Все trial',
    name: 'Бизнес', code: 'Код', owner: 'Владелец', members: 'Участники', stored: 'Stored', effective: 'Effective', source: 'Источник',
    trial: 'Trial', tx: 'Tx (мес)', wallets: 'Кошельки', manage: 'Управлять', copyId: 'Копировать ID', copyCode: 'Копировать код', copied: 'Скопировано', none: 'Нет бизнесов' },
  id: { title: 'Admin Platform', sub: 'Registri bisnis & akses', users: 'Pengguna', businesses: 'Bisnis', audit: 'Log Audit',
    search: 'Cari nama atau kode…', allPlans: 'Semua paket', allTypes: 'Semua tipe', allTrials: 'Semua trial',
    name: 'Bisnis', code: 'Kode', owner: 'Pemilik', members: 'Anggota', stored: 'Stored', effective: 'Effective', source: 'Sumber',
    trial: 'Trial', tx: 'Tx (bln)', wallets: 'Dompet', manage: 'Kelola', copyId: 'Salin ID', copyCode: 'Salin kode', copied: 'Tersalin', none: 'Tidak ada bisnis' },
}
export const PLAN_COLOR = {
  free: ['#6B7280', '#F3F4F6'], starter: ['#1e40af', '#EFF6FF'], business: ['#085041', '#E1F5EE'],
  founder: ['#6D28D9', '#F5F3FF'], enterprise: ['#E5E7EB', '#1F2937'], trial: ['#92400E', '#FEF3C7'],
  override: ['#9A3412', '#FFEDD5'], expired: ['#991B1B', '#FEE2E2'], active: ['#92400E', '#FEF3C7'],
}
export const Badge = ({ s }) => { const [fg, bg] = PLAN_COLOR[s] || ['#374151', '#F3F4F6']; return <span style={{ background: bg, color: fg, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{s}</span> }

export function AdminTabs({ active }) {
  const l = L[['ru', 'id'].includes(getLang()) ? getLang() : 'en']
  const tab = (to, key) => (
    <Link to={to} style={{ padding: '6px 14px', borderRadius: 20, textDecoration: 'none', fontWeight: 600, fontSize: 13,
      background: active === key ? 'var(--accent,#4F46E5)' : 'var(--bg-3)', color: active === key ? '#fff' : 'var(--text-2)' }}>{l[key]}</Link>
  )
  return <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>{tab('/admin', 'users')}{tab('/admin/businesses', 'businesses')}{tab('/admin/access-audit', 'audit')}</div>
}

export default function AdminBusinesses() {
  const { token } = useAuth()
  const lang = ['ru', 'id'].includes(getLang()) ? getLang() : 'en'; const l = L[lang]
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [f, setF] = useState({ search: '', plan: '', type: '', trial: '' })
  const [copied, setCopied] = useState('')

  const load = useCallback(() => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString()
    apiFetch(`/admin/businesses${qs ? '?' + qs : ''}`, token).then(setData).catch(setError)
  }, [token, f])
  useEffect(() => { if (token) load() }, [token, load])

  const copy = (text, key) => { navigator.clipboard?.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1500) }

  if (error) {
    const is403 = /access required|Forbidden/i.test(error.message || '')
    return <div style={{ padding: 40, textAlign: 'center' }}><div style={{ fontSize: 48 }}>{is403 ? '🔒' : '⚠️'}</div><div style={{ fontWeight: 700, marginTop: 8 }}>{is403 ? 'Platform admin only' : error.message}</div></div>
  }
  const rows = data?.businesses || []

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>🛠 {l.title}</h1>
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>{l.sub}</div>
      <AdminTabs active="businesses" />

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input value={f.search} onChange={e => setF({ ...f, search: e.target.value })} placeholder={l.search} style={{ flex: 1, minWidth: 180, padding: '7px 10px', border: '1px solid var(--border-2)', borderRadius: 8, fontSize: 13 }} />
        <select value={f.plan} onChange={e => setF({ ...f, plan: e.target.value })} style={sel}><option value="">{l.allPlans}</option>{['free', 'starter', 'business', 'founder', 'enterprise'].map(p => <option key={p} value={p}>{p}</option>)}</select>
        <select value={f.type} onChange={e => setF({ ...f, type: e.target.value })} style={sel}><option value="">{l.allTypes}</option><option value="business">business</option><option value="personal">personal</option></select>
        <select value={f.trial} onChange={e => setF({ ...f, trial: e.target.value })} style={sel}><option value="">{l.allTrials}</option>{['active', 'expired', 'none'].map(t => <option key={t} value={t}>{t}</option>)}</select>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: 'var(--bg-3)', textAlign: 'left' }}>
            {[l.name, l.code, l.owner, l.members, l.stored, l.effective, l.source, l.trial, l.tx, ''].map((h, i) => <th key={i} style={{ padding: 8, whiteSpace: 'nowrap' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>{l.none}</td></tr>}
            {rows.map(b => (
              <tr key={b.business_id} style={{ borderTop: '0.5px solid var(--border)' }}>
                <td style={{ padding: 8 }}><b>{b.name}</b>{b.type === 'personal' && <span style={{ marginLeft: 6, color: 'var(--text-4)' }}>· personal</span>}</td>
                <td style={{ padding: 8 }}><button onClick={() => copy(b.business_code, 'c' + b.business_id)} title={l.copyCode} style={mini}>{copied === 'c' + b.business_id ? l.copied : b.business_code}</button></td>
                <td style={{ padding: 8 }}>{b.owner?.name || b.owner?.user_id || '—'}</td>
                <td style={{ padding: 8 }}>{b.active_member_count}/{b.member_count}</td>
                <td style={{ padding: 8 }}><Badge s={b.stored_plan} /></td>
                <td style={{ padding: 8 }}><Badge s={b.effective_plan} /></td>
                <td style={{ padding: 8 }}>{b.effective_access_source === 'admin_override' ? <Badge s="override" /> : b.effective_access_source}</td>
                <td style={{ padding: 8 }}><Badge s={b.trial_status_effective} /></td>
                <td style={{ padding: 8 }}>{b.transactions_this_month}</td>
                <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                  <button onClick={() => copy(b.business_id, 'i' + b.business_id)} title={l.copyId} style={mini}>{copied === 'i' + b.business_id ? l.copied : 'ID'}</button>
                  <Link to={`/admin/businesses/${b.business_id}`} style={{ ...mini, textDecoration: 'none', display: 'inline-block' }}>{l.manage} →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
const sel = { padding: '7px 9px', border: '1px solid var(--border-2)', borderRadius: 8, fontSize: 13, background: 'var(--bg)' }
const mini = { fontSize: 11, padding: '3px 8px', marginRight: 4, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-2)', cursor: 'pointer', color: 'var(--text-2)' }
