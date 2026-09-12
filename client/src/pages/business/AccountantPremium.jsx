// AI Accountant — PREMIUM module (P1 of _specs/business-premium-redesign.md).
// Gated by VITE_AI_ACCOUNTANT_PREMIUM; flag OFF renders the existing profile page
// unchanged. In-module tabs: Workbench · Compliance Calendar · Tax Draft · Audit · Tax Profile.
//
// HONESTY CONTRACT: engines calculate, AI explains. Only REAL data is shown as real
// (profile completeness, deterministic obligations from /accountant/applicability,
// payables/receivables presence). Everything the tax engine doesn't provide yet is
// explicitly labelled "preview / engine not connected" — never fake numbers.
// No backend, no migrations. Frontend + existing endpoints only.
//
// CONTAINER ONLY. Presentation lives in AccountantBlocks.jsx, the way Radar, AI CFO
// and Accounts are split, so the gated design preview photographs the real
// components. This file owns auth, the five fetches, the request guard, tab state
// and the statutory schedule; it renders no styling of its own.
//
// NO TAX LOGIC CHANGED IN THE DESIGN PASS. Every rate, threshold, due date,
// obligation rule, endpoint and gate below is the one that shipped. The statutory
// schedule, the reserve, the obligation states and the applicability filter are
// byte-for-byte the previous behaviour; what changed is which component draws them.
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../hooks/useAuth'
import { useTranslation } from '../../hooks/useTranslation'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { BusinessAccountant } from './Accountant'
import { buildDocumentActions, applicableMissingFields } from '../../lib/accountantReadiness'
import { createRequestGuard } from '../../lib/requestGuard'
import { moneyFull, MISSING } from '../../lib/aiCfoFigures'
import {
  AccountantHeader, AccountantTabs, ModuleChips, ReserveCard, CompletenessCard,
  ObligationsCard, PendingActionsCard, CalendarPreviewCard, PlainLanguageCard,
  CalendarGrid, DeadlinesCard, WithholdingCard, DraftCalculationCard,
  DraftExplanationCard, DraftStatusCard, AuditStat, AuditTrailCard,
  AccountantLoading, AccountantError, AccountantNotice, obligationView, RESERVE_CURRENCY,
  AccountantAsk, ASK_SUGGESTIONS,
} from './AccountantBlocks'
import './Accountant.css'

const PREMIUM = import.meta.env.VITE_AI_ACCOUNTANT_PREMIUM === 'true'

const findOb = (obligations, type) => (obligations?.obligations || []).find(o => o.obligation_type === type)

// ── Static Indonesian compliance schedule (deterministic; engine wiring later) ──
// Generic monthly deadlines under Indonesian tax law. Amount/source wiring arrives
// with the tax-engine endpoints; dates themselves are fixed statutory rules.
// UNCHANGED by the design pass — days, keys, kinds and ordering are all as shipped.
export function idComplianceDeadlines(year, month /* 0-based */) {
  const mk = (day, key, title, sub, kind) => ({ day, key, title, sub, kind, date: new Date(year, month, day) })
  return [
    mk(10, 'pph2126', 'PPH 21/26 payment', 'Employee withholding · from Payroll', 'withholding'),
    mk(10, 'pph23', 'PPH 23 payment', 'Service withholding · from Payables', 'service'),
    mk(15, 'pph25', 'PPH 25 installment', 'Corporate income tax installment', 'cit'),
    mk(20, 'pph21file', 'PPH 21/26 filing', 'Monthly withholding return', 'withholding'),
    mk(new Date(year, month + 1, 0).getDate(), 'ppn', 'PPN filing & payment', 'VAT for the previous period · from Invoices', 'ppn'),
  ]
}

export function upcomingDeadlines(n = 3) {
  const now = new Date()
  const list = [
    ...idComplianceDeadlines(now.getFullYear(), now.getMonth()),
    ...idComplianceDeadlines(now.getFullYear(), now.getMonth() + 1),
  ].filter(x => x.date >= new Date(now.getFullYear(), now.getMonth(), now.getDate()))
  return list.sort((a, b) => a.date - b.date).slice(0, n)
}

