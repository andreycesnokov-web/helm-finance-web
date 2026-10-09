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
import { monthOptions, accountantMonth, closeReadiness, packages, packageSummary, monthGrid, complianceEvents, eventStage, packageExportData, createAccountantZipPackage, dedupeDocumentLinks, determineUnreconciledReason, UNRECONCILED_REASONS, reasonMeta } from '../lib/accounting'
import { documentFileUrl } from '../lib/actions'
import { money, shortDate } from '../lib/format'
import { askAccountant } from '../lib/ask'
import AccountantTabs from '../components/AccountantTabs'
import UnreconciledTxDrawer from '../components/UnreconciledTxDrawer'
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

// The rule's name in the user's language; the stored English title is the fallback.
export const ruleTitle = (t, e) => { const k = `acct.rule.${e.rule_code}`; const v = t(k); return v && v !== k ? v : (e.title || e.rule_code) }

// What the company's own records give for last month (GET /api/accountant/obligations — the
// deterministic engine: PPh 21/26 from payroll deduction lines; PPh 23 and PPN need data the app
// does not record yet). Formerly the classic Workbench's "Tax obligations" + "Tax reserve".
const OBL_STATUS_TONE = { calculated: 'warn', insufficient_data: 'neutral', unavailable: 'neutral' }
function FromYourData({ obl, t, lang }) {
  if (obl.loading) return <Card><Skeleton rows={3} /></Card>
  if (obl.error) return null   // the role may not read obligations (manager / employee)
  const list = obl.data?.obligations || []
  const reserve = Number(obl.data?.reserve?.amount || 0)
  return (
    <Card title={t('acct.fromData.title', { m: obl.data?.period ? monthLabel(obl.data.period, lang) : '' })}
      aside={<span className="v2-row-gap"><Link to="/business/accountant/tax-split">{t('acct.fromData.split')}</Link><Link to="/business/accountant/settlement">{t('acct.fromData.settlement')}</Link></span>}>
      <p className="v2-stat-mid v2-num">{reserve > 0 ? money(reserve) : '—'}</p>
      <p className="v2-muted v2-small">{t(reserve > 0 ? 'acct.fromData.reserve' : 'acct.fromData.noReserve')}</p>
      <ul className="v2-taxlist">
        {list.map((o) => (
          <li key={o.obligation_type}>
            <span className="v2-num v2-taxlist-date">{o.due_date ? shortDate(o.due_date, lang) : '—'}</span>
            <span className="v2-taxlist-what"><strong>{t(`acct.fromData.name.${o.obligation_type}`)}</strong>
              <span className="v2-muted"> · {t(`acct.fromData.why.${o.obligation_type}.${o.status}`)}</span></span>
            <span className="v2-num v2-r">{o.status === 'calculated' ? money(o.amount) : '—'}</span>
            <Pill tone={OBL_STATUS_TONE[o.status] || 'neutral'}>{t(`acct.fromData.st.${o.status}`)}</Pill>
          </li>
        ))}
      </ul>
      <p className="v2-muted v2-small">{t('acct.fromData.note')}</p>
    </Card>
  )
}

