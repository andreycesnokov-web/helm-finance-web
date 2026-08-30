// Production Onboarding UI (migration 054 API). Mounted at /business/onboarding inside the
// premium Business shell.
//
// DATA-DRIVEN, NOT SCRIPTED. Every flow, step, title, description and instruction on this
// page comes from GET /api/onboarding/*, already resolved for the requested locale. There is
// no hardcoded step list: screens are chosen from the flow's own `mode`, and the guidance
// framing from its own `metadata.guidance_only`. A deployment that seeds a fourth flow gets a
// fourth card without a code change. The only fixed content is UI chrome in
// ./onboardingStrings.
//
// NO FINANCIAL EFFECT. Nothing here reads or writes transactions, wallets, debts, documents,
// payments, credentials, Telegram or support threads. The only writes are the caller's own
// onboarding progress rows. Opening this page never provisions a business or starts a trial.
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
const MAX_DETAIL_PREFETCH = 6   // bounds the home fan-out that builds the card previews
const PREVIEW_STEPS = 4

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

// Rail grouping for the full product tour. Purely presentational — it buckets whatever steps
// the API returns; an unlisted area lands in "workspace" rather than disappearing.
const TOUR_GROUPS = [
  { key: 'overview', areas: ['general', 'pulse', 'radar', 'ai_cfo', 'ai_accountant'] },
  { key: 'finance', areas: ['transactions', 'accounts', 'invoices', 'receivables', 'payables', 'funding'] },
  { key: 'connections', areas: ['bank_import', 'incoming_payments', 'payment_connections'] },
  { key: 'operations', areas: ['intercompany', 'payroll', 'approvals', 'team'] },
  { key: 'workspace', areas: ['documents', 'settings', 'support', 'admin'] },
]
const bucketOf = (step) => TOUR_GROUPS.find((g) => g.areas.includes(step.product_area))?.key || 'workspace'

/**
 * How a flow presents itself — derived from the flow's own fields, not from its key.
 *
 * `mode` picks the screen (a page-by-page tour reads differently from a checklist) and
 * `metadata.guidance_only` — set by the seed on the AI Accountant flow — turns on the
 * readiness framing and the advice disclaimers. An unrecognised flow still renders.
 */
function shapeOf(flow) {
  const guidance = flow?.metadata?.guidance_only === true
  const mode = flow?.mode
  if (mode === 'full_tour') return { variant: 'tour', accent: 'navy', icon: 'book', guidance }
  if (guidance) return { variant: 'checklist', accent: 'green', icon: 'acct', guidance: true }
  if (mode === 'quick_setup') return { variant: 'checklist', accent: 'blue', icon: 'play', guidance: false }
  return { variant: 'checklist', accent: 'navy', icon: 'book', guidance }
}

// ?flow= short names, so the single /business/onboarding route stays deep-linkable. An
// unknown flow falls back to its own flow_key as the parameter.
const PARAM_TO_FLOW = { quick: FLOW_KEYS.quick, tour: FLOW_KEYS.tour, accountant: FLOW_KEYS.accountant }
const FLOW_TO_PARAM = Object.fromEntries(Object.entries(PARAM_TO_FLOW).map(([k, v]) => [v, k]))

const pct = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)))
const isResolved = (s) => s === 'completed' || s === 'skipped'
const resolvedCount = (steps) => steps.filter((st) => isResolved(st.progress?.status)).length

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

// Visual help entry point ONLY. Opens a static panel; calls no API and creates no support
// conversation.
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

/**
 * The single clearest thing to do next.
 *
 * Resuming beats starting: a half-finished guide is more useful to return to than a new one.
 * Both come from server state — the current step is whatever the backend recomputed, never a
 * client-side guess.
 */