// Deadline key → obligation type, so each row can show its deterministic amount/state.
const DEADLINE_OB = { pph2126: 'pph_21_26', pph21file: 'pph_21_26', pph23: 'pph_23', ppn: 'ppn' }

// The tax profile form's fields, as the completeness figure counts them:
// country, jurisdiction, entity, npwp, pkp, fy start/end, nib, employees.
const PROFILE_FIELDS = 9

const shortDate = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
const shortDateLoose = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function BusinessAccountantHub() {
  if (!PREMIUM) return <BusinessAccountant />
  return <PremiumAccountant />
}

function PremiumAccountant() {
  const { token } = useAuth()
  const { t, lang } = useTranslation()
  const { active, scopeKey } = useWorkspace()
  const navigate = useNavigate()
  const [tab, setTab] = useState('workbench')
  // Bumped when the Tax Profile tab saves, so the Workbench reloads its checklist:
  // changing PKP status changes which documents are required.
  const [profileVersion, setProfileVersion] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const EMPTY = { loading: true, failed: false, applicability: null, profile: null, pulse: null, obligations: null, checklist: null }
  const [state, setState] = useState(EMPTY)
  // Ignores a response from a workspace the user has already switched away from.
  const guard = useRef(createRequestGuard())
  // The assistant thread. Keyed on the same company signal the page's own
  // fetches use, so a switch clears the conversation and the figures together.
  const ask = useAccountantAsk({ token, activeId: active?.id ?? null, scopeKey, language: lang, t })

  useEffect(() => {
    // Clear FIRST so business A's pending actions can never render under business B.
    setState(EMPTY)
    if (!token || !active) return
    const req = guard.current.start()
    const opts = { signal: req.signal }
    Promise.all([
      apiFetch('/accountant/applicability', token, opts).catch(() => null),
      apiFetch('/accountant/profile', token, opts).catch(() => null),
      apiFetch('/pulse', token, opts).catch(() => null),
      apiFetch('/accountant/obligations', token, opts).catch(() => null),
      // Same source of truth as the Compliance Documents checklist.
      apiFetch('/ai-accountant/required-documents', token, opts).catch(() => null),
    ]).then(([applicability, profile, pulse, obligations, checklist]) => {
      if (req.isStale()) return
      // Every call is individually .catch(null), so "failed" means the whole
      // workbench came back with nothing to show — not a single soft miss.
      const failed = !applicability && !profile && !pulse && !obligations && !checklist
      setState({ loading: false, failed, applicability, profile: profile?.profile || null, pulse, obligations, checklist })
    })
    return () => guard.current.abort()
  }, [token, active?.id, scopeKey, profileVersion, reloadKey])

  const tabs = [
    { key: 'workbench', label: t('accountantHub.tabWorkbench') },
    { key: 'calendar', label: t('accountantHub.tabCalendar') },
    { key: 'taxdraft', label: t('accountantHub.tabDraft') },
    { key: 'audit', label: t('accountantHub.tabAudit') },
    { key: 'profile', label: t('accountantHub.tabProfile') },
  ]

  return (
    <div className="acct-wb">
      <AccountantHeader t={t}
        onTaxSplit={() => navigate('/business/accountant/tax-split')}
        onSettlement={() => navigate('/business/accountant/settlement')} />
      <AccountantTabs t={t} tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'workbench' && <Workbench t={t} state={state} setTab={setTab} navigate={navigate}
        onRetry={() => setReloadKey(k => k + 1)} ask={ask} />}
      {tab === 'calendar' && <CalendarTab t={t} obligations={state.obligations} />}
      {tab === 'taxdraft' && <TaxDraftTab t={t} obligations={state.obligations} />}
      {tab === 'audit' && <AuditTab t={t} />}
      {tab === 'profile' && <BusinessAccountant
        embedded
        onProfileSaved={() => setProfileVersion(v => v + 1)}
        onDocumentsChanged={() => setProfileVersion(v => v + 1)} />}
    </div>
  )
}

