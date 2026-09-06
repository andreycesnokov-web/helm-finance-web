// DESIGN PREVIEW — visual QA for the PR #80 design foundation.
//
// Route /design-preview. Renders a 404 unless VITE_DESIGN_PREVIEW_ENABLED === 'true',
// following the same gating idiom as PreviewApp.jsx. Vite only exposes VITE_-prefixed
// env to the bundle, so a production build without the flag ships the 404 branch.
//
// Why it exists: PR #80 changed the shared PageHeader, the flagship card watermark, the
// token layer and the semantic colour of the Pulse KPIs. Those are visual claims, and a
// visual claim needs a picture. This page renders the ACTUAL production components —
// PageHeader, SummaryCard and Pulse's own ExecutiveHero — against fixed data, so a
// screenshot proves what shipped rather than what a hand-written mock looked like.
//
// Safety: no auth, no API, no Supabase, no customer data. Every figure below is invented
// and every company name is fictional. Nothing here writes anything.
import { formatAmount } from '../lib/money'
import { PageHeader, SummaryCard, Card, Btn, StatusBadge, Icon } from '../shell/ui'
import { ExecutiveHero } from './business/PulseBlocks'
import WorkspaceShell, { BUSINESS_NAV } from '../shell/WorkspaceShell'
import './DesignPreview.css'

const PREVIEW_ON = import.meta.env.VITE_DESIGN_PREVIEW_ENABLED === 'true'

// Same 404 the gated premium preview renders, so a disabled flag looks identical
// to a route that was never registered.
function NotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-ui)', color: 'var(--text-muted)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 64, color: 'var(--brand-navy)' }}>404</div>
        <div>Not found</div>
      </div>
    </div>
  )
}

// The production formatter, byte for byte the one Pulse uses (index.jsx:57).
const idr = (v) => 'Rp ' + formatAmount(String(v ?? 0), 'IDR')

/* ── fixtures ──────────────────────────────────────────────────────────────
   Invented companies, invented figures. No real balance, tax number, bank
   detail or counterparty appears anywhere in this file. The values are chosen
   to exercise the states, not to look plausible for any real business. */
const PULSE_FIXTURE = {
  totalBalance: 122850000,
  income: 78745000,
  expenses: 42450000,
  netPosition: 60294000,
  burnRate: 3282833,
  burnWindowDays: 30,
  runway: 37,
  sourcesConnected: 4,
  sourcesTotal: 4,
  // Named keys, not an items array — ExecutiveHero reads other.opening_balance,
  // other.funding and so on (PulseBlocks.jsx:124). An items array renders an empty list.
  other_cash_movement: { total: 17000000, opening_balance: 12000000, funding: 5000000 },
}

// The same shape with the signs that flip every semantic colour.
const PULSE_NEGATIVE = {
  ...PULSE_FIXTURE,
  income: 0,
  netPosition: -18200000,
  runway: 12,
}

/* The real app frame, driven by synthetic props.
   WorkspaceShell is presentational — its only hook is useState, and it reads
   nothing but the props below — so the shell in these screenshots is the shell
   the product ships, not a drawing of it. No auth, no router, no network. */
const SHELL_WORKSPACES = {
  personal: [{ id: 'demo-personal', name: 'Personal', type: 'personal', role: 'owner' }],
  business: [{
    id: 'demo-business', name: 'Nusantara Facilities', type: 'business',
    // No business_code: the switcher renders one when present, and a technical
    // identifier is not something a business user needs to read on every screen.
    role: 'owner', location: 'Bali, Indonesia',
  }],
}
const noop = () => {}

const LONG_TITLE = 'Nusantara Integrated Facilities Management & Industrial Services'
const LONG_DESC = 'Cash position, this month’s operating figures and anything waiting on you — '
  + 'including unclassified transactions, documents awaiting confirmation and any tax deadline '
  + 'falling inside the next reporting period.'

// ?only=<id> renders a single example. Screenshot tooling captures the top of the
// viewport, so a hash anchor is not enough to frame one component — this is.
const params = typeof location !== 'undefined'
  ? new URLSearchParams(location.search)
  : new URLSearchParams()
const ONLY = params.get('only')
// ?shell=pulse | ?shell=accounts renders the page inside the real application
// frame, which is the only way a screenshot can speak to sidebar, gutters and
// content width rather than to a component floating on a blank page.
const SHELL = params.get('shell')

const Section = ({ id, title, note, children, wide }) => (
  ONLY && ONLY !== id ? null : (
  <section className="dsp-section" id={id}>
    <div className="dsp-section-head">
      <h2 className="dsp-h2">{title}</h2>
      {note && <p className="dsp-note">{note}</p>}
    </div>
    <div className={wide ? 'dsp-stage dsp-stage-wide' : 'dsp-stage'}>{children}</div>
  </section>
  )
)

// Page bodies, shared by the isolated catalogue and the in-shell views, so the
// two can never drift into showing different things.
const PulseBody = () => (
  <>
    <PageHeader
      eyebrow="Business Workspace"
      title="Nusantara Facilities"
      description="Cash position, this month's operating figures and anything waiting on you."
    />
    <ExecutiveHero d={PULSE_FIXTURE} idr={idr} readiness={null} empty={false} />
  </>
)

const AccountsBody = () => (
  <>
    <PageHeader
      title="Wallets &amp; Accounts"
      description="Manage your bank accounts, cash, and payment wallets"
      primaryAction={<Btn variant="primary">+ Add wallet</Btn>}
    />
    <SummaryCard
      flagship
      label="Total balance · all wallets"
      value={<span className="fin">{idr(152450000)}</span>}
      meta="IDR · 4 wallets"
    />
  </>
)

