import React, { useEffect, useRef, useState, useCallback } from 'react'
import I from '../icons'
import { useT } from '../i18n'
import { Skeleton } from '../ui'
import SafeMarkdown from './SafeMarkdown'
import { askAccountant } from '../lib/ask'

import { createRequestGuard } from '../../lib/requestGuard'

/**
 * AccountantChatModal:
 * Convenient, focused chat dialog for AI Accountant.
 *
 * Interface specifications:
 * - Desktop: centered dialog, width ~800–900px, max-height 85vh.
 * - Mobile: fullscreen dialog (100vw, 100vh).
 * - Header: "AI Бухгалтер", active company name, close button.
 * - Body: scrollable conversation thread (user questions + AI responses).
 * - Footer: pinned follow-up input and send button.
 * - Safe Markdown rendering: headers, lists, bold, links without HTML execution.
 * - Transparent sources (used_rules) and limitations/disclaimers.
 * - State management: conversation persisted across close/reopen within same company;
 *   generation guard invalidates stale requests on company switch (even A -> B -> A).
 * - Accessibility: Escape key, body scroll lock, focus trap, and return focus on close.
 */
export default function AccountantChatModal({
  open,
  onClose,
  companyName,
  token,
  activeBusinessId,
  scopeKey,
  initialQuery = '',
}) {
  const t = useT()
  const [thread, setThread] = useState([])
  const [draft, setDraft] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  const modalRef = useRef(null)
  const inputRef = useRef(null)
  const listEndRef = useRef(null)
  const lastActiveElementRef = useRef(null)

  // Track active company workspace identity to enforce strict isolation
  const currentScope = `${activeBusinessId ?? ''}|${scopeKey ?? ''}`
  const scopeRef = useRef(currentScope)

  // Generation guard: aborts and invalidates in-flight requests across workspace changes
  const guardRef = useRef(createRequestGuard())
  const initialTriggerRef = useRef(null)

  // 1. Company switch guard: bump generation, wipe thread, draft, and reset initialTriggerRef
  useEffect(() => {
    if (scopeRef.current !== currentScope) {
      scopeRef.current = currentScope
      // Invalidate any in-flight requests from earlier generation
      guardRef.current.abort()
      initialTriggerRef.current = null
      setThread([])
      setDraft('')
      setIsBusy(false)
      if (open && onClose) {
        onClose()
      }
    }
  }, [currentScope, open, onClose])

  // 2. Ask action
  const sendQuery = useCallback(async (queryText) => {
    const text = String(queryText || '').trim()
    if (!text) return

    const turnId = Date.now() + Math.random().toString(36).slice(2, 6)
    // Start new guarded request generation
    const { gen, signal, isStale } = guardRef.current.start()

    // Add user turn immediately and loading indicator
    const newTurn = {
      id: turnId,
      question: text,
      answer: null,
      disclaimer: null,
      used_rules: null,
      loading: true,
      error: null,
    }

    setThread((prev) => [...prev, newTurn])
    setDraft('')
    setIsBusy(true)

    try {
      const resp = await askAccountant(token, text, { signal })
      // Verify generation has not been superseded or invalidated (even across A -> B -> A)
      if (!isStale() && !guardRef.current.isStale(gen)) {
        setThread((prev) =>
          prev.map((turn) =>
            turn.id === turnId
              ? {
                  ...turn,
                  answer: resp?.answer || '',
                  disclaimer: resp?.disclaimer || null,
                  used_rules: resp?.used_rules || [],
                  loading: false,
                  error: null,
                }
              : turn
          )
        )
        setIsBusy(false)
      }
    } catch (err) {
      // Ignore aborted requests and superseded generations
      if (err?.name === 'AbortError' || err?.code === 20) {
        return
      }
      if (!isStale() && !guardRef.current.isStale(gen)) {
        const errorMsg =
          err?.status === 403
            ? t('dec.forbidden')
            : t('acct.askErr') || 'Не удалось получить ответ. Пожалуйста, повторите попытку.'
        setThread((prev) =>
          prev.map((turn) =>
            turn.id === turnId
              ? {
                  ...turn,
                  loading: false,
                  error: errorMsg,
                }
              : turn
          )
        )
        setIsBusy(false)
      }
    }
  }, [token, t])

  // 3. Handle initialQuery trigger when opening
  useEffect(() => {
    if (open && initialQuery && initialQuery.trim() && initialTriggerRef.current !== initialQuery) {
      initialTriggerRef.current = initialQuery
      sendQuery(initialQuery)
    }
  }, [open, initialQuery, sendQuery])

  // Reset initial trigger reference when query is cleared
  useEffect(() => {
    if (!initialQuery) {
      initialTriggerRef.current = null
    }
  }, [initialQuery])

  // 4. Scroll to bottom when thread updates or is loading
  useEffect(() => {
    if (open) {
      listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [thread, open])

  // 5. Accessibility: Focus restoration, Escape listener, Body scroll lock, Focus trap
  useEffect(() => {
    if (!open) return

    // Save previous focus
    lastActiveElementRef.current = document.activeElement

    // Lock body scroll
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Focus input or modal
    const focusTimer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus()
      } else if (modalRef.current) {
        modalRef.current.focus()
      }
    }, 40)

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose?.()
        return
      }

      // Focus trap
      if (e.key === 'Tab' && modalRef.current) {
        const focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        const focusables = Array.from(modalRef.current.querySelectorAll(focusableSelectors)).filter(
          (el) => !el.hasAttribute('disabled') && el.offsetParent !== null
        )
        if (focusables.length === 0) return

        const firstElement = focusables[0]
        const lastElement = focusables[focusables.length - 1]

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault()
            lastElement.focus()
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault()
            firstElement.focus()
          }
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = prevOverflow
      if (lastActiveElementRef.current && typeof lastActiveElementRef.current.focus === 'function') {
        lastActiveElementRef.current.focus()
      }
    }
  }, [open, onClose])

  if (!open) return null

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!draft.trim() || isBusy) return
    sendQuery(draft)
  }

  const handleRetry = (question) => {
    if (!question || isBusy) return
    sendQuery(question)
  }

  return (
    <>
      <div
        className="v2-acct-scrim"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="v2-acct-modal-wrap"
        role="dialog"
        aria-modal="true"
        aria-labelledby="v2-acct-modal-title"
        ref={modalRef}
        tabIndex={-1}
      >
        <div className="v2-acct-modal-panel">
          {/* Header */}
          <header className="v2-acct-modal-head">
            <div className="v2-acct-modal-brand">
              <span className="v2-acct-modal-badge" aria-hidden="true">
                <I.accountant size={18} />
              </span>
              <div className="v2-acct-modal-titles">
                <h2 id="v2-acct-modal-title" className="v2-acct-modal-name">
                  {t('acct.modalTitle') || 'AI Бухгалтер'}
                </h2>
                {companyName && (
                  <span className="v2-acct-modal-company" title={companyName}>
                    {companyName}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              className="v2-btn v2-btn-ghost v2-acct-close-btn"
              onClick={onClose}
              aria-label={t('acct.modalClose') || 'Закрыть окно'}
            >
              <I.close size={18} />
            </button>
          </header>

          {/* Body: Scrollable message conversation */}
          <div className="v2-acct-modal-body" aria-live="polite">
            {thread.length === 0 && (
              <div className="v2-acct-empty-state">
                <p className="v2-muted">
                  {t('acct.askLabel')}
                </p>
              </div>
            )}

            {thread.map((turn) => (
              <div key={turn.id} className="v2-acct-thread-turn">
                {/* User Message */}
                <div className="v2-acct-bubble-user">
                  <p className="v2-acct-bubble-text">{turn.question}</p>
                </div>

                {/* AI Loading State */}
                {turn.loading && (
                  <div className="v2-acct-bubble-ai v2-acct-ai-loading">
                    <p className="v2-muted v2-small" style={{ marginBottom: 8 }}>
                      {t('acct.modalThinking') || 'AI Бухгалтер анализирует правила и факты компании…'}
                    </p>
                    <Skeleton rows={3} />
                  </div>
                )}

                {/* AI Error with Retry preserving the question */}
                {turn.error && (
                  <div className="v2-acct-bubble-ai v2-acct-ai-error" role="alert">
                    <div className="v2-inline-err" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <span>{turn.error}</span>
                      <button
                        type="button"
                        className="v2-btn v2-btn-ghost v2-btn-sm"
                        onClick={() => handleRetry(turn.question)}
                        disabled={isBusy}
                      >
                        {t('acct.askRetry') || 'Повторить'}
                      </button>
                    </div>
                  </div>
                )}

                {/* AI Answer */}
                {turn.answer && !turn.loading && (
                  <div className="v2-acct-bubble-ai">
                    <div className="v2-acct-ai-content">
                      <SafeMarkdown content={turn.answer} />
                    </div>

                    {/* Citations / Sources */}
                    {Array.isArray(turn.used_rules) && turn.used_rules.length > 0 && (
                      <div className="v2-acct-sources">
                        <span className="v2-muted v2-small">
                          <strong>{t('acct.sources')}: </strong>
                          {turn.used_rules.map((r) => r.rule_code || r).join(', ')}
                        </span>
                      </div>
                    )}

                    {/* Limitations & Disclaimers */}
                    {turn.disclaimer && (
                      <div className="v2-acct-disclaimer">
                        <p className="v2-muted v2-small">{turn.disclaimer}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={listEndRef} />
          </div>

          {/* Footer: pinned input and send button */}
          <footer className="v2-acct-modal-foot">
            <form className="v2-acct-foot-form" onSubmit={handleSubmit}>
              <label htmlFor="v2-acct-chat-input" className="v2-sr">
                {t('acct.modalPlaceholder') || 'Задайте следующий вопрос…'}
              </label>
              <input
                id="v2-acct-chat-input"
                ref={inputRef}
                className="v2-input v2-acct-foot-input"
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t('acct.modalPlaceholder') || 'Задайте следующий вопрос о налогах или документах…'}
                maxLength={500}
                disabled={isBusy}
              />
              <button
                type="submit"
                className="v2-btn v2-btn-primary v2-acct-foot-btn"
                disabled={isBusy || !draft.trim()}
                aria-label={t('acct.send')}
              >
                <I.send size={16} />
              </button>
            </form>
          </footer>
        </div>
      </div>
    </>
  )
}
