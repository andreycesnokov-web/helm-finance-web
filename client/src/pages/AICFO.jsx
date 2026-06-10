import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useAccess } from '../hooks/useAccess'
import { apiFetch, fmt, fmtFull } from '../lib/api'

// ── Suggested questions ───────────────────────────────────────────────────────
const SUGGESTED = [
  { icon: '💰', text: 'How much cash do I have?' },
  { icon: '⏰', text: 'What payables are urgent?' },
  { icon: '📥', text: 'Who owes me money?' },
  { icon: '📉', text: 'What is my cash runway?' },
  { icon: '⚠️', text: 'What is my biggest cash risk?' },
  { icon: '👤', text: 'Can I hire someone?' },
  { icon: '📋', text: 'What should I do today?' },
  { icon: '📊', text: 'How are expenses trending this month?' },
]

// ── Severity config ───────────────────────────────────────────────────────────
const SEV_CFG = {
  critical: { bg: 'var(--red-light)',   border: 'rgba(220,38,38,.18)',  dot: 'var(--red-dark)',   text: 'var(--red-dark)',   label: 'Critical' },
  high:     { bg: 'var(--red-light)',   border: 'rgba(220,38,38,.12)',  dot: '#F87171',           text: 'var(--red-dark)',   label: 'High' },
  medium:   { bg: 'var(--amber-light)', border: 'rgba(217,119,6,.18)', dot: 'var(--amber-dark)', text: 'var(--amber-dark)', label: 'Medium' },
  low:      { bg: 'var(--green-light)', border: 'rgba(6,95,70,.15)',   dot: 'var(--green-dark)', text: 'var(--green-dark)', label: 'Low' },
}

// ── Markdown-lite renderer (bold + line breaks) ───────────────────────────────
function MarkdownText({ text }) {
  if (!text) return null
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <span style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>
        }
        return <span key={i}>{part}</span>
      })}
    </span>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────
function Spin({ size = 20 }) {
  return (
    <div style={{ width: size, height: size, border: `2px solid var(--border-2)`, borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'tx-spin 0.7s linear infinite', flexShrink: 0 }} />
  )
}

// ── Chat message bubble ───────────────────────────────────────────────────────
function Bubble({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div style={{
      display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 12, gap: 8, alignItems: 'flex-end',
    }}>
      {!isUser && (
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #1D4ED8, #2563EB)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
          ✦
        </div>
      )}
      <div style={{
        maxWidth: '80%', padding: '10px 14px', borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        background: isUser ? 'linear-gradient(135deg, #1D4ED8, #2563EB)' : 'var(--bg-2)',
        color: isUser ? '#fff' : 'var(--text)',
        border: isUser ? 'none' : '0.5px solid var(--border)',
        fontSize: 13, lineHeight: 1.6,
      }}>
        {isUser ? msg.content : <MarkdownText text={msg.content} />}
      </div>
    </div>
  )
}

