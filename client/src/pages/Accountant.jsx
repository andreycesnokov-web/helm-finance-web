import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from '../hooks/useTranslation'
import { apiFetch, fmt } from '../lib/api'
import { getLang } from '../i18n/index'

// Compact label map (page-local, ru/en/id).
const L = {
  en: { title: 'AI Accountant', subtitle: 'Tax & compliance — advisory, verify with a licensed professional',
    profile: 'Tax profile', calendar: 'Compliance calendar', rules: 'Tax rules', source: 'Official source',
    save: 'Save profile', edit: 'Edit', country: 'Country', jurisdiction: 'Jurisdiction', entity: 'Legal entity type',
    npwp: 'Tax ID (NPWP)', vat: 'VAT status', employees: 'Employees', fyStart: 'Financial year start (MM-DD)', fyEnd: 'Financial year end (MM-DD)',
    regime: 'Tax regime', noEvents: 'No upcoming obligations. Complete the tax profile to build the calendar.',
    due: 'Due', period: 'Period', verifyRule: 'Verification recommended', locked: 'AI Accountant is a premium add-on.',
    upcoming: 'Upcoming', due_soon: 'Due soon', overdue: 'Overdue', incomplete: 'Complete your tax profile to generate the calendar.',
    remind: 'Remind in Telegram', reminded: 'Reminder sent',
    ask: 'Ask the AI Accountant', askPh: 'e.g. Which obligations are upcoming? Why is this applicable?', askBtn: 'Ask',
    openProfile: 'Open tax profile', openCalendar: 'Open calendar', completeness: 'Profile', upcoming90: 'Upcoming (90d)', overdueN: 'Overdue', missingN: 'Missing fields', srcWarn: 'rules need source verification' },
  ru: { title: 'AI Бухгалтер', subtitle: 'Налоги и отчётность — рекомендательно, подтвердите у лицензированного специалиста',
    profile: 'Налоговый профиль', calendar: 'Календарь обязательств', rules: 'Налоговые правила', source: 'Официальный источник',
    save: 'Сохранить профиль', edit: 'Изменить', country: 'Страна', jurisdiction: 'Юрисдикция', entity: 'Форма компании',
    npwp: 'Налоговый номер (NPWP)', vat: 'Статус НДС', employees: 'Сотрудники', fyStart: 'Начало фин. года (ММ-ДД)', fyEnd: 'Конец фин. года (ММ-ДД)',
    regime: 'Налоговый режим', noEvents: 'Нет ближайших обязательств. Заполните профиль, чтобы построить календарь.',
    due: 'Срок', period: 'Период', verifyRule: 'Рекомендуется проверка', locked: 'AI Бухгалтер — премиальный модуль.',
    upcoming: 'Предстоит', due_soon: 'Скоро срок', overdue: 'Просрочено', incomplete: 'Заполните налоговый профиль, чтобы построить календарь.',
    remind: 'Напомнить в Telegram', reminded: 'Напоминание отправлено',
    ask: 'Спросить AI Бухгалтера', askPh: 'напр. Какие обязательства ближайшие? Почему применимо?', askBtn: 'Спросить',
    openProfile: 'Открыть профиль', openCalendar: 'Открыть календарь', completeness: 'Профиль', upcoming90: 'Ближайшие (90д)', overdueN: 'Просрочено', missingN: 'Нет полей', srcWarn: 'правил требуют проверки источника' },
  id: { title: 'AI Akuntan', subtitle: 'Pajak & kepatuhan — bersifat rekomendasi, konfirmasi dengan profesional berlisensi',
    profile: 'Profil pajak', calendar: 'Kalender kewajiban', rules: 'Aturan pajak', source: 'Sumber resmi',
    save: 'Simpan profil', edit: 'Ubah', country: 'Negara', jurisdiction: 'Yurisdiksi', entity: 'Jenis badan usaha',
    npwp: 'NPWP', vat: 'Status PPN', employees: 'Karyawan', fyStart: 'Awal tahun fiskal (MM-DD)', fyEnd: 'Akhir tahun fiskal (MM-DD)',
    regime: 'Rezim pajak', noEvents: 'Belum ada kewajiban. Lengkapi profil untuk membuat kalender.',
    due: 'Jatuh tempo', period: 'Periode', verifyRule: 'Disarankan verifikasi', locked: 'AI Akuntan adalah add-on premium.',
    upcoming: 'Akan datang', due_soon: 'Segera', overdue: 'Terlambat', incomplete: 'Lengkapi profil pajak untuk membuat kalender.',
    remind: 'Ingatkan di Telegram', reminded: 'Pengingat terkirim',
    ask: 'Tanya AI Akuntan', askPh: 'mis. Kewajiban apa yang akan datang? Mengapa berlaku?', askBtn: 'Tanya',
    openProfile: 'Buka profil pajak', openCalendar: 'Buka kalender', completeness: 'Profil', upcoming90: 'Akan datang (90h)', overdueN: 'Terlambat', missingN: 'Bidang kurang', srcWarn: 'aturan perlu verifikasi sumber' },
}
const STATUS_COLOR = { upcoming: 'var(--text-3)', due_soon: 'var(--amber-dark)', overdue: 'var(--red-dark)' }