/**
 * The Ask AI Accountant thread.
 *
 * Owns the conversation, the in-flight request and — the part that matters —
 * the company it belongs to.
 *
 * COMPANY ISOLATION, on three independent levels, because any one of them alone
 * has a hole:
 *
 *  1. Switching company CLEARS the thread. Not filtered, not hidden — cleared,
 *     synchronously, before any new request can start.
 *  2. A request carries the company id it was issued under. When the response
 *     arrives, the id is compared against the company that is active NOW, and a
 *     mismatch is dropped. This is what catches the slow answer to a question
 *     asked about the company the user has already left.
 *  3. The server echoes `business_id` on every answer and it is checked too. A
 *     client-side guard lives in a closure that a remount can orphan; the
 *     server's own statement of which company it answered for cannot be.
 *
 * Stage one keeps the thread in memory. Nothing is persisted, so there is no
 * stored history to leak across a switch either.
 */
function useAccountantAsk({ token, activeId, scopeKey, language, t }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const [usage, setUsage] = useState(null)
  const [limitHit, setLimitHit] = useState(false)
  const lastQuestion = useRef(null)
  const guard = useRef(createRequestGuard())
  // The company this thread belongs to. Read inside the async continuation so
  // the comparison is against the company active at RESPONSE time, not the one
  // captured when the request was sent.
  const threadScope = useRef(activeId)
  const endRef = useRef(null)
  const inputRef = useRef(null)

  // A different company is a different set of books, so it is a different
  // conversation. Clearing runs on the same signal the page's own fetches key
  // on, so the thread can never outlive the data it was talking about.
  useEffect(() => {
    guard.current.abort()
    threadScope.current = activeId
    setMessages([])
    setInput('')
    setError('')
    setAsking(false)
    setLimitHit(false)
    setUsage(null)
    lastQuestion.current = null
  }, [activeId, scopeKey])

  useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({ block: 'nearest' })
  }, [messages, asking])

  const ask = async (rawQuestion) => {
    const question = String(rawQuestion || '').trim()
    if (!question || asking || limitHit) return
    lastQuestion.current = question

    const askedUnder = activeId
    const req = guard.current.start()
    const id = `q${Date.now()}`
    // The history the server sees is this thread only, and this thread is
    // already company-scoped by the effect above.
    const history = messages.map((m) => ({ role: m.role, text: m.text }))

    setMessages((prev) => [...prev, { id, role: 'user', text: question }])
    setInput('')
    setError('')
    setAsking(true)

    try {
      const data = await apiFetch('/accountant/ask', token, {
        method: 'POST',
        signal: req.signal,
        body: JSON.stringify({ question, language, history }),
      })
      if (req.isStale()) return
      // Level 2 and 3: the company the request was issued under, the company
      // active now, and the company the server says it answered for must all
      // agree. Any disagreement means this answer belongs to a thread that no
      // longer exists on screen.
      if (askedUnder !== threadScope.current) return
      if (data?.business_id && data.business_id !== threadScope.current) return

      setUsage(data.usage || null)
      setMessages((prev) => [...prev, {
        id: `a${Date.now()}`,
        role: 'assistant',
        text: data.answer || '',
        statement_types: data.statement_types || [],
        grounded_sources: data.grounded_sources || [],
        sources_for_review: data.sources_for_review || [],
        missing: data.missing || [],
        next_step: data.next_step || null,
        injection_detected: data.injection_detected === true,
        grounded_rules_available: data.grounded_rules_available === true,
        degraded: data.degraded === true || data.provider_error === true,
      }])
    } catch (e) {
      if (req.isStale()) return
      if (askedUnder !== threadScope.current) return
      const code = e?.data?.code || e?.code
      if (code === 'ai_limit_reached' || e?.status === 429) {
        setLimitHit(true)
        setUsage(e?.data?.usage || null)
        setError('')
      } else if (code === 'forbidden_role' || e?.status === 403) {
        setError(t('accountantHub.askForbidden'))
      } else {
        setError(e?.message || t('accountantHub.askFailed'))
      }
      // The question stays in the thread, and retry re-sends it. Dropping it
      // would make a failed request look like one the user never made.
    } finally {
      if (!req.isStale() && askedUnder === threadScope.current) setAsking(false)
    }
  }

  return {
    messages, input, asking, error, usage, limitHit,
    setInput, ask,
    retry: () => { if (lastQuestion.current) ask(lastQuestion.current) },
    onKeyDown: (e) => {
      // Enter sends, Shift+Enter is a newline — the convention for a chat box
      // that is a textarea rather than an input.
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input) }
    },
    endRef, inputRef,
  }
}

