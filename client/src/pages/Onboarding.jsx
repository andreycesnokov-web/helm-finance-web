/**
 * CFO AI — First-time Onboarding Wizard
 *
 * Detection (in App.jsx PulseWrapper):
 *   Show if: no accounts + no transactions + no debts on server
 *            AND not skipped/completed via localStorage flags
 *
 * localStorage keys (UI convenience only — real state is server data):
 *   cfo_onboarding_skipped  → user explicitly skipped
 *   cfo_onboarded           → user completed setup successfully
 *
 * Steps: Welcome → Profile → First Account → Done
 *
 * Known limitations:
 *   - No dedicated business_name field in DB. Stored in users.last_name as workaround.
 *   - Currency is informational only — backend stores amounts in IDR.
 *     Opening balance always saved as IDR regardless of selected currency.
 *   - No business/workspace table exists yet.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch } from '../lib/api'

// ── localStorage helpers ──────────────────────────────────────────────────────
export function markOnboardingSkipped()   { localStorage.setItem('cfo_onboarding_skipped', '1') }
export function markOnboardingCompleted() { localStorage.setItem('cfo_onboarded', '1') }
export function clearOnboardingFlags()    {
  localStorage.removeItem('cfo_onboarding_skipped')
  localStorage.removeItem('cfo_onboarded')
}

/**
 * shouldShowOnboarding — pure function, call with pulse API response.
 * Returns true only for genuinely new users.
 *
 * @param {object} pulseData  — response from GET /api/pulse
 * @returns {boolean}
 */
export function shouldShowOnboarding(pulseData) {
  // 1. If user explicitly skipped — never show again on this device
  if (localStorage.getItem('cfo_onboarding_skipped')) return false
  // 2. If user already completed onboarding — never show again
  if (localStorage.getItem('cfo_onboarded'))          return false
  // 3. If user already has real server-side data — they're not new
  const hasAccounts = (pulseData?.accounts || []).length > 0
  const hasTxs      = (pulseData?.income > 0) || (pulseData?.expenses > 0) ||
                      (pulseData?.totalBalance != null && pulseData?.totalBalance !== 0)
  const hasDebts    = (pulseData?.debts || []).filter(d => !d.is_settled).length > 0
  if (hasAccounts || hasTxs || hasDebts) return false
  // 4. Truly new user — show onboarding
  return true
}

// ── Step indicator ────────────────────────────────────────────────────────────
const STEPS = ['welcome', 'profile', 'account', 'done']
const STEP_LABELS = ['Welcome', 'Profile', 'Account', 'Done']

function StepBar({ current }) {
  return (
    <div style={{ marginBottom: 30 }}>
      <div style={{ display: 'flex', gap: 5, justifyContent: 'center', marginBottom: 8 }}>
        {STEPS.map((_, i) => (
          <div
            key={i}
            style={{
              height: 4,
              width: i === current ? 28 : 14,
              borderRadius: 3,
              background: i < current  ? '#2563EB' :
                          i === current ? '#2563EB' : 'var(--border-2)',
              opacity: i < current ? 0.4 : 1,
              transition: 'all 0.25s',
            }}
          />
        ))}
      </div>
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-4)', fontWeight: 600, letterSpacing: '0.06em' }}>
        {current < STEPS.length - 1 ? `STEP ${current + 1} OF ${STEPS.length - 1}` : 'COMPLETE'}
        {' · '}{STEP_LABELS[current].toUpperCase()}
      </div>
    </div>
  )
}

// ── Input helpers ─────────────────────────────────────────────────────────────
const inputSt = {
  width: '100%', padding: '12px 14px', borderRadius: 11,
  border: '1px solid var(--border-2)', fontSize: 14,
  background: 'var(--bg-2)', color: 'var(--text)',
  boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none', minHeight: 44,
}

function Field({ label, value, onChange, placeholder, type = 'text', hint, autoFocus }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
        {label}
      </label>
      <input
        autoFocus={autoFocus}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputSt}
      />
      {hint && <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 4, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  )
}

