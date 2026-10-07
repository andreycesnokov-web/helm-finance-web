// AI Accountant (designs/Accountant, AccountantPackages, AccountantTaxes).
// Tabs: Month close · Documents by transaction · Tax calendar (this page, ?tab=) and
// Tax profile (/business/accountant/tax-profile).
//
// Reads only: /api/transactions?period=all, /api/debts, /api/bank-import/batches,
// /api/wallets, /api/accountant/summary (stored compliance events — read-only; the
// calendar route that GENERATES events is not called from here), /api/accountant/obligations
// (engine-calculated amounts). The ask box uses the existing POST /api/accountant/ask,
// which answers from the verified rules and changes no data.
// "Engines calculate, AI explains": no rate, date or amount is computed in this file.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import I from '../icons'
import { PageHead, Card, Pill, Btn, NotYet, Skeleton, ErrorBox, Empty } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi } from '../data'
import { monthOptions, accountantMonth, closeReadiness, packages, packageSummary, monthGrid, complianceEvents, eventStage, packageExportData, createAccountantZipPackage, dedupeDocumentLinks } from '../lib/accounting'
import { apiFetch } from '../../lib/api'
import { money } from '../lib/format'
import { askAccountant } from '../lib/ask'
import AccountantTabs from '../components/AccountantTabs'
import { findWithholdingRule } from '../../pages/business/InvoiceReviewDrawer'
import TaxKnowledgeCard from '../../components/TaxKnowledgeCard'
import { listTaxCards, getTaxCard, matchTopicId } from '../../lib/taxKnowledgeFixtures'
import InfoTooltip from '../../components/InfoTooltip'
import AccountantChatModal from '../components/AccountantChatModal'

const monthLabel = (key, lang) => {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang === 'id' ? 'id-ID' : 'en-GB', { month: 'long', year: 'numeric' })
}
const STAGE_TONE = { done: 'good', overdue: 'crit', calculated: 'info', todo: 'neutral' }

function MonthPicker({ value, onChange }) {
  const t = useT()
  const lang = useLang()
  return (
    <select className="v2-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={t('acct.month')}>
      {monthOptions(12).map((m) => <option key={m.key} value={m.key}>{monthLabel(m.key, lang)}</option>)}
    </select>
  )
}

function AskBox({ externalQuery = '', onQueryChange, onOpenModal }) {
  const t = useT()
  const [sp, setSp] = useSearchParams()
  const [q, setQ] = useState(() => externalQuery || sp.get('ask') || '')
  // One business's answer never shows under another (review 8.2 #2).
  const { active, scopeKey } = useWorkspace()
  const wsKey = `${active?.id ?? ''}|${scopeKey ?? ''}`
  const wsRef = useRef(wsKey)

  useEffect(() => {
    if (externalQuery !== undefined && externalQuery !== null && externalQuery !== '') {
      setQ(externalQuery)
    }
  }, [externalQuery])

  useEffect(() => {
    if (wsRef.current !== wsKey) {
      wsRef.current = wsKey
      setQ('')
      if (onQueryChange) onQueryChange('')
      if (sp.has('ask') || sp.has('q')) {
        const nextSp = new URLSearchParams(sp)
        nextSp.delete('ask')
        nextSp.delete('q')
        setSp(nextSp, { replace: true })
      }
    }
  }, [wsKey, sp, setSp, onQueryChange])

  useEffect(() => {
    // Only take search param if ws hasn't just switched away
    const askParam = sp.get('ask') || sp.get('q')
    if (askParam) {
      setQ(askParam)
    }
  }, [sp])

  const submitAsk = (question) => {
    const text = (question ?? q).trim()
    if (!text) return
    if (onOpenModal) {
      onOpenModal(text)
    }
  }

  return (
    <Card>
      <form className="v2-askbox" onSubmit={(e) => { e.preventDefault(); submitAsk() }}>
        <label htmlFor="acc-ask" className="v2-field-label">{t('acct.askLabel')}</label>
        <div className="v2-askrow">
          <input
            id="acc-ask"
            className="v2-input"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              if (onQueryChange) onQueryChange(e.target.value)
            }}
            placeholder={t('acct.askPh')}
            maxLength={500}
          />
          <button type="submit" className="v2-btn v2-btn-primary" aria-label={t('acct.send')} title={q.trim() ? undefined : t('ask.typeFirst')} disabled={!q.trim()}><I.send size={16} /></button>
        </div>
      </form>
      <div className="v2-chips">
        {['q1', 'q2', 'q3'].map((k) => <button key={k} type="button" className="v2-chip" onClick={() => submitAsk(t(`acct.chip.${k}`))}>{t(`acct.chip.${k}`)}</button>)}
        <Link className="v2-chip v2-chip-ask" to="/business/accountant/tax-profile">{t('acct.tab.profile')}</Link>
      </div>
    </Card>
  )
}

