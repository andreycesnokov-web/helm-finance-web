/**
 * Onboarding wizard — shown once to new users with no accounts/transactions.
 * 3 steps: Name → First Account → Done
 *
 * Completion stored in localStorage('cfo_onboarded') so it never shows again.
 * User can skip at any step → goes straight to Pulse.
 */
import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { apiFetch } from '../lib/api'

const STEPS = ['profile', 'account', 'done']

// ── Tiny step indicator ───────────────────────────────────────────────────────
function StepDots({ current }) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 32 }}>
      {STEPS.map((s, i) => (
        <div
          key={s}
          style={{
            width: i === current ? 20 : 7,
            height: 7,
            borderRadius: 4,
            background: i === current
              ? '#2563EB'
              : i < current ? 'rgba(37,99,235,0.35)' : 'var(--border-2)',
            transition: 'all 0.25s',
          }}
        />
      ))}
    </div>
  )
}

// ── Input helpers ─────────────────────────────────────────────────────────────
const inputSt = {
  width: '100%', padding: '13px 14px', borderRadius: 12,
  border: '1px solid var(--border-2)', fontSize: 15,
  background: 'var(--bg-2)', color: 'var(--text)',
  boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none',
}

function Field({ label, value, onChange, placeholder, type = 'text', hint }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputSt}
      />
      {hint && <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 5, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  )
}

// ── Primary / Ghost buttons ───────────────────────────────────────────────────
function PrimaryBtn({ children, onClick, disabled, loading }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        width: '100%', padding: '14px', borderRadius: 14, border: 'none',
        background: disabled || loading ? 'var(--bg-3)' : '#2563EB',
        color: disabled || loading ? 'var(--text-4)' : '#fff',
        fontSize: 15, fontWeight: 700, cursor: disabled || loading ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', transition: 'background 0.15s',
      }}
    >
      {loading ? 'Saving…' : children}
    </button>
  )
}