function ShellPreview({ page }) {
  return (
    // No preview banner here on purpose: these are pictures of the product frame,
    // and a strip of our own chrome above it would misrepresent what ships.
    <div className="dsp-shell">
      <WorkspaceShell
        workspaces={SHELL_WORKSPACES}
        activeId="demo-business"
        onSelectWorkspace={noop}
        nav={BUSINESS_NAV}
        activeKey={page === 'accounts' ? 'accounts' : 'pulse'}
        onNavigate={noop}
      >
        {page === 'accounts' ? <AccountsBody /> : <PulseBody />}
      </WorkspaceShell>
    </div>
  )
}

export default function DesignPreview() {
  if (!PREVIEW_ON) return <NotFound />
  if (SHELL) return <ShellPreview page={SHELL} />

  return (
    <div className="dsp-root">
      <div className="dsp-banner" role="note">
        DESIGN PREVIEW · SYNTHETIC DATA · NOT A CUSTOMER PAGE
      </div>

      <div className="dsp-wrap">
        {/* Deliberately not an h1: each example below renders the real PageHeader,
            which owns the h1. A catalogue page must not compete with the thing it
            is cataloguing. */}
        <p className="dsp-title">PR #80 — design foundation</p>
        <p className="dsp-lede">
          The real components, not a mock: <code>PageHeader</code>, <code>SummaryCard</code> and
          {' '}<code>FlagshipMark</code> from <code>shell/ui.jsx</code>, and Pulse&rsquo;s own
          {' '}<code>ExecutiveHero</code>. Every figure is invented.
        </p>

        {/* ── Pulse ────────────────────────────────────────────────────── */}
        <Section id="pulse" title="Pulse" wide
          note="Shared header with a description, the navy flagship card wearing the shared mark, and the KPI row — which stays unbranded.">
          <PulseBody />
        </Section>

        {/* ── Accounts ─────────────────────────────────────────────────── */}
        <Section id="accounts" title="Accounts" wide
          note="The same header and the same navy flagship card, from the same components and the same watermark — this page used to draw its own gradient with a graph-paper grid.">
          <AccountsBody />
        </Section>

        {/* ── semantic colour ──────────────────────────────────────────── */}
        <Section id="semantic" title="Semantic colour" wide
          note="Same component, figures flipped: zero revenue is no longer green, cash out is ink, a negative net position is red and a short runway warns.">
          <ExecutiveHero d={PULSE_NEGATIVE} idr={idr} readiness={null} empty={false} />
          <div className="dsp-chips">
            <span className="dsp-chip dsp-ok">Reconciled — success</span>
            <span className="dsp-chip dsp-warn">Needs review — warning</span>
            <span className="dsp-chip dsp-bad">Overdue 42 days — danger</span>
            <span className="dsp-chip dsp-info">AI suggestion — info</span>
          </div>
          <div className="dsp-values">
            <span className="fin dsp-v-pos">+ {idr(78745000)}</span>
            <span className="fin dsp-v-ink">− {idr(42450000)}</span>
            <span className="fin dsp-v-warn">37 days</span>
            <span className="fin dsp-v-neg">− {idr(18200000)}</span>
          </div>
        </Section>

        {/* ── wrapping ─────────────────────────────────────────────────── */}
        <Section id="wrapping" title="Long title and description" wide
          note="A long company name and a long description must wrap without pushing the actions off the row or clipping.">
          <PageHeader
            eyebrow="Business Workspace"
            title={LONG_TITLE}
            description={LONG_DESC}
            primaryAction={<Btn variant="primary">Primary action</Btn>}
            secondaryActions={<Btn variant="ghost">Secondary</Btn>}
            context={<>
              <StatusBadge tone="shared" icon={<Icon.users />}>Shared workspace</StatusBadge>
              <StatusBadge tone="neutral">Owner</StatusBadge>
            </>}
          />
        </Section>

        {/* ── the two branding layers ──────────────────────────────────── */}
        <Section id="watermark" title="Branding layers" wide
          note="Two marks, deliberately unequal. This header has no controls, so it carries the ambient page-hero mark at 3.5% set well inside a reserved column no text may enter; the flagship navy card carries the brand moment at 7%, cropped by the card edge. An action header (Accounts, and the long-title example above) drops the hero mark rather than sit it behind a control. Both marks are absent from the accessibility tree.">
          <PageHeader
            eyebrow="Business Workspace"
            title="Nusantara Facilities"
            description="With no action on this header, the hero symbol sits inside the band with clear space around it, so it reads as a background watermark rather than an icon clipped by the layout."
          />
          <SummaryCard
            flagship
            label="Total cash · IDR"
            value={<span className="fin">{idr(122850000)}</span>}
            meta="Cropped by the card edge, and behind nothing anyone has to read."
          />
          {/* The same component with the prop left off — the difference between a
              flagship card and an ordinary one is one word at the call site. */}
          <SummaryCard
            label="An ordinary summary card · no mark"
            value={<span className="fin">{idr(4820000)}</span>}
            meta="The watermark is opt-in, so every other card on every page stays plain."
          />
        </Section>

        {/* ── focus ────────────────────────────────────────────────────── */}
        <Section id="focus" title="Focus and controls"
          note="Tab through these. The ring is the brand blue's accessible ink (#1565C0) at 2px with a 2px offset — 3.65:1 against the page and 5.75:1 on white, where the raw accent measured 2.76:1. On navy surfaces it switches to white.">
          <Card title="Interactive">
            <div className="dsp-row">
              <Btn variant="primary" className="dsp-focus-target">Primary</Btn>
              <Btn variant="ghost">Secondary</Btn>
              <Btn variant="secondary">Emphasis</Btn>
              <a href="#pulse" className="dsp-link">A link</a>
            </div>
          </Card>
        </Section>
      </div>
    </div>
  )
}
