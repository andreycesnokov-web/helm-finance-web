// AI Accountant — presentation blocks for the Tax & Compliance Workbench.
//
// Split out of AccountantPremium.jsx the way RadarBlocks, AICFOBlocks and
// AccountsBlocks are, and for the same two reasons: the page needs auth, five
// network calls and per-tab state, and the gated design preview has to be able
// to photograph the REAL components rather than a hand-built lookalike.
//
// AccountantPremium.jsx keeps the token, the fetches, the request guard and the
// tab state. Every pixel below is a pure function of its props.
//
// NOTHING HERE CALCULATES TAX. No rate, no threshold, no due date and no
// obligation rule lives in this file. Amounts, statuses, periods and deadlines
// arrive already decided by /accountant/obligations, /accountant/applicability
// and the statutory schedule in AccountantPremium.jsx; this module only decides
// how they are drawn.
//
// THE HONESTY CONTRACT, in display terms:
//   - an amount that was never measured renders as an em dash, never as Rp 0
//   - a confirmed zero renders as a zero
//   - "insufficient data" is drawn as a state chip, never in the figure face,
//     and always carries a line saying it is not a statement that nothing is owed
//   - profile completeness describes the FORM and says so
import { PageHeader, SummaryCard, Card, Btn, StatusBadge, DataList, LoadingSkeleton, EmptyState, ErrorState, PageTabs, Icon } from '../../shell/ui'
import { money, moneyFull, MISSING } from '../../lib/aiCfoFigures'
import './Accountant.css'

// The same official mark every other page's empty state uses, from /brand.
export const ACCOUNTANT_SYMBOL = '/brand/symbol_navy_blue_dot_transparent.svg'

// The workbench reports in the workspace's base currency, which this module is
// told rather than deciding. It does not convert and never sums across
// currencies — see client/src/lib/walletBalanceContract.js for why that matters.
export const RESERVE_CURRENCY = 'IDR'

/* ── small shared pieces ──────────────────────────────────────────────────── */

const plural = (t, n, oneKey, manyKey) =>
  (n === 1 ? t(oneKey) : t(manyKey).replace('{n}', String(n)))

const fill = (s, vars) =>
  Object.keys(vars).reduce((acc, k) => acc.split('{' + k + '}').join(String(vars[k])), s)

/**
 * How one obligation is displayed.
 *
 * Three server states, three visibly different treatments — the point being
 * that a reader scanning the amount column can tell a figure from a
 * non-figure without reading the words.
 *
 * `calculated`        a real amount, in the figure face
 * `insufficient_data` a warning-toned chip + a line saying what it does NOT mean
 * anything else       a muted chip (the module it needs is not enabled)
 *
 * The amount is formatted with money(), so a `calculated` row that arrives
 * without an amount shows an em dash rather than the Rp 0 that
 * `'Rp ' + Number(v || 0)` used to produce.
 */
export function obligationView(o, t, currency = RESERVE_CURRENCY) {
  if (!o) return { kind: 'absent', amount: MISSING, hint: '' }
  if (o.status === 'calculated') {
    return { kind: 'calculated', amount: moneyFull(o.amount, currency), hint: '' }
  }
  if (o.status === 'insufficient_data') {
    return { kind: 'insufficient', label: t('accountantHub.stateInsufficient'), hint: t('accountantHub.stateInsufficientHint') }
  }
  return { kind: 'unavailable', label: t('accountantHub.stateUnavailable'), hint: t('accountantHub.stateUnavailableHint') }
}

const StateChip = ({ view }) => (
  <span className={`acct-ob-state${view.kind === 'insufficient' ? ' is-insufficient' : ''}`}>{view.label}</span>
)

/* ── header and tabs ──────────────────────────────────────────────────────── */

/**
 * One header for the whole module, on every tab.
 *
 * It used to be suppressed on the Tax Profile tab, where the embedded profile
 * page drew a second PageHeader with a different eyebrow AND a different title
 * — so switching tabs renamed the page. The module has one identity now; the
 * profile tab contributes its Save control to this header's row instead.
 */
export function AccountantHeader({ t, onTaxSplit, onSettlement }) {
  return (
    <PageHeader
      eyebrow={t('accountantHub.eyebrow')}
      title={t('accountantHub.title')}
      context={<StatusBadge tone="info">{t('accountantHub.previewBadge')}</StatusBadge>}
      secondaryActions={<Btn sm variant="ghost" onClick={onSettlement}>{t('accountantHub.settlement')}</Btn>}
      primaryAction={<Btn sm onClick={onTaxSplit}>{t('accountantHub.taxSplit')}</Btn>}
    />
  )
}