function PrimaryBtn({ children, onClick, disabled, loading, style: extra }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        width: '100%', padding: '13px', borderRadius: 12, border: 'none',
        background: disabled || loading ? 'var(--bg-3)' : '#2563EB',
        color: disabled || loading ? 'var(--text-4)' : '#fff',
        fontSize: 14, fontWeight: 700,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', transition: 'background 0.15s',
        ...extra,
      }}
    >
      {loading ? 'Saving…' : children}
    </button>
  )
}

function GhostBtn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', padding: '11px', borderRadius: 12,
      border: '0.5px solid var(--border-2)', background: 'none',
      color: 'var(--text-3)', fontSize: 13, cursor: 'pointer',
      fontFamily: 'inherit', marginTop: 8,
    }}>
      {children}
    </button>
  )
}

function ErrorBox({ msg }) {
  if (!msg) return null
  return (
    <div style={{ fontSize: 13, color: '#991B1B', marginBottom: 12, background: '#FEE2E2', borderRadius: 8, padding: '8px 12px', lineHeight: 1.5 }}>
      {msg}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Onboarding({ onSkip, onComplete }) {
  const { token, user } = useAuth()
  const navigate        = useNavigate()

  const [step,   setStep]   = useState(0)  // 0=welcome, 1=profile, 2=account, 3=done
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  // Step 1 — profile fields
  const [firstName,    setFirstName]    = useState(user?.firstName || user?.first_name || '')
  const [businessName, setBusinessName] = useState('')
  const [timezone,     setTimezone]     = useState('Asia/Makassar')
  const [language,     setLanguage]     = useState('en')

  // Step 2 — account fields
  const [accountName, setAccountName] = useState('')
  const [accountType, setAccountType] = useState('business')
  const [openBalance, setOpenBalance] = useState('')
  const [currency,    setCurrency]    = useState('IDR')

  // ── Skip ─────────────────────────────────────────────────────────────────
  const skip = () => {
    markOnboardingSkipped()
    if (onSkip) onSkip()
  }

  // ── Complete ──────────────────────────────────────────────────────────────
  const complete = () => {
    markOnboardingCompleted()
    if (onComplete) onComplete()
  }

  // ── Step 1: Save profile ──────────────────────────────────────────────────
  const saveProfile = async () => {
    setSaving(true)
    setError('')
    try {
      const body = {}
      if (firstName.trim())    body.first_name = firstName.trim()
      // Limitation: no business_name column. Storing in last_name as workaround.
      if (businessName.trim()) body.last_name  = businessName.trim()
      if (timezone)            body.timezone   = timezone
      if (language)            body.language   = language
      if (Object.keys(body).length > 0) {
        await apiFetch('/profile', token, { method: 'POST', body })
      }
      setStep(2)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Step 2: Save wallet ───────────────────────────────────────────────────
  const saveAccount = async () => {
    // If wallet name empty, skip to done
    if (!accountName.trim()) { setStep(3); return }
    setSaving(true)
    setError('')
    try {
      // POST /api/wallets creates a real wallet record + optional opening balance transaction
      await apiFetch('/wallets', token, {
        method: 'POST',
        body: {
          name:            accountName.trim(),
          currency,
          type:            accountType === 'business' ? 'bank' : 'other',
          opening_balance: Number(openBalance) || 0,
        },
      })
      setStep(3)
    } catch (e) {
      // Fallback to legacy /api/accounts if wallets table not yet available
      try {
        await apiFetch('/accounts', token, {
          method: 'POST',
          body: { name: accountName.trim(), type: accountType, balance: Number(openBalance) || 0 },
        })
        setStep(3)
      } catch (e2) {
        setError(e2.message)
      }
    } finally {
      setSaving(false)
    }
  }

  // ── Shell ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '24px 16px', background: 'var(--bg)',
    }}>

      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 11,
          background: 'linear-gradient(135deg, #1D4ED8, #2563EB)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect x="2"  y="14" width="4"  height="7" rx="1" fill="rgba(255,255,255,0.5)"/>
            <rect x="8"  y="9"  width="4"  height="12" rx="1" fill="rgba(255,255,255,0.75)"/>
            <rect x="14" y="5"  width="4"  height="16" rx="1" fill="#fff"/>
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', letterSpacing: -0.3 }}>CFO AI</div>
          <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Financial OS</div>
        </div>
      </div>

      {/* Card */}
      <div style={{
        background: 'var(--bg-2)', borderRadius: 20, padding: '28px 24px',
        border: '1px solid var(--border)',
        boxShadow: '0 8px 32px rgba(15,23,42,0.08)',
        width: '100%', maxWidth: 440,
      }}>
        <StepBar current={step} />

        {/* ─── STEP 0: WELCOME ─── */}
        {step === 0 && (
          <>
            {/* Dark hero */}
            <div style={{
              background: 'linear-gradient(135deg, #0F172A, #1e293b)',
              borderRadius: 16, padding: '24px 20px', marginBottom: 22,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>✦</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: -0.3, marginBottom: 8 }}>
                Welcome to CFO AI
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7 }}>
                Your AI financial operating system. Track cash, debts, payroll and runway — all in one place.
              </div>
            </div>

            {/* Feature list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
              {[
                { icon: '📊', title: 'Pulse dashboard',     sub: 'Real-time cash position and runway' },
                { icon: '💳', title: 'Smart transactions',  sub: 'Add in plain language — AI parses it' },
                { icon: '📋', title: 'Debts & receivables', sub: 'Track who owes what and when' },
                { icon: '🤖', title: 'AI CFO insights',     sub: 'Financial analysis and recommendations' },
              ].map(f => (
                <div key={f.title} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', background: 'var(--bg-3)', borderRadius: 10 }}>
                  <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{f.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 1 }}>{f.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{f.sub}</div>
                  </div>
                </div>
              ))}
            </div>

            <PrimaryBtn onClick={() => setStep(1)}>Start setup →</PrimaryBtn>
            <GhostBtn onClick={skip}>Skip for now</GhostBtn>
          </>
        )}

        {/* ─── STEP 1: PROFILE ─── */}
        {step === 1 && (
          <>
            <div style={{ marginBottom: 22, textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>👤</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', letterSpacing: -0.3, marginBottom: 5 }}>Your profile</div>
              <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6 }}>
                Tell us a bit about yourself and your workspace.
              </div>
            </div>

            <Field
              label="Your name"
              value={firstName}
              onChange={setFirstName}
              placeholder="e.g. Alex"
              autoFocus
            />
            <Field
              label="Business / workspace name (optional)"
              value={businessName}
              onChange={setBusinessName}
              placeholder="e.g. Bali Spa, Freelance Studio"
              hint="Shown in the sidebar. You can change this later in Settings."
            />

            {/* Timezone */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
                Timezone
              </label>
              <select value={timezone} onChange={e => setTimezone(e.target.value)} style={{ ...inputSt, cursor: 'pointer' }}>
                <option value="Asia/Makassar">WITA — Bali, Makassar (UTC+8)</option>
                <option value="Asia/Jakarta">WIB — Jakarta (UTC+7)</option>
                <option value="Asia/Jayapura">WIT — Papua (UTC+9)</option>
                <option value="Asia/Singapore">SGT — Singapore (UTC+8)</option>
                <option value="Europe/Moscow">MSK — Moscow (UTC+3)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>

            {/* Language */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
                Language
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[{ k: 'en', l: '🇬🇧 English' }, { k: 'ru', l: '🇷🇺 Русский' }, { k: 'id', l: '🇮🇩 Bahasa' }].map(({ k, l }) => (
                  <button key={k} onClick={() => setLanguage(k)} style={{
                    flex: 1, padding: '9px 6px', borderRadius: 9, fontFamily: 'inherit', fontSize: 12,
                    border: language === k ? '2px solid #2563EB' : '1px solid var(--border-2)',
                    background: language === k ? '#EFF6FF' : 'none',
                    color: language === k ? '#1D4ED8' : 'var(--text-2)',
                    fontWeight: language === k ? 700 : 500, cursor: 'pointer',
                  }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <ErrorBox msg={error} />
            <PrimaryBtn onClick={saveProfile} loading={saving}>
              Save & continue →
            </PrimaryBtn>
            <GhostBtn onClick={() => setStep(2)}>Skip this step</GhostBtn>
          </>
        )}

        {/* ─── STEP 2: FIRST WALLET ─── */}
        {step === 2 && (
          <>
            <div style={{ marginBottom: 22, textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>🏦</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', letterSpacing: -0.3, marginBottom: 5 }}>
                Add your first wallet
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6 }}>
                A bank account, e-wallet, or cash — where your money sits. You can add more later.
              </div>
            </div>

            <Field
              label="Wallet name"
              value={accountName}
              onChange={setAccountName}
              placeholder="e.g. BCA Business, GoPay, Cash Office"
              autoFocus
            />

            {/* Account type */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Type
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[{ k: 'business', l: '💼 Business' }, { k: 'personal', l: '👤 Personal' }].map(({ k, l }) => (
                  <button key={k} onClick={() => setAccountType(k)} style={{
                    flex: 1, padding: '10px 8px', borderRadius: 10, fontFamily: 'inherit', fontSize: 13,
                    border: accountType === k ? '2px solid #2563EB' : '1px solid var(--border-2)',
                    background: accountType === k ? '#EFF6FF' : 'none',
                    color: accountType === k ? '#1D4ED8' : 'var(--text-2)',
                    fontWeight: accountType === k ? 700 : 500, cursor: 'pointer',
                  }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Opening balance + currency side by side */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 4 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
                  Opening balance
                </label>
                <input
                  type="number"
                  value={openBalance}
                  onChange={e => setOpenBalance(e.target.value)}
                  placeholder="0"
                  style={inputSt}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
                  Currency
                </label>
                <select value={currency} onChange={e => setCurrency(e.target.value)} style={{ ...inputSt, cursor: 'pointer' }}>
                  <option value="IDR">IDR</option>
                  <option value="USD">USD</option>
                  <option value="SGD">SGD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </div>
            {currency !== 'IDR' && (
              <div style={{ fontSize: 11, color: '#085041', background: '#E1F5EE', borderRadius: 7, padding: '6px 10px', marginBottom: 12 }}>
                ✓ Wallet will be created in {currency}.
              </div>
            )}

            <div style={{ marginBottom: 14 }} />
            <ErrorBox msg={error} />
            <PrimaryBtn
              onClick={saveAccount}
              loading={saving}
              disabled={!accountName.trim()}
            >
              {accountName.trim() ? 'Add wallet →' : 'Enter a wallet name'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setStep(3)}>Skip — add later</GhostBtn>
          </>
        )}

        {/* ─── STEP 3: DONE ─── */}
        {step === 3 && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 26 }}>
              <div style={{ fontSize: 48, marginBottom: 14 }}>🎉</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', letterSpacing: -0.3, marginBottom: 8 }}>
                You're all set!
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.7 }}>
                Your CFO AI workspace is ready. Start by adding your first transaction or open the Pulse dashboard.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
              {[
                { icon: '✦', title: 'Add a transaction', sub: 'Describe it in plain text — AI does the rest', path: '/add' },
                { icon: '📊', title: 'View Pulse',        sub: 'Your live financial health overview',         path: '/'    },
                { icon: '📋', title: 'Log a debt',        sub: 'Track who owes you or who you owe',           path: '/add' },
              ].map(f => (
                <div key={f.title} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', background: 'var(--bg-3)', borderRadius: 10 }}>
                  <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{f.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 1 }}>{f.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{f.sub}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <PrimaryBtn onClick={complete}>
                Open Pulse →
              </PrimaryBtn>
              <PrimaryBtn
                onClick={() => { markOnboardingCompleted(); navigate('/add') }}
                style={{ background: '#0F172A' }}
              >
                Add transaction
              </PrimaryBtn>
            </div>
          </>
        )}
      </div>

      {/* Step counter below card */}
      {step < 3 && (
        <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-4)' }}>
          You can always re-run setup from Settings.
        </div>
      )}
    </div>
  )
}