// ── Workbench (dashboard) ─────────────────────────────────────────────────────
function Workbench({ t, state, setTab, navigate, onRetry, ask }) {
  if (state.loading) return <AccountantLoading rows={5} />
  if (state.failed) return <AccountantError t={t} onRetry={onRetry} />

  const ap = state.applicability || { applicable_rules: [], missing_profile_fields: [] }
  // Fields that do not apply to this profile (vat_status on a Non-PKP company) are not gaps.
  // The Tax Profile badges say "Not required"; the Workbench must not contradict them.
  const missing = applicableMissingFields(state.profile || {}, ap.missing_profile_fields || [])
  const d = state.pulse || {}

  // Profile completeness — REAL: persisted fields present vs missing (deterministic).
  // Same arithmetic as before; the card now reports it as "x of 9 fields", which is
  // what the number has always measured, instead of a bare percentage that read as
  // a compliance verdict.
  const missingCount = Math.min(missing.length, PROFILE_FIELDS)
  const filled = Math.max(0, PROFILE_FIELDS - missingCount)

  // Synced modules — real presence signals from /pulse (no fake counts).
  const chips = [
    { key: 'tx', labelKey: 'accountantHub.modTransactions', ok: (d.recentTxs || []).length > 0 },
    { key: 'recv', labelKey: 'accountantHub.modReceivables', ok: Number(d.receivables || 0) > 0 || Number(d.pendingReceivables || 0) > 0 },
    { key: 'pay', labelKey: 'accountantHub.modPayables', ok: Number(d.payables || 0) > 0 || Number(d.pendingPayables || 0) > 0 },
    // presence unknown here — neutral, and now labelled as unchecked rather than
    // sitting silently among the ticks as if it had been checked and found empty.
    { key: 'payroll', labelKey: 'accountantHub.modPayroll', ok: null },
    { key: 'bank', labelKey: 'accountantHub.modBankImport', ok: null },
  ]

  const nextDeadlines = upcomingDeadlines(3)
  const obs = state.obligations?.obligations || []
  const reserve = state.obligations?.reserve || null

  // Document actions come from the SAME payload the Compliance Documents checklist renders —
  // never from a hardcoded list, which is how the Workbench used to ask for an already
  // uploaded NPWP/NIB. Everything routes to Tax Profile, where the checklist and the upload
  // window live, rather than to the generic Document Center.
  const docActions = buildDocumentActions(state.checklist, { form: state.profile || {} })
  const goDocs = () => setTab('profile')

  const CTA = {
    upload: t('accountantHub.ctaUpload'),
    confirm: t('accountantHub.ctaConfirm'),
  }

  const actions = []
  if (missing.length) {
    actions.push({
      id: 'profile',
      label: t('accountantHub.completeProfile'),
      sub: missing.length === 1
        ? t('accountantHub.completeProfileSubOne')
        : t('accountantHub.completeProfileSubMany').replace('{n}', String(missing.length)),
      cta: t('accountantHub.ctaComplete'),
      go: () => setTab('profile'),
    })
  }
  // Already ordered identity -> tax registration -> payroll by the helper, and each action
  // carries the priority label, so a BPJS row never reads like a foundation document.
  for (const a of docActions.actions) {
    actions.push({
      id: a.id, label: a.label, sub: a.sub, group: a.group, priority: a.priority,
      cta: CTA[a.type] || t('accountantHub.ctaEnter'), go: goDocs,
    })
  }
  if (docActions.available && !docActions.actions.length) {
    actions.push({ id: 'docs-ok', label: t('accountantHub.docsOk'), sub: t('accountantHub.docsOkSub'), cta: t('accountantHub.ctaReview'), go: goDocs })
  }
  if (!docActions.available) {
    actions.push({
      id: 'docs-unknown', label: t('accountantHub.docsUnknown'),
      sub: docActions.reason === 'truncated' ? t('accountantHub.docsTruncated') : t('accountantHub.docsOpenChecklist'),
      cta: t('accountantHub.ctaOpen'), go: goDocs,
    })
  }

  const whatToDo = nextDeadlines[0]
    ? t('accountantHub.plainWhatDue').replace('{title}', nextDeadlines[0].title).replace('{date}', shortDateLoose(nextDeadlines[0].date))
    : t('accountantHub.plainWhatNone')

  return (
    <>
      <ModuleChips t={t} chips={chips} />
      <div className="acct-wb-band">
        <ReserveCard t={t} reserve={reserve} />
        <CompletenessCard t={t} filled={filled} total={PROFILE_FIELDS} missing={missingCount} />
      </div>
      <ObligationsCard t={t} period={state.obligations?.period || ''} obligations={obs} />
      <div className="acct-wb-band">
        <PendingActionsCard t={t} actions={actions} />
        <CalendarPreviewCard t={t} deadlines={nextDeadlines} onOpen={() => setTab('calendar')} formatDay={shortDate} />
      </div>
      <PlainLanguageCard t={t}
        what={whatToDo}
        why={t('accountantHub.plainWhyBody')}
        // `missing` is the FILTERED list — a field that does not apply (vat_status on a
        // Non-PKP company) must not read as an unfinished profile here either.
        prepare={missing.length ? t('accountantHub.plainPrepareMissing') : t('accountantHub.plainPrepareOk')} />
      {/* The accounting question is answered HERE. This used to be a button that
          navigated to AI CFO — which left the section the question was about and
          arrived somewhere that reads cash rather than books. AI CFO itself is
          unchanged and still reachable from the sidebar. */}
      <AccountantAsk
        t={t}
        messages={ask.messages}
        input={ask.input}
        asking={ask.asking}
        error={ask.error}
        usage={ask.usage}
        limitHit={ask.limitHit}
        suggestions={ASK_SUGGESTIONS}
        onInput={ask.setInput}
        onAsk={ask.ask}
        onRetry={ask.retry}
        onKeyDown={ask.onKeyDown}
        inputRef={ask.inputRef}
        endRef={ask.endRef}
      />
    </>
  )
}

