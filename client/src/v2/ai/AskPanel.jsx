// The AI CFO panel: 440px right drawer on desktop, bottom sheet on phone.
// Header: "AI CFO", "Looking at: <page · period>", open full page, close.
// Each answer shows its source (this company's numbers the server used) and action
// buttons for any clickable phrase it carries. Esc closes; focus goes to the input.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import I from '../icons'
import { useT } from '../i18n'
import { money } from '../lib/format'
import { parseAiText } from '../lib/aiLinks'
import { useAsk } from './AskContext'
import AiText from './AiText'

export default function AskPanel() {
  const t = useT()
  const { open, thread, looking, close, send } = useAsk()
  const [q, setQ] = useState('')
  const inputRef = useRef(null)
  const endRef = useRef(null)
  const lastFocus = useRef(null)

  useEffect(() => {
    if (!open) return
    lastFocus.current = document.activeElement
    setTimeout(() => inputRef.current?.focus(), 30)
    const onKey = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); lastFocus.current?.focus?.() }
  }, [open, close])
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }) }, [thread])

  if (!open) return null
  const submit = (e) => { e.preventDefault(); if (q.trim()) { send(q); setQ('') } }
  const chips = ['chip1', 'chip2', 'chip3']

  return (
    <>
      <div className="v2-askscrim" onClick={close} aria-hidden="true" />
      <aside className="v2-askpanel" role="dialog" aria-modal="false" aria-labelledby="v2-ask-title">
        <span className="v2-sheet-grip" aria-hidden="true" />
        <header className="v2-ask-head">
          <span className="v2-ask-ic" aria-hidden="true"><I.cfo size={18} /></span>
          <span className="v2-ask-titles">
            <strong id="v2-ask-title">{t('nav.cfo')}</strong>
            {looking && <span className="v2-muted v2-small">{t('ask.looking', { what: looking })}</span>}
          </span>
          <Link className="v2-iconbtn" to="/business/ai-cfo" onClick={close} aria-label={t('ask.fullPage')}><I.chevRight size={18} /></Link>
          <button type="button" className="v2-iconbtn" onClick={close} aria-label={t('ask.close')}><I.close size={18} /></button>
        </header>
        <div className="v2-ask-body" aria-live="polite">
          {thread.length === 0 && (
            <div className="v2-ask-empty">
              <p className="v2-sec">{t('ask.intro')}</p>
              <div className="v2-chips">{chips.map((c) => <button key={c} type="button" className="v2-chip" onClick={() => send(t(`ask.${c}`))}>{t(`ask.${c}`)}</button>)}</div>
            </div>
          )}
          {thread.map((m) => {
            const links = m.answer ? parseAiText(m.answer.answer).filter((s) => s.type === 'link') : []
            const cs = m.answer?.context_summary
            return (
              <div key={m.id} className="v2-ask-turn">
                <p className="v2-ask-q">{m.q}</p>
                {m.loading && <p className="v2-muted">{t('ask.thinking')}</p>}
                {m.error && <p className="v2-inline-err" role="alert">{m.error === 'forbidden' ? t('ask.forbidden') : m.error}</p>}
                {m.answer && (
                  <div className="v2-ask-a">
                    <p className="v2-ask-label">{t('ask.from', { what: m.looking || t('nav.cfo') })}</p>
                    <div className="v2-ask-text"><AiText text={m.answer.answer} onNavigate={close} /></div>
                    {cs && (
                      <p className="v2-ask-src">
                        <I.info size={14} />
                        {t('ask.source', { cash: money(cs.total_balance), runway: cs.runway_days == null ? '—' : t('pulse.daysN', { n: cs.runway_days }) })}
                        {m.answer.used_ai_provider === false && ` · ${t('ask.rulesOnly')}`}
                      </p>
                    )}
                    {links.length > 0 && (
                      <div className="v2-chips">{links.map((l, i) => <Link key={i} className="v2-chip v2-chip-ask" to={l.to} onClick={close}>{l.text}</Link>)}</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          <span ref={endRef} />
        </div>
        <form className="v2-ask-foot" onSubmit={submit}>
          <label htmlFor="v2-ask-input" className="v2-sr">{t('ask.followUp')}</label>
          <input id="v2-ask-input" ref={inputRef} className="v2-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(thread.length ? 'ask.followUp' : 'ask.placeholder')} maxLength={2000} />
          <button type="submit" className="v2-btn v2-btn-primary" aria-label={t('ask.send')} title={q.trim() ? undefined : t('ask.typeFirst')} disabled={!q.trim()}><I.send size={16} /></button>
        </form>
        <p className="v2-ask-note v2-muted v2-small">{t('ask.note')}</p>
      </aside>
    </>
  )
}

/** "Ask AI CFO" / "Why?" / a question chip. */
export function AskButton({ question, children, variant = 'secondary', className = '' }) {
  const { openAsk } = useAsk()
  return <button type="button" className={`v2-btn v2-btn-${variant} ${className}`} onClick={() => openAsk(question)}>{children}</button>
}
