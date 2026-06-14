import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { apiFetch } from '../lib/api'
import { getLang } from '../i18n/index'

const L = {
  en: { title: 'Tax profile', subtitle: 'Company tax & compliance configuration · Indonesia',
    completeness: 'Tax profile completeness', incomplete: 'Your tax profile is incomplete. Complete the required fields before generating compliance obligations.',
    save: 'Save', verify: 'Mark verified', verified: 'Verified', save_first: 'Save changes first',
    sec_identity: 'Company identity', sec_reg: 'Tax registration', sec_form: 'Legal form & regime',
    sec_vat: 'VAT / PKP', sec_year: 'Financial year', sec_emp: 'Employees / payroll', sec_act: 'Business activities',
    applicable: 'Applicable obligations', excluded: 'Not applicable', missing: 'Missing data', needsReview: 'Needs review',
    sourceReq: 'Source verification required', noActive: 'No active verified rules for this jurisdiction yet.',
    disclaimer: 'This information is for guidance only and does not constitute legal, tax or accounting advice. Confirm calculations with a licensed professional before making a tax payment or filing a return.' },
  ru: { title: 'Налоговый профиль', subtitle: 'Налоговая и compliance-конфигурация компании · Индонезия',
    completeness: 'Заполненность профиля', incomplete: 'Профиль не заполнен. Заполните обязательные поля перед генерацией обязательств.',
    save: 'Сохранить', verify: 'Подтвердить', verified: 'Подтверждён', save_first: 'Сначала сохраните',
    sec_identity: 'Идентификация компании', sec_reg: 'Налоговая регистрация', sec_form: 'Юр. форма и режим',
    sec_vat: 'НДС / PKP', sec_year: 'Финансовый год', sec_emp: 'Сотрудники / зарплата', sec_act: 'Виды деятельности',
    applicable: 'Применимые обязательства', excluded: 'Неприменимо', missing: 'Недостающие данные', needsReview: 'Нужна проверка',
    sourceReq: 'Требуется проверка источника', noActive: 'Пока нет активных проверенных правил для юрисдикции.',
    disclaimer: 'Информация носит рекомендательный характер и не является юридической, налоговой или бухгалтерской консультацией. Перед платежом или подачей отчётности подтвердите расчёты у лицензированного специалиста.' },
  id: { title: 'Profil pajak', subtitle: 'Konfigurasi pajak & kepatuhan perusahaan · Indonesia',
    completeness: 'Kelengkapan profil pajak', incomplete: 'Profil pajak belum lengkap. Lengkapi bidang wajib sebelum membuat kewajiban.',
    save: 'Simpan', verify: 'Tandai terverifikasi', verified: 'Terverifikasi', save_first: 'Simpan dulu',
    sec_identity: 'Identitas perusahaan', sec_reg: 'Registrasi pajak', sec_form: 'Bentuk hukum & rezim',
    sec_vat: 'PPN / PKP', sec_year: 'Tahun buku', sec_emp: 'Karyawan / penggajian', sec_act: 'Aktivitas usaha',
    applicable: 'Kewajiban yang berlaku', excluded: 'Tidak berlaku', missing: 'Data kurang', needsReview: 'Perlu ditinjau',
    sourceReq: 'Perlu verifikasi sumber', noActive: 'Belum ada aturan aktif terverifikasi untuk yurisdiksi ini.',
    disclaimer: 'Informasi ini hanya bersifat panduan dan bukan merupakan nasihat hukum, pajak, atau akuntansi. Konfirmasikan perhitungan dengan profesional berlisensi sebelum melakukan pembayaran atau pelaporan pajak.' },
}

const OPTS = {
  legal_entity_type: ['', 'PT', 'PT PMA', 'CV', 'Perorangan', 'Yayasan', 'Firma'],
  tax_regime: ['', 'normal', 'pp23_final', 'pph_final_umkm'],
  vat_status: ['', 'pkp', 'non_pkp', 'not_registered'],
  pkp_status: ['', 'pkp', 'non_pkp'],
  employee_status: ['', 'has_employees', 'none'],
  accounting_method: ['', 'accrual', 'cash'],
  filing_frequency: ['', 'monthly', 'quarterly', 'annual'],
}