// ── Compliance Calendar (real month grid, per owner decision) ─────────────────
function CalendarTab({ t, obligations }) {
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const deadlines = idComplianceDeadlines(ym.y, ym.m)
  // A day can carry more than one statutory deadline — the 10th carries both
  // PPH 21/26 and PPH 23 — so days map to a LIST. Keying one deadline per day
  // silently dropped the second and coloured the cell by whichever came last in
  // the array. The schedule itself is unchanged; only the grid stops discarding
  // half of what it was given.
  const byDay = new Map()
  for (const x of deadlines) byDay.set(x.day, [...(byDay.get(x.day) || []), x])
  const first = new Date(ym.y, ym.m, 1)
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate()
  const lead = (first.getDay() + 6) % 7 // Monday-first
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const title = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const isToday = (day) => !!day && ym.y === now.getFullYear() && ym.m === now.getMonth() && day === now.getDate()

  const rows = deadlines.map(x => {
    const ob = DEADLINE_OB[x.key] ? findOb(obligations, DEADLINE_OB[x.key]) : null
    const v = ob ? obligationView(ob, t) : null
    return {
      id: x.key,
      label: x.title,
      sub: `${shortDate(x.date)} · ${x.sub}`,
      amount: v && v.kind === 'calculated' ? v.amount : shortDate(x.date),
      state: v && v.kind !== 'calculated' ? v : null,
    }
  })

  return (
    <div className="acct-wb-band">
      <CalendarGrid t={t} year={ym.y} month={ym.m} cells={cells} title={title}
        weekdays={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']}
        deadlineFor={(day) => byDay.get(day) || null}
        isToday={isToday}
        onPrev={() => setYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))}
        onNext={() => setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))} />
      <DeadlinesCard t={t} rows={rows} />
    </div>
  )
}

