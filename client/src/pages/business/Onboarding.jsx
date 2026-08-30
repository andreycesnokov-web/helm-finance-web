// Production Onboarding UI (migration 054 API). Mounted at /business/onboarding inside the
// premium Business shell.
//
// DATA-DRIVEN, NOT SCRIPTED. Every flow, step, title, description and instruction on this
// page comes from GET /api/onboarding/*, already resolved for the requested locale. There is
// no hardcoded step list here: if a deployment seeds a fourth flow or renames a step, this
// page renders it. The only fixed content is UI chrome (button labels, notices) in
// ./onboardingStrings.
//
// NO FINANCIAL EFFECT. Nothing on this page reads or writes transactions, wallets, debts,
// documents, payments, credentials, Telegram or support threads. The only writes are the
// caller's own onboarding progress rows. Opening this page never provisions a business or
// starts a trial — the backend deliberately uses a read-only business context.
//
// DISABLED DEPLOYMENTS. With ONBOARDING_ENABLED off, every route answers 404 before touching
// the database. That is a valid state, not a fault: it renders an explanatory panel, and the
// loading state always terminates.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { getLang } from '../../i18n/index'
import { Icon, PageHeader, StatusBadge, Btn, EmptyState, ErrorState, LoadingSkeleton } from '../../shell/ui'
import onboardingApi, {
  FLOW_KEYS, SUPPORTED_LOCALES, resolveLocale, safeText, isFeatureDisabled,
} from '../../lib/onboardingApi'
import { uiStrings } from './onboardingStrings'
import './Onboarding.css'

const SYMBOL = '/brand/symbol_navy_blue_dot_transparent.svg'

// product_area → icon. Areas come from a CHECK constraint in migration 054; an area added
// later without an entry here falls back to the neutral book icon rather than crashing.
const AREA_ICON = {
  general: 'book', pulse: 'pulse', radar: 'radar', ai_cfo: 'cfo', ai_accountant: 'acct',
  transactions: 'list', accounts: 'wallet', invoices: 'doc', receivables: 'down',
  payables: 'up', funding: 'fund', bank_import: 'bank', incoming_payments: 'arrowDown',
  payment_connections: 'link', intercompany: 'transfer', payroll: 'users',
  approvals: 'check', team: 'team', documents: 'doc', settings: 'cog',
  support: 'book', admin: 'cog',
}

// Rail grouping for the full product tour. Purely presentational — it buckets whatever
// steps the API returns; an unlisted area lands in "workspace" rather than disappearing.
const TOUR_GROUPS = [
  { key: 'overview', areas: ['general', 'pulse', 'radar', 'ai_cfo', 'ai_accountant'] },
  { key: 'finance', areas: ['transactions', 'accounts', 'invoices', 'receivables', 'payables', 'funding'] },
  { key: 'connections', areas: ['bank_import', 'incoming_payments', 'payment_connections'] },
  { key: 'operations', areas: ['intercompany', 'payroll', 'approvals', 'team'] },
  { key: 'workspace', areas: ['documents', 'settings', 'support', 'admin'] },
]

// Per-flow accent + icon. Keyed by the seeded flow_key; an unknown flow still renders with
// the neutral default, so the page never depends on a specific seed being present.
const FLOW_VISUAL = {
  [FLOW_KEYS.quick]: { icon: 'play', accent: 'blue', screen: 'quick' },
  [FLOW_KEYS.tour]: { icon: 'book', accent: 'navy', screen: 'tour' },
  [FLOW_KEYS.accountant]: { icon: 'acct', accent: 'green', screen: 'accountant' },
}
const DEFAULT_VISUAL = { icon: 'book', accent: 'navy', screen: 'quick' }
const visualFor = (flowKey) => FLOW_VISUAL[flowKey] || DEFAULT_VISUAL