function GhostBtn({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '12px', borderRadius: 14,
        border: '1px solid var(--border-2)', background: 'none',
        color: 'var(--text-3)', fontSize: 14, fontWeight: 500,
        cursor: 'pointer', fontFamily: 'inherit', marginTop: 8,
      }}
    >
      {children}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Onboarding({ onComplete }) {
  const { token, user } = useAuth()

  const [step,    setStep]    = useState(0)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  // Step 0 — profile
  const [firstName,    setFirstName]    = useState(user?.firstName || user?.first_name || '')
  const [businessName, setBusinessName] = useState('')

  // Step 1 — account
  const [accountName, setAccountName]     = useState('')
  const [accountType, setAccountType]     = useState('business')
  const [openBalance, setOpenBalance]     = useState('')

  // ── Finish / skip ─────────────────────────────────────────────────────────
  const finish = () => {
    localStorage.setItem('cfo_onboarded', '1')
    onComplete()
  }

  // ── Step 0 save ───────────────────────────────────────────────────────────
  const saveProfile = async () => {
    setSaving(true)
    setError('')
    try {
      const body = {}
      if (firstName.trim())    body.first_name = firstName.trim()
      if (businessName.trim()) body.last_name  = businessName.trim() // stored in last_name as business name
      if (Object.keys(body).length > 0) {
        await apiFetch('/profile', token, { method: 'POST', body })
      }
      setStep(1)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Step 1 save ───────────────────────────────────────────────────────────
  const saveAccount = async () => {
    if (!accountName.trim()) { setStep(2); return }
    setSaving(true)
    setError('')
    try {
      await apiFetch('/accounts', token, {
        method: 'POST',
        body: {
          name:    accountName.trim(),
          type:    accountType,
          balance: Number(openBalance) || 0,
        },
      })
      setStep(2)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Layout shell ──────────────────────────────────────────────────────────
  const cardStyle = {
    background: 'var(--bg-2)',
    borderRadius: 20,
    padding: '32px 28px',
    border: '1px solid var(--border)',
    boxShadow: '0 8px 32px rgba(15,23,42,0.08)',
    width: '100%',
    maxWidth: 440,
  }

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      background: 'var(--bg)',
    }}>

      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 36 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 11,
          background: 'linear-gradient(135deg, #1D4ED8, #2563EB)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <rect x="2"  y="14" width="4"  height="7" rx="1" fill="rgba(255,255,255,0.55)"/>
            <rect x="8"  y="9"  width="4"  height="12" rx="1" fill="rgba(255,255,255,0.80)"/>
            <rect x="14" y="5"  width="4"  height="16" rx="1" fill="#fff"/>
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', letterSpacing: -0.3 }}>CFO AI</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500 }}>Financial OS</div>
        </div>
      </div>

      <div style={cardStyle}>
        <StepDots current={step} />

        {/* ── STEP 0: Profile ── */}
        {step === 0 && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <div style={{ fontSize: 24, marginBottom: 10 }}>👋</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', letterSpacing: -0.3, marginBottom: 6 }}>
                Welcome to CFO AI
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.6 }}>
                Let's set up your financial workspace. Takes less than a minute.
              </div>
            </div>

            <Field
              label="Your name"
              value={firstName}
              onChange={setFirstName}
              placeholder="e.g. Alex"
              hint="This is how we'll address you in the app."
            />
            <Field
              label="Business or project name (optional)"
              value={businessName}
              onChange={setBusinessName}
              placeholder="e.g. Bali Spa, Freelance Studio"
              hint="Shown in the sidebar and reports. You can change this later."
            />

            {error && <div style={{ fontSize: 13, color: '#991B1B', marginBottom: 12, background: '#FEE2E2', borderRadius: 8, padding: '8px 12px' }}>{error}</div>}

            <PrimaryBtn onClick={saveProfile} loading={saving}>
              Continue →
            </PrimaryBtn>
            <GhostBtn onClick={finish}>Skip setup</GhostBtn>
          </>
        )}

        {/* ── STEP 1: First Account ── */}
        {step === 1 && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <div style={{ fontSize: 24, marginBottom: 10 }}>💳</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', letterSpacing: -0.3, marginBottom: 6 }}>
                Add your first account
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.6 }}>
                This is where your money sits — a bank account, e-wallet, or cash. You can add more later.
              </div>
            </div>

            <Field
              label="Account name"
              value={accountName}
              onChange={setAccountName}
              placeholder="e.g. BCA Business, GoPay, Cash"
            />

            {/* Account type toggle */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Account type
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[{ k: 'business', label: '💼 Business' }, { k: 'personal', label: '👤 Personal' }].map(({ k, label }) => (
                  <button key={k} onClick={() => setAccountType(k)} style={{
                    flex: 1, padding: '11px', borderRadius: 10, fontFamily: 'inherit',
                    border: accountType === k ? '2px solid #2563EB' : '1px solid var(--border-2)',
                    background: accountType === k ? '#EFF6FF' : 'none',
                    color: accountType === k ? '#1D4ED8' : 'var(--text-2)',
                    fontWeight: accountType === k ? 700 : 500,
                    fontSize: 14, cursor: 'pointer', transition: 'all 0.12s',
                  }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <Field
              label="Opening balance (IDR)"
              value={openBalance}
              onChange={setOpenBalance}
              type="number"
              placeholder="0"
              hint="Current balance in this account. Enter 0 if starting fresh."
            />

            {error && <div style={{ fontSize: 13, color: '#991B1B', marginBottom: 12, background: '#FEE2E2', borderRadius: 8, padding: '8px 12px' }}>{error}</div>}

            <PrimaryBtn onClick={saveAccount} loading={saving} disabled={!accountName.trim()}>
              {accountName.trim() ? 'Add account →' : 'Enter account name'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setStep(2)}>Skip for now</GhostBtn>
          </>
        )}

        {/* ── STEP 2: Done ── */}
        {step === 2 && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <div style={{ fontSize: 52, marginBottom: 14 }}>🎉</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', letterSpacing: -0.3, marginBottom: 10 }}>
                You're all set!
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.7 }}>
                Your CFO AI workspace is ready. Start by adding transactions, logging debts, or letting the AI analyse your finances.
              </div>
            </div>

            {/* Feature hints */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
              {[
                { icon: '✦', label: 'Add transactions via AI', desc: 'Just describe in plain language' },
                { icon: '📋', label: 'Track receivables & payables', desc: 'Know exactly who owes what' },
                { icon: '📊', label: 'Pulse dashboard', desc: 'Your financial health at a glance' },
              ].map(f => (
                <div key={f.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', background: 'var(--bg-3)', borderRadius: 12 }}>
                  <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{f.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{f.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <PrimaryBtn onClick={finish}>
              Go to Dashboard →
            </PrimaryBtn>
          </>
        )}
      </div>

      {/* Step label */}
      <div style={{ marginTop: 20, fontSize: 12, color: 'var(--text-4)' }}>
        {step === 0 ? 'Step 1 of 2 — Profile' : step === 1 ? 'Step 2 of 2 — Account' : 'All done!'}
      </div>
    </div>
  )
}
