import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from '../hooks/useTranslation'
import { apiFetch } from '../lib/api'

const LANGUAGES = [
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'id', label: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'zh', label: '中文', flag: '🇨🇳' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'pt', label: 'Português', flag: '🇧🇷' },
  { code: 'hi', label: 'हिन्दी', flag: '🇮🇳' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'tr', label: 'Türkçe', flag: '🇹🇷' },
  { code: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'th', label: 'ภาษาไทย', flag: '🇹🇭' },
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

export default function Settings() {
  const { token, logout } = useAuth()
  const navigate = useNavigate()
  const fileRef = useRef()
  const { t, changeLang } = useTranslation()

  const [profile, setProfile] = useState({ first_name: '', last_name: '', photo_url: '', language: 'ru', timezone: 'Asia/Makassar' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [showLogout, setShowLogout] = useState(false)
  const [showLang, setShowLang] = useState(false)
  const [showTz, setShowTz] = useState(false)
  const [notifications, setNotifications] = useState(localStorage.getItem('hf_notif') !== 'false')

  useEffect(() => {
    apiFetch('/profile', token).then(data => {
      setProfile({ first_name: data.first_name || '', last_name: data.last_name || '', photo_url: data.photo_url || '', language: data.language || 'ru', timezone: data.timezone || 'Asia/Makassar' })
      setLoading(false)
    }).catch(() => setLoading(false))
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

      <div style={{ margin: '4px 16px 20px', background: 'var(--text)', borderRadius: 16, padding: '20px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div onClick={() => fileRef.current.click()} style={{ position: 'relative', cursor: 'pointer', flexShrink: 0 }}>
            {profile.photo_url
              ? <img src={profile.photo_url} alt="" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover' }} />
              : <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#B5D4F4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 600, color: '#0C447C' }}>{profile.first_name?.[0] || 'A'}</div>
            }
            <div style={{ position: 'absolute', bottom: 0, right: 0, width: 18, height: 18, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            </div>
          </div>
          <div style={{ flex: 1, color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{t('settings.tapPhotoToChange')}</div>
          <input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} style={{ display: 'none' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input value={profile.first_name} onChange={e => { setProfile(p => ({ ...p, first_name: e.target.value })); setDirty(true) }} placeholder={t('settings.firstName')} style={{ flex: 1, padding: '9px 12px', borderRadius: 10, border: 'none', background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 14 }} />
          <input value={profile.last_name} onChange={e => { setProfile(p => ({ ...p, last_name: e.target.value })); setDirty(true) }} placeholder={t('settings.lastName')} style={{ flex: 1, padding: '9px 12px', borderRadius: 10, border: 'none', background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 14 }} />
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
    </div>
  )
}