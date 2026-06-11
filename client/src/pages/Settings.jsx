import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useAccess } from '../hooks/useAccess'
import { useTranslation } from '../hooks/useTranslation'
import { apiFetch } from '../lib/api'

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'id', label: 'Bahasa Indonesia', flag: '🇮🇩' },
]

const TIMEZONES = [
  { value: 'Asia/Makassar', label: 'Bali (WITA, UTC+8)' },
  { value: 'Asia/Jakarta', label: 'Jakarta (WIB, UTC+7)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT, UTC+8)' },
  { value: 'Asia/Bangkok', label: 'Bangkok (ICT, UTC+7)' },
  { value: 'Asia/Ho_Chi_Minh', label: 'Ho Chi Minh (ICT, UTC+7)' },
  { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur (MYT, UTC+8)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST, UTC+4)' },
  { value: 'Europe/Moscow', label: 'Moscow (MSK, UTC+3)' },
  { value: 'Europe/London', label: 'London (GMT, UTC+0)' },
  { value: 'America/New_York', label: 'New York (EST, UTC-5)' },
  { value: 'UTC', label: 'UTC' },
]

const BIZ_CURRENCIES = [
  { value: 'IDR', label: 'IDR — Indonesian Rupiah' },
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'SGD', label: 'SGD — Singapore Dollar' },
  { value: 'MYR', label: 'MYR — Malaysian Ringgit' },
  { value: 'THB', label: 'THB — Thai Baht' },
  { value: 'CNY', label: 'CNY — Chinese Yuan' },
]