// ── Context card ──────────────────────────────────────────────────────────────
function CtxCard({ label, value, sub, color, onClick }) {
  return (
    <div className="hf-card" style={{ cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      <div className="hf-kpi-label">{label}</div>
      <div className="hf-kpi-value" style={{ color: color || 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', marginTop: 4 }}>{sub}</div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AICFO() {
  const { token }  = useAuth()
  const navigate   = useNavigate()
  const { access, planLabel, isTrialActive, effectivePlan } = useAccess()

  const [ctx,      setCtx]      = useState(null)
  const [ctxLoad,  setCtxLoad]  = useState(true)
  const [ctxErr,   setCtxErr]   = useState('')
  const [messages, setMessages] = useState([])   // { role: 'user'|'assistant', content }
  const [input,    setInput]    = useState('')
  const [asking,   setAsking]   = useState(false)
  const [askErr,   setAskErr]   = useState('')
  const [limitHit, setLimitHit] = useState(false)

  const chatEndRef  = useRef(null)
  const inputRef    = useRef(null)

  // Load context
  const loadCtx = useCallback(() => {
    setCtxLoad(true); setCtxErr('')
    apiFetch('/ai-cfo/context', token)
      .then(setCtx)
      .catch(e => setCtxErr(e.message))
      .finally(() => setCtxLoad(false))
  }, [token])

  useEffect(() => { loadCtx() }, [loadCtx])

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, asking])

  // Send a question
  const ask = async (q) => {
    const question = (q || input).trim()
    if (!question || asking) return
    setInput('')
    setAskErr('')
    setLimitHit(false)
    setMessages(prev => [...prev, { role: 'user', content: question }])
    setAsking(true)
    try {
      const res = await apiFetch('/ai-cfo/ask', token, {
        method: 'POST',
        body: { question },
      })
      setMessages(prev => [...prev, { role: 'assistant', content: res.answer }])
    } catch (e) {
      if (e.upgrade_required || e.message?.includes('limit')) {
        setLimitHit(true)
        setMessages(prev => [...prev, { role: 'assistant', content: '🔒 Monthly AI question limit reached. Upgrade your plan to continue using AI CFO.' }])
      } else {
        setAskErr(e.message || 'Failed to get answer. Please try again.')
        setMessages(prev => [...prev, { role: 'assistant', content: `Sorry, I couldn't answer that right now. ${e.message || ''}` }])
      }
    } finally {
      setAsking(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }

  // ── Derived values ────────────────────────────────────────────────────────
  const c         = ctx || {}
  const cash      = c.cash      || {}
  const month     = c.current_month || {}
  const recv      = c.receivables   || {}
  const pay       = c.payables      || {}
  const risks     = c.risks         || []
  const nextActs  = c.next_actions  || []
  const biz       = c.business      || {}
  const currency  = biz.base_currency || 'IDR'
  const runway    = c.runway_days
  const runwayColor = runway === null ? 'var(--text)' : runway < 7 ? 'var(--red-dark)' : runway < 14 ? 'var(--amber-dark)' : 'var(--green-dark)'

  // Plan badge style
  const badgeStyle = isTrialActive
    ? { background: 'rgba(254,243,199,0.15)', color: '#FCD34D', border: '1px solid rgba(252,211,77,.3)' }
    : effectivePlan !== 'free'
      ? { background: 'rgba(209,250,229,0.12)', color: '#6EE7B7', border: '1px solid rgba(110,231,183,.25)' }
      : {}

  const aiQUsage  = access?.usage?.ai_questions_this_month ?? 0
  const aiQLimit  = access?.limits?.max_ai_questions_per_month ?? null
  const aiQLeft   = aiQLimit !== null ? Math.max(0, aiQLimit - aiQUsage) : null

  return (
    <div className="hf-page">

      {/* ── Page header ─── */}
      <div className="hf-page-header">
        <div>
          <div className="hf-page-title">AI CFO</div>
          <div className="hf-page-subtitle">Context-aware financial assistant</div>
        </div>
        <button onClick={loadCtx} style={{ background: 'var(--bg-2)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: 'var(--text-3)', fontSize: 12 }}>
          ↻ Refresh
        </button>
      </div>

      {/* ── Hero: business + plan + usage ─── */}
      <div className="hf-dark-card" style={{ marginBottom: 20 }}>
        {ctxLoad && !ctx ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Spin size={22} />
            <span style={{ color: 'rgba(255,255,255,.5)', fontSize: 13 }}>Loading financial context…</span>
          </div>
        ) : (
          <>
            {/* Top row */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>AI CFO ASSISTANT</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', letterSpacing: -0.3, marginBottom: 4 }}>{biz.name || 'My Business'}</div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, ...badgeStyle }}>
                  {planLabel}
                </span>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>AI Questions</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: aiQLeft === 0 ? '#F87171' : '#34D399' }}>
                  {aiQLeft !== null ? aiQLeft : '∞'}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>remaining{aiQLimit !== null ? ` / ${aiQLimit}` : ''}</div>
              </div>
            </div>

            {/* 3 KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
              {[
                { label: 'TOTAL CASH',   value: fmtFull(cash.total_balance), suffix: currency, color: (cash.total_balance||0) < 0 ? '#F87171' : '#fff' },
                { label: 'RUNWAY',       value: runway === null ? '—' : runway >= 999 ? '∞' : String(runway), suffix: 'days', color: runwayColor.replace('var(--red-dark)','#F87171').replace('var(--amber-dark)','#FBBF24').replace('var(--green-dark)','#34D399') },
                { label: 'NET FLOW',     value: (month.net_flow >= 0 ? '+' : '') + fmt(month.net_flow), suffix: `${currency}/month`, color: (month.net_flow||0) >= 0 ? '#34D399' : '#F87171' },
              ].map(m => (
                <div key={m.label} style={{ background: 'rgba(255,255,255,.06)', borderRadius: 12, padding: '12px 14px', border: '0.5px solid rgba(255,255,255,.08)' }}>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, fontWeight: 700 }}>{m.label}</div>
                  <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: m.color, letterSpacing: -0.5, lineHeight: 1.1 }}>{m.value}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.25)', marginTop: 3 }}>{m.suffix}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {ctxErr && <div className="page-error" style={{ marginBottom: 16 }}>{ctxErr}</div>}

      {/* ── Context cards ─── */}
      {!ctxLoad && ctx && (
        <div className="hf-card-grid hf-card-grid-4" style={{ marginBottom: 20 }}>
          <CtxCard label="Receivables" value={'+' + fmt(recv.total_remaining)} sub={`${recv.overdue_count > 0 ? recv.overdue_count + ' overdue · ' : ''}${currency} expected`} color="var(--green-dark)" onClick={() => navigate('/receivables')} />
          <CtxCard label="Payables" value={'−' + fmt(pay.total_remaining)} sub={`${pay.overdue_count > 0 ? pay.overdue_count + ' overdue · ' : ''}${currency} to pay`} color="var(--red-dark)" onClick={() => navigate('/payables')} />
          <CtxCard label="Monthly Income" value={'+' + fmt(month.income)} sub={`${month.transactions_count} transactions`} color="var(--green-dark)" />
          <CtxCard label="Monthly Expenses" value={'−' + fmt(month.expenses)} sub={`~${fmt(month.burn_rate)} ${currency}/day`} color="var(--text)" onClick={() => navigate('/transactions')} />
        </div>
      )}

      {/* ── Risk summary ─── */}
      {!ctxLoad && risks.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="hf-section-title">Risk Summary</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {risks.map((r, i) => {
              const cfg = SEV_CFG[r.severity] || SEV_CFG.low
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 12, padding: '11px 16px' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: cfg.dot }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: cfg.text }}>{r.title}</div>
                    {r.amount > 0 && <div style={{ fontSize: 11, color: cfg.text, opacity: 0.7, marginTop: 2 }}>{fmt(r.amount)} {currency}</div>}
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: cfg.text, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{cfg.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Next actions ─── */}
      {!ctxLoad && nextActs.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="hf-section-title">Next Best Actions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {nextActs.map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--bg-2)', borderRadius: 12, border: '0.5px solid var(--border)', cursor: a.action_type !== 'pulse' ? 'pointer' : 'default' }}
                onClick={() => { if (a.action_type === 'receivables') navigate('/receivables'); if (a.action_type === 'payables') navigate('/payables'); }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: i === 0 ? 'var(--red-light)' : 'var(--brand-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                  {a.action_type === 'receivables' ? '📥' : a.action_type === 'payables' ? '📤' : '✦'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{a.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{a.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Suggested questions ─── */}
      <div style={{ marginBottom: 16 }}>
        <div className="hf-section-title">Ask AI CFO</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {SUGGESTED.map(s => (
            <button
              key={s.text}
              onClick={() => ask(s.text)}
              disabled={asking}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                background: 'var(--bg-2)', border: '0.5px solid var(--border)',
                color: 'var(--text-2)', cursor: asking ? 'not-allowed' : 'pointer',
                opacity: asking ? 0.5 : 1, transition: 'all .12s',
                fontFamily: 'inherit',
              }}
            >
              <span>{s.icon}</span>
              <span>{s.text}</span>
            </button>
          ))}
        </div>

        {/* Chat panel */}
        <div style={{ background: 'var(--bg-2)', borderRadius: 16, border: '0.5px solid var(--border)', overflow: 'hidden' }}>
          {/* Messages */}
          {messages.length > 0 && (
            <div style={{ padding: '16px 16px 8px', maxHeight: 420, overflowY: 'auto' }}>
              {messages.map((msg, i) => <Bubble key={i} msg={msg} />)}
              {asking && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', marginBottom: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#1D4ED8,#2563EB)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>✦</div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand)', animation: `tx-spin 1s ease-in-out ${i * 0.2}s infinite`, opacity: 0.7 }} />
                    ))}
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}

          {messages.length === 0 && (
            <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-4)', fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>✦</div>
              Ask anything about your finances — cash, risks, receivables, payables, or what to do next.
            </div>
          )}

          {/* Input area */}
          <div style={{ padding: '10px 12px', borderTop: messages.length > 0 ? '0.5px solid var(--border)' : 'none', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Ask your CFO AI a question…"
              rows={1}
              disabled={asking || limitHit}
              style={{
                flex: 1, padding: '10px 12px', borderRadius: 10,
                border: '0.5px solid var(--border-2)', background: 'var(--bg-3)',
                color: 'var(--text)', fontSize: 13, resize: 'none',
                fontFamily: 'inherit', outline: 'none', lineHeight: 1.5,
                maxHeight: 100, overflowY: 'auto',
              }}
            />
            <button
              onClick={() => ask()}
              disabled={!input.trim() || asking || limitHit}
              style={{
                width: 38, height: 38, borderRadius: 10, border: 'none', flexShrink: 0,
                background: (!input.trim() || asking || limitHit) ? 'var(--bg-3)' : 'linear-gradient(135deg,#1D4ED8,#2563EB)',
                color: (!input.trim() || asking) ? 'var(--text-4)' : '#fff',
                cursor: (!input.trim() || asking || limitHit) ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, transition: 'all .12s',
              }}
            >
              {asking ? <Spin size={16} /> : '↑'}
            </button>
          </div>

          {askErr && (
            <div style={{ padding: '6px 14px 10px', fontSize: 12, color: 'var(--red-dark)' }}>{askErr}</div>
          )}
        </div>

        {aiQLeft === 0 && (
          <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 10, background: 'var(--bg-2)', border: '0.5px solid var(--border)', fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
            🔒 Monthly AI question limit reached · Upgrade coming soon
          </div>
        )}
      </div>

      {/* ── Quick navigation ─── */}
      <div className="hf-card-grid hf-card-grid-2" style={{ marginBottom: 24, gap: 10 }}>
        {[
          { label: 'Receivables', sub: fmt(recv.total_remaining) + ' ' + currency + ' outstanding', path: '/receivables', bg: '#F0FDF4', color: 'var(--green-dark)', icon: '📥' },
          { label: 'Payables',    sub: fmt(pay.total_remaining) + ' ' + currency + ' to pay',       path: '/payables',    bg: 'var(--red-light)', color: 'var(--red-dark)', icon: '📤' },
          { label: 'Radar',       sub: '30-day cash forecast',                                        path: '/radar',       bg: 'var(--brand-light)', color: 'var(--brand-dark)', icon: '📡' },
          { label: 'Add Transaction', sub: 'Keep data up to date',                                    path: '/add',         bg: 'var(--bg-2)', color: 'var(--text)', icon: '➕' },
        ].map(a => (
          <button key={a.label} onClick={() => navigate(a.path)} style={{ background: a.bg, borderRadius: 14, padding: '14px 16px', cursor: 'pointer', border: `1px solid ${a.color}22`, textAlign: 'left', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 12, transition: 'box-shadow .15s' }}
            onMouseOver={e => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(15,23,42,.1)' }}
            onMouseOut={e => { e.currentTarget.style.boxShadow = 'none' }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{a.icon}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: a.color }}>{a.label}</div>
              <div style={{ fontSize: 11, color: a.color, opacity: 0.7, marginTop: 2 }}>{a.sub}</div>
            </div>
          </button>
        ))}
      </div>

    </div>
  )
}