/**
 * The tab strip.
 *
 * Five tabs do not fit a phone, and .cfo-tabs already scrolls them. What was
 * missing was any sign that they scroll: at 373px a user saw "Workbench |
 * Compliance Calendar" and nothing suggesting Tax Draft, Audit and Tax Profile
 * existed. A right-edge fade says there is more, and is removed once there
 * isn't — so the affordance never lies about content that is already on screen.
 */
export function AccountantTabs({ t, tabs, active, onChange }) {
  const onScroll = (e) => {
    const el = e.currentTarget.querySelector('.cfo-tabs')
    if (!el) return
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2
    e.currentTarget.classList.toggle('is-end', atEnd)
  }
  return (
    <div className="acct-wb-tabs" onScroll={onScroll}>
      <PageTabs tabs={tabs} active={active} onChange={onChange} />
    </div>
  )
}

/* ── workbench ────────────────────────────────────────────────────────────── */

/**
 * Which workspace modules this workbench is reading from.
 *
 * `ok === null` means presence is genuinely not checked here, which is a
 * different thing from checked-and-empty, and the two no longer share a look:
 * an unchecked module says so rather than sitting silently among the ticks.
 */
export function ModuleChips({ t, chips }) {
  return (
    <div className="acct-wb-mods">
      {chips.map((c) => (
        <StatusBadge key={c.key} tone={c.ok === null ? 'neutral' : c.ok ? 'success' : 'neutral'}>
          {c.ok ? <Icon.check width="13" height="13" /> : null} {t(c.labelKey)}
          {c.ok === false ? ` · ${t('accountantHub.noDataYet')}` : ''}
          {c.ok === null ? ` · ${t('accountantHub.notChecked')}` : ''}
        </StatusBadge>
      ))}
      <p className="acct-wb-mods-note">{t('accountantHub.syncedNote')}</p>
    </div>
  )
}

/**
 * The tax reserve — this page's one flagship figure, and now its one branded
 * surface.
 *
 * It was a hand-built <div class="cfo-summary"> with no watermark, which made
 * it the only navy hero in the product wearing no mark at all. It is the shared
 * SummaryCard with `flagship` now, so the symbol, its size, crop, opacity and
 * the reserved safe column it may not be drawn over all come from .cfo-flagship
 * in shell.css. This component positions nothing.
 *
 * ABSENCE vs ZERO. `reserve.lines` is what the server actually summed. Lines
 * present means the sum is a measured figure and a zero is a real zero, shown
 * as one. No lines means no obligation has a deterministic amount yet — that is
 * unknown, not nil, and shows an em dash with the sentence explaining it.
 */
export function ReserveCard({ t, reserve }) {
  const lines = (reserve && reserve.lines) || []
  const measured = lines.length > 0
  const amount = reserve ? reserve.amount : null
  const currency = (reserve && reserve.currency) || RESERVE_CURRENCY
  return (
    <div className="acct-reserve">
      <SummaryCard
        flagship
        label={t('accountantHub.reserveLabel')}
        value={measured
          ? money(amount, currency)
          /* The em dash stays the product's one absence marker, but at the
             flagship's 38px display size a lone dash reads as a rule someone
             drew across the card rather than as a missing figure. It is set at
             the supporting size instead — still a dash, no longer a bar. */
          : <span className="acct-reserve-absent">{MISSING}</span>}
        meta={measured
          ? fill(t('accountantHub.reserveWithLines'), {
              n: plural(t, lines.length, 'accountantHub.reserveLineOne', 'accountantHub.reserveLineMany'),
            })
          : t('accountantHub.reserveNone')}
      />
    </div>
  )
}

/**
 * Profile completeness.
 *
 * Two things changed here, both because of what the old card implied.
 *
 * It no longer turns green at 80%. A green badge and a full green bar on a page
 * about tax obligations reads as "you are compliant", and nothing on this page
 * is in a position to say that — completeness counts filled fields in a form.
 * The bar is the action colour at every value and the card states, in words,
 * exactly what it measures and what it does not.
 *
 * It also no longer reports an obligation count. That sentence read "0
 * deterministic obligations identified from your profile" while the card
 * directly beneath it listed three, because the count came from
 * /accountant/applicability and the list from /accountant/obligations, and the
 * two disagree in production. Filed as
 * _specs/accountant-applicability-obligations-contradiction.md; removing the
 * claim is the only part of it that belongs in a design change.
 */