// ── Tax Draft (layout preview — CIT engine not connected; only recorded numbers) ─
function TaxDraftTab({ t, obligations }) {
  const pph21 = findOb(obligations, 'pph_21_26')
  const hasWithholding = pph21 && pph21.status === 'calculated'
  const rows = [
    t('accountantHub.draftGross'), t('accountantHub.draftNonObject'), t('accountantHub.draftOpex'),
    t('accountantHub.draftDeductible'), t('accountantHub.draftNonDeductible'),
  ]
  const sources = [
    { title: 'UU No. 36 / 2008', sub: 'Income tax law' },
    { title: 'PP No. 94 / 2010', sub: 'Implementation reg.' },
  ]
  return (
    <>
      {hasWithholding && (
        <WithholdingCard t={t}
          view={obligationView(pph21, t)}
          sourceLabel={pph21.source_label}
          note={t('accountantHub.withholdingNote')
            .replace('{period}', pph21.period || '')
            .replace('{date}', pph21.due_date ? shortDateLoose(new Date(pph21.due_date)) : MISSING)} />
      )}
      <div className="acct-wb-band">
        <DraftCalculationCard t={t} rows={rows} sources={sources} />
        <DraftExplanationCard t={t} />
      </div>
      <DraftStatusCard t={t} />
    </>
  )
}

// ── Audit trail (P3 — REAL data from GET /api/audit/events, 023 audit_events) ─
function AuditTab({ t }) {
  const { token } = useAuth()
  const { active, scopeKey } = useWorkspace()
  const [state, setState] = useState({ loading: true, events: [], total: 0, error: null })
  const [entityType, setEntityType] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  // The hub guards its own fetches; this tab used to guard with a plain `on` flag,
  // which cancels a setState but not the request, so a slow response from the
  // previous workspace still resolved. Same guard as the hub now.
  const guard = useRef(createRequestGuard())

  useEffect(() => {
    if (!token || !active) return
    const req = guard.current.start()
    setState(s => ({ ...s, loading: true, error: null }))
    apiFetch(`/audit/events?limit=50${entityType ? `&entity_type=${encodeURIComponent(entityType)}` : ''}`, token, { signal: req.signal })
      .then(d => { if (!req.isStale()) setState({ loading: false, events: d.events || [], total: d.total || 0, error: null }) })
      .catch(e => { if (!req.isStale()) setState({ loading: false, events: [], total: 0, error: e.message }) })
    return () => guard.current.abort()
  }, [token, active?.id, scopeKey, entityType, reloadKey])

  if (state.loading) return <AccountantLoading rows={6} />
  // A role that may not read the trail is a boundary, not a fault: no warning
  // icon and no retry, because retrying cannot change the answer.
  if (state.error && /role|forbidden/i.test(state.error)) {
    return <AccountantNotice title={t('accountantHub.auditTitle')} description={t('accountantHub.auditForbidden')} />
  }
  if (state.error) return <AccountantError t={t} onRetry={() => setReloadKey(k => k + 1)} message={state.error} />

  const types = [...new Set(state.events.map(e => e.entity_type))]
  const actors = new Set(state.events.map(e => e.actor_name))
  const fmtTs = (ts) => new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <>
      <div className="acct-wb-band-3">
        <AuditStat k={t('accountantHub.auditTotal')} sub={t('accountantHub.auditTotalSub')} v={state.total.toLocaleString('en-US')} />
        <AuditStat k={t('accountantHub.auditActors')} sub={t('accountantHub.auditActorsSub')} v={actors.size} />
        <AuditStat k={t('accountantHub.auditLatest')} sub={t('accountantHub.auditLatestSub')} ts
          v={state.events[0] ? fmtTs(state.events[0].created_at) : MISSING} />
      </div>
      <AuditTrailCard t={t} events={state.events} types={types} entityType={entityType}
        onEntityType={setEntityType} formatTs={fmtTs} />
    </>
  )
}

// Re-exported so a caller that only needs a money string does not reach past this
// module into the figures library. moneyFull keeps absence as an em dash.
export { moneyFull, RESERVE_CURRENCY }
