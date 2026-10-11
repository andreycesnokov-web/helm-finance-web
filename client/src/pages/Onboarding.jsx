/**
 * CFO AI — Onboarding V2
 *
 * 5-step flow:
 *   0. Welcome        — product intro, Start setup / Skip
 *   1. Trial Welcome  — 7-day full trial explained, trial info from /api/access/status
 *   2. Business Setup — name, base_currency, timezone, country → PATCH /api/business/current
 *   3. First Wallet   — name, currency, type, opening balance  → POST /api/wallets
 *   4. Ready          — action cards, Go to Pulse / Add transaction
 *
 * Detection logic (shouldShowOnboarding):
 *   Show if: no accounts + no significant data on server
 *            AND not skipped/completed via localStorage flags
 *
 * localStorage keys:
 *   cfo_onboarding_skipped — user explicitly skipped
 *   cfo_onboarded          — user completed setup
 *
 * Backward compat: existing users with data are never forced into onboarding.
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch } from '../lib/api'

// ── localStorage helpers (exported for App.jsx) ───────────────────────────────
export function markOnboardingSkipped()   { localStorage.setItem('cfo_onboarding_skipped', '1') }
export function markOnboardingCompleted() { localStorage.setItem('cfo_onboarded', '1') }
export function clearOnboardingFlags()    {
  localStorage.removeItem('cfo_onboarding_skipped')
  localStorage.removeItem('cfo_onboarded')
}

/**
 * shouldShowOnboarding — pure function, call with pulse API response.
 * Returns true only for genuinely new users with no data.
 */
export function shouldShowOnboarding(pulseData) {
  if (localStorage.getItem('cfo_onboarding_skipped')) return false
  if (localStorage.getItem('cfo_onboarded'))          return false
  const hasAccounts = (pulseData?.accounts || []).length > 0
  const hasTxs      = (pulseData?.income > 0) || (pulseData?.expenses > 0) ||
                      (pulseData?.totalBalance != null && pulseData?.totalBalance !== 0)
  const hasDebts    = (pulseData?.debts || []).filter(d => !d.is_settled).length > 0
  if (hasAccounts || hasTxs || hasDebts) return false
  return true
}

// ── Constants ─────────────────────────────────────────────────────────────────
const STEPS       = ['welcome', 'trial', 'business', 'wallet', 'done']
const STEP_LABELS = ['Welcome', 'Trial', 'Business', 'Wallet', 'Done']

const CURRENCIES = [
  { value: 'IDR', label: 'IDR — Indonesian Rupiah' },
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'SGD', label: 'SGD — Singapore Dollar' },
  { value: 'MYR', label: 'MYR — Malaysian Ringgit' },
  { value: 'THB', label: 'THB — Thai Baht' },
  { value: 'CNY', label: 'CNY — Chinese Yuan' },
]

const TIMEZONES = [
  { value: 'Asia/Makassar',    label: 'Bali / Makassar (WITA UTC+8)' },
  { value: 'Asia/Jakarta',     label: 'Jakarta (WIB UTC+7)' },
  { value: 'Asia/Jayapura',    label: 'Papua (WIT UTC+9)' },
  { value: 'Asia/Singapore',   label: 'Singapore (SGT UTC+8)' },
  { value: 'Asia/Bangkok',     label: 'Bangkok / Ho Chi Minh (ICT UTC+7)' },
  { value: 'Asia/Kuala_Lumpur',label: 'Kuala Lumpur (MYT UTC+8)' },
  { value: 'Asia/Shanghai',    label: 'Beijing / Shanghai (CST UTC+8)' },
  { value: 'Asia/Dubai',       label: 'Dubai (GST UTC+4)' },
  { value: 'Europe/Moscow',    label: 'Moscow (MSK UTC+3)' },
  { value: 'Europe/London',    label: 'London (GMT UTC+0)' },
  { value: 'America/New_York', label: 'New York (EST UTC-5)' },
  { value: 'UTC',              label: 'UTC' },
]