// ?flow= short names, so the single /business/onboarding route stays deep-linkable.
const PARAM_TO_FLOW = { quick: FLOW_KEYS.quick, tour: FLOW_KEYS.tour, accountant: FLOW_KEYS.accountant }
const FLOW_TO_PARAM = Object.fromEntries(Object.entries(PARAM_TO_FLOW).map(([k, v]) => [v, k]))

const pct = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)))
const isResolved = (s) => s === 'completed' || s === 'skipped'

function AreaIcon({ area, size = 18 }) {
  const C = Icon[AREA_ICON[area] || 'book'] || Icon.dot
  return <C width={size} height={size} aria-hidden="true" />
}

function NamedIcon({ name, size = 18 }) {
  const C = Icon[name] || Icon.book || Icon.dot
  return <C width={size} height={size} aria-hidden="true" />
}

/* ── shared bits ──────────────────────────────────────────────────────────── */

function ProgressBar({ value, label }) {
  const v = pct(value)
  return (
    <span className="ob-bar" role="progressbar" aria-valuenow={v} aria-valuemin={0}
      aria-valuemax={100} aria-label={label}>
      <span className="ob-bar-fill" style={{ width: `${v}%` }} />
    </span>
  )
}

function LanguageSwitcher({ locale, onChange, label }) {
  return (
    <div className="ob-lang" role="group" aria-label={label}>
      {SUPPORTED_LOCALES.map((l) => (
        <button key={l} type="button" className={`ob-lang-btn${l === locale ? ' is-active' : ''}`}
          aria-pressed={l === locale} onClick={() => onChange(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

// Visual help entry point ONLY. It opens a static panel; it does not call any API and does
// not create a support conversation.
function HelpDrawer({ open, onClose, s }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="ob-drawer-scrim" onClick={onClose}>
      <aside className="ob-drawer" role="dialog" aria-modal="true" aria-label={s.needHelp}
        onClick={(e) => e.stopPropagation()}>
        <div className="ob-drawer-head">
          <h2 className="ob-drawer-title">{s.needHelp}</h2>
          <button type="button" className="ob-iconbtn" aria-label={s.close} onClick={onClose}>
            <Icon.plus width="18" height="18" style={{ transform: 'rotate(45deg)' }} />
          </button>
        </div>
        <p className="ob-drawer-body">{s.helpBody}</p>
        <ul className="ob-drawer-list">
          {s.helpItems.map((item, i) => (
            <li key={i}><span className="ob-drawer-num">{i + 1}</span><span>{item}</span></li>
          ))}
        </ul>
        <p className="ob-drawer-foot">{s.helpFoot}</p>
        <Btn variant="ghost" onClick={onClose}>{s.close}</Btn>
      </aside>
    </div>
  )
}

function Notice({ tone = 'info', icon, title, children }) {
  const C = Icon[icon] || Icon.warn
  return (
    <div className={`ob-notice ob-notice--${tone}`}>
      <span className="ob-notice-ic"><C width="18" height="18" aria-hidden="true" /></span>
      <div>
        <strong className="ob-notice-title">{title}</strong>
        <p className="ob-notice-body">{children}</p>
      </div>
    </div>
  )
}

/* ── home ─────────────────────────────────────────────────────────────────── */

function FlowCard({ flow, progress, s, onOpen }) {
  const v = visualFor(flow.flow_key)
  const status = progress?.status || 'not_started'
  const percent = pct(progress?.progress_percent)
  const cta = status === 'completed' ? s.review : status === 'in_progress' ? s.continue : s.start
  const tone = status === 'completed' ? 'success' : status === 'in_progress' ? 'info' : 'neutral'
  const guidanceOnly = flow.metadata?.guidance_only === true

  return (
    <button type="button" className={`ob-card ob-card--${v.accent}`} onClick={() => onOpen(flow)}>
      <span className="ob-card-top">
        <span className="ob-card-ic"><NamedIcon name={v.icon} size={20} /></span>
        <StatusBadge tone={tone}>{s.status[status] || status}</StatusBadge>
      </span>
      <span className="ob-card-title">{safeText(flow.title, flow.flow_key)}</span>
      <span className="ob-card-desc">{safeText(flow.description)}</span>
      {guidanceOnly && <span className="ob-chip ob-chip--green">{s.guidanceTitle}</span>}
      <span className="ob-card-progress">
        <ProgressBar value={percent} label={safeText(flow.title, flow.flow_key)} />
        <span className="ob-card-pct">{s.percentDone(percent)}</span>
      </span>
      <span className="ob-card-cta">{cta}<Icon.chev width="16" height="16" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true" /></span>
    </button>
  )
}

function HomeScreen({ flows, progressByFlow, s, onOpen }) {
  const total = flows.length
  const rows = flows.map((f) => progressByFlow[f.id] || null)
  const done = rows.filter((p) => p?.status === 'completed').length
  const running = rows.filter((p) => p?.status === 'in_progress').length
  const idle = total - done - running
  const overall = total ? Math.round(rows.reduce((a, p) => a + pct(p?.progress_percent), 0) / total) : 0

  if (!total) return <EmptyState symbol={SYMBOL} title={s.title} description={s.noFlows} />

  return (
    <>
      <section className="ob-summary">
        <div className="ob-summary-main">
          <span className="ob-summary-label">{s.summaryLabel}</span>
          <span className="ob-summary-value">{s.guidesDone(done, total)}</span>
          <ProgressBar value={overall} label={s.summaryLabel} />
          <span className="ob-summary-pct">{s.percentDone(overall)}</span>
        </div>
        <div className="ob-summary-stats">
          <div className="ob-stat"><span className="ob-stat-v">{running}</span><span className="ob-stat-k">{s.summaryInProgress}</span></div>
          <div className="ob-stat"><span className="ob-stat-v ok">{done}</span><span className="ob-stat-k">{s.summaryCompleted}</span></div>
          <div className="ob-stat"><span className="ob-stat-v muted">{idle}</span><span className="ob-stat-k">{s.summaryNotStarted}</span></div>
        </div>
      </section>

      <div className="ob-cards">
        {flows.map((f) => (
          <FlowCard key={f.id} flow={f} progress={progressByFlow[f.id]} s={s} onOpen={onOpen} />
        ))}
      </div>
    </>
  )
}

/* ── flow screens ─────────────────────────────────────────────────────────── */

function StepRow({ step, index, active, onSelect, s, showNumber }) {
  const st = step.progress?.status || 'not_started'
  const state = st === 'completed' ? 'done' : st === 'skipped' ? 'skipped' : active ? 'current' : 'idle'
  return (
    <li>
      <button type="button" className={`ob-step ob-step--${state}`} aria-current={active ? 'step' : undefined}
        onClick={() => onSelect(step.id)}>
        <span className="ob-step-mark" aria-hidden="true">
          {st === 'completed' ? <Icon.check width="14" height="14" />
            : showNumber ? index + 1 : <AreaIcon area={step.product_area} size={15} />}
        </span>
        <span className="ob-step-text">
          <span className="ob-step-title">{safeText(step.title, step.step_key)}</span>
          <span className="ob-step-meta">{s.stepStatus[st] || st}{step.required ? ` · ${s.required}` : ''}</span>
        </span>
      </button>
    </li>
  )
}

function StepRail({ steps, activeId, onSelect, s, variant }) {
  if (variant !== 'tour') {
    return (
      <ol className="ob-rail-list">
        {steps.map((step, i) => (
          <StepRow key={step.id} step={step} index={i} active={step.id === activeId}
            onSelect={onSelect} s={s} showNumber />
        ))}
      </ol>
    )
  }
  // Tour: 20 modules read better bucketed by product area than as one long list.
  const bucketOf = (step) =>
    TOUR_GROUPS.find((g) => g.areas.includes(step.product_area))?.key || 'workspace'
  const groups = TOUR_GROUPS
    .map((g) => ({ key: g.key, items: steps.filter((step) => bucketOf(step) === g.key) }))
    .filter((g) => g.items.length)

  return (
    <div className="ob-rail-groups">
      {groups.map((g) => (
        <div key={g.key}>
          <div className="ob-rail-title">{s.groups[g.key] || g.key}</div>
          <ol className="ob-rail-list">
            {g.items.map((step) => (
              <StepRow key={step.id} step={step} index={steps.indexOf(step)} active={step.id === activeId}
                onSelect={onSelect} s={s} showNumber={false} />
            ))}
          </ol>
        </div>
      ))}
    </div>
  )
}

function StepDetail({ step, index, total, s, variant, busy, started, onComplete, onSkip, onOpenPage, onPrev, onNext }) {
  if (!step) return <div className="ob-panel-empty">{s.noSteps}</div>
  const st = step.progress?.status || 'not_started'
  const resolved = isResolved(st)
  const counter = variant === 'tour' ? s.moduleOf(index + 1, total) : s.stepOf(index + 1, total)
  const instructions = safeText(step.instructions)

  return (
    <article className="ob-detail">
      <header className="ob-detail-head">
        <span className="ob-detail-ic"><AreaIcon area={step.product_area} size={22} /></span>
        <div className="ob-detail-heading">
          <span className="ob-detail-counter">{counter}</span>
          <h2 className="ob-detail-title">{safeText(step.title, step.step_key)}</h2>
        </div>
        <div className="ob-detail-chips">
          <span className={`ob-chip ${step.required ? 'ob-chip--navy' : ''}`}>{step.required ? s.required : s.optional}</span>
          {resolved && <span className={`ob-chip ${st === 'completed' ? 'ob-chip--green' : ''}`}>{s.stepStatus[st]}</span>}
        </div>
      </header>

      {safeText(step.description) && <p className="ob-detail-desc">{step.description}</p>}
      {instructions && (
        <div className="ob-instructions">
          <span className="ob-instructions-label">{s.needHelp}</span>
          <p>{instructions}</p>
        </div>
      )}

      <footer className="ob-detail-actions">
        {variant === 'tour' && (
          <>
            <Btn variant="ghost" onClick={onPrev} disabled={index === 0 || !!busy}
              icon={<Icon.chev width="15" height="15" style={{ transform: 'rotate(90deg)' }} />}>{s.back}</Btn>
            <Btn variant="ghost" onClick={onNext} disabled={index >= total - 1 || !!busy}>{s.next}</Btn>
          </>
        )}
        {step.page_path && (
          <Btn variant="ghost" onClick={() => onOpenPage(step.page_path)} disabled={!!busy}>{s.openPage}</Btn>
        )}
        <span className="ob-spacer" />
        {step.skippable && variant !== 'tour' && (
          <Btn variant="ghost" onClick={() => onSkip(step)} disabled={!started || busy === 'skip' || st === 'skipped'}>
            {s.skip}
          </Btn>
        )}
        <Btn variant="primary" onClick={() => onComplete(step)}
          disabled={!started || busy === 'complete' || st === 'completed'}
          icon={<Icon.check width="15" height="15" />}>
          {variant === 'tour' ? s.markComplete : s.complete}
        </Btn>
      </footer>
    </article>
  )
}

function FlowScreen({
  flow, steps, progress, variant, s, busy, actionError,
  activeId, onSelect, onBack, onStart, onContinue, onComplete, onSkip, onDismiss, onReset, onOpenPage,
}) {
  const v = visualFor(flow.flow_key)
  const status = progress?.status || 'not_started'
  const started = !!progress && status !== 'not_started'
  const index = Math.max(0, steps.findIndex((st) => st.id === activeId))
  const step = steps[index] || null
  const resolvedCount = steps.filter((st) => isResolved(st.progress?.status)).length
  const percent = pct(progress?.progress_percent)

  return (
    <div className={`ob-flow ob-flow--${v.accent}`}>
      <button type="button" className="ob-back" onClick={onBack}>
        <Icon.chev width="15" height="15" style={{ transform: 'rotate(90deg)' }} aria-hidden="true" />
        {s.allGuides}
      </button>

      <section className="ob-flowhead">
        <div className="ob-flowhead-main">
          <span className="ob-flowhead-ic"><NamedIcon name={v.icon} size={22} /></span>
          <div>
            <h1 className="ob-flowhead-title">{safeText(flow.title, flow.flow_key)}</h1>
            {safeText(flow.description) && <p className="ob-flowhead-desc">{flow.description}</p>}
          </div>
          <StatusBadge tone={status === 'completed' ? 'success' : status === 'in_progress' ? 'info' : 'neutral'}>
            {s.status[status] || status}
          </StatusBadge>
        </div>

        <div className="ob-flowhead-progress">
          <ProgressBar value={percent} label={safeText(flow.title, flow.flow_key)} />
          <div className="ob-flowhead-meta">
            <span>{s.stepsResolved(resolvedCount, steps.length)}</span>
            <span className="ob-flowhead-pct">{s.percentDone(percent)}</span>
          </div>
        </div>

        <div className="ob-flowhead-actions">
          {!started
            ? <Btn variant="primary" onClick={onStart} disabled={busy === 'start'} icon={<Icon.play width="15" height="15" />}>{s.start}</Btn>
            : <Btn variant="primary" onClick={onContinue} disabled={!!busy || !progress?.current_step_id}
                icon={<Icon.play width="15" height="15" />}>{s.continue}</Btn>}
          <Btn variant="ghost" onClick={onReset} disabled={!started || busy === 'reset'}>{s.reset}</Btn>
          <Btn variant="ghost" onClick={onDismiss} disabled={busy === 'dismiss' || status === 'dismissed'}>{s.dismiss}</Btn>
        </div>
      </section>

      {!started && <Notice tone="info" icon="lock" title={s.status.not_started}>{s.notStartedBanner}</Notice>}
      {status === 'dismissed' && <Notice tone="warn" icon="warn" title={s.status.dismissed}>{s.dismissedBanner}</Notice>}
      {status === 'completed' && <Notice tone="ok" icon="check" title={s.status.completed}>{s.completedBanner}</Notice>}
      {actionError && (
        <Notice tone="warn" icon="warn" title={s.errorTitle}>
          {actionError.code === 'step_not_skippable' ? s.notSkippable : safeText(actionError.message, s.retry)}
        </Notice>
      )}

      {variant === 'accountant' && (
        <div className="ob-notices">
          <Notice tone="info" icon="book" title={s.guidanceTitle}>{s.guidanceBody}</Notice>
          <Notice tone="ok" icon="users" title={s.reviewTitle}>{s.reviewBody}</Notice>
        </div>
      )}

      {steps.length === 0
        ? <EmptyState symbol={SYMBOL} title={safeText(flow.title, flow.flow_key)} description={s.noSteps} />
        : (
          <div className="ob-layout">
            <aside className="ob-rail" aria-label={safeText(flow.title, flow.flow_key)}>
              <StepRail steps={steps} activeId={step?.id} onSelect={onSelect} s={s} variant={variant} />
            </aside>
            <div className="ob-panel">
              <StepDetail step={step} index={index} total={steps.length} s={s} variant={variant}
                busy={busy} started={started} onComplete={onComplete} onSkip={onSkip}
                onOpenPage={onOpenPage}
                onPrev={() => onSelect(steps[Math.max(0, index - 1)]?.id)}
                onNext={() => onSelect(steps[Math.min(steps.length - 1, index + 1)]?.id)} />
            </div>
          </div>
        )}
    </div>
  )
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function BusinessOnboarding() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  // Locale: URL first (shareable, and what the API is asked for), then the app language,
  // then English. An unsupported value is normalised rather than sent or rendered.
  const locale = resolveLocale(params.get('locale') || getLang())
  const s = useMemo(() => uiStrings(locale), [locale])

  const flowKey = PARAM_TO_FLOW[params.get('flow')] || null
  const [help, setHelp] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [busy, setBusy] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [activeId, setActiveId] = useState(null)
  const viewedRef = useRef(new Set())

  const [home, setHome] = useState({ loading: true, error: null, flows: [], progress: [] })
  const [detail, setDetail] = useState({ loading: false, error: null, flow: null, steps: [], progress: null })

  const setParam = useCallback((key, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    setParams(next, { replace: true })
  }, [params, setParams])

  // ── home data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    // No token means nothing can be fetched. Resolve the loading state rather than leaving
    // a spinner running for a session that will never load.
    if (!token) { setHome({ loading: false, error: null, flows: [], progress: [] }); return undefined }
    let on = true
    setHome((h) => ({ ...h, loading: true, error: null }))
    Promise.all([onboardingApi.flows(token, locale), onboardingApi.progress(token)])
      .then(([f, p]) => {
        if (!on) return
        setHome({ loading: false, error: null, flows: f.flows || [], progress: p.progress || [] })
      })
      .catch((e) => { if (on) setHome({ loading: false, error: e, flows: [], progress: [] }) })
    return () => { on = false }
  }, [token, locale, nonce])

  // ── selected flow ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !flowKey) { setDetail({ loading: false, error: null, flow: null, steps: [], progress: null }); return undefined }
    let on = true
    setDetail((d) => ({ ...d, loading: true, error: null }))
    onboardingApi.flow(token, flowKey, locale)
      .then((d) => {
        if (!on) return
        setDetail({ loading: false, error: null, flow: d.flow || null, steps: d.steps || [], progress: d.progress || null })
      })
      .catch((e) => { if (on) setDetail({ loading: false, error: e, flow: null, steps: [], progress: null }) })
    return () => { on = false }
  }, [token, flowKey, locale, nonce])

  // Reset the per-flow cursor when the flow changes; the server's current_step_id then
  // decides where the user lands.
  useEffect(() => {
    setActiveId(null)
    setActionError(null)
    viewedRef.current = new Set()
    setDetail((d) => (d.flow ? { ...d, flow: null, steps: [], progress: null } : d))
  }, [flowKey])

  const steps = detail.steps
  const resolvedActiveId = useMemo(() => {
    if (activeId && steps.some((st) => st.id === activeId)) return activeId
    if (detail.progress?.current_step_id && steps.some((st) => st.id === detail.progress.current_step_id)) {
      return detail.progress.current_step_id
    }
    const firstOpen = steps.find((st) => !isResolved(st.progress?.status))
    return firstOpen?.id || steps[0]?.id || null
  }, [activeId, steps, detail.progress])

  // First-look telemetry. Fire-and-forget: a failed view must never block reading a step,
  // and the backend 404s it entirely when the flow was not started.
  useEffect(() => {
    if (!token || !resolvedActiveId || !detail.progress) return
    const current = steps.find((st) => st.id === resolvedActiveId)
    if (!current || current.progress?.status !== 'not_started') return
    if (viewedRef.current.has(resolvedActiveId)) return
    viewedRef.current.add(resolvedActiveId)
    onboardingApi.view(token, resolvedActiveId).catch(() => { /* never surfaced */ })
  }, [token, resolvedActiveId, steps, detail.progress])

  const bump = useCallback(() => setNonce((n) => n + 1), [])

  const run = useCallback(async (name, fn) => {
    setBusy(name); setActionError(null)
    try { return await fn() } catch (e) { setActionError(e); return null } finally { setBusy(null) }
  }, [])

  const openFlow = useCallback((flow) => {
    setParam('flow', FLOW_TO_PARAM[flow.flow_key] || flow.flow_key)
  }, [setParam])

  const onStart = useCallback(async () => {
    if (!flowKey) return
    await run('start', () => onboardingApi.start(token, flowKey)); bump()
  }, [flowKey, run, token, bump])

  const onStepAction = useCallback(async (kind, step) => {
    if (!step) return
    const fn = kind === 'complete' ? onboardingApi.complete : onboardingApi.skip
    const out = await run(kind, () => fn(token, step.id))
    // The server recomputes the next open step; following it keeps the cursor honest even
    // when the user resolved a step out of order.
    if (out?.progress?.current_step_id) setActiveId(out.progress.current_step_id)
    bump()
  }, [run, token, bump])

  const onDismiss = useCallback(async () => {
    if (!flowKey) return
    await run('dismiss', () => onboardingApi.dismiss(token, flowKey)); bump()
  }, [flowKey, run, token, bump])

  const onReset = useCallback(async () => {
    if (!flowKey) return
    const out = await run('reset', () => onboardingApi.reset(token, flowKey))
    setActiveId(out?.progress?.current_step_id || null); bump()
  }, [flowKey, run, token, bump])

  const onOpenPage = useCallback((path) => {
    if (typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')) navigate(path)
  }, [navigate])

  const head = (
    <PageHeader eyebrow={s.eyebrow} title={s.title}
      actions={<>
        <LanguageSwitcher locale={locale} label={s.language}
          onChange={(l) => setParam('locale', l)} />
        <Btn variant="ghost" onClick={() => setHelp(true)} icon={<Icon.book width="15" height="15" />}>
          {s.needHelp}
        </Btn>
      </>} />
  )

  const frame = (body) => (
    <div className="ob-root">
      {head}
      {body}
      <HelpDrawer open={help} onClose={() => setHelp(false)} s={s} />
    </div>
  )

  if (home.loading && !home.flows.length) {
    return frame(
      <div className="ob-skeleton">
        <div className="cfo-skel" style={{ height: 132, borderRadius: 16 }} />
        <div className="ob-cards">
          {[0, 1, 2].map((i) => <div key={i} className="cfo-skel" style={{ height: 216, borderRadius: 16 }} />)}
        </div>
      </div>,
    )
  }

  // Flag off (or nothing seeded): a deliberate deployment state, not an error. Rendered as a
  // finished, explanatory panel — never an endless spinner.
  if (home.error) {
    return frame(isFeatureDisabled(home.error)
      ? <EmptyState symbol={SYMBOL} title={s.disabledTitle} description={s.disabledBody} />
      : <ErrorState title={s.errorTitle} description={safeText(home.error.message)} retryLabel={s.retry} onRetry={bump} />)
  }

  const progressByFlow = Object.fromEntries((home.progress || []).map((p) => [p.flow_id, p]))

  if (!flowKey) {
    return frame(<HomeScreen flows={home.flows} progressByFlow={progressByFlow} s={s} onOpen={openFlow} />)
  }

  if (detail.loading && !detail.flow) {
    return frame(<div className="ob-skeleton"><LoadingSkeleton rows={6} height={22} /></div>)
  }
  if (detail.error || !detail.flow) {
    return frame(
      <>
        <button type="button" className="ob-back" onClick={() => setParam('flow', null)}>
          <Icon.chev width="15" height="15" style={{ transform: 'rotate(90deg)' }} aria-hidden="true" />{s.allGuides}
        </button>
        {detail.error && !isFeatureDisabled(detail.error)
          ? <ErrorState title={s.errorTitle} description={safeText(detail.error.message)} retryLabel={s.retry} onRetry={bump} />
          : <EmptyState symbol={SYMBOL} title={s.title} description={s.flowMissing} />}
      </>,
    )
  }

  const variant = visualFor(detail.flow.flow_key).screen

  return frame(
    <FlowScreen
      flow={detail.flow} steps={steps} progress={detail.progress} variant={variant} s={s}
      busy={busy} actionError={actionError} activeId={resolvedActiveId}
      onSelect={(id) => { if (id) setActiveId(id) }}
      onBack={() => setParam('flow', null)}
      onStart={onStart}
      onContinue={() => { if (detail.progress?.current_step_id) setActiveId(detail.progress.current_step_id) }}
      onComplete={(step) => onStepAction('complete', step)}
      onSkip={(step) => onStepAction('skip', step)}
      onDismiss={onDismiss} onReset={onReset} onOpenPage={onOpenPage}
    />,
  )
}
