import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from '../hooks/useTranslation'
import { apiFetch } from '../lib/api'

// Telegram test message examples by language
const EXAMPLES = {
  ru: [
    'Клиент ABC должен 10 млн до пятницы',
    'Нужно оплатить поставщику 5 млн завтра',
    'Я оплатил бензин 300k своими деньгами',
    'Поставщик прислал счёт на 3.5 млн, оплатить до 15 июня',
    'PT ABC оплатил 10 млн на BCA',
  ],
  id: [
    'PT ABC belum bayar 10 juta',
    'Bayar supplier 5 juta besok',
    'Saya bayar bensin 300 ribu pakai uang pribadi',
    'Supplier kirim invoice 3,5 juta, jatuh tempo 15 Juni',
    'PT ABC sudah bayar 10 juta ke BCA',
  ],
  en: [
    'Client ABC should pay 10M by Friday',
    'Need to pay supplier 5M tomorrow',
    'I paid fuel 300k with my own money',
    'Supplier sent invoice for 3.5M due June 15',
    'PT ABC paid 10M to BCA',
  ],
}

const TEST_MESSAGES = {
  payable:         { ru: 'TEST: Нужно оплатить поставщику 100,000 IDR завтра', id: 'TEST: Bayar supplier 100,000 IDR besok', en: 'TEST: Need to pay supplier 100,000 IDR tomorrow' },
  receivable:      { ru: 'TEST: Клиент ABC должен оплатить 250,000 IDR до пятницы', id: 'TEST: PT ABC harus bayar 250,000 IDR sebelum Jumat', en: 'TEST: Client ABC should pay 250,000 IDR by Friday' },
  expense_request: { ru: 'TEST: Я оплатил бензин 50,000 IDR своими деньгами', id: 'TEST: Saya bayar bensin 50,000 IDR pakai uang pribadi', en: 'TEST: I paid fuel 50,000 IDR with my own money' },
}

function CopyBtn({ text, t: tr }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 8, border: '1px solid var(--border-2)', background: copied ? 'var(--green-light, #E8F8EE)' : 'var(--surface)', color: copied ? 'var(--green-dark)' : 'var(--text-2)', cursor: 'pointer', flexShrink: 0 }}
    >
      {copied ? tr('onboarding.copied') : tr('onboarding.copyExample')}
    </button>
  )
}

function StepCard({ num, title, done, children }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px', marginBottom: 12, opacity: done ? 0.75 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', background: done ? 'var(--green-dark)' : 'var(--brand)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
          {done ? '✓' : num}
        </div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.55 }}>{children}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MemberTutorial — shown to manager/employee instead of the finance dashboard