function TaxList({ events, lang, t, limit, empty = 'acct.noEvents' }) {
  if (!events.length) return <p className="v2-muted">{t(empty)}</p>
  return (
    <ul className="v2-taxlist">
      {events.slice(0, limit).map((e) => {
        const stage = eventStage(e)
        const topicId = matchTopicId(e.rule_code || e.title)
        const matchedCard = topicId ? getTaxCard(topicId, lang) : null
        const whatText = Array.isArray(matchedCard?.what_is) && matchedCard.what_is[0]?.text
          ? matchedCard.what_is[0].text
          : (Array.isArray(matchedCard?.summary) && matchedCard.summary[0]?.text ? matchedCard.summary[0].text : '')
        const howText = Array.isArray(matchedCard?.how_it_works) && matchedCard.how_it_works[0]?.text
          ? matchedCard.how_it_works[0].text
          : (matchedCard?.section_status?.how_it_works === 'unavailable' ? 'Archived procedure under research review.' : '')

        return (
          <li key={e.id || e.rule_code + e.period}>
            <span className="v2-num v2-taxlist-date">{shortDate(e.due_date, lang)}</span>
            <span className="v2-taxlist-what" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <strong>{e.title || e.rule_code}</strong>
              {matchedCard && (
                <InfoTooltip
                  title={matchedCard.name}
                  what={whatText}
                  how={howText}
                  interpret={matchedCard.required_notice}
                  lang={lang}
                />
              )}
              {e.period && <span className="v2-muted"> · {e.period}</span>}
            </span>
            <span className="v2-num v2-r">{e.estimated_amount != null ? money(e.estimated_amount) : '—'}</span>
            <Pill tone={STAGE_TONE[stage]}>{t(`acct.stage.${stage}`)}</Pill>
          </li>
        )
      })}
    </ul>
  )
}