export default function Accountant() {
  const { token } = useAuth()
  const { t } = useTranslation()
  const lang = ['ru', 'id'].includes(getLang()) ? getLang() : 'en'
  const l = L[lang]

  const [status, setStatus]   = useState(null)
  const [profile, setProfile] = useState(null)
  const [calendar, setCalendar] = useState(null)
  const [rules, setRules]     = useState([])
  const [editing, setEditing] = useState(false)
  const [form, setForm]       = useState({})
  const [saving, setSaving]   = useState(false)
  const [loading, setLoading] = useState(true)
  const [reminded, setReminded] = useState(false)
  const [summary, setSummary] = useState(null)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState(null)
  const [asking, setAsking] = useState(false)

  const ask = async () => {
    if (!question.trim()) return
    setAsking(true); setAnswer(null)
    try { const d = await apiFetch('/accountant/ask', token, { method: 'POST', body: { question } }); setAnswer(d) }
    catch (e) { setAnswer({ answer: e.message }) } finally { setAsking(false) }
  }

  const sendReminder = async () => {
    try { await apiFetch('/accountant/calendar/remind', token, { method: 'POST' }); setReminded(true); setTimeout(() => setReminded(false), 3000) }
    catch (e) { alert(e.message) }
  }

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      apiFetch(`/accountant/status?language=${getLang()}`, token),
      apiFetch('/accountant/profile', token).catch(() => ({ profile: null })),
      apiFetch('/accountant/calendar', token).catch(() => ({ events: [] })),
      apiFetch('/accountant/rules', token).catch(() => ({ rules: [] })),
      apiFetch('/accountant/summary', token).catch(() => null),
    ]).then(([s, p, c, r, sum]) => {
      setStatus(s); setProfile(p.profile); setForm(p.profile || { country: 'Indonesia', jurisdiction: 'ID', reporting_currency: 'IDR' })
      setCalendar(c); setRules(r.rules || []); setSummary(sum)
    }).catch(console.error).finally(() => setLoading(false))
  }, [token])
  useEffect(() => { load() }, [load])

  const saveProfile = async () => {
    setSaving(true)
    try { await apiFetch('/accountant/profile', token, { method: 'PUT', body: form }); setEditing(false); load() }
    catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
    <div style={{ width: 28, height: 28, border: '2.5px solid var(--border-2)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'tx-spin .7s linear infinite' }} /></div>

  const events = calendar?.events || []
  const field = (key, label, opts) => (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 3 }}>{label}</label>
      {opts ? (
        <select className="modal-input" value={form[key] || ''} onChange={e => setForm({ ...form, [key]: e.target.value })}>
          <option value="">—</option>
          {opts.map(o => <option key={o.v} value={o.v}>{o.t}</option>)}
        </select>
      ) : (
        <input className="modal-input" value={form[key] || ''} onChange={e => setForm({ ...form, [key]: e.target.value })} />
      )}
    </div>
  )

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ marginBottom: 8 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>🧮 {l.title}</h1>
        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{l.subtitle}</div>
      </div>

      {/* Disclaimer */}
      {status?.disclaimer && (
        <div style={{ background: '#FFF6E5', border: '1px solid var(--amber-dark)', borderRadius: 12, padding: '10px 14px', margin: '12px 0', fontSize: 12, color: 'var(--amber-dark)', lineHeight: 1.5 }}>
          ⚠ {status.disclaimer}
        </div>
      )}

      {status && !status.entitled && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, fontSize: 13, color: 'var(--text-2)' }}>🔒 {l.locked}</div>
      )}

      {status?.entitled && summary && (
        <>
          {/* Status tiles + quick links */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 12 }}>
            {[[l.completeness, `${summary.completeness?.percent ?? 0}%`], [l.upcoming90, (summary.upcoming || []).length], [l.overdueN, (summary.overdue || []).length], [l.missingN, (summary.missing_profile_fields || []).length]].map(([k, v], i) => (
              <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{k}</div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{v}</div>
              </div>
            ))}
          </div>
          {summary.active_unverified > 0 && (
            <div style={{ fontSize: 12, color: 'var(--amber-dark)', marginBottom: 10 }}>⚠ {summary.active_unverified} {l.srcWarn}</div>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <a href="/accountant/tax-profile" className="btn btn-ghost btn-sm">{l.openProfile}</a>
            <a href="/accountant/calendar" className="btn btn-ghost btn-sm">{l.openCalendar}</a>
          </div>

          {/* AI ask box */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>💬 {l.ask}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="modal-input" value={question} placeholder={l.askPh} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') ask() }} style={{ flex: 1 }} />
              <button className="btn btn-primary btn-md" disabled={asking || !question.trim()} onClick={ask}>{asking ? '…' : l.askBtn}</button>
            </div>
            {answer && (
              <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-2)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                {answer.answer}
                {answer.disclaimer && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-4)' }}>{answer.disclaimer}</div>}
              </div>
            )}
          </div>
        </>
      )}

      {status?.entitled && (
        <>
          {/* Tax profile */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontWeight: 700 }}>{l.profile}</div>
              {status.can_edit && !editing && <button onClick={() => setEditing(true)} style={{ fontSize: 12, fontWeight: 600, color: 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer' }}>{l.edit}</button>}
            </div>
            {editing ? (
              <>
                {field('country', l.country)}
                {field('jurisdiction', l.jurisdiction, [{ v: 'ID', t: 'Indonesia (ID)' }])}
                {field('legal_entity_type', l.entity, [{ v: 'PT', t: 'PT' }, { v: 'CV', t: 'CV' }, { v: 'Perorangan', t: 'Perorangan / Sole' }])}
                {field('tax_identifier', l.npwp)}
                {field('vat_status', l.vat, [{ v: 'pkp', t: 'PKP (registered)' }, { v: 'non_pkp', t: 'Non-PKP' }, { v: 'not_registered', t: 'Not registered' }])}
                {field('employee_status', l.employees, [{ v: 'has_employees', t: 'Has employees' }, { v: 'none', t: 'None' }])}
                {field('financial_year_start', l.fyStart)}
                {field('financial_year_end', l.fyEnd)}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={saveProfile} disabled={saving} className="btn btn-primary btn-sm">{l.save}</button>
                  <button onClick={() => { setEditing(false); setForm(profile || {}) }} className="btn btn-ghost btn-sm">✕</button>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.8 }}>
                <div>{l.country}: <b>{profile?.country || '—'}</b> · {l.jurisdiction}: <b>{profile?.jurisdiction || '—'}</b></div>
                <div>{l.entity}: <b>{profile?.legal_entity_type || '—'}</b> · {l.npwp}: <b>{profile?.tax_identifier || '—'}</b></div>
                <div>{l.vat}: <b>{profile?.vat_status || '—'}</b> · {l.employees}: <b>{profile?.employee_status || '—'}</b></div>
                {!status.profile_complete && <div style={{ color: 'var(--amber-dark)', marginTop: 4 }}>ℹ️ {l.incomplete}</div>}
              </div>
            )}
          </div>

          {/* Compliance calendar */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontWeight: 700 }}>{l.calendar}</div>
              {events.length > 0 && status.can_edit && (
                <button onClick={sendReminder} style={{ fontSize: 12, fontWeight: 600, color: reminded ? 'var(--green-dark)' : 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer' }}>
                  {reminded ? `✓ ${l.reminded}` : `✈ ${l.remind}`}
                </button>
              )}
            </div>
            {events.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{l.noEvents}</div>
            ) : events.map((e, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < events.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{e.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{l.period}: {e.period}
                    {e.official_source && <> · <a href={e.official_source.url} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}>{l.source} ↗</a></>}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: STATUS_COLOR[e.status] }}>{l[e.status] || e.status}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{l.due}: {e.due_date}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Active rules */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px' }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>{l.rules}</div>
            {rules.map((r, i) => (
              <div key={i} style={{ padding: '10px 0', borderBottom: i < rules.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{r.title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>{r.calculation_method}</div>
                <div style={{ fontSize: 11, marginTop: 3, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {r.official_sources && <a href={r.official_sources.url} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)', fontWeight: 600 }}>📄 {r.official_sources.title} ↗</a>}
                  {!r.last_verified_at && <span style={{ color: 'var(--amber-dark)' }}>⚠ {l.verifyRule}</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