// ─────────────────────────────────────────────────────────────────────────────
export function MemberTutorial() {
  const { token } = useAuth()
  const { t, lang } = useTranslation()
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)
  const language = ['ru', 'id'].includes(lang) ? lang : 'en'

  const load = useCallback(() => {
    apiFetch('/team/onboarding/me', token)
      .then(setMe).catch(console.error).finally(() => setLoading(false))
  }, [token])
  useEffect(() => { load() }, [load])

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
      <div style={{ width: 28, height: 28, border: '2.5px solid var(--border-2)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'tx-spin 0.7s linear infinite' }} />
    </div>
  )
  if (!me) return null

  const completed = new Set(me.completed_steps || [])
  const roleKey = me.role === 'manager' ? 'roleManager'
    : me.role === 'employee' ? 'roleEmployee'
    : ['admin', 'cfo'].includes(me.role) ? 'roleAdmin' : 'roleOwner'
  const allDone = (me.required_steps || []).every(s => completed.has(s))

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '8px 4px' }}>
      {/* Welcome */}
      <div style={{ background: 'linear-gradient(135deg, #0E1B3D, #1B2C5C)', color: '#fff', borderRadius: 16, padding: '22px 22px', marginBottom: 18 }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>
          CFO AI · {me.business?.name}
        </div>
        <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 10 }}>
          {t('onboarding.yourRole')}: <b style={{ textTransform: 'capitalize' }}>{me.role}</b>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.6, opacity: 0.9 }}>{t(`onboarding.${roleKey}`)}</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.6, opacity: 0.75, marginTop: 8 }}>{t('onboarding.welcomeBody')}</div>
      </div>

      {allDone && (
        <div style={{ background: 'var(--green-light, #E8F8EE)', border: '1px solid var(--green-dark)', borderRadius: 14, padding: '16px 18px', marginBottom: 16 }}>
          <div style={{ fontWeight: 800, color: 'var(--green-dark)', marginBottom: 4 }}>🎉 {t('onboarding.finishTitle')}</div>
          <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{t('onboarding.finishBody')}</div>
        </div>
      )}

      {/* Step 2 — Connect Telegram */}
      <StepCard num={1} title={t('onboarding.connectTelegram')} done={completed.has('telegram_connected')}>
        {me.bot_username ? (
          <>
            <a
              href={me.deep_link} target="_blank" rel="noreferrer"
              style={{ display: 'inline-block', background: '#2AABEE', color: '#fff', fontWeight: 700, fontSize: 14, padding: '10px 18px', borderRadius: 10, textDecoration: 'none', marginBottom: 10 }}
            >
              ✈ {t('onboarding.openBot')}
            </a>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{t('onboarding.ifButtonFails')}</div>
              {t('onboarding.fallback1')}<br />
              {t('onboarding.fallback2').replace('{bot}', me.bot_username)}<br />
              {t('onboarding.fallback3')}<br />
              {t('onboarding.fallback4')}
            </div>
            {!completed.has('telegram_connected') && (
              <div style={{ fontSize: 12, color: 'var(--amber-dark)', marginTop: 8 }}>⏳ {t('onboarding.waitingTelegram')}</div>
            )}
          </>
        ) : (
          <div style={{ color: 'var(--amber-dark)' }}>{t('onboarding.botNotConfigured')}</div>
        )}
      </StepCard>

      {/* Steps 3–5 — test submissions */}
      {[
        { key: 'test_payable',         type: 'payable',         label: t('onboarding.testPayable') },
        { key: 'test_receivable',      type: 'receivable',      label: t('onboarding.testReceivable') },
        { key: 'test_expense_request', type: 'expense_request', label: t('onboarding.testExpense') },
      ].map((s, i) => (
        <StepCard key={s.key} num={i + 2} title={s.label} done={completed.has(s.key)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)', border: '1px dashed var(--border-2)', borderRadius: 10, padding: '10px 12px' }}>
            <code style={{ fontSize: 12.5, flex: 1, wordBreak: 'break-word' }}>{TEST_MESSAGES[s.type][language]}</code>
            <CopyBtn text={TEST_MESSAGES[s.type][language]} t={t} />
          </div>
          {s.type === 'expense_request' && (
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>{t('onboarding.expenseNote')}</div>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--text-4)', marginTop: 6 }}>🛡 {t('onboarding.trainingNote')}</div>
        </StepCard>
      ))}

      {/* Examples */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px' }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>{t('onboarding.examplesTitle')}</div>
        {EXAMPLES[language].map((ex, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: i < EXAMPLES[language].length - 1 ? '0.5px solid var(--border)' : 'none' }}>
            <span style={{ fontSize: 12.5, color: 'var(--text-2)', flex: 1 }}>{ex}</span>
            <CopyBtn text={ex} t={t} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TeamOnboarding — owner/admin/cfo progress dashboard (default export)
// ─────────────────────────────────────────────────────────────────────────────
const PROGRESS_COLS = [
  { key: 'telegram', label: '✈' },
  { key: 'payable', label: 'P' },
  { key: 'receivable', label: 'R' },
  { key: 'expense_request', label: 'E' },
]

// ── CEO / Owner setup section ────────────────────────────────────────────────
function CeoSetup({ me, botCfg, token, t }) {
  const [testState, setTestState] = useState(null) // null | 'sending' | 'sent' | 'error'
  if (!me) return null
  const connected = me.telegram_connected
  const botReady = botCfg?.is_configured

  const sendTest = async () => {
    setTestState('sending')
    try { await apiFetch('/team/onboarding/test-ceo-notification', token, { method: 'POST' }); setTestState('sent') }
    catch { setTestState('error') }
  }

  const FEATURES = ['featDailyPulse', 'featApprovals', 'featCashAlerts', 'featOverdueRecv', 'featDueSoon', 'featPayroll', 'featAiCfo']

  return (
    <div style={{ background: 'linear-gradient(135deg, #0E1B3D, #1B2C5C)', color: '#fff', borderRadius: 16, padding: '20px 22px', marginBottom: 20 }}>
      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>👔 {t('onboarding.ceoSetup')}</div>
      <div style={{ fontSize: 13, lineHeight: 1.6, opacity: 0.88, marginBottom: 14 }}>{t('onboarding.ceoIntro')}</div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {FEATURES.map(f => (
          <span key={f} style={{ fontSize: 12, background: 'rgba(255,255,255,.1)', borderRadius: 8, padding: '5px 10px' }}>{t(`onboarding.${f}`)}</span>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {connected ? (
          <span style={{ fontSize: 13, fontWeight: 700, color: '#7BE5A9' }}>✓ {t('onboarding.ceoConnected')}</span>
        ) : botReady && me.deep_link ? (
          <a href={me.deep_link} target="_blank" rel="noreferrer"
            style={{ background: '#2AABEE', color: '#fff', fontWeight: 700, fontSize: 14, padding: '10px 18px', borderRadius: 10, textDecoration: 'none' }}>
            ✈ {t('onboarding.connectCeo')}
          </a>
        ) : (
          <span style={{ fontSize: 13, color: '#FFD27A' }}>⚠ {t('onboarding.botNotConfigured')}</span>
        )}

        <button onClick={sendTest}
          disabled={!connected || !botReady || testState === 'sending'}
          title={!connected || !botReady ? t('onboarding.botNotReady') : ''}
          style={{ fontSize: 13, fontWeight: 700, padding: '9px 16px', borderRadius: 10, border: 'none', cursor: connected && botReady ? 'pointer' : 'not-allowed', background: connected && botReady ? 'rgba(255,255,255,.15)' : 'rgba(255,255,255,.06)', color: connected && botReady ? '#fff' : 'rgba(255,255,255,.4)' }}>
          {testState === 'sent' ? `✓ ${t('onboarding.testSent')}` : t('onboarding.sendTestCeo')}
        </button>
      </div>
      {testState === 'error' && <div style={{ fontSize: 12, color: '#FFB4A8', marginTop: 8 }}>{t('onboarding.botNotReady')}</div>}
    </div>
  )
}

export default function TeamOnboarding() {
  const { token } = useAuth()
  const { t } = useTranslation()
  const [members, setMembers] = useState([])
  const [botCfg, setBotCfg] = useState(null)
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)

  const load = useCallback(() => {
    Promise.all([
      apiFetch('/team/onboarding', token),
      apiFetch('/telegram/config', token),
      apiFetch('/team/onboarding/me', token).catch(() => null),
    ]).then(([m, c, meData]) => { setMembers(m.members || []); setBotCfg(c); setMe(meData) })
      .catch(console.error).finally(() => setLoading(false))
  }, [token])
  useEffect(() => { load() }, [load])

  const resetMember = async (memberId) => {
    setBusy(memberId)
    try { await apiFetch(`/team/onboarding/${memberId}/reset`, token, { method: 'POST' }); load() }
    catch (e) { alert(e.message) } finally { setBusy(null) }
  }

  const copyInstruction = (m) => {
    const link = botCfg?.bot_username ? `https://t.me/${botCfg.bot_username}` : '(bot link)'
    navigator.clipboard?.writeText(
      `CFO AI · ${t('onboarding.connectTelegram')}\n1. ${link}\n2. Start\n3. ${t('onboarding.testPayable')} / ${t('onboarding.testReceivable')} / ${t('onboarding.testExpense')}`
    )
  }

  const statusLabel = (s) =>
    s === 'completed' ? t('onboarding.completed')
    : s === 'in_progress' ? t('onboarding.inProgress')
    : t('onboarding.notStarted')

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
      <div style={{ width: 28, height: 28, border: '2.5px solid var(--border-2)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'tx-spin 0.7s linear infinite' }} />
    </div>
  )

  const ready = members.filter(m => m.onboarding_status === 'completed').length
  const connected = members.filter(m => m.telegram_connected_at).length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: 'var(--text-2xl, 22px)', fontWeight: 800, margin: 0 }}>{t('onboarding.title')}</h1>
        <Link to="/team" style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand)' }}>← {t('nav.team')}</Link>
      </div>

      {botCfg && !botCfg.is_configured && (
        <div style={{ background: '#FFF6E5', border: '1px solid var(--amber-dark)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: 'var(--amber-dark)', fontWeight: 600 }}>
          ⚠ {t('onboarding.botNotConfigured')} (TELEGRAM_BOT_USERNAME)
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 18 }}>
        {[
          { label: t('nav.team'), value: members.length },
          { label: t('onboarding.telegramConnected'), value: connected },
          { label: t('onboarding.ready'), value: ready },
        ].map((c, i) => (
          <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{c.value}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* CEO / Owner setup */}
      <CeoSetup me={me} botCfg={botCfg} token={token} t={t} />

      {/* Member list */}
      <div style={{ fontSize: 14, fontWeight: 700, margin: '4px 0 10px', color: 'var(--text-2)' }}>{t('onboarding.teamMembers')}</div>
      {members.map(m => (
        <div key={m.member_id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{m.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'capitalize' }}>
                {m.role} · {statusLabel(m.onboarding_status)}
                {m.last_onboarding_event_at && ` · ${t('onboarding.lastEvent')}: ${new Date(m.last_onboarding_event_at).toLocaleDateString()}`}
              </div>
            </div>

            {/* Progress dots */}
            <div style={{ display: 'flex', gap: 6 }}>
              {PROGRESS_COLS.map(c => {
                const done = c.key === 'telegram' ? !!m.telegram_connected_at : m.tests?.[c.key]
                return (
                  <div key={c.key} title={c.key} style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, background: done ? 'var(--green-dark)' : 'var(--border)', color: done ? '#fff' : 'var(--text-4)' }}>
                    {done ? '✓' : c.label}
                  </div>
                )
              })}
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => copyInstruction(m)} style={{ fontSize: 12, fontWeight: 600, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text-2)', cursor: 'pointer' }}>
                {t('onboarding.copyInstruction')}
              </button>
              <button disabled title={t('onboarding.reminderTodo')} style={{ fontSize: 12, fontWeight: 600, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-4)', cursor: 'not-allowed' }}>
                {t('onboarding.sendReminder')}
              </button>
              <button onClick={() => resetMember(m.member_id)} disabled={busy === m.member_id} style={{ fontSize: 12, fontWeight: 600, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--red-dark)', cursor: 'pointer' }}>
                {t('onboarding.resetTutorial')}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