function CloseTab({ month, onOpenChatModal }) {
  const t = useT()
  const lang = useLang()
  const { active, scopeKey } = useWorkspace()
  const { token } = useAuth()
  const [askQuery, setAskQuery] = useState('')
  const [exporting, setExporting] = useState(false)
  const exportControllerRef = useRef(null)

  useEffect(() => {
    setAskQuery('')
  }, [active?.id, scopeKey])

  useEffect(() => {
    if (exportControllerRef.current) {
      exportControllerRef.current.abort()
      exportControllerRef.current = null
    }
    setExporting(false)
  }, [active?.id, month])
  const tx = useApi('/transactions?period=all')
  const debts = useApi('/debts')
  const batches = useApi('/bank-import/batches')
  const wallets = useApi('/wallets')
  const docs = useApi('/documents')
  const summary = useApi('/accountant/summary')
  const taxCardsApi = useApi(`/accountant/tax-knowledge/cards?lang=${lang}`)

  const taxStatus = taxCardsApi.error?.status || (taxCardsApi.error?.data && taxCardsApi.error.data.status)
  const isForbidden = taxStatus === 403 || taxStatus === 401 || /401|403|unauthorized|forbidden/i.test(taxCardsApi.error?.message || '')
  const isNetworkOffline = !!taxCardsApi.error && !taxStatus && (
    (typeof window !== 'undefined' && !window.navigator.onLine) ||
    /Failed to fetch|NetworkError|network|offline/i.test(taxCardsApi.error?.message || '')
  )
  const isServerError = !!taxCardsApi.error && !isForbidden && !isNetworkOffline
  const isOffline = isNetworkOffline
  const isMalformed = !taxCardsApi.loading && !taxCardsApi.error && taxCardsApi.data != null && (typeof taxCardsApi.data !== 'object' || !Array.isArray(taxCardsApi.data.cards))
  const isEmpty = !taxCardsApi.loading && !taxCardsApi.error && !isMalformed && Array.isArray(taxCardsApi.data?.cards) && taxCardsApi.data.cards.length === 0

  const taxCards = useMemo(() => {
    if (Array.isArray(taxCardsApi.data?.cards) && taxCardsApi.data.cards.length > 0) {
      return taxCardsApi.data.cards
    }
    if (isOffline) {
      return listTaxCards(lang)
    }
    return []
  }, [taxCardsApi.data, isOffline, lang])

  const enrichedDebts = useMemo(() => {
    const rawDebts = Array.isArray(debts.data) ? debts.data : []
    const rawDocs = Array.isArray(docs.data?.documents) ? docs.data.documents : []
    const linkedMap = new Map()
    for (const d of rawDocs) {
      for (const l of d.links || []) {
        if (l.target_type === 'debt' && l.target_id != null) {
          const k = String(l.target_id)
          if (!linkedMap.has(k)) linkedMap.set(k, [])
          linkedMap.get(k).push({ ...l, document_id: d.id, file_name: d.file_name })
        }
      }
    }
    return rawDebts.map((b) => {
      const docLinks = linkedMap.get(String(b.id)) || []
      const existingLinks = Array.isArray(b.document_links) ? b.document_links : []
      const mergedLinks = dedupeDocumentLinks([...existingLinks, ...docLinks])
      return {
        ...b,
        document_links: mergedLinks,
        linked_documents_count: mergedLinks.length,
        _hasLinkedDocs: mergedLinks.length > 0,
      }
    })
  }, [debts.data, docs.data])

  const r = useMemo(() => closeReadiness({
    month,
    transactions: Array.isArray(tx.data) ? tx.data : [],
    debts: enrichedDebts,
    batches: batches.data?.batches || [],
    wallets: wallets.data?.wallets || [],
  }), [month, tx.data, enrichedDebts, batches.data, wallets.data])
  if (tx.loading || debts.loading) return <Card><Skeleton rows={6} /></Card>
  if (tx.error) return <ErrorBox error={tx.error} onRetry={tx.reload} />
  const events = complianceEvents(summary.data)
  const [y, m] = month.split('-').map(Number)
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`
  const due = events.filter((e) => String(e.due_date).slice(0, 7) === next)
  const dueSum = due.reduce((s, e) => s + (e.estimated_amount != null ? Number(e.estimated_amount) : 0), 0)
  const left = r.checks.filter((c) => !c.done)


  return (
    <div className="v2-grid-detail">
      <div className="v2-col">
        <section className="v2-hero v2-hero-plain">
          <div className="v2-hero-text">
            <span className="v2-hero-label">{t('acct.closeOf', { m: monthLabel(month, lang) })}</span>
            <h2 className="v2-hero-title">
              {r.percent == null
                ? t('acct.noRecords')
                : left.length === 0
                ? (r.is_closed ? t('acct.closed') : t('acct.preparedForReview'))
                : t('acct.almost', { n: r.percent, k: left.length })}
            </h2>
            <p className="v2-hero-p v2-show">
              {left.length === 0 && !r.is_closed
                ? t('acct.awaitingAccountantSignoff', { n: r.complete, m: r.records })
                : t('acct.recordsComplete', { n: r.complete, m: r.records })}
            </p>
            <div className="v2-row-gap v2-row-start">
              <NotYet note={t('acct.reviewSoon')}>{t('acct.sendToAccountant')}</NotYet>
              <button
                type="button"
                className="v2-btn v2-btn-secondary"
                disabled={exporting}
                onClick={async () => {
                  if (exportControllerRef.current) {
                    exportControllerRef.current.abort()
                  }
                  const controller = new AbortController()
                  exportControllerRef.current = controller
                  const currentBizId = active?.id
                  const currentMonth = month

                  setExporting(true)
                  try {
                    const rawDocs = Array.isArray(docs.data?.documents) ? docs.data.documents : []
                    const companyName = active?.name || 'Company'
                    const res = await createAccountantZipPackage({
                      month: currentMonth,
                      companyName,
                      businessId: currentBizId,
                      transactions: Array.isArray(tx.data) ? tx.data : [],
                      debts: enrichedDebts,
                      batches: batches.data?.batches || [],
                      wallets: wallets.data?.wallets || [],
                      documents: rawDocs,
                      token,
                      lang,
                      signal: controller.signal,
                      fetchSignedUrl: async (docId, mode = 'download', bizId, sig) => {
                        const resp = await apiFetch(`/documents/${docId}/signed-url`, token, {
                          method: 'POST',
                          headers: (bizId || currentBizId) ? { 'x-business-id': String(bizId || currentBizId) } : {},
                          body: { mode },
                          signal: sig || controller.signal,
                        })
                        return resp?.url || null
                      },
                    })

                    if (controller.signal.aborted) return
                    if (active?.id !== currentBizId || month !== currentMonth) return
                    if (!res?.zipBytes) return

                    const blob = new Blob([res.zipBytes], { type: 'application/zip' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = res.filename
                    document.body.appendChild(a)
                    a.click()
                    document.body.removeChild(a)
                    URL.revokeObjectURL(url)
                  } catch (err) {
                    if (err.name === 'AbortError' || controller.signal.aborted) return
                    console.error('Accountant export failed:', err)
                  } finally {
                    if (exportControllerRef.current === controller) {
                      exportControllerRef.current = null
                      setExporting(false)
                    }
                  }
                }}
              >
                {exporting ? '…' : t('acct.download')}
              </button>
            </div>
            {left.length > 0 && (
              <div style={{ marginTop: 12, padding: '8px 12px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, fontSize: 12, color: '#92400E' }}>
                ⚠️ {t('acct.incompleteDownloadWarning', { k: left.length })}
              </div>
            )}
          </div>
        </section>
        <Card title={t('acct.toFinish', { m: monthLabel(month, lang) })}>
          <ul className="v2-check">
            {r.checks.map((c) => (
              <li key={c.key} className={c.done ? 'is-done' : ''}>
                <span className="v2-check-mark" aria-hidden="true">{c.done ? <I.check size={14} /> : null}</span>
                <span className="v2-check-text">
                  <span>{t(`acct.check.${c.key}`, { ok: c.ok, n: c.total })}<span className="v2-sr"> — {c.done ? t('acct.done') : t('acct.notDone')}</span></span>
                  {!c.done && c.missing.length > 0 && <span className="v2-muted v2-small">{c.missing.slice(0, 3).join(', ')}{c.missing.length > 3 ? ` +${c.missing.length - 3}` : ''}</span>}
                </span>
                {c.done ? <Pill tone="good">{t('acct.done')}</Pill>
                  : c.key === 'categories' ? <Link to="/business/transactions">{t('pulse.review')}</Link>
                  : c.key === 'statements' ? <Link to="/business/bank-import">{t('acc.import')}</Link>
                  : <Link to="/business/accountant?tab=packages">{t('acct.seePackages')}</Link>}
              </li>
            ))}
            <li>
              <span className="v2-check-mark" aria-hidden="true" />
              <span className="v2-check-text"><span>{t('acct.check.review')}</span><span className="v2-muted v2-small">{t('bill.doc.notTracked')}</span></span>
            </li>
          </ul>
        </Card>
        {r.unlinked_transactions?.length > 0 && (
          <Card
            title={
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#DC2626' }}>
                <I.warn size={16} />
                <span>{lang === 'ru' ? 'Несверенные банковские операции' : lang === 'id' ? 'Transaksi Bank Belum Terekonsiliasi' : 'Unreconciled Bank Transactions'} ({r.unlinked_transactions.length})</span>
              </span>
            }
          >
            <p className="v2-muted v2-small" style={{ margin: '0 0 10px' }}>
              {lang === 'ru' ? 'Операции присутствуют в учёте, но отсутствуют в подтверждённой банковской выписке за этот период:'
                : lang === 'id' ? 'Transaksi ada di pembukuan tetapi tidak tercantum dalam mutasi rekening periode ini:'
                : 'Transactions exist in the ledger but are missing from the confirmed bank statement for this period:'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {r.unlinked_transactions.map((ut) => {
                const wName = (wallets.data?.wallets || []).find((w) => String(w.id) === String(ut.wallet_id))?.name || 'Bank'
                const isIncome = ut.type === 'income' || ut.type === 'cash_in'
                return (
                  <div key={ut.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, fontSize: 13 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600 }}>{ut.description || (isIncome ? 'Доход' : 'Расход')}</span>
                        <Pill tone={isIncome ? 'good' : 'warn'}>{isIncome ? (lang === 'ru' ? 'Приход' : 'Income') : (lang === 'ru' ? 'Расход' : 'Expense')}</Pill>
                      </div>
                      <span className="v2-muted v2-small">{ut.date} · {wName}</span>
                    </div>
                    <span style={{ fontWeight: 600, color: isIncome ? '#059669' : '#DC2626' }}>
                      {isIncome ? '+' : '−'}{money(ut.amount, ut.currency)}
                    </span>
                  </div>
                )
              })}
            </div>
          </Card>
        )}
      </div>
      <div className="v2-col">
        <Card title={t('acct.taxesDue', { m: monthLabel(next, lang) })} aside={<Link to="/business/accountant?tab=taxes">{t('acct.fullCalendar')}</Link>}>
          {dueSum > 0 && <p className="v2-stat-mid v2-num">{money(dueSum)}</p>}
          <TaxList events={due} lang={lang} t={t} limit={8} />
          <p className="v2-muted v2-small">{t('acct.taxNote')}</p>
        </Card>
        <AskBox
          externalQuery={askQuery}
          onQueryChange={setAskQuery}
          onOpenModal={onOpenChatModal}
        />
      </div>

      <div style={{ gridColumn: '1 / -1', marginTop: 14 }}>
        <Card title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {t('acct.taxReference')}
            <InfoTooltip term="tax_data_status" lang={lang} />
          </span>
        }>
          <p className="v2-muted v2-small" style={{ margin: '0 0 14px' }}>
            {t('acct.taxReferenceSub')}
          </p>
          {isForbidden && (
            <div className="v2-inline-err" role="alert" style={{ marginBottom: 12 }}>
              {t('acct.taxAccessDenied')}
            </div>
          )}
          {isOffline && (
            <div className="v2-banner v2-tone-warn" style={{ marginBottom: 12 }}>
              <I.warn size={16} />
              <span className="v2-banner-text">{t('acct.taxOfflineNotice')}</span>
            </div>
          )}
          {isServerError && (
            <div className="v2-inline-err" role="alert" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{t('acct.taxServerErr')}</span>
              <button type="button" className="v2-btn v2-btn-sm" onClick={taxCardsApi.reload}>
                {t('acct.taxRetry')}
              </button>
            </div>
          )}
          {isMalformed && (
            <div className="v2-inline-err" role="alert" style={{ marginBottom: 12 }}>
              {t('acct.taxMalformed')}
            </div>
          )}
          {taxCardsApi.loading && <Skeleton rows={4} />}
          {isEmpty && (
            <p className="v2-muted" style={{ padding: '20px 0', textAlign: 'center' }}>
              {t('acct.taxEmpty')}
            </p>
          )}
          {!taxCardsApi.loading && !isForbidden && !isServerError && !isMalformed && !isEmpty && (taxCards.length > 0 || isOffline) && (
            <div className="tax-cards-grid">
              {taxCards.map(card => (
                <TaxKnowledgeCard
                  key={card.topic_id}
                  card={card}
                  lang={lang}
                  onAskAccountant={(qText) => {
                    setAskQuery(qText)
                    if (onOpenChatModal) {
                      onOpenChatModal(qText)
                    }
                  }}
                />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function PackagesTab({ month }) {
  const t = useT()
  const lang = useLang()
  const [filter, setFilter] = useState('all')
  const [sel, setSel] = useState(null)
  const tx = useApi('/transactions?period=all')
  const debts = useApi('/debts')
  const rules = useApi('/accountant/rules')
  // A slip is expected only when the verified engine has a withholding rate (as on Bill detail).
  const slipNeeded = findWithholdingRule(rules.data?.rules || [])?.rate != null
  const slips = useApi('/withholding-slips')
  const rows = useMemo(() => packages({ month, slipNeeded, slips: slips.data, transactions: Array.isArray(tx.data) ? tx.data : [], debts: Array.isArray(debts.data) ? debts.data : [] }), [month, tx.data, debts.data, slipNeeded, slips.data])
  if (tx.loading || debts.loading) return <Card><Skeleton rows={6} /></Card>
  if (tx.error) return <ErrorBox error={tx.error} onRetry={tx.reload} />
  const s = packageSummary(rows)
  const shown = rows.filter((r) => filter === 'all' || (filter === 'incomplete' ? r.status !== 'complete' : r.kind === filter))
  const cur = rows.find((r) => r.key === sel) || shown.find((r) => r.status !== 'complete') || null

  return (
    <div className="v2-page">
      <div className="v2-tiles">
        <div className="v2-tile"><span className="v2-tile-label">{t('acct.pk.complete')}</span><span className="v2-tile-val v2-num">{s.complete}</span><span className="v2-tile-sub">{t('acct.pk.ofN', { n: s.total })}</span></div>
        <div className="v2-tile"><span className="v2-tile-label">{t('acct.pk.missing')}</span><span className="v2-tile-val v2-num">{s.missing}</span></div>
        <div className="v2-tile"><span className="v2-tile-label">{t('acct.pk.nocat')}</span><span className="v2-tile-val v2-num">{s.nocat}</span></div>
        <div className="v2-tile"><span className="v2-tile-label">{t('acct.pk.slips')}</span>
          {s.slipsToMake == null
            ? <><span className="v2-tile-val v2-muted">—</span><span className="v2-tile-sub">{t('bill.doc.notTracked')}</span></>
            : <span className="v2-tile-val v2-num">{s.slipsToMake}</span>}</div>
      </div>
      <div className="v2-grid-detail">
        <Card className="v2-col">
          <div className="v2-chips" role="group" aria-label={t('acct.pk.filter')}>
            {['all', 'incomplete', 'out', 'in', 'payroll'].map((k) => (
              <button key={k} type="button" className="v2-chip v2-chip-sel" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {k === 'all' ? t('acct.pk.f.allN', { n: rows.length }) : k === 'incomplete' ? t('acct.pk.f.incompleteN', { n: rows.length - s.complete }) : t(`acct.pk.f.${k}`)}
              </button>
            ))}
          </div>
          {shown.length === 0 ? <Empty icon={<I.documents size={28} />} title={t('acct.pk.emptyTitle')} text={t('acct.pk.emptyText')} /> : (
            <ul className="v2-pklist">
              {shown.map((r) => (
                <li key={r.key}>
                  <button type="button" className={`v2-pkrow${cur?.key === r.key ? ' is-on' : ''}`} onClick={() => setSel(r.key)} aria-pressed={cur?.key === r.key}>
                    <span className="v2-num v2-pk-date">{shortDate(r.date, lang)}</span>
                    <span className="v2-pk-what"><strong>{r.label || '—'}</strong>{r.note && <span className="v2-muted v2-small">{r.note}</span>}</span>
                    <span className={`v2-num v2-r ${r.kind === 'in' ? 'v2-pos' : ''}`}>{money(r.kind === 'in' ? r.amount : -r.amount, { sign: true })}</span>
                    <Pill tone={r.status === 'complete' ? 'good' : r.status === 'missing' ? 'warn' : r.status === 'nocat' ? 'crit' : 'neutral'}>
                      {r.status === 'missing' ? t('acct.pk.st.missingN', { n: r.missing }) : t(`acct.pk.st.${r.status}`)}</Pill>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <aside className="v2-col">
          {cur && (
            <Card title={cur.label || '—'}>
              <p className="v2-muted v2-small">{shortDate(cur.date, lang)} · {money(cur.amount)}</p>
              <ul className="v2-check">
                {cur.items.map((i) => (
                  <li key={i.key} className={i.done ? 'is-done' : ''}>
                    <span className="v2-check-mark" aria-hidden="true">{i.done ? <I.check size={14} /> : null}</span>
                    <span className="v2-check-text"><span>{t(`acct.pk.item.${i.key}`)}</span>
                      <span className="v2-muted v2-small">{i.done ? t('bill.doc.have') : i.unknown ? t('bill.doc.notTracked') : i.pending ? t('bill.doc.proofSub') : i.review ? t('bill.ck.notChecked') : t('bill.doc.missing')}</span></span>
                    {!i.done && !i.unknown && !i.pending && (i.review || i.key === 'slip'
                      ? <Link to={`/business/${cur.kind === 'in' ? 'receivables' : 'payables'}/${cur.id}`}>{t('bills.open')}</Link>
                      : i.key === 'category'
                      ? <Link to="/business/transactions">{t('tx.chooseCategory')}</Link>
                      : <Link to="/business/documents">{t('bill.upload')}</Link>)}
                  </li>
                ))}
              </ul>
              {cur.key.startsWith('debt:') && <Link to={`/business/${cur.kind === 'in' ? 'receivables' : 'payables'}/${cur.id}`}>{t('bills.open')}</Link>}
              <NotYet note={t('acct.packageSoon')}>{t('acct.pk.downloadFolder')}</NotYet>
            </Card>
          )}
          <Card title={t('acct.pk.whatTitle')}><p className="v2-sec">{t('acct.pk.what')}</p></Card>
        </aside>
      </div>
    </div>
  )
}

function TaxesTab({ month }) {
  const t = useT()
  const lang = useLang()
  const summary = useApi('/accountant/summary')
  if (summary.loading) return <Card><Skeleton rows={6} /></Card>
  if (summary.error) return <ErrorBox error={summary.error?.status === 403 ? t('dec.forbidden') : summary.error} onRetry={summary.reload} />
  const events = complianceEvents(summary.data)
  const inM = events.filter((e) => String(e.due_date).slice(0, 7) === month)
  const today = new Date().toISOString().slice(0, 10)
  const nextDue = events.find((e) => e.due_date >= today && eventStage(e) !== 'done')
  const later = events.filter((e) => String(e.due_date).slice(0, 7) > month)
  const missing = summary.data?.missing_profile_fields || []

  return (
    <div className="v2-grid-detail">
      <div className="v2-col">
        <Card title={monthLabel(month, lang)}>
          {missing.length > 0 && (
            <div className="v2-banner v2-tone-warn"><I.warn size={18} /><span className="v2-banner-text">{t('acct.profileMissing', { n: missing.length })}</span><Btn to="/business/accountant/tax-profile">{t('acct.tab.profile')}</Btn></div>
          )}
          <table className="v2-cal">
            <caption className="v2-sr">{t('acct.calCaption', { m: monthLabel(month, lang) })}</caption>
            <thead><tr>{[1, 2, 3, 4, 5, 6, 0].map((d) => <th key={d} scope="col">{new Date(2024, 0, d === 0 ? 7 : d).toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang === 'id' ? 'id-ID' : 'en-GB', { weekday: 'short' })}</th>)}</tr></thead>
            <tbody>
              {monthGrid(month).map((w, i) => (
                <tr key={i}>
                  {w.map((c, j) => {
                    if (!c) return <td key={j} className="v2-cal-empty" />
                    const evs = inM.filter((e) => String(e.due_date).slice(0, 10) === c.iso)
                    return (
                      <td key={j} className={`${c.iso === today ? 'is-today' : ''}${evs.length ? ' has-ev' : ''}`}>
                        <span className="v2-cal-day">{c.day}</span>
                        {evs.map((e) => <span key={e.id || e.rule_code} className={`v2-cal-ev v2-tone-${eventStage(e) === 'overdue' ? 'crit' : 'warn'}`}>{e.title || e.rule_code}</span>)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title={t('acct.stepByStep')}>
          <TaxList events={inM} lang={lang} t={t} limit={50} />
          <p className="v2-muted v2-small">{t('acct.calNote')}</p>
        </Card>
        <Card title={t('acct.ahead')}>
          <TaxList events={later} lang={lang} t={t} limit={12} empty="acct.noLater" />
          {/* No link to /accountant/calendar: that page calls the write-on-read endpoint (DECISIONS Q5). */}
        </Card>
      </div>
      <aside className="v2-col">
        <Card title={t('acct.nextDeadline')}>
          {nextDue ? (
            <>
              <p className="v2-dec-title">{nextDue.title || nextDue.rule_code} · {shortDate(nextDue.due_date, lang)}</p>
              <p className="v2-stat-mid v2-num">{nextDue.estimated_amount != null ? money(nextDue.estimated_amount) : t('acct.amountByEngine')}</p>
            </>
          ) : <p className="v2-muted">{t('acct.noEvents')}</p>}
          <NotYet note={t('placeholder.soon')}>{t('acct.billingCodes')}</NotYet>
        </Card>
        <Card title={t('acct.reminders')}>
          <p className="v2-sec">{t('acct.remindersText')}</p>
          <NotYet note={t('placeholder.soon')}>{t('acct.reminderSettings')}</NotYet>
        </Card>
      </aside>
    </div>
  )
}

export default function Accountant() {
  const t = useT()
  const { token } = useAuth()
  const { active, scopeKey } = useWorkspace()
  const [sp, setSp] = useSearchParams()
  const tab = ['packages', 'taxes'].includes(sp.get('tab')) ? sp.get('tab') : 'close'
  // Read from the URL on every render: validated, and reset to the tab's default on a tab
  // switch (the tab links carry no month).
  const month = accountantMonth(sp.get('month'), tab)
  const pickMonth = (m) => { const n = new URLSearchParams(sp); n.set('month', m); setSp(n, { replace: true }) }
  const sub = t(`acct.sub.${tab}`)

  const [chatModalOpen, setChatModalOpen] = useState(false)
  const [chatInitialQuery, setChatInitialQuery] = useState('')

  // Clean initial query and close modal whenever active company or scope changes
  useEffect(() => {
    setChatInitialQuery('')
    setChatModalOpen(false)
  }, [active?.id, scopeKey])

  useEffect(() => {
    const askParam = sp.get('ask') || sp.get('q')
    if (askParam) {
      setChatInitialQuery(askParam)
      setChatModalOpen(true)
      const nextSp = new URLSearchParams(sp)
      nextSp.delete('ask')
      nextSp.delete('q')
      setSp(nextSp, { replace: true })
    }
  }, [sp, setSp])

  const handleOpenChat = (queryText) => {
    setChatInitialQuery(queryText || '')
    setChatModalOpen(true)
  }

  const handleCloseChat = () => {
    setChatModalOpen(false)
    setChatInitialQuery('')
  }

  return (
    <div className="v2-page">
      <PageHead title={t('nav.accountant')} sub={sub} actions={<><MonthPicker value={month} onChange={pickMonth} /><Btn to="/business/accountant/classic">{t('bills.classic')}</Btn></>} />
      <AccountantTabs active={tab} />
      {tab === 'close' && <CloseTab month={month} onOpenChatModal={handleOpenChat} />}
      {tab === 'packages' && <PackagesTab month={month} />}
      {tab === 'taxes' && <TaxesTab month={month} />}
      <AccountantChatModal
        open={chatModalOpen}
        onClose={handleCloseChat}
        companyName={active?.name || ''}
        token={token}
        activeBusinessId={active?.id}
        scopeKey={scopeKey}
        initialQuery={chatInitialQuery}
      />
    </div>
  )
}