const WALLET_TYPES = [
  { value: 'bank',            label: '🏦 Bank account' },
  { value: 'cash',            label: '💵 Cash' },
  { value: 'ewallet',         label: '📱 E-Wallet' },
  { value: 'alipay',          label: '🔵 Alipay' },
  { value: 'wechat_pay',      label: '💬 WeChat Pay' },
  { value: 'crypto',          label: '₿  Crypto wallet' },
  { value: 'payment_gateway', label: '⚡ Payment gateway' },
  { value: 'other',           label: '🗂  Other' },
]

// ── Shared UI helpers ─────────────────────────────────────────────────────────
const inputSt = {
  width: '100%', padding: '12px 14px', borderRadius: 11,
  border: '1px solid var(--border-2)', fontSize: 14,
  background: 'var(--bg-2)', color: 'var(--text)',
  boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none', minHeight: 44,
}

function Field({ label, value, onChange, placeholder, type = 'text', hint, autoFocus, required }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
        {label}{required && <span style={{ color: '#EF4444', marginLeft: 3 }}>*</span>}
      </label>
      <input autoFocus={autoFocus} type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} style={inputSt} />
      {hint && <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 4, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  )
}

function SelectField({ label, value, onChange, options, hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
        {label}
      </label>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ ...inputSt, cursor: 'pointer' }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 4, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  )
}

function PrimaryBtn({ children, onClick, disabled, loading, style: extra }) {
  return (
    <button onClick={onClick} disabled={disabled || loading} style={{
      width: '100%', padding: '14px', borderRadius: 12, border: 'none',
      background: disabled || loading ? 'var(--bg-3)' : 'linear-gradient(135deg, #1D4ED8, #2563EB)',
      color: disabled || loading ? 'var(--text-4)' : '#fff',
      fontSize: 14, fontWeight: 700,
      cursor: disabled || loading ? 'not-allowed' : 'pointer',
      fontFamily: 'inherit', transition: 'all 0.15s',
      boxShadow: disabled || loading ? 'none' : '0 4px 14px rgba(37,99,235,0.35)',
      ...extra,
    }}>
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

// ── Step bar ──────────────────────────────────────────────────────────────────
function StepBar({ current }) {
  const total = STEPS.length
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginBottom: 7 }}>
        {STEPS.map((_, i) => (
          <div key={i} style={{
            height: 3, borderRadius: 3, transition: 'all 0.25s',
            width: i === current ? 32 : 12,
            background: i < current ? '#2563EB' : i === current ? '#2563EB' : 'var(--border-2)',
            opacity: i < current ? 0.35 : 1,
          }} />
        ))}
      </div>
      <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-4)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {current < total - 1 ? `Step ${current + 1} of ${total - 1}` : 'Complete'} · {STEP_LABELS[current]}
      </div>
    </div>
  )
}