function deriveNextAction(flows, progressByFlow, details) {
  const ordered = [...flows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const running = ordered.find((f) => progressByFlow[f.id]?.status === 'in_progress')
  if (running) {
    const d = details[running.flow_key]
    const cur = d?.steps?.find((st) => st.id === progressByFlow[running.id]?.current_step_id)
      || d?.steps?.find((st) => !isResolved(st.progress?.status))
    return { kind: 'continue', flow: running, step: cur || null }
  }
  const fresh = ordered.find((f) => {
    const st = progressByFlow[f.id]?.status
    return !st || st === 'not_started'
  })
  if (fresh) return { kind: 'start', flow: fresh, step: details[fresh.flow_key]?.steps?.[0] || null }
  return { kind: 'done', flow: null, step: null }
}

function NextActionCard({ next, s, onOpen }) {
  if (next.kind === 'done') {
    return (
      <section className="ob-next ob-next--done">
        <span className="ob-next-ic"><Icon.check width="20" height="20" aria-hidden="true" /></span>
        <div className="ob-next-text">
          <span className="ob-next-label">{s.summaryCompleted}</span>
          <h2 className="ob-next-title">{s.allDone}</h2>
          <p className="ob-next-desc">{s.allDoneBody}</p>
        </div>
      </section>
    )
  }
  const { flow, step, kind } = next
  return (
    <section className="ob-next">
      <span className="ob-next-ic"><NamedIcon name={shapeOf(flow).icon} size={20} /></span>
      <div className="ob-next-text">
        <span className="ob-next-label">{s.nextLabel}</span>
        <h2 className="ob-next-title">{safeText(step?.title, safeText(flow.title, flow.flow_key))}</h2>
        <p className="ob-next-desc">{safeText(step?.description, safeText(flow.description))}</p>
        <span className="ob-next-meta">{safeText(flow.title, flow.flow_key)}</span>
      </div>
      <Btn variant="primary" onClick={() => onOpen(flow)} icon={<Icon.play width="15" height="15" />}>
        {kind === 'continue' ? s.continue : s.startHere}
      </Btn>
    </section>
  )
}

function FlowCard({ flow, progress, detail, s, onOpen, feature }) {
  const shape = shapeOf(flow)
  const status = progress?.status || 'not_started'
  const steps = detail?.steps || []
  // Percent from the server when it has an opinion; otherwise derived from the step statuses
  // we just loaded, so a card is never blank while the data is right there.
  const percent = progress ? pct(progress.progress_percent)
    : steps.length ? pct((resolvedCount(steps) / steps.length) * 100) : 0
  const cta = status === 'completed' ? s.review : status === 'in_progress' ? s.continue : s.start
  const tone = status === 'completed' ? 'success' : status === 'in_progress' ? 'info' : 'neutral'
  const preview = steps.slice(0, PREVIEW_STEPS)
  const rest = Math.max(0, steps.length - preview.length)

  return (
    <article className={`ob-card ob-card--${shape.accent}${feature ? ' ob-card--feature' : ''}`}
      onClick={() => onOpen(flow)}>
      <div className="ob-card-top">
        <span className="ob-card-ic"><NamedIcon name={shape.icon} size={20} /></span>
        <div className="ob-card-badges">
          {feature && <span className="ob-chip ob-chip--navy">{s.recommended}</span>}
          {shape.guidance && <span className="ob-chip ob-chip--green">{s.guidanceTitle}</span>}
          <StatusBadge tone={tone}>{s.status[status] || status}</StatusBadge>
        </div>
      </div>

      <h3 className="ob-card-title">{safeText(flow.title, flow.flow_key)}</h3>
      <p className="ob-card-desc">{safeText(flow.description)}</p>

      {/* "What's inside" is the flow's own first steps, not a written-up marketing list —
          it tells the user what the track will actually ask of them. */}
      {preview.length > 0 && (
        <div className="ob-card-inside">
          <span className="ob-card-inside-label">{s.whatsInside}</span>
          <ul className="ob-card-steps">
            {preview.map((st) => {
              const done = isResolved(st.progress?.status)
              return (
                <li key={st.id} className={done ? 'is-done' : ''}>
                  <span className="ob-card-steps-mark" aria-hidden="true">
                    {done ? <Icon.check width="11" height="11" /> : <Icon.dot width="7" height="7" />}
                  </span>
                  {safeText(st.title, st.step_key)}
                </li>
              )
            })}
            {rest > 0 && <li className="is-more">{s.moreItems(rest)}</li>}
          </ul>
        </div>
      )}

      <div className="ob-card-foot">
        <div className="ob-card-progress">
          <ProgressBar value={percent} label={safeText(flow.title, flow.flow_key)} />
          <span className="ob-card-pct">
            {steps.length ? s.stepsResolved(resolvedCount(steps), steps.length) : s.percentDone(percent)}
          </span>
        </div>
        <Btn variant={feature ? 'primary' : 'ghost'}
          onClick={(e) => { e.stopPropagation(); onOpen(flow) }}>{cta}</Btn>
      </div>
    </article>
  )
}

function HomeScreen({ flows, progressByFlow, details, s, onOpen }) {
  if (!flows.length) return <EmptyState symbol={SYMBOL} title={s.heroTitle} description={s.noFlows} />

  const rows = flows.map((f) => progressByFlow[f.id] || null)
  const done = rows.filter((p) => p?.status === 'completed').length
  const running = rows.filter((p) => p?.status === 'in_progress').length
  const idle = flows.length - done - running
  const overall = Math.round(rows.reduce((a, p) => a + pct(p?.progress_percent), 0) / flows.length)
  const next = deriveNextAction(flows, progressByFlow, details)
  // The quick-setup track leads: it is the shortest path to a usable workspace.
  const featureKey = flows.find((f) => f.mode === 'quick_setup')?.flow_key

  return (
    <>
      <section className="ob-hero">
        <div className="ob-hero-text">
          <h1 className="ob-hero-title">{s.heroTitle}</h1>
          <p className="ob-hero-body">{s.heroBody}</p>
        </div>
        <div className="ob-hero-progress">
          <div className="ob-hero-progress-head">
            <span className="ob-summary-label">{s.summaryLabel}</span>
            <span className="ob-hero-pct">{s.percentDone(overall)}</span>
          </div>
          <ProgressBar value={overall} label={s.summaryLabel} />
          <span className="ob-hero-guides">{s.guidesDone(done, flows.length)}</span>
          <div className="ob-hero-stats">
            <div className="ob-stat"><span className="ob-stat-v">{running}</span><span className="ob-stat-k">{s.summaryInProgress}</span></div>
            <div className="ob-stat"><span className="ob-stat-v ok">{done}</span><span className="ob-stat-k">{s.summaryCompleted}</span></div>
            <div className="ob-stat"><span className="ob-stat-v muted">{idle}</span><span className="ob-stat-k">{s.summaryNotStarted}</span></div>
          </div>
        </div>
      </section>

      <NextActionCard next={next} s={s} onOpen={onOpen} />

      <div className="ob-cards">
        {flows.map((f) => (
          <FlowCard key={f.id} flow={f} progress={progressByFlow[f.id]} detail={details[f.flow_key]}
            s={s} onOpen={onOpen} feature={f.flow_key === featureKey} />
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
  // Tour: 20 modules read better bucketed by product area, each group carrying its own count
  // so the user can see how far through a section they are.
  const groups = TOUR_GROUPS
    .map((g) => ({ key: g.key, items: steps.filter((step) => bucketOf(step) === g.key) }))
    .filter((g) => g.items.length)

  return (
    <div className="ob-rail-groups">
      {groups.map((g) => (
        <div key={g.key} className="ob-rail-group">
          <div className="ob-rail-title">
            <span>{s.groups[g.key] || g.key}</span>
            <span className="ob-rail-count">{resolvedCount(g.items)}/{g.items.length}</span>
          </div>
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
  const group = variant === 'tour' ? (s.groups[bucketOf(step)] || null) : null
  const purpose = safeText(step.description)
  // "What to do next" prefers the step's own instructions. Only where the API has none does
  // the tour fall back to generic navigation guidance — no invented product, legal or tax
  // claims in either branch.
  const instructions = safeText(step.instructions)
  const todo = instructions || (variant === 'tour' ? s.genericNext : '')

  return (
    <article className="ob-detail">
      <header className="ob-detail-head">
        <span className="ob-detail-ic"><AreaIcon area={step.product_area} size={22} /></span>
        <div className="ob-detail-heading">
          <span className="ob-detail-counter">{group ? `${group} · ${counter}` : counter}</span>
          <h2 className="ob-detail-title">{safeText(step.title, step.step_key)}</h2>
        </div>
        <div className="ob-detail-chips">
          <span className={`ob-chip ${step.required ? 'ob-chip--navy' : ''}`}>{step.required ? s.required : s.optional}</span>
          {resolved && <span className={`ob-chip ${st === 'completed' ? 'ob-chip--green' : ''}`}>{s.stepStatus[st]}</span>}
        </div>
      </header>

      <div className="ob-sections">
        {purpose && (
          <section className="ob-section">
            <span className="ob-section-label">{s.forLabel}</span>
            <p>{purpose}</p>
          </section>
        )}
        {todo && (
          <section className="ob-section ob-section--todo">
            <span className="ob-section-label">{s.todoLabel}</span>
            <p>{todo}</p>
          </section>
        )}
      </div>

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
  flow, steps, progress, s, busy, actionError,
  activeId, onSelect, onBack, onStart, onContinue, onComplete, onSkip, onDismiss, onReset, onOpenPage,
}) {
  const shape = shapeOf(flow)
  const { variant, guidance } = shape
  const status = progress?.status || 'not_started'
  // "Started" means the flow actually began — not merely that a progress row exists.
  // Dismissing a flow BEFORE starting it creates a row with status 'dismissed', no
  // started_at and no current_step_id; treating that as started left the screen showing a
  // permanently disabled Continue with no way to begin the guide at all.
  const started = !!progress?.started_at || status === 'in_progress' || status === 'completed'
  const finished = status === 'completed'
  const index = Math.max(0, steps.findIndex((st) => st.id === activeId))
  const step = steps[index] || null
  const doneCount = resolvedCount(steps)
  const percent = pct(progress?.progress_percent)
  const currentStep = steps.find((st) => st.id === progress?.current_step_id) || null

  return (
    <div className={`ob-flow ob-flow--${shape.accent}`}>
      <button type="button" className="ob-back" onClick={onBack}>
        <Icon.chev width="15" height="15" style={{ transform: 'rotate(90deg)' }} aria-hidden="true" />
        {s.allGuides}
      </button>

      <section className="ob-flowhead">
        <div className="ob-flowhead-main">
          <span className="ob-flowhead-ic"><NamedIcon name={shape.icon} size={22} /></span>
          <div className="ob-flowhead-copy">
            {/* A guidance flow is framed as preparation for a human review, never as an
                authority on what the company owes. */}
            <h1 className="ob-flowhead-title">
              {guidance ? s.readinessTitle : safeText(flow.title, flow.flow_key)}
            </h1>
            {guidance && <p className="ob-flowhead-desc">{s.readinessBody}</p>}
            {safeText(flow.description) && (
              <p className={guidance ? 'ob-flowhead-sub' : 'ob-flowhead-desc'}>{flow.description}</p>
            )}
          </div>
          <StatusBadge tone={status === 'completed' ? 'success' : status === 'in_progress' ? 'info' : 'neutral'}>
            {s.status[status] || status}
          </StatusBadge>
        </div>

        <div className="ob-flowhead-progress">
          <ProgressBar value={percent} label={safeText(flow.title, flow.flow_key)} />
          <div className="ob-flowhead-meta">
            <span>{guidance ? s.prepared(doneCount, steps.length) : s.stepsResolved(doneCount, steps.length)}</span>
            <span className="ob-flowhead-pct">{s.percentDone(percent)}</span>
          </div>
        </div>

        {started && currentStep && (
          <p className="ob-flowhead-next">
            <span className="ob-flowhead-next-label">{s.nextStepIs}</span>
            {safeText(currentStep.title, currentStep.step_key)}
          </p>
        )}

        <div className="ob-flowhead-actions">
          {!started ? (
            <Btn variant="primary" onClick={onStart} disabled={busy === 'start'}
              icon={<Icon.play width="15" height="15" />}>{s.start}</Btn>
          ) : finished ? (
            // A finished flow has no current step, so Continue could only ever be disabled.
            <Btn variant="primary" onClick={onReset} disabled={busy === 'reset'}>{s.reset}</Btn>
          ) : (
            <Btn variant="primary" onClick={onContinue} disabled={!!busy || !progress?.current_step_id}
              icon={<Icon.play width="15" height="15" />}>{s.continue}</Btn>
          )}
          {started && !finished && <Btn variant="ghost" onClick={onReset} disabled={busy === 'reset'}>{s.reset}</Btn>}
          <Btn variant="ghost" onClick={onDismiss} disabled={busy === 'dismiss' || status === 'dismissed'}>{s.dismiss}</Btn>
        </div>
      </section>

      {!progress && <Notice tone="info" icon="lock" title={s.status.not_started}>{s.notStartedBanner}</Notice>}
      {status === 'dismissed' && <Notice tone="warn" icon="warn" title={s.status.dismissed}>{s.dismissedBanner}</Notice>}
      {status === 'completed' && <Notice tone="ok" icon="check" title={s.status.completed}>{s.completedBanner}</Notice>}
      {actionError && (
        <Notice tone="warn" icon="warn" title={s.errorTitle}>
          {actionError.code === 'step_not_skippable' ? s.notSkippable : safeText(actionError.message, s.retry)}
        </Notice>
      )}

      {guidance && (
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

  // Locale: URL first (shareable, and what the API is asked for), then the app language, then
  // English. An unsupported value is normalised rather than sent or rendered.
  const locale = resolveLocale(params.get('locale') || getLang())
  const s = useMemo(() => uiStrings(locale), [locale])

  const flowParam = params.get('flow')
  const flowKey = flowParam ? (PARAM_TO_FLOW[flowParam] || flowParam) : null

  const [help, setHelp] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [busy, setBusy] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [activeId, setActiveId] = useState(null)
  const viewedRef = useRef(new Set())

  const [home, setHome] = useState({ loading: true, error: null, flows: [], progress: [] })
  const [details, setDetails] = useState({})
  const [detail, setDetail] = useState({ loading: false, error: null, flow: null, steps: [], progress: null })

  const setParam = useCallback((key, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    setParams(next, { replace: true })
  }, [params, setParams])

  // ── home data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    // No token means nothing can be fetched. Resolve the loading state rather than leaving a
    // spinner running for a session that will never load.
    if (!token) { setHome({ loading: false, error: null, flows: [], progress: [] }); return undefined }
    let on = true
    setHome((h) => ({ ...h, loading: true, error: null }));
    (async () => {
      try {
        const [f, p] = await Promise.all([onboardingApi.flows(token, locale), onboardingApi.progress(token)])
        if (!on) return
        const flows = f.flows || []
        setHome({ loading: false, error: null, flows, progress: p.progress || [] })

        // Step previews and exact counts for the cards, from the same per-flow endpoint the
        // flow screens use. Best-effort and bounded: a failure here degrades a card to its
        // title and description; it never fails the page.
        const subset = flows.slice(0, MAX_DETAIL_PREFETCH)
        const settled = await Promise.allSettled(
          subset.map((fl) => onboardingApi.flow(token, fl.flow_key, locale)))
        if (!on) return
        const map = {}
        settled.forEach((r, i) => { if (r.status === 'fulfilled') map[subset[i].flow_key] = r.value })
        setDetails(map)
      } catch (e) {
        if (on) setHome({ loading: false, error: e, flows: [], progress: [] })
      }
    })()
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

  // Switching to a DIFFERENT flow must not briefly show the previous flow's content while the
  // new one loads. (A same-flow refetch after an action still updates in place.)
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

  // First-look telemetry. Fire-and-forget: a failed view must never block reading a step, and
  // the backend 404s it entirely when the flow was not started.
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
        <LanguageSwitcher locale={locale} label={s.language} onChange={(l) => setParam('locale', l)} />
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
        <div className="cfo-skel" style={{ height: 148, borderRadius: 16 }} />
        <div className="cfo-skel" style={{ height: 96, borderRadius: 16 }} />
        <div className="ob-cards">
          {[0, 1, 2].map((i) => <div key={i} className="cfo-skel" style={{ height: 260, borderRadius: 16 }} />)}
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
    return frame(<HomeScreen flows={home.flows} progressByFlow={progressByFlow} details={details}
      s={s} onOpen={openFlow} />)
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

  return frame(
    <FlowScreen
      flow={detail.flow} steps={steps} progress={detail.progress} s={s}
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