export function CompletenessCard({ t, filled, total, missing }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((filled / total) * 100))) : 0
  return (
    <Card title={t('accountantHub.completenessTitle')} action={<StatusBadge tone="neutral">{pct}%</StatusBadge>}>
      <div className="acct-meter">
        <div className={`acct-meter-fill${pct >= 100 ? ' is-full' : ''}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="acct-completeness-meta">
        {fill(t('accountantHub.completenessMeta'), { filled, total })}
        {missing > 0 ? ' ' + fill(t('accountantHub.completenessMissing'), { n: missing }) : ''}
      </p>
      <p className="acct-caveat">{t('accountantHub.completenessCaveat')}</p>
    </Card>
  )
}

/**
 * The obligations list.
 *
 * Every row keeps the title and source label it always had. What changed is the
 * amount column: a real amount stays a figure, and the two non-amount states
 * become chips with a hint underneath, so nothing that is not money is drawn
 * where money goes.
 */
export function ObligationsCard({ t, period, obligations }) {
  const rows = obligations || []
  return (
    <Card
      className="acct-obligations"
      title={t('accountantHub.obligationsTitle')}
      action={period ? <StatusBadge tone="neutral">{period}</StatusBadge> : null}
    >
      {rows.length === 0 ? (
        <p className="acct-ob-hint">{t('accountantHub.obligationsNone')}</p>
      ) : (
        <DataList
          items={rows.map((o) => {
            const v = obligationView(o, t)
            const sub = [o.source_label, v.hint].filter(Boolean).join(' · ')
            return {
              id: o.obligation_type,
              label: o.title,
              sub,
              amount: v.kind === 'calculated' ? v.amount : <StateChip view={v} />,
              amountTone: '',
            }
          })}
        />
      )}
      <p className="acct-note">{t('accountantHub.obligationsNote')}</p>
    </Card>
  )
}

export function PendingActionsCard({ t, actions }) {
  return (
    <Card title={t('accountantHub.pendingTitle')}>
      {actions.length === 0 ? (
        <p className="acct-ob-hint">{t('accountantHub.pendingNone')}</p>
      ) : (
        <DataList
          items={actions.map((a) => ({
            id: a.id,
            label: a.label,
            sub: a.sub,
            action: <Btn sm variant="ghost" onClick={a.go}>{a.cta}</Btn>,
          }))}
        />
      )}
    </Card>
  )
}

export function CalendarPreviewCard({ t, deadlines, onOpen, formatDay }) {
  return (
    <Card
      title={t('accountantHub.calendarTitle')}
      action={<Btn sm variant="ghost" onClick={onOpen}>{t('accountantHub.openCalendar')}</Btn>}
    >
      <DataList
        items={deadlines.map((x) => ({
          id: x.key + x.date.toISOString(),
          label: x.title,
          sub: x.sub,
          amount: formatDay(x.date),
          amountTone: '',
        }))}
      />
      <p className="acct-note">{t('accountantHub.calendarNote')}</p>
    </Card>
  )
}

export function PlainLanguageCard({ t, what, why, prepare, onFilingPack, onAskCfo }) {
  return (
    <Card title={t('accountantHub.plainTitle')} className="acct-plain">
      <div className="acct-plain-grid">
        <PlainCard k={t('accountantHub.plainWhat')} v={what} />
        <PlainCard k={t('accountantHub.plainWhy')} v={why} />
        <PlainCard k={t('accountantHub.plainPrepare')} v={prepare} />
      </div>
      <div className="acct-plain-actions">
        <Btn disabled title={t('accountantHub.engineTitle')} onClick={onFilingPack}>
          {t('accountantHub.filingPack')} ({t('accountantHub.soon')})
        </Btn>
        <Btn variant="ghost" onClick={onAskCfo}>{t('accountantHub.askCfo')}</Btn>
      </div>
    </Card>
  )
}

function PlainCard({ k, v }) {
  return (
    <div className="acct-plain-card">
      <div className="acct-plain-k">{k}</div>
      <div className="acct-plain-v">{v}</div>
    </div>
  )
}

/* ── compliance calendar ──────────────────────────────────────────────────── */

/**
 * The month grid.
 *
 * Geometry and the Monday-first week are unchanged. The colours moved out of a
 * JS style object into four `.k-*` classes, which is what let the two
 * contrast bugs be fixed: a bare #fff on the PPN cell (the module's only hex
 * literal) and `var(--warning)` set as text on `var(--warning-soft)`, where
 * --warning-ink is the token that exists for exactly that pairing.
 */
export function CalendarGrid({ t, year, month, cells, deadlineFor, isToday, title, onPrev, onNext, weekdays }) {
  return (
    <Card
      title={title}
      action={
        <span className="acct-cal-nav">
          <Btn sm variant="ghost" onClick={onPrev} aria-label={t('accountantHub.prevMonth')}>←</Btn>
          <Btn sm variant="ghost" onClick={onNext} aria-label={t('accountantHub.nextMonth')}>→</Btn>
        </span>
      }
    >
      <div className="acct-cal-grid">
        {weekdays.map((d) => <div key={d} className="acct-cal-head">{d}</div>)}
      </div>
      <div className="acct-cal-grid acct-cal-days">
        {cells.map((day, i) => {
          const dls = day ? (deadlineFor(day) || []) : []
          const cls = ['acct-cal-day', 'cfo-mono']
          // A cell can only wear one ground. It takes the FIRST deadline's kind,
          // which is the schedule's own order, and every deadline on the day is
          // named in the cell's label and its tooltip — so a second obligation is
          // never invisible just because a colour cannot be split.
          if (dls.length) cls.push('k-' + dls[0].kind)
          if (dls.length > 1) cls.push('is-multi')
          if (isToday(day)) cls.push('is-today')
          const names = dls.map((d) => `${d.title} — ${d.sub}`).join('\n')
          const label = [
            day,
            isToday(day) ? t('accountantHub.today') : null,
            dls.map((d) => d.title).join(', ') || null,
          ].filter(Boolean).join(' · ')
          return (
            <div key={i} className={cls.join(' ')}
              title={names || undefined}
              aria-label={dls.length || isToday(day) ? label : undefined}>
              {day || ''}
            </div>
          )
        })}
      </div>
      <div className="acct-cal-legend">
        <Legend kind="ppn" label={t('accountantHub.legendPpn')} />
        <Legend kind="withholding" label={t('accountantHub.legendWithholding')} />
        <Legend kind="service" label={t('accountantHub.legendService')} />
        <Legend kind="cit" label={t('accountantHub.legendCit')} />
      </div>
    </Card>
  )
}

function Legend({ kind, label }) {
  return (
    <span className="acct-legend">
      <span className={`acct-legend-dot k-${kind}`} />
      {label}
    </span>
  )
}

export function DeadlinesCard({ t, rows }) {
  return (
    <Card title={t('accountantHub.deadlinesThisMonth')}>
      <DataList
        items={rows.map((r) => ({
          id: r.id,
          label: r.label,
          sub: r.sub,
          amount: r.state ? <StateChip view={r.state} /> : r.amount,
          amountTone: '',
        }))}
      />
      <p className="acct-note">{t('accountantHub.calendarFootnote')}</p>
      <div className="acct-plain-actions">
        <Btn disabled title={t('accountantHub.engineTitle')}>
          {t('accountantHub.filingPack')} ({t('accountantHub.soon')})
        </Btn>
      </div>
    </Card>
  )
}

/* ── tax draft ────────────────────────────────────────────────────────────── */

export function WithholdingCard({ t, view, sourceLabel, note }) {
  return (
    <Card
      title={t('accountantHub.withholdingTitle')}
      className="acct-withholding"
      action={<StatusBadge tone="success">{t('accountantHub.withholdingCalculated')}</StatusBadge>}
    >
      <DataList items={[{ id: 'w', label: t('accountantHub.withholdingRemit'), sub: sourceLabel, amount: view.amount, amountTone: '' }]} />
      <p className="acct-note">{note}</p>
    </Card>
  )
}

export function DraftCalculationCard({ t, rows, sources }) {
  return (
    <Card title={t('accountantHub.draftCalcTitle')} action={<StatusBadge tone="neutral">{t('accountantHub.draftBaseCurrency')}</StatusBadge>}>
      <p className="acct-note is-lead">{t('accountantHub.draftCitNote')}</p>
      <DataList items={rows.map((label) => ({ id: label, label, amount: MISSING, amountTone: '' }))} />
      <div className="acct-draft-total">
        <span>{t('accountantHub.draftTaxable')}</span><span className="cfo-mono">{MISSING}</span>
      </div>
      <div className="acct-draft-liability">
        <span>{t('accountantHub.draftLiability')}</span><span className="cfo-mono">{MISSING}</span>
      </div>
      <div className="acct-draft-sources-k">{t('accountantHub.draftSources')}</div>
      <div className="acct-draft-sources">
        {sources.map((s) => (
          <div key={s.title} className="acct-source">
            <div className="acct-source-t">{s.title}</div>
            <div className="acct-source-s">{s.sub}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

export function DraftExplanationCard({ t }) {
  return (
    <Card title={t('accountantHub.draftAiTitle')}>
      <p className="acct-draft-body">
        {t('accountantHub.draftAiBody')} <b>{t('accountantHub.draftAiEmphasis')}</b>
      </p>
      <div className="acct-draft-empty">{t('accountantHub.draftAiEmpty')}</div>
    </Card>
  )
}

export function DraftStatusCard({ t }) {
  return (
    <Card>
      <div className="acct-draft-status">
        <StatusBadge tone="neutral">{t('accountantHub.draftStatus')}</StatusBadge>
        <span className="acct-draft-status-actions">
          <Btn variant="ghost" disabled title={t('accountantHub.engineTitle')}>
            {t('accountantHub.draftExport')} ({t('accountantHub.soon')})
          </Btn>
          <Btn disabled title={t('accountantHub.engineTitle')}>
            {t('accountantHub.draftReview')} ({t('accountantHub.soon')})
          </Btn>
        </span>
      </div>
    </Card>
  )
}

/* ── audit ────────────────────────────────────────────────────────────────── */

export function AuditStat({ k, v, sub, ts }) {
  return (
    <Card title={k}>
      <div className={`acct-audit-v${ts ? ' is-ts' : ''}`}>{v}</div>
      {sub && <div className="acct-audit-k">{sub}</div>}
    </Card>
  )
}

export function AuditTrailCard({ t, events, types, entityType, onEntityType, formatTs }) {
  return (
    <Card
      title={t('accountantHub.auditTitle')}
      action={
        <select className="cfo-input acct-audit-filter" value={entityType}
          onChange={(e) => onEntityType(e.target.value)} aria-label={t('accountantHub.auditAllTypes')}>
          <option value="">{t('accountantHub.auditAllTypes')}</option>
          {types.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
        </select>
      }
    >
      {events.length === 0 ? (
        <EmptyState symbol={ACCOUNTANT_SYMBOL} title={t('accountantHub.auditEmpty')} description={t('accountantHub.auditEmptyDesc')} />
      ) : (
        <DataList
          items={events.map((e) => ({
            id: e.id,
            label: `${e.entity_type} · ${e.action}`,
            tag: e.channel || undefined,
            sub: `${e.actor_name}${e.actor_role ? ` (${e.actor_role})` : ''}${e.entity_id ? ` · ${String(e.entity_id).slice(0, 12)}` : ''}`,
            amount: formatTs(e.created_at),
            amountTone: '',
          }))}
        />
      )}
      <p className="acct-note">{t('accountantHub.auditNote')}</p>
    </Card>
  )
}

/* ── shared states ────────────────────────────────────────────────────────── */

export const AccountantLoading = ({ rows = 5 }) => (
  <Card><LoadingSkeleton rows={rows} height={18} /></Card>
)

/**
 * The load-failure state.
 *
 * The page shows nothing rather than a stale figure, which is the same rule AI
 * CFO's stale notice states: a number on screen is always from the workspace
 * currently selected.
 *
 * `message` replaces the generic description where the server said something
 * specific about what went wrong.
 */
export const AccountantError = ({ t, onRetry, message }) => (
  <ErrorState
    title={t('accountantHub.loadFailed')}
    description={message || t('accountantHub.loadFailedDesc')}
    onRetry={onRetry}
    retryLabel={t('accountantHub.retry')}
  />
)

/**
 * Not an error: a state the user's role simply does not open.
 *
 * The audit tab used to render a refused role through the failure path, under a
 * red warning icon. A permission boundary is not a fault and retrying cannot
 * change it, so it gets the neutral empty-state treatment and no retry button —
 * the same distinction the rest of the product draws between "broken" and
 * "not yours to see".
 */
export const AccountantNotice = ({ title, description }) => (
  <EmptyState symbol={ACCOUNTANT_SYMBOL} title={title} description={description} />
)
