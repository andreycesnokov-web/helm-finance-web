// AI CFO — financial decision assistant. Container only: auth, the two API
// calls, refresh, chat state and the loading / error / empty states.
//
// WHAT DID NOT CHANGE: every figure on this page, and every rule that decides
// one. Cash, runway, net flow, the CFO Score, its five factors and their
// thresholds, the AI alert, hiring readiness, the risk list and the next best
// actions are all computed server-side and arrive ready to render — no weight,
// boundary, branch or recommendation text was touched, and the two endpoints are
// the two this page has always called. Plan and feature gating is untouched:
// the question limit is still read from the same access limits and still blocks
// on the same condition.
//
// WHAT CHANGED: this was the last business page outside the shared design
// system. It drew its own header with no <h1> at all, a dark hero from
// .hf-dark-card — the legacy #0F172A gradient with a graph-paper grid built from
// two repeating-linear-gradients, which PR #80 replaced with the brand navy —
// and hf-card panels, across 105 inline style blocks. The markup now lives in
// AICFOBlocks.jsx on the shared components, which is also what lets the design
// preview photograph the real page.
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useAccess } from '../hooks/useAccess'
import { useTranslation } from '../hooks/useTranslation'
import { apiFetch } from '../lib/api'
import { getLang } from '../i18n/index'
import { Card, LoadingSkeleton, ErrorState } from '../shell/ui'
import { aiQuestionsLeft, hasNoFinancialData } from '../lib/aiCfoFigures'
import {
  AICFOHeader, AICFOSummary, AICFOScore, AICFOSignals, AICFOFigures,
  AICFORisks, AICFOActions, AICFOAsk, AICFOQuickNav, AICFOEmpty, AICFOStaleNotice,
  SUGGESTED_KEYS,
} from './AICFOBlocks'

export default function AICFO() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const { access, planLabel } = useAccess()
  const { t } = useTranslation()

  const [ctx, setCtx] = useState(null)
  const [ctxLoad, setCtxLoad] = useState(true)
  const [ctxErr, setCtxErr] = useState('')
  const [messages, setMessages] = useState([])   // { role, content, outOfScope? }
  const [input, setInput] = useState('')
  const [asking, setAsking] = useState(false)
  const [askErr, setAskErr] = useState('')
  const [limitHit, setLimitHit] = useState(false)

  const chatEndRef = useRef(null)
  const inputRef = useRef(null)

  const loadCtx = useCallback(() => {
    setCtxLoad(true); setCtxErr('')
    apiFetch(`/ai-cfo/context?language=${getLang()}`, token)
      .then(setCtx)
      .catch((e) => setCtxErr(e.message))
      .finally(() => setCtxLoad(false))
  }, [token])

  useEffect(() => { loadCtx() }, [loadCtx])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, asking])

  const ask = async (q) => {
    const question = (q || input).trim()
    if (!question || asking) return
    setInput(''); setAskErr(''); setLimitHit(false)
    setMessages((prev) => [...prev, { role: 'user', content: question }])
    setAsking(true)
    try {
      const res = await apiFetch('/ai-cfo/ask', token, { method: 'POST', body: { question, language: getLang() } })
      setMessages((prev) => [...prev, { role: 'assistant', content: res.answer, outOfScope: !!res.out_of_scope }])
    } catch (e) {
      if (e.upgrade_required || e.message?.includes('limit')) {
        setLimitHit(true)
        setMessages((prev) => [...prev, { role: 'assistant', content: t('aicfo.limitReached') }])
      } else {
        setAskErr(e.message || t('aicfo.askFailed'))
        setMessages((prev) => [...prev, { role: 'assistant', content: `${t('aicfo.askFailed')} ${e.message || ''}`.trim() }])
      }
    } finally {
      setAsking(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }

  const lang = getLang()
  const aiQLeft = aiQuestionsLeft(access)
  // A first load has nothing to show; a REFRESH keeps the page on screen and
  // only puts the button in its busy state, so the figures do not flash away
  // underneath the reader every time they ask for fresh ones.
  const firstLoad = ctxLoad && !ctx

  const askPanel = (
    <AICFOAsk
      t={t}
      messages={messages}
      input={input}
      asking={asking}
      limitHit={limitHit}
      askErr={askErr}
      suggestions={SUGGESTED_KEYS}
      onAsk={ask}
      onInput={setInput}
      onKeyDown={onKey}
      inputRef={inputRef}
      endRef={chatEndRef}
      aiQLeft={aiQLeft}
    />
  )

  if (firstLoad) {
    return (
      <div className="hf-page aicfo-page">
        <AICFOHeader t={t} onRefresh={loadCtx} refreshing />
        <Card><LoadingSkeleton rows={5} height={18} /></Card>
      </div>
    )
  }

  // A failed load used to render as a line of red text with no way out — the
  // only retry on the page was the header button, which looked like a refresh
  // of data that was on screen rather than a recovery from a page that had none.
  if (ctxErr && !ctx) {
    return (
      <div className="hf-page aicfo-page">
        <AICFOHeader t={t} onRefresh={loadCtx} refreshing={ctxLoad} />
        <ErrorState description={ctxErr} onRetry={loadCtx} retryLabel={t('aicfo.tryAgain')} />
      </div>
    )
  }

  // Nothing recorded yet. The engine still returns a score — it scores the
  // absence of data as readily as data, which is how an untouched workspace was
  // told its health was 72 out of 100 — so the page withholds the verdict rather
  // than the engine withholding the number. See hasNoFinancialData().
  if (hasNoFinancialData(ctx)) {
    return (
      <div className="hf-page aicfo-page">
        <AICFOHeader t={t} onRefresh={loadCtx} refreshing={ctxLoad} />
        <AICFOSummary ctx={ctx} t={t} planLabel={planLabel} aiQLeft={aiQLeft} lang={lang} />
        <AICFOEmpty t={t} onNavigate={navigate} />
        {askPanel}
      </div>
    )
  }

  return (
    <div className="hf-page aicfo-page">
      <AICFOHeader t={t} onRefresh={loadCtx} refreshing={ctxLoad} />
      <AICFOSummary ctx={ctx} t={t} planLabel={planLabel} aiQLeft={aiQLeft} lang={lang} />
      {/* A refresh that fails leaves the last good figures on screen — replacing
          them with an error would throw away data the user can still act on, and
          replacing them with zeros would be a lie. But the page must then say so
          plainly: it printed only the raw error before, so a stale page looked
          like a current one. The notice names the state, gives the reason, and
          offers the retry. */}
      <AICFOStaleNotice t={t} error={ctxErr} onRetry={loadCtx} retrying={ctxLoad} />
      <AICFOScore score={ctx?.cfo_score} t={t} lang={lang} />
      <AICFOSignals ctx={ctx} t={t} onAsk={ask} lang={lang} />
      <AICFOFigures ctx={ctx} t={t} onNavigate={navigate} />
      <AICFORisks ctx={ctx} t={t} />
      <AICFOActions ctx={ctx} t={t} onNavigate={navigate} />
      {askPanel}
      <AICFOQuickNav ctx={ctx} t={t} onNavigate={navigate} />
    </div>
  )
}