export function TaxList({ events, lang, t, limit, empty = 'acct.noEvents' }) {
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
              <strong>{ruleTitle(t, e)}</strong>
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
            <span className="v2-num v2-r">{e.estimated_amount != null ? money(e.estimated_amount) : e.nil_return && e.nil_rule === 'required' ? money(0) : '—'}</span>
            <Pill tone={STAGE_TONE[stage]}>{t(`acct.stage.${stage}`)}</Pill>
            {(e.pay_by || e.nil_return || e.verified === false || e.documents > 0) && (
              <span className="v2-taxlist-more v2-small">
                {e.pay_by && e.pay_by !== e.due_date && <span>{t('acct.payBy', { d: shortDate(e.pay_by, lang) })}</span>}
                {e.nil_return && <span className={e.nil_rule === 'required' ? 'v2-taxlist-nil' : 'v2-muted'}>{t(e.nil_rule === 'required' ? 'acct.nilReturn' : 'acct.nilOptional')}</span>}
                {e.documents > 0 && <span>{t('acct.docsN', { n: e.documents })}</span>}
                {e.verified === false && <span className="v2-muted">{t('acct.generalDeadline')}</span>}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

const REASON_ICON = { no_statement: 'upload', statement_unconfirmed: 'clock', no_match: 'search', requires_clarification: 'info' }

// "Unreconciled bank transactions": counters by reason, groups by account, one row per
// transaction. Only the "Investigate" button opens the drawer; the reason pill toggles the
// explanation block under the row (the row itself is not a button).
function UnreconciledCard({ items, month, lang, wallets, batches, expanded, onToggle, onOpen }) {
  const t = useT()
  const groups = new Map()
  for (const ut of items) {
    const wId = String(ut.wallet_id || 'unassigned')
    if (!groups.has(wId)) groups.set(wId, [])
    groups.get(wId).push(ut)
  }
  const diagnosed = Array.from(groups.entries()).map(([wId, groupTxs]) => {
    const walletObj = wallets.find((w) => String(w.id) === String(wId))
    return {
      wId, walletObj,
      rows: groupTxs.map((gt) => ({ tx: gt, diagnosis: determineUnreconciledReason({ tx: gt, month, wallet: walletObj, batches }) })),
    }
  })
  const counts = Object.fromEntries(UNRECONCILED_REASONS.map((x) => [x.code, 0]))
  for (const g of diagnosed) for (const { diagnosis } of g.rows) counts[reasonMeta(diagnosis.reason).code] += 1

  return (
    <section className="v2-card v2-acct-unrec" aria-labelledby="acct-unrec-title">
      <div className="v2-acct-unrec-head">
        <h2 className="v2-h2 v2-acct-unrec-title" id="acct-unrec-title">
          <I.warn size={18} />
          <span>{t('acct.unlinked.title')} <span className="v2-num">({items.length})</span></span>
        </h2>
        <ul className="v2-acct-reasons" aria-label={t('acct.unlinked.countsLabel')}>
          {UNRECONCILED_REASONS.filter((x) => counts[x.code] > 0).map((x) => {
            const Ic = I[REASON_ICON[x.code]]
            return (
              <li key={x.code} className={`v2-acct-reason v2-tone-${x.tone}`}>
                <Ic size={14} />
                <span>{t(x.countKey)}</span>
                <span className="v2-num">{counts[x.code]}</span>
              </li>
            )
          })}
        </ul>
      </div>
      <p className="v2-muted v2-small v2-acct-unrec-sub">{t('acct.unlinked.sub')}</p>

      <div className="v2-acct-groups">
        {diagnosed.map(({ wId, walletObj, rows }) => {
          const wName = walletObj?.name || (wId === 'unassigned' ? t('acct.unlinked.unknownAccount') : 'Bank')
          const wCurrency = walletObj?.currency || rows[0]?.tx?.currency || 'IDR'
          const kindLabel = walletObj?.type ? (() => { const k = t(`acc.kind.${walletObj.type}`); return k === `acc.kind.${walletObj.type}` ? walletObj.type : k })() : null
          const allNoStatement = rows.length > 0 && rows.every((d) => d.diagnosis.reason === 'no_statement')
          const allUnconfirmed = rows.length > 0 && rows.every((d) => d.diagnosis.reason === 'statement_unconfirmed')
          const firstBatchId = rows[0]?.diagnosis?.batch?.id
          return (
            <div key={wId} className="v2-unlinked-group">
              <div className="v2-unlinked-group-head">
                <span className="v2-unlinked-group-title">{wName}</span>
                <span className="v2-unlinked-group-meta">
                  <span>{t('acct.unlinked.opsCount', { n: rows.length })}</span>
                  <span aria-hidden="true">·</span>
                  <span className="v2-num">{wCurrency}</span>
                  {kindLabel && <><span aria-hidden="true">·</span><span>{kindLabel}</span></>}
                </span>
              </div>

              {allNoStatement && (
                <div className="v2-unlinked-banner">
                  <span className="v2-unlinked-banner-text"><I.upload size={16} />{t('acct.unlinked.allNoStatement', { n: rows.length })}</span>
                  <Link
                    to={`/business/bank-import?wallet_id=${encodeURIComponent(wId)}&month=${encodeURIComponent(month)}`}
                    className="v2-btn v2-btn-sm v2-btn-primary"
                  >
                    {t('acct.unlinked.uploadStatement')}
                  </Link>
                </div>
              )}
              {!allNoStatement && allUnconfirmed && (
                <div className="v2-unlinked-banner">
                  <span className="v2-unlinked-banner-text"><I.clock size={16} />{t('acct.unlinked.allUnconfirmed', { n: rows.length })}</span>
                  <Link
                    to={`/business/bank-import?wallet_id=${encodeURIComponent(wId)}&month=${encodeURIComponent(month)}${firstBatchId ? `&batchId=${encodeURIComponent(firstBatchId)}` : ''}`}
                    className="v2-btn v2-btn-sm v2-btn-secondary"
                  >
                    {t('acct.unlinked.reviewStatement')}
                  </Link>
                </div>
              )}

              <ul className="v2-unlinked-list">
                {rows.map(({ tx: ut, diagnosis }) => {
                  const isIncome = ut.type === 'income' || ut.type === 'cash_in'
                  const isExpanded = !!expanded[ut.id]
                  const meta = reasonMeta(diagnosis.reason)
                  const Ic = I[REASON_ICON[meta.code]]
                  const detailId = `acct-reason-${String(ut.id).replace(/[^A-Za-z0-9_-]/g, '_')}`
                  const title = ut.description || (isIncome ? t('tx.k.in') : t('tx.k.out'))
                  return (
                    <li key={ut.id} className={`v2-unlinked-item${isExpanded ? ' is-open' : ''}`}>
                      <div className="v2-urow-main">
                        <span className="v2-urow-title">{title}</span>
                        <span className="v2-urow-meta">
                          {ut.date && <span className="v2-num">{ut.date}</span>}
                          {ut.category && <><span aria-hidden="true">·</span><span>{ut.category}</span></>}
                          <span aria-hidden="true">·</span>
                          <span className={`v2-urow-kind ${isIncome ? 'is-in' : 'is-out'}`}>{isIncome ? t('tx.k.in') : t('tx.k.out')}</span>
                        </span>
                      </div>
                      <div className="v2-urow-status">
                        <button
                          type="button"
                          className={`v2-reason-toggle v2-tone-${meta.tone}`}
                          aria-expanded={isExpanded}
                          aria-controls={detailId}
                          onClick={() => onToggle(ut.id)}
                        >
                          <Ic size={14} />
                          <span className="v2-reason-toggle-text">{t(meta.badgeKey)}</span>
                          <I.chevDown size={14} className={isExpanded ? 'v2-reason-chev is-open' : 'v2-reason-chev'} />
                        </button>
                      </div>
                      <span className={`v2-urow-amount v2-num ${isIncome ? 'is-in' : 'is-out'}`}>
                        {isIncome ? '+' : '−'}{money(ut.amount, ut.currency)}
                      </span>
                      <div className="v2-urow-action">
                        <Btn variant="secondary" className="v2-btn-sm v2-urow-review" onClick={() => onOpen(ut.id)} aria-label={`${t('acct.unlinked.reviewBtn')}: ${title}`}>
                          {t('acct.unlinked.reviewBtn')}
                        </Btn>
                      </div>
                      {isExpanded && (
                        <div className="v2-reason-detail-box" id={detailId}>
                          <div className="v2-reason-detail-text">
                            <span className="v2-reason-detail-label">{t('acct.unlinked.whyLabel')}</span>
                            <p>{t(diagnosis.reasonKey, diagnosis.params)}</p>
                          </div>
                          {diagnosis.actionRoute && diagnosis.actionLabelKey && (
                            <Link to={diagnosis.actionRoute} className="v2-btn v2-btn-sm v2-btn-primary v2-reason-detail-action">
                              {t(diagnosis.actionLabelKey)}
                            </Link>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function CloseTab({ month, onOpenChatModal }) {
  const t = useT()
  const lang = useLang()
  const { active, scopeKey } = useWorkspace()
  const { token } = useAuth()
  const [askQuery, setAskQuery] = useState('')
  const [exportLang, setExportLang] = useState('id')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)
  const [selectedTxId, setSelectedTxId] = useState(null)
  const [expandedReasons, setExpandedReasons] = useState({})
  const exportControllerRef = useRef(null)

  useEffect(() => {
    setAskQuery('')
    setSelectedTxId(null)
    setExpandedReasons({})
  }, [active?.id, scopeKey])

  useEffect(() => {
    if (exportControllerRef.current) {
      exportControllerRef.current.abort()
      exportControllerRef.current = null
    }
    setExporting(false)
    setExportError(null)
    setSelectedTxId(null)
    setExpandedReasons({})
  }, [active?.id, month])
  const tx = useApi('/transactions?period=all')
  const debts = useApi('/debts')
  const batches = useApi('/bank-import/batches')
  const wallets = useApi('/wallets')
  const docs = useApi('/documents')
  const categories = useApi('/cashflow-categories')
  const summary = useApi('/accountant/summary')
  const taxCal = useApi('/accountant/tax-calendar')
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

  const selectedTx = useMemo(() => {
    if (!selectedTxId || !r.unlinked_transactions) return null
    return r.unlinked_transactions.find((ut) => String(ut.id) === String(selectedTxId)) || null
  }, [selectedTxId, r.unlinked_transactions])

  if (tx.loading || debts.loading) return <Card><Skeleton rows={6} /></Card>
  if (tx.error) return <ErrorBox error={tx.error} onRetry={tx.reload} />
  const events = taxCal.data?.events || complianceEvents(summary.data)
  const [y, m] = month.split('-').map(Number)
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`
  const due = events.filter((e) => String(e.due_date).slice(0, 7) === next)
  const dueSum = due.reduce((s, e) => s + (e.estimated_amount != null ? Number(e.estimated_amount) : 0), 0)
  const left = r.checks.filter((c) => !c.done)


  const reconCheck = r.checks.find((c) => c.key === 'reconciliation')
  const statementsCheck = r.checks.find((c) => c.key === 'statements')
  const bankReconPending = (reconCheck && !reconCheck.done) || (statementsCheck && !statementsCheck.done)

  const handleDownload = async () => {
    if (exportControllerRef.current) {
      exportControllerRef.current.abort()
    }
    const controller = new AbortController()
    exportControllerRef.current = controller
    const currentBizId = active?.id
    const currentMonth = month
    const packageLang = exportLang || 'id'

    setExporting(true)
    setExportError(null)
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
        lang: packageLang,
        signal: controller.signal,
        fetchSignedUrl: async (docId, mode = 'download', bizId, sig) => {
          // The scope header is the active business; a switch aborts the export.
          if (bizId && String(bizId) !== String(currentBizId)) return null
          const resp = await documentFileUrl(token, docId, mode, sig || controller.signal)
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
      setExportError(err.message || 'Export error')
    } finally {
      if (exportControllerRef.current === controller) {
        exportControllerRef.current = null
        setExporting(false)
      }
    }
  }

  const statusTitle = r.percent == null
    ? t('acct.noRecords')
    : left.length === 0
    ? (r.is_closed ? t('acct.closed') : t('acct.preparedForReview'))
    : (r.percent === 100 && bankReconPending)
    ? t('acct.reconciliationRequired')
    : t('acct.almost', { n: r.percent, k: left.length })
  const statusSub = left.length === 0 && !r.is_closed
    ? t('acct.awaitingAccountantSignoff', { n: r.complete, m: r.records })
    : (r.percent === 100 && bankReconPending)
    ? t('acct.recordCompletenessDetails', { pct: 100, done: r.checks.length - left.length, total: r.checks.length })
    : t('acct.recordsComplete', { n: r.complete, m: r.records })

  return (
    <div className="v2-acct-close">
      {/* Top row: readiness + checklist (left), taxes + ask (right). One column below 1180px. */}
      <div className="v2-acct-top">
        <Card className="v2-acct-status">
          <div className="v2-acct-status-head">
            <span className="v2-acct-status-label">{t('acct.closeOf', { m: monthLabel(month, lang) })}</span>
            <h2 className="v2-acct-status-title">{statusTitle}</h2>
            <p className="v2-acct-status-sub">{statusSub}</p>
          </div>
          <div className="v2-acct-actions">
            <NotYet note={t('acct.reviewSoon')}>{t('acct.sendToAccountant')}</NotYet>
            <div className="v2-acct-lang">
              <label htmlFor="accountant-export-lang">{t('acct.exportLang')}</label>
              <select
                id="accountant-export-lang"
                className="v2-select"
                value={exportLang}
                disabled={exporting}
                onChange={(e) => setExportLang(e.target.value)}
              >
                <option value="id">Bahasa Indonesia</option>
                <option value="en">English</option>
              </select>
            </div>
            <button
              type="button"
              className="v2-btn v2-btn-secondary"
              disabled={exporting}
              onClick={handleDownload}
            >
              {exporting ? '…' : t('acct.download')}
            </button>
          </div>
          {exportError && (
            <div className="v2-acct-note v2-acct-note-crit" role="alert">
              <I.warn size={16} />
              <span>{t('acct.exportError')}</span>
              <button type="button" className="v2-btn v2-btn-ghost v2-btn-sm" onClick={handleDownload}>
                {t('acct.exportRetry')}
              </button>
            </div>
          )}
          {left.length > 0 && (
            <div className="v2-acct-note v2-acct-note-warn">
              <I.warn size={16} />
              <span>{t('acct.incompleteDownloadWarning', { k: left.length })}</span>
            </div>
          )}
          <h3 className="v2-h3 v2-acct-checktitle">{t('acct.toFinish', { m: monthLabel(month, lang) })}</h3>
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
        <div className="v2-col v2-acct-side">
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
      </div>

      {r.unlinked_transactions?.length > 0 && (
        <UnreconciledCard
          items={r.unlinked_transactions}
          month={month}
          lang={lang}
          wallets={wallets.data?.wallets || []}
          batches={batches.data?.batches || []}
          expanded={expandedReasons}
          onToggle={(txId) => setExpandedReasons((prev) => ({ ...prev, [txId]: !prev[txId] }))}
          onOpen={(txId) => setSelectedTxId(txId)}
        />
      )}

      <div className="v2-acct-wide">
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

      {selectedTx && (
        <UnreconciledTxDrawer
          tx={selectedTx}
          month={month}
          activeBusinessId={active?.id}
          scopeKey={scopeKey}
          wallets={wallets.data?.wallets || []}
          batches={batches.data?.batches || []}
          debts={enrichedDebts}
          docs={Array.isArray(docs.data?.documents) ? docs.data.documents : []}
          categories={Array.isArray(categories.data) ? categories.data : []}
          token={token}
          onClose={() => setSelectedTxId(null)}
          onSaved={(updated) => {
            if (typeof window !== 'undefined' && typeof window.__onDrawerSaved === 'function') {
              window.__onDrawerSaved(updated)
            }
          }}
          onTxUpdated={(updated) => {
            if (typeof window !== 'undefined' && typeof window.__onDrawerTxUpdated === 'function') {
              window.__onDrawerTxUpdated(updated)
            }
            tx.reload()
            summary.reload()
          }}
        />
      )}
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
  // GET /api/accountant/tax-calendar is read-only (no write-on-read): general deadlines while the
  // rules await review, merged with stored obligations, nil returns for months with no activity.
  const summary = useApi('/accountant/tax-calendar')
  const obl = useApi('/accountant/obligations')
  if (summary.loading) return <Card><Skeleton rows={6} /></Card>
  if (summary.error) return <ErrorBox error={summary.error?.status === 403 ? t('dec.forbidden') : summary.error} onRetry={summary.reload} />
  const events = summary.data?.events || []
  const inM = events.filter((e) => String(e.due_date).slice(0, 7) === month)
  const overdue = events.filter((e) => e.stage === 'overdue')
  const today = new Date().toISOString().slice(0, 10)
  const nextDue = events.find((e) => e.due_date >= today && eventStage(e) !== 'done')
  const later = events.filter((e) => String(e.due_date).slice(0, 7) > month)
  const missing = summary.data?.missing_profile_fields || []
  const undecided = summary.data?.undecided || []

  return (
    <div className="v2-grid-detail">
      <div className="v2-col">
        {(!summary.data?.has_profile || undecided.length > 0) && (
          <Card title={t('acct.setup.title')}>
            <p className="v2-sec">{t('acct.setup.why')}</p>
            <ol className="v2-setup">
              <li><Link to="/business/documents?tab=company">{t('acct.setup.docs')}</Link></li>
              <li><Link to="/business/accountant/tax-profile">{t('acct.setup.profile')}</Link>
                {undecided.length > 0 && <span className="v2-muted v2-small"> · {undecided.map((u) => t(`acct.setup.q.${u}`)).join(' · ')}</span>}</li>
              <li>{t('acct.setup.done')}</li>
            </ol>
          </Card>
        )}
        <FromYourData obl={obl} t={t} lang={lang} />
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
                        {evs.map((e) => <span key={e.id || e.rule_code} className={`v2-cal-ev v2-tone-${eventStage(e) === 'overdue' ? 'crit' : 'warn'}`}>{ruleTitle(t, e)}</span>)}
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
        {overdue.length > 0 && (
          <Card title={t('acct.overdueTitle', { n: overdue.length })}>
            <TaxList events={overdue} lang={lang} t={t} limit={24} />
          </Card>
        )}
        <Card title={t('acct.ahead')}>
          <TaxList events={later} lang={lang} t={t} limit={12} empty="acct.noLater" />
          {/* No link to /accountant/calendar: that page calls the write-on-read endpoint (DECISIONS Q5). */}
        </Card>
      </div>
      <aside className="v2-col">
        <Card title={t('acct.nextDeadline')}>
          {nextDue ? (
            <>
              <p className="v2-dec-title">{ruleTitle(t, nextDue)} · {shortDate(nextDue.due_date, lang)}</p>
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
      <PageHead title={t('nav.accountant')} sub={sub} actions={<MonthPicker value={month} onChange={pickMonth} />} />
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