// ── Logo mark (official CFO AI wordmark) ──────────────────────────────────────
function LogoMark() {
  return (
    <div style={{ marginBottom: 32 }}>
      <img src="/brand/logo_main_navy_transparent_2400.png" alt="CFO AI — Financial OS"
        style={{ height: 40, width: 'auto', maxWidth: '70vw', objectFit: 'contain', display: 'block' }} />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Onboarding({ onSkip, onComplete }) {
  const { token, user } = useAuth()
  const navigate        = useNavigate()

  const [step,   setStep]   = useState(0)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  // Trial info — loaded from /api/access/status
  const [access,      setAccess]      = useState(null)
  const [accessLoaded,setAccessLoaded]= useState(false)

  // Step 2 — Business setup
  const [bizName,     setBizName]     = useState('')
  const [bizCurrency, setBizCurrency] = useState('IDR')
  const [bizTimezone, setBizTimezone] = useState('Asia/Makassar')
  const [bizCountry,  setBizCountry]  = useState('Indonesia')

  // Step 3 — Wallet
  const [walletName, setWalletName] = useState('')
  const [walletType, setWalletType] = useState('bank')
  const [walletCur,  setWalletCur]  = useState('IDR')
  const [openBal,    setOpenBal]    = useState('')
  const [entityName, setEntityName] = useState('')
  const [hasWallets, setHasWallets] = useState(false)

  // ── Load access status on mount ──────────────────────────────────────────
  useEffect(() => {
    if (!token) return
    apiFetch('/access/status', token)
      .then(data => {
        setAccess(data)
        // Pre-fill business fields from existing data
        if (data?.business?.name && data.business.name !== `${user?.firstName || 'My'} Business`) {
          setBizName(data.business.name)
        }
        if (data?.business?.base_currency) setBizCurrency(data.business.base_currency)
        if (data?.business?.timezone)      setBizTimezone(data.business.timezone)
        if (data?.business?.country)       setBizCountry(data.business.country)
        if (data?.usage?.wallets_count > 0) setHasWallets(true)
      })
      .catch(() => {}) // graceful — trial info optional
      .finally(() => setAccessLoaded(true))
  }, [token])

  // ── Helpers ───────────────────────────────────────────────────────────────
  const skip = () => { markOnboardingSkipped(); if (onSkip) onSkip() }
  const complete = (path) => {
    markOnboardingCompleted()
    if (onComplete) onComplete()
    if (path) navigate(path, { replace: true })
  }

  // ── Step 2: Save business ─────────────────────────────────────────────────
  const saveBusiness = async () => {
    setSaving(true); setError('')
    try {
      await apiFetch('/business/current', token, {
        method: 'PATCH',
        body: {
          name:          bizName.trim() || undefined,
          base_currency: bizCurrency,
          timezone:      bizTimezone,
          country:       bizCountry.trim() || undefined,
        },
      })
      setStep(3)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Step 3: Save wallet ───────────────────────────────────────────────────
  const saveWallet = async () => {
    if (!walletName.trim()) { setStep(4); return }
    setSaving(true); setError('')
    try {
      await apiFetch('/wallets', token, {
        method: 'POST',
        body: {
          name:            walletName.trim(),
          currency:        walletCur,
          type:            walletType,
          entity_name:     entityName.trim() || undefined,
          opening_balance: Number(openBal) || 0,
        },
      })
      setStep(4)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // Trial helpers
  const isTrialActive  = access?.plan?.is_trial_active  ?? false
  const daysLeft       = access?.plan?.days_left_in_trial ?? 7
  const trialEndsAt    = access?.plan?.trial_ends_at
  const effectivePlan  = access?.plan?.effective_plan ?? 'founder'
  const trialEndLabel  = trialEndsAt
    ? new Date(trialEndsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  // ── Shell ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', background: 'var(--bg)' }}>

      <LogoMark />

      <div style={{ background: 'var(--bg-2)', borderRadius: 20, padding: '28px 24px', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(15,23,42,0.08)', width: '100%', maxWidth: 460 }}>

        <StepBar current={step} />

        {/* ───────── STEP 0: WELCOME ───────── */}
        {step === 0 && (
          <>
            <div style={{ background: 'linear-gradient(135deg, #0F172A 0%, #1e293b 100%)', borderRadius: 16, padding: '28px 22px', marginBottom: 22, textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, opacity: 0.04, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 24px, #fff 24px, #fff 25px)', pointerEvents: 'none' }} />
              <div style={{ position: 'relative' }}>
                <div style={{ fontSize: 40, marginBottom: 14 }}>✦</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: -0.5, marginBottom: 10 }}>
                  Welcome to CFO AI
                </div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7 }}>
                  Your AI financial operating system for cash, debts,<br />payroll, runway and decisions.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
              {[
                { icon: '📊', title: 'Pulse dashboard',      sub: 'Real-time cash position and runway' },
                { icon: '💳', title: 'Smart transactions',   sub: 'Add in plain language — AI parses it' },
                { icon: '📋', title: 'Debts & receivables',  sub: 'Track who owes what and when' },
                { icon: '🤖', title: 'AI CFO insights',      sub: 'Financial analysis and recommendations' },
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

        {/* ───────── STEP 1: TRIAL WELCOME ───────── */}
        {step === 1 && (
          <>
            {/* Trial hero card */}
            <div style={{ background: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)', borderRadius: 16, padding: '22px 20px', marginBottom: 20, border: '1px solid #FCD34D' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: 14, background: '#F59E0B', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#78350F', letterSpacing: -0.3 }}>
                    Your 7-day full trial has started
                  </div>
                  <div style={{ fontSize: 12, color: '#92400E', marginTop: 2 }}>
                    {accessLoaded && isTrialActive
                      ? `${daysLeft} days left · ends ${trialEndLabel}`
                      : 'Full access for 7 days from today'}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 13, color: '#78350F', lineHeight: 1.6 }}>
                You have full access to all current CFO AI features during your trial. After 7 days, your account automatically moves to Free Plan unless you upgrade.
                <strong> Your data will always stay safe.</strong>
              </div>
            </div>

            {/* Feature cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 20 }}>
              {[
                { icon: '🚀', title: 'Full access', sub: 'All features' },
                { icon: '💳', title: 'No card', sub: 'Required' },
                { icon: '🔒', title: 'Free Plan', sub: 'After trial' },
              ].map(c => (
                <div key={c.title} style={{ background: 'var(--bg-3)', borderRadius: 12, padding: '14px 10px', textAlign: 'center', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 20, marginBottom: 6 }}>{c.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{c.title}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{c.sub}</div>
                </div>
              ))}
            </div>

            {/* Effective plan badge */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#E1F5EE', borderRadius: 10, marginBottom: 20, border: '1px solid #A7F3D0' }}>
              <span style={{ fontSize: 13, color: '#085041', fontWeight: 600 }}>Effective access during trial</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#085041', background: '#A7F3D0', padding: '3px 10px', borderRadius: 20 }}>
                {effectivePlan.charAt(0).toUpperCase() + effectivePlan.slice(1)} Plan
              </span>
            </div>

            <PrimaryBtn onClick={() => setStep(2)}>Continue →</PrimaryBtn>
          </>
        )}

        {/* ───────── STEP 2: BUSINESS SETUP ───────── */}
        {step === 2 && (
          <>
            <div style={{ marginBottom: 22, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🏢</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', letterSpacing: -0.3, marginBottom: 6 }}>Business setup</div>
              <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6 }}>
                Tell us about your business. This helps personalise your financial workspace.
              </div>
            </div>

            <Field
              label="Business name"
              value={bizName}
              onChange={setBizName}
              placeholder="e.g. Bali Spa, Freelance Studio, PT Maju"
              hint="Shown in the sidebar and reports."
              autoFocus
            />

            <SelectField
              label="Base currency"
              value={bizCurrency}
              onChange={setBizCurrency}
              options={CURRENCIES}
              hint="Used for totals and reporting."
            />

            <SelectField
              label="Timezone"
              value={bizTimezone}
              onChange={setBizTimezone}
              options={TIMEZONES}
            />

            <Field
              label="Country"
              value={bizCountry}
              onChange={setBizCountry}
              placeholder="e.g. Indonesia"
            />

            <ErrorBox msg={error} />
            <PrimaryBtn onClick={saveBusiness} loading={saving} disabled={saving}>
              Save & continue →
            </PrimaryBtn>
            <GhostBtn onClick={() => setStep(3)}>Skip for now</GhostBtn>
          </>
        )}

        {/* ───────── STEP 3: FIRST WALLET ───────── */}
        {step === 3 && (
          <>
            <div style={{ marginBottom: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🏦</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', letterSpacing: -0.3, marginBottom: 6 }}>
                Add your first wallet
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6 }}>
                A bank account, e-wallet, or cash account — where your money sits.
              </div>
            </div>

            {hasWallets ? (
              <div style={{ background: '#E1F5EE', border: '1px solid #A7F3D0', borderRadius: 12, padding: '14px 16px', marginBottom: 18, textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#085041', marginBottom: 4 }}>✓ You already have wallets</div>
                <div style={{ fontSize: 12, color: '#047857' }}>You can manage them in Accounts. Skip this step.</div>
              </div>
            ) : (
              <>
                <Field
                  label="Wallet name"
                  value={walletName}
                  onChange={setWalletName}
                  placeholder="e.g. BCA Business, GoPay, Cash Office"
                  autoFocus
                />

                <SelectField
                  label="Type"
                  value={walletType}
                  onChange={setWalletType}
                  options={WALLET_TYPES}
                />

                <SelectField
                  label="Currency"
                  value={walletCur}
                  onChange={setWalletCur}
                  options={CURRENCIES}
                />

                <Field
                  label="Company / Entity name"
                  value={entityName}
                  onChange={setEntityName}
                  placeholder="e.g. PT Maju Bersama (optional)"
                  hint="Optional. Useful for multi-entity setups."
                />

                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
                    Opening balance <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span>
                  </label>
                  <input
                    type="number"
                    value={openBal}
                    onChange={e => setOpenBal(e.target.value)}
                    placeholder="0"
                    style={inputSt}
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 4 }}>
                    Current real balance to set the starting point.
                  </div>
                </div>
              </>
            )}

            <ErrorBox msg={error} />
            {hasWallets ? (
              <PrimaryBtn onClick={() => setStep(4)}>Continue →</PrimaryBtn>
            ) : (
              <>
                <PrimaryBtn onClick={saveWallet} loading={saving} disabled={saving || !walletName.trim()}>
                  {walletName.trim() ? 'Add wallet & continue →' : 'Enter wallet name'}
                </PrimaryBtn>
                <GhostBtn onClick={() => setStep(4)}>Skip — add later in Accounts</GhostBtn>
              </>
            )}
          </>
        )}

        {/* ───────── STEP 4: READY ───────── */}
        {step === 4 && (
          <>
            {/* Success hero */}
            <div style={{ background: 'linear-gradient(135deg, #0F172A 0%, #1e293b 100%)', borderRadius: 16, padding: '28px 20px', marginBottom: 22, textAlign: 'center' }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>🎉</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: -0.5, marginBottom: 8 }}>
                You're ready!
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', lineHeight: 1.7 }}>
                Your CFO AI workspace is set up. Here's what to do next.
              </div>
            </div>

            {/* Next steps */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
              {[
                { icon: '📊', title: 'Open Pulse',           sub: 'Your live financial health overview',     path: '/' },
                { icon: '✦',  title: 'Add a transaction',    sub: 'Describe it — AI fills in the details',   path: '/add' },
                { icon: '📋', title: 'Log a debt',           sub: 'Track receivables and payables',          path: '/receivables' },
                { icon: '🤖', title: 'Ask AI CFO',           sub: 'Get instant financial analysis',          path: '/cfo' },
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
              <PrimaryBtn onClick={() => complete('/')}>
                Open Pulse →
              </PrimaryBtn>
              <PrimaryBtn
                onClick={() => complete('/add')}
                style={{ background: 'linear-gradient(135deg, #0F172A, #1e293b)', boxShadow: 'none' }}
              >
                Add transaction
              </PrimaryBtn>
            </div>
          </>
        )}

      </div>

      {step < 4 && (
        <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-4)', textAlign: 'center' }}>
          You can always re-run setup from Settings.
        </div>
      )}
    </div>
  )
}