export default function TaxProfile() {
  const { token } = useAuth()
  const lang = ['ru', 'id'].includes(getLang()) ? getLang() : 'en'
  const l = L[lang]
  const [p, setP] = useState({})
  const [meta, setMeta] = useState({ percent: 0, missing: [] })
  const [appl, setAppl] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    apiFetch('/accountant/profile', token).then(d => { setP(d.profile || {}); setDirty(false) }).catch(() => {})
    apiFetch('/accountant/applicability', token).then(setAppl).catch(() => {})
  }, [token])
  useEffect(() => { if (token) load() }, [token, load])
  useEffect(() => { if (appl?.completeness) setMeta(appl.completeness) }, [appl])

  const set = (k, v) => { setP({ ...p, [k]: v }); setDirty(true) }
  const save = async () => {
    setBusy(true)
    try { const d = await apiFetch('/accountant/profile', token, { method: 'PUT', body: p }); setP(d.profile); setMeta(d.completeness); setDirty(false); apiFetch('/accountant/applicability', token).then(setAppl).catch(() => {}) }
    catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  const verify = async () => {
    setBusy(true)
    try { await apiFetch('/accountant/profile/verify', token, { method: 'POST' }); load() }
    catch (e) { alert(e.message) } finally { setBusy(false) }
  }

  const field = (k, label) => OPTS[k]
    ? <label style={fl}><span style={ls}>{label}</span>
        <select value={p[k] || ''} onChange={e => set(k, e.target.value)} style={inp}>{OPTS[k].map(o => <option key={o} value={o}>{o || '—'}</option>)}</select></label>
    : <label style={fl}><span style={ls}>{label}</span>
        <input value={p[k] || ''} onChange={e => set(k, e.target.value)} style={inp} /></label>

  const section = (title, fields) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>{fields}</div>
    </div>
  )

  const pct = meta.percent || 0
  const verified = p.profile_status === 'verified'

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>🧾 {l.title}</h1>
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>{l.subtitle}</div>

      {/* Completeness */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
          <span>{l.completeness}: <b>{pct}%</b> {verified && <span style={{ color: 'var(--green-dark)' }}>· ✓ {l.verified}</span>} {p.profile_status === 'needs_review' && <span style={{ color: 'var(--amber-dark)' }}>· {l.needsReview}</span>}</span>
        </div>
        <div style={{ height: 8, background: 'var(--bg-3)', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? 'var(--green-dark,#085041)' : 'var(--accent,#4F46E5)' }} />
        </div>
        {pct < 100 && <div style={{ fontSize: 12, color: 'var(--amber-dark)', marginTop: 8 }}>{l.incomplete}</div>}
        {(appl?.profile_warnings || []).map((w, i) => <div key={i} style={{ fontSize: 12, color: 'var(--red-dark)', marginTop: 6 }}>⚠ {w.message}</div>)}
      </div>

      {/* Form */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 14 }}>
        {section(l.sec_identity, [field('country', 'Country'), field('jurisdiction', 'Jurisdiction'), field('industry', 'Industry'), field('reporting_currency', 'Reporting currency')])}
        {section(l.sec_reg, [field('tax_identifier', 'Tax identifier'), field('npwp', 'NPWP'), field('nib', 'NIB'), field('tax_residency', 'Tax residency')])}
        {section(l.sec_form, [field('legal_entity_type', 'Legal entity type'), field('tax_regime', 'Tax regime'), field('accounting_method', 'Accounting method'), field('filing_frequency', 'Filing frequency')])}
        {section(l.sec_vat, [field('vat_status', 'VAT status'), field('pkp_status', 'PKP status')])}
        {section(l.sec_year, [field('financial_year_start', 'FY start (MM-DD)'), field('financial_year_end', 'FY end (MM-DD)')])}
        {section(l.sec_emp, [field('employee_status', 'Employee status'), field('payroll_tax_status', 'Payroll tax status'), field('withholding_tax_status', 'Withholding tax status')])}
        {section(l.sec_act, [field('business_activity_codes', 'Activity codes')])}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn btn-primary btn-md" disabled={busy || !dirty} onClick={save}>{busy ? '…' : l.save}</button>
          <button className="btn btn-ghost btn-md" disabled={busy || dirty || pct < 100 || verified} title={dirty ? l.save_first : ''} onClick={verify}>{l.verify}</button>
        </div>
      </div>

      {/* Applicability */}
      {appl && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{l.applicable}</div>
          {appl.active_unverified > 0 && <div style={{ fontSize: 12, color: 'var(--amber-dark)', marginBottom: 8 }}>⚠ {appl.active_unverified} {l.sourceReq}</div>}
          {(appl.applicable_rules || []).length === 0 && <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{l.noActive}</div>}
          {(appl.applicable_rules || []).map(r => (
            <div key={r.rule_code} style={{ fontSize: 13, padding: '6px 0', borderTop: '0.5px solid var(--border)' }}>
              ✅ <b>{r.title}</b> <span style={{ color: 'var(--text-3)' }}>({r.rule_code})</span><div style={{ fontSize: 12, color: 'var(--text-3)' }}>{r.reason}</div>
            </div>
          ))}
          {(appl.missing_profile_fields || []).length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--amber-dark)', marginTop: 8 }}>{l.missing}: {appl.missing_profile_fields.join(', ')}</div>
          )}
          {(appl.excluded_rules || []).length > 0 && (
            <details style={{ marginTop: 8, fontSize: 12, color: 'var(--text-3)' }}>
              <summary>{l.excluded} ({appl.excluded_rules.length})</summary>
              {appl.excluded_rules.map(r => <div key={r.rule_code} style={{ padding: '3px 0' }}>✖ {r.rule_code} — {r.reason}</div>)}
            </details>
          )}
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{l.disclaimer}</div>
    </div>
  )
}
const fl = { display: 'flex', flexDirection: 'column', gap: 3 }
const ls = { fontSize: 11, fontWeight: 700, color: 'var(--text-3)' }
const inp = { padding: '7px 9px', border: '1px solid var(--border-2)', borderRadius: 8, fontSize: 13, background: 'var(--bg)' }