const BIZ_TIMEZONES = [
  { value: 'Asia/Makassar',     label: 'Bali / Makassar (WITA UTC+8)' },
  { value: 'Asia/Jakarta',      label: 'Jakarta (WIB UTC+7)' },
  { value: 'Asia/Jayapura',     label: 'Papua (WIT UTC+9)' },
  { value: 'Asia/Singapore',    label: 'Singapore (SGT UTC+8)' },
  { value: 'Asia/Bangkok',      label: 'Bangkok (ICT UTC+7)' },
  { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur (MYT UTC+8)' },
  { value: 'Asia/Shanghai',     label: 'Beijing / Shanghai (CST UTC+8)' },
  { value: 'Asia/Dubai',        label: 'Dubai (GST UTC+4)' },
  { value: 'Europe/Moscow',     label: 'Moscow (MSK UTC+3)' },
  { value: 'Europe/London',     label: 'London (GMT UTC+0)' },
  { value: 'America/New_York',  label: 'New York (EST UTC-5)' },
  { value: 'UTC',               label: 'UTC' },
]

export default function Settings() {
  const { token, logout } = useAuth()
  const { access, planLabel, isTrialActive, effectivePlan, refreshAccess } = useAccess()
  const navigate = useNavigate()
  const fileRef = useRef()
  const { t, changeLang } = useTranslation()

  const [profile, setProfile] = useState({ first_name: '', last_name: '', photo_url: '', language: 'ru', timezone: 'Asia/Makassar' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [showLogout,    setShowLogout]    = useState(false)
  const [showReset,     setShowReset]     = useState(false)
  const [resetStep,     setResetStep]     = useState(1)   // 1=confirm, 2=done
  const [resetLoading,  setResetLoading]  = useState(false)
  const [resetError,    setResetError]    = useState('')
  const [showLang, setShowLang] = useState(false)
  const [showTz, setShowTz] = useState(false)
  const [notifications, setNotifications] = useState(localStorage.getItem('hf_notif') !== 'false')
  const [refData, setRefData] = useState({ categories: 0, counterparties: 0, wallets: 0 })

  // Business settings state
  const [bizEdit, setBizEdit] = useState(false)
  const [bizName, setBizName] = useState('')
  const [bizCurrency, setBizCurrency] = useState('IDR')
  const [bizTimezone, setBizTimezone] = useState('Asia/Makassar')
  const [bizCountry, setBizCountry] = useState('')
  const [bizSaving, setBizSaving] = useState(false)
  const [bizError, setBizError] = useState('')

  // Sync biz fields from access when it loads
  useEffect(() => {
    if (access?.business) {
      setBizName(access.business.name || '')
      setBizCurrency(access.business.base_currency || 'IDR')
      setBizTimezone(access.business.timezone || 'Asia/Makassar')
      setBizCountry(access.business.country || '')
    }
  }, [access])

  const saveBusiness = async () => {
    setBizSaving(true); setBizError('')
    try {
      await apiFetch('/business/current', token, {
        method: 'PATCH',
        body: { name: bizName.trim() || undefined, base_currency: bizCurrency, timezone: bizTimezone, country: bizCountry.trim() || undefined },
      })
      await refreshAccess()
      setBizEdit(false)
    } catch (e) {
      setBizError(e.message)
    } finally {
      setBizSaving(false)
    }
  }

  useEffect(() => {
    apiFetch('/profile', token).then(data => {
      setProfile({ first_name: data.first_name || '', last_name: data.last_name || '', photo_url: data.photo_url || '', language: data.language || 'ru', timezone: data.timezone || 'Asia/Makassar' })
      setLoading(false)
    }).catch(() => setLoading(false))
    // Load reference data counts for display
    Promise.all([
      apiFetch('/cashflow-categories', token).catch(() => ({ categories: [] })),
      apiFetch('/counterparties', token).catch(() => ({ counterparties: [] })),
      apiFetch('/wallets', token).catch(() => ({ wallets: [] })),
    ]).then(([cats, cps, wls]) => {
      setRefData({
        categories:    (cats.categories   || []).length,
        counterparties:(cps.counterparties || []).length,
        wallets:       (wls.wallets        || []).length,
      })
    })
  }, [token])

  const save = async (updates) => {
    setSaving(true)
    const updated = { ...profile, ...updates }
    setProfile(updated)
    await apiFetch('/profile', token, { method: 'POST', body: updated })
    setSaving(false)
    setDirty(false)
  }

  const handlePhoto = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const max = 200
        const ratio = Math.min(max / img.width, max / img.height)
        canvas.width = img.width * ratio
        canvas.height = img.height * ratio
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        setProfile(p => ({ ...p, photo_url: canvas.toDataURL('image/jpeg', 0.8) }))
        setDirty(true)
      }
      img.src = ev.target.result
    }
    reader.readAsDataURL(file)
  }

  const handleLogout = () => { logout(); navigate('/login') }

  const handleResetData = async () => {
    setResetLoading(true); setResetError('')
    try {
      const res = await fetch('/api/user/reset-data', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirm: 'RESET' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Reset failed')
      setResetStep(2)
    } catch (e) {
      setResetError(e.message)
    } finally {
      setResetLoading(false)
    }
  }

  const closeReset = () => { setShowReset(false); setResetStep(1); setResetError('') }
  const resetAndReload = () => { closeReset(); navigate('/') }
  const handleNotif = () => { const n = !notifications; setNotifications(n); localStorage.setItem('hf_notif', String(n)) }

  const selectedLang = LANGUAGES.find(l => l.code === profile.language) || LANGUAGES[0]
  const selectedTz = TIMEZONES.find(tz => tz.value === profile.timezone) || TIMEZONES[0]

  if (loading) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)' }}>{t('common.loading')}</div>

  return (
    <div className="page">
      <div className="topbar">
        <button onClick={() => navigate(-1)} style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-2)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{t('settings.title')}</div>
        <div style={{ width: 32 }}/>
      </div>

      <div style={{ margin: '4px 16px 20px', background: 'var(--text)', borderRadius: 16, padding: '20px 18px', overflow: 'hidden', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div onClick={() => fileRef.current.click()} style={{ position: 'relative', cursor: 'pointer', flexShrink: 0 }}>
            {profile.photo_url
              ? <img src={profile.photo_url} alt="" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover' }} />
              : <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--brand-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 600, color: 'var(--brand-dark)' }}>{profile.first_name?.[0] || 'A'}</div>
            }
            <div style={{ position: 'absolute', bottom: 0, right: 0, width: 18, height: 18, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            </div>
          </div>
          <div style={{ flex: 1, color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{t('settings.tapPhotoToChange')}</div>
          <input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} style={{ display: 'none' }} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <input value={profile.first_name} onChange={e => { setProfile(p => ({ ...p, first_name: e.target.value })); setDirty(true) }} placeholder={t('settings.firstName')} style={{ flex: '1 1 120px', minWidth: 0, padding: '9px 12px', borderRadius: 10, border: 'none', background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 14 }} />
          <input value={profile.last_name} onChange={e => { setProfile(p => ({ ...p, last_name: e.target.value })); setDirty(true) }} placeholder={t('settings.lastName')} style={{ flex: '1 1 120px', minWidth: 0, padding: '9px 12px', borderRadius: 10, border: 'none', background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 14 }} />
        </div>
        <button disabled={!dirty || saving} onClick={() => save({})} style={{ width: '100%', padding: '9px', borderRadius: 10, background: dirty ? '#fff' : 'rgba(255,255,255,0.15)', color: dirty ? '#000' : 'rgba(255,255,255,0.3)', border: 'none', fontSize: 13, fontWeight: 500 }}>
          {saving ? t('common.saving') : t('settings.saveChanges')}
        </button>
      </div>

      <div style={{ margin: '0 16px 8px', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('settings.language')}</div>
      <div style={{ margin: '0 16px 16px', background: 'var(--bg-2)', borderRadius: 12 }}>
        <div onClick={() => setShowLang(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>{selectedLang.flag}</span>
            <span style={{ fontSize: 14, color: 'var(--text)' }}>{selectedLang.label}</span>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>

      <div style={{ margin: '0 16px 8px', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('settings.timezone')}</div>
      <div style={{ margin: '0 16px 16px', background: 'var(--bg-2)', borderRadius: 12 }}>
        <div onClick={() => setShowTz(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', cursor: 'pointer' }}>
          <span style={{ fontSize: 14, color: 'var(--text)' }}>{selectedTz.label}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>

      <div style={{ margin: '0 16px 8px', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('settings.notifications')}</div>
      <div style={{ margin: '0 16px 16px', background: 'var(--bg-2)', borderRadius: 12 }}>
        <div onClick={handleNotif} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', cursor: 'pointer' }}>
          <div>
            <div style={{ fontSize: 14, color: 'var(--text)', marginBottom: 2 }}>{t('settings.pushNotifications')}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{t('settings.remindersAndAlerts')}</div>
          </div>
          <div style={{ width: 44, height: 26, borderRadius: 13, background: notifications ? 'var(--text)' : 'var(--border-2)', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
            <div style={{ position: 'absolute', top: 3, left: notifications ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
          </div>
        </div>
      </div>

      <div style={{ margin: '0 16px 8px', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('settings.telegramBot')}</div>
      <div style={{ margin: '0 16px 16px', background: 'var(--bg-2)', borderRadius: 12 }}>
        <a href="https://t.me/HCfinance_Bot" target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', textDecoration: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#229ED9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248l-2.008 9.457c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.871.764z"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 14, color: 'var(--text)', marginBottom: 1 }}>{t('settings.openBot')}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{t('settings.addViaChat')}</div>
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 0 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>
      </div>

      {/* Reference Data */}
      <div style={{ margin: '0 16px 8px', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Reference Data</div>
      <div style={{ margin: '0 16px 16px', background: 'var(--surface-card)', borderRadius: 14, border: '0.5px solid var(--border)', overflow: 'hidden' }}>
        {[
          { label: 'Wallets & Accounts', value: `${refData.wallets} active`, note: 'Manage in Accounts →', icon: '🏦', link: '/accounts' },
          { label: 'Cashflow Categories', value: `${refData.categories} loaded`, note: '46 system articles from DDS model', icon: '📂' },
          { label: 'Counterparties', value: `${refData.counterparties} saved`, note: 'Vendors, clients, franchisees', icon: '🏢' },
          { label: 'Business Directions', value: '3 system', note: 'Vending · Franchise · General', icon: '📊' },
          { label: 'Activity Types', value: '4 system', note: 'Operating · Investing · Financing · Technical', icon: '🏷️' },
        ].map((row, idx, arr) => (
          <div key={row.label} onClick={row.link ? () => navigate(row.link) : undefined} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: idx < arr.length - 1 ? '0.5px solid var(--border)' : 'none', cursor: row.link ? 'pointer' : 'default' }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>{row.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 500 }}>{row.label}</div>
              <div style={{ fontSize: 11, color: row.link ? 'var(--brand)' : 'var(--text-3)', marginTop: 1 }}>{row.note}</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--brand)', fontWeight: 600, flexShrink: 0 }}>{row.value}</div>
          </div>
        ))}
      </div>

      {/* ── Business Settings ── */}
      {access?.business && (() => {
        const canEdit = ['owner', 'admin'].includes(access?.membership?.role)
        const biz = access.business
        const inputSt = { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border-2)', fontSize: 13, background: 'var(--bg-3)', color: 'var(--text)', boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }
        return (
          <>
            <div style={{ margin: '0 16px 8px', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Business Settings</div>
            <div style={{ margin: '0 16px 16px', background: 'var(--bg-2)', borderRadius: 12, overflow: 'hidden' }}>
              {!bizEdit ? (
                <>
                  {[
                    { label: 'Business name',  value: biz.name || '—' },
                    { label: 'Base currency',  value: biz.base_currency || 'IDR' },
                    { label: 'Timezone',       value: biz.timezone || '—' },
                    { label: 'Country',        value: biz.country || '—' },
                  ].map((row, idx, arr) => (
                    <div key={row.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: idx < arr.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{row.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{row.value}</span>
                    </div>
                  ))}
                  {canEdit && (
                    <div style={{ padding: '12px 16px', borderTop: '0.5px solid var(--border)' }}>
                      <button onClick={() => { setBizName(biz.name || ''); setBizCurrency(biz.base_currency || 'IDR'); setBizTimezone(biz.timezone || 'Asia/Makassar'); setBizCountry(biz.country || ''); setBizEdit(true); setBizError('') }} style={{ width: '100%', padding: '9px', borderRadius: 10, background: 'none', color: 'var(--brand)', border: '0.5px solid var(--border-2)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                        ✏️ Edit business info
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ padding: '16px' }}>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Business name</label>
                    <input value={bizName} onChange={e => setBizName(e.target.value)} placeholder="e.g. Bali Spa" style={inputSt} autoFocus />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Base currency</label>
                    <select value={bizCurrency} onChange={e => setBizCurrency(e.target.value)} style={{ ...inputSt, cursor: 'pointer' }}>
                      {BIZ_CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Timezone</label>
                    <select value={bizTimezone} onChange={e => setBizTimezone(e.target.value)} style={{ ...inputSt, cursor: 'pointer' }}>
                      {BIZ_TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                    </select>
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Country</label>
                    <input value={bizCountry} onChange={e => setBizCountry(e.target.value)} placeholder="e.g. Indonesia" style={inputSt} />
                  </div>
                  {bizError && <div style={{ fontSize: 12, color: '#991B1B', background: '#FEE2E2', borderRadius: 8, padding: '7px 10px', marginBottom: 10 }}>{bizError}</div>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={saveBusiness} disabled={bizSaving} style={{ flex: 1, padding: '10px', borderRadius: 10, background: '#2563EB', color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: bizSaving ? 'not-allowed' : 'pointer', opacity: bizSaving ? 0.6 : 1 }}>
                      {bizSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => { setBizEdit(false); setBizError('') }} style={{ flex: 1, padding: '10px', borderRadius: 10, background: 'none', color: 'var(--text-3)', border: '0.5px solid var(--border-2)', fontSize: 13, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )
      })()}

      {/* ── Plan & Access ── */}
      {access && (() => {
        const { plan, limits, usage } = access
        const PLAN_LABELS = { free: 'Free Plan', starter: 'Starter', business: 'Business', founder: 'Founder', enterprise: 'Enterprise' }
        const planName = PLAN_LABELS[plan.effective_plan] || plan.effective_plan

        // Badge color for effective plan chip
        const chipStyle = plan.is_trial_active
          ? { background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }
          : plan.effective_plan === 'free'
            ? { background: 'var(--bg-3)', color: 'var(--text-3)', border: '1px solid var(--border)' }
            : { background: '#E1F5EE', color: '#085041', border: '1px solid #A7F3D0' }

        const fmtLimit = (v) => (v === null || v === undefined) ? '∞' : String(v)

        const rows = [
          { label: 'Current plan',    value: plan.name.charAt(0).toUpperCase() + plan.name.slice(1) },
          { label: 'Trial status',    value: plan.trial_status },
          ...(plan.is_trial_active ? [
            { label: 'Trial ends',    value: new Date(plan.trial_ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) },
            { label: 'Days left',     value: `${plan.days_left_in_trial} days` },
          ] : []),
          { label: 'Wallets',              value: `${usage.wallets_count} / ${fmtLimit(limits.max_wallets)}` },
          { label: 'Transactions (month)', value: `${usage.transactions_this_month} / ${fmtLimit(limits.max_transactions_per_month)}` },
          { label: 'AI questions (month)', value: `${usage.ai_questions_this_month} / ${fmtLimit(limits.max_ai_questions_per_month)}` },
        ]

        return (
          <>
            <div style={{ margin: '0 16px 8px', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Plan & Access</div>
            <div style={{ margin: '0 16px 16px', background: 'var(--bg-2)', borderRadius: 12, overflow: 'hidden' }}>

              {/* Effective plan chip header */}
              <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '0.5px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600, marginBottom: 3 }}>Effective access</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{access.business?.name}</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20, ...chipStyle }}>
                  {planLabel}
                </span>
              </div>

              {/* Rows */}
              {rows.map((row, idx) => (
                <div key={row.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', borderBottom: idx < rows.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{row.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{row.value}</span>
                </div>
              ))}

              {/* Feature flags row */}
              <div style={{ padding: '10px 16px', borderTop: '0.5px solid var(--border)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  ['Payroll',      limits.payroll_enabled],
                  ['Team',         limits.team_access_enabled],
                  ['Approvals',    limits.approval_flow_enabled],
                  ['Radar',        limits.advanced_radar_enabled],
                  ['Export',       limits.export_enabled],
                  ['Integrations', limits.integrations_enabled],
                ].map(([label, enabled]) => (
                  <span key={label} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 20, fontWeight: 600,
                    background: enabled ? '#E1F5EE' : 'var(--bg-3)',
                    color:      enabled ? '#085041' : 'var(--text-3)',
                    border:     enabled ? '1px solid #A7F3D0' : '1px solid var(--border)',
                  }}>
                    {enabled ? '✓' : '—'} {label}
                  </span>
                ))}
              </div>

              {/* Upgrade CTA placeholder */}
              <div style={{ padding: '12px 16px', borderTop: '0.5px solid var(--border)' }}>
                <button style={{ width: '100%', padding: '10px', borderRadius: 10, background: 'none', color: 'var(--brand)', border: '0.5px solid var(--border-2)', fontSize: 13, fontWeight: 500, cursor: 'default', opacity: 0.7 }}>
                  ✨ Upgrade plans — coming soon
                </button>
              </div>
            </div>
          </>
        )
      })()}

      {/* Repeat setup wizard */}
      <div style={{ margin: '0 16px 10px' }}>
        <button
          onClick={() => navigate('/onboarding')}
          style={{ width: '100%', padding: 12, borderRadius: 12, background: 'none', color: 'var(--brand)', border: '0.5px solid var(--border-2)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
        >
          ✦ Repeat setup wizard
        </button>
      </div>

      {/* Reset all data */}
      <div style={{ margin: '0 16px 8px' }}>
        <button
          onClick={() => { setShowReset(true); setResetStep(1); setResetError('') }}
          style={{ width: '100%', padding: 13, borderRadius: 12, background: 'none', color: 'var(--amber-dark)', border: '0.5px solid var(--amber-dark)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          🗑 Reset all financial data
        </button>
      </div>

      <div style={{ margin: '0 16px 16px' }}>
        <button onClick={() => setShowLogout(true)} style={{ width: '100%', padding: 13, borderRadius: 12, background: 'none', color: 'var(--red)', border: '0.5px solid var(--red)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>{t('settings.signOut')}</button>
      </div>
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-3)', paddingBottom: 32 }}>{t('settings.version')}</div>

      {showLang && (
        <div onClick={() => setShowLang(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', borderRadius: '16px 16px 0 0', padding: '20px 0 32px', width: '100%', maxHeight: '70vh', overflow: 'auto' }}>
            <div style={{ width: 36, height: 3, background: 'var(--border-2)', borderRadius: 2, margin: '0 auto 16px' }} />
            <div style={{ fontSize: 15, fontWeight: 600, padding: '0 16px 12px' }}>{t('settings.selectLanguage')}</div>
            {LANGUAGES.map((l, i) => (
              <div key={l.code} onClick={() => { save({ language: l.code }); changeLang(l.code); setShowLang(false) }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: i < LANGUAGES.length - 1 ? '0.5px solid var(--border)' : 'none', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 22 }}>{l.flag}</span>
                  <span style={{ fontSize: 14, color: 'var(--text)' }}>{l.label}</span>
                </div>
                {profile.language === l.code && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
              </div>
            ))}
          </div>
        </div>
      )}

      {showTz && (
        <div onClick={() => setShowTz(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', borderRadius: '16px 16px 0 0', padding: '20px 0 32px', width: '100%', maxHeight: '70vh', overflow: 'auto' }}>
            <div style={{ width: 36, height: 3, background: 'var(--border-2)', borderRadius: 2, margin: '0 auto 16px' }} />
            <div style={{ fontSize: 15, fontWeight: 600, padding: '0 16px 12px' }}>{t('settings.selectTimezone')}</div>
            {TIMEZONES.map((tz, i) => (
              <div key={tz.value} onClick={() => { save({ timezone: tz.value }); setShowTz(false) }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: i < TIMEZONES.length - 1 ? '0.5px solid var(--border)' : 'none', cursor: 'pointer' }}>
                <span style={{ fontSize: 14, color: 'var(--text)' }}>{tz.label}</span>
                {profile.timezone === tz.value && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
              </div>
            ))}
          </div>
        </div>
      )}

      {showLogout && (
        <div onClick={() => setShowLogout(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', borderRadius: '16px 16px 0 0', padding: '20px 16px 32px', width: '100%' }}>
            <div style={{ width: 36, height: 3, background: 'var(--border-2)', borderRadius: 2, margin: '0 auto 16px' }} />
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{t('settings.signOutConfirm')}</div>
            <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>{t('settings.signOutNote')}</div>
            <button onClick={handleLogout} style={{ width: '100%', padding: 13, borderRadius: 10, background: 'var(--red)', color: '#fff', border: 'none', fontSize: 14, fontWeight: 500, marginBottom: 8 }}>{t('settings.signOut')}</button>
            <button onClick={() => setShowLogout(false)} style={{ width: '100%', padding: 11, borderRadius: 10, background: 'none', color: 'var(--text-3)', border: '0.5px solid var(--border)', fontSize: 13 }}>{t('common.cancel')}</button>
          </div>
        </div>
      )}

      {/* ── Reset all data modal ── */}
      {showReset && (
        <div onClick={resetStep === 1 ? closeReset : undefined} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', borderRadius: '16px 16px 0 0', padding: '20px 16px 36px', width: '100%', maxWidth: 480 }}>
            <div style={{ width: 36, height: 3, background: 'var(--border-2)', borderRadius: 2, margin: '0 auto 20px' }} />

            {resetStep === 1 && (
              <>
                <div style={{ fontSize: 22, textAlign: 'center', marginBottom: 10 }}>🗑</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>Reset all financial data?</div>
                <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 6, lineHeight: 1.6 }}>
                  This will permanently delete:
                </div>
                <div style={{ background: 'var(--red-light)', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: 'var(--red-dark)', lineHeight: 1.8 }}>
                  ✕ All transactions<br />
                  ✕ All debts & invoices (receivables / payables)<br />
                  ✕ All wallets<br />
                  ✕ All reminders
                </div>
                <div style={{ background: 'var(--green-light)', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: 'var(--green-dark)', lineHeight: 1.8 }}>
                  ✓ Account stays active<br />
                  ✓ Business & plan settings preserved<br />
                  ✓ You can start fresh immediately
                </div>
                {resetError && (
                  <div style={{ fontSize: 12, color: 'var(--red-dark)', marginBottom: 12, padding: '8px 12px', background: 'var(--red-light)', borderRadius: 8 }}>{resetError}</div>
                )}
                <button
                  onClick={handleResetData}
                  disabled={resetLoading}
                  style={{ width: '100%', padding: 13, borderRadius: 10, background: 'var(--amber-dark)', color: '#fff', border: 'none', fontSize: 14, fontWeight: 600, marginBottom: 8, cursor: resetLoading ? 'not-allowed' : 'pointer', opacity: resetLoading ? 0.7 : 1 }}>
                  {resetLoading ? 'Deleting data…' : 'Yes, reset all data'}
                </button>
                <button onClick={closeReset} style={{ width: '100%', padding: 11, borderRadius: 10, background: 'none', color: 'var(--text-3)', border: '0.5px solid var(--border)', fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
              </>
            )}

            {resetStep === 2 && (
              <>
                <div style={{ fontSize: 32, textAlign: 'center', marginBottom: 12 }}>✅</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>Data reset complete</div>
                <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 24, textAlign: 'center', lineHeight: 1.6 }}>
                  All transactions, debts, wallets and reminders have been deleted.<br />Your account is ready for fresh data.
                </div>
                <button onClick={resetAndReload} style={{ width: '100%', padding: 13, borderRadius: 10, background: 'var(--brand)', color: '#fff', border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  Go to Dashboard
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}