import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../shell/ui'
import './OnboardingPreview.css'
import OnboardingTourPreview from './OnboardingTourPreview'

const QUICK_STEPS = [
  { key: 'company', label: 'Company', icon: 'bank' },
  { key: 'accountant', label: 'AI Accountant', icon: 'acct' },
  { key: 'wallets', label: 'Wallets', icon: 'wallet' },
  { key: 'documents', label: 'Documents', icon: 'doc' },
  { key: 'payments', label: 'Payments', icon: 'card' },
  { key: 'finish', label: 'Finish', icon: 'check' },
]

const TRANSLATIONS = {
  en: {
    welcomeTitle: 'Welcome to CFO Finance OS',
    welcomeSubtitle: "Let's set up your finance workspace in a few minutes.",
    quick: 'Start quick setup', tour: 'Start full tour', skip: 'Skip for now',
    aiSetup: 'AI Accountant setup', support: 'Support', needHelp: 'Need help?',
    quickMode: 'Quick setup', tourMode: 'Full tour', continue: 'Continue',
    back: 'Back', next: 'Next', openDashboard: 'Open dashboard',
  },
  id: {
    welcomeTitle: 'Selamat datang di CFO Finance OS',
    welcomeSubtitle: 'Mari siapkan ruang kerja keuangan Anda dalam beberapa menit.',
    quick: 'Mulai pengaturan cepat', tour: 'Mulai tur lengkap', skip: 'Lewati untuk sekarang',
    aiSetup: 'Pengaturan AI Accountant', support: 'Dukungan', needHelp: 'Butuh bantuan?',
    quickMode: 'Pengaturan cepat', tourMode: 'Tur lengkap', continue: 'Lanjutkan',
    back: 'Kembali', next: 'Berikutnya', openDashboard: 'Buka dashboard',
  },
  ru: {
    welcomeTitle: '\u0414\u043e\u0431\u0440\u043e \u043f\u043e\u0436\u0430\u043b\u043e\u0432\u0430\u0442\u044c \u0432 CFO Finance OS',
    welcomeSubtitle: '\u0414\u0430\u0432\u0430\u0439\u0442\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0438\u043c \u0444\u0438\u043d\u0430\u043d\u0441\u043e\u0432\u043e\u0435 \u043f\u0440\u043e\u0441\u0442\u0440\u0430\u043d\u0441\u0442\u0432\u043e \u0437\u0430 \u043d\u0435\u0441\u043a\u043e\u043b\u044c\u043a\u043e \u043c\u0438\u043d\u0443\u0442.',
    quick: '\u041d\u0430\u0447\u0430\u0442\u044c \u0431\u044b\u0441\u0442\u0440\u0443\u044e \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0443',
    tour: '\u041d\u0430\u0447\u0430\u0442\u044c \u043f\u043e\u043b\u043d\u044b\u0439 \u0442\u0443\u0440',
    skip: '\u041f\u0440\u043e\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u043f\u043e\u043a\u0430',
    aiSetup: '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0430 AI Accountant',
    support: '\u041f\u043e\u0434\u0434\u0435\u0440\u0436\u043a\u0430',
    needHelp: '\u041d\u0443\u0436\u043d\u0430 \u043f\u043e\u043c\u043e\u0449\u044c?',
    quickMode: '\u0411\u044b\u0441\u0442\u0440\u0430\u044f \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0430',
    tourMode: '\u041f\u043e\u043b\u043d\u044b\u0439 \u0442\u0443\u0440',
    continue: '\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c',
    back: '\u041d\u0430\u0437\u0430',
    next: '\u0414\u0430\u043b\u0435\u0435',
    openDashboard: '\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0434\u0430\u0448\u0431\u043e\u0440\u0434',
  },
}

const ROLE_CONTENT = {
  en: { prompt: 'What is your role?', note: 'We will adapt setup and the product tour to your responsibilities.', resume: 'Continue saved tour', resumeNote: 'Return to the last completed section.', path: 'Personalized path', items: {
    owner: { label: 'Owner / Founder', description: 'Company control, approvals, team and financial visibility.', icon: 'crown' },
    cfo: { label: 'CFO / Finance lead', description: 'Cash, risk, planning, decisions and reporting.', icon: 'cfo' },
    accountant: { label: 'Accountant', description: 'Tax, documents, reconciliation and accounting readiness.', icon: 'acct' },
  }},
  id: { prompt: 'Apa peran Anda?', note: 'Pengaturan dan tur produk akan disesuaikan dengan tanggung jawab Anda.', resume: 'Lanjutkan tur tersimpan', resumeNote: 'Kembali ke bagian terakhir.', path: 'Jalur yang dipersonalisasi', items: {
    owner: { label: 'Pemilik / Pendiri', description: 'Kontrol perusahaan, persetujuan, tim, dan visibilitas keuangan.', icon: 'crown' },
    cfo: { label: 'CFO / Pimpinan keuangan', description: 'Kas, risiko, perencanaan, keputusan, dan pelaporan.', icon: 'cfo' },
    accountant: { label: 'Akuntan', description: 'Pajak, dokumen, rekonsiliasi, dan kesiapan akuntansi.', icon: 'acct' },
  }},
  ru: { prompt: '\u041a\u0430\u043a\u0430\u044f \u0443 \u0432\u0430\u0441 \u0440\u043e\u043b\u044c?', note: '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0430 \u0438 \u0442\u0443\u0440 \u0431\u0443\u0434\u0443\u0442 \u0430\u0434\u0430\u043f\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u044b \u043f\u043e\u0434 \u0432\u0430\u0448\u0443 \u0437\u043e\u043d\u0443 \u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043d\u043d\u043e\u0441\u0442\u0438.', resume: '\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u044b\u0439 \u0442\u0443\u0440', resumeNote: '\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f \u043a \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0435\u043c\u0443 \u0440\u0430\u0437\u0434\u0435\u043b\u0443.', path: '\u041f\u0435\u0440\u0441\u043e\u043d\u0430\u043b\u044c\u043d\u044b\u0439 \u043c\u0430\u0440\u0448\u0440\u0443\u0442', items: {
    owner: { label: '\u0412\u043b\u0430\u0434\u0435\u043b\u0435\u0446 / \u041e\u0441\u043d\u043e\u0432\u0430\u0442\u0435\u043b\u044c', description: '\u041a\u043e\u043d\u0442\u0440\u043e\u043b\u044c \u043a\u043e\u043c\u043f\u0430\u043d\u0438\u0438, \u0441\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u0438\u044f, \u043a\u043e\u043c\u0430\u043d\u0434\u0430 \u0438 \u0444\u0438\u043d\u0430\u043d\u0441\u044b.', icon: 'crown' },
    cfo: { label: 'CFO / \u0424\u0438\u043d\u0430\u043d\u0441\u043e\u0432\u044b\u0439 \u0440\u0443\u043a\u043e\u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044c', description: '\u0414\u0435\u043d\u044c\u0433\u0438, \u0440\u0438\u0441\u043a\u0438, \u043f\u043b\u0430\u043d\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435, \u0440\u0435\u0448\u0435\u043d\u0438\u044f \u0438 \u043e\u0442\u0447\u0451\u0442\u043d\u043e\u0441\u0442\u044c.', icon: 'cfo' },
    accountant: { label: '\u0411\u0443\u0445\u0433\u0430\u043b\u0442\u0435\u0440', description: '\u041d\u0430\u043b\u043e\u0433\u0438, \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u044b, \u0441\u0432\u0435\u0440\u043a\u0430 \u0438 \u0433\u043e\u0442\u043e\u0432\u043d\u043e\u0441\u0442\u044c \u0443\u0447\u0451\u0442\u0430.', icon: 'acct' },
  }},
}

const TOUR_STORAGE_KEY = 'cfo-onboarding-tour-preview-v2'
function readTourProgress() {
  try { return JSON.parse(localStorage.getItem(TOUR_STORAGE_KEY) || 'null') } catch { return null }
}
const CHECKLIST_ITEMS = [
  'Complete company profile',
  'Configure AI Accountant',
  'Add wallet',
  'Upload document',
  'Connect payment provider',
  'Invite accountant',
  'View first Pulse report',
]

const PROVIDERS = [
  { id: 'xendit', name: 'Xendit', meta: 'Indonesia payments', mark: 'X' },
  { id: 'midtrans', name: 'Midtrans', meta: 'Cards and transfers', mark: 'M' },
  { id: 'stripe', name: 'Stripe', meta: 'International payments', mark: 'S' },
]

function AppIcon({ name, size = 18, className = '' }) {
  const Component = Icon[name] || Icon.dot
  return <Component width={size} height={size} className={className} aria-hidden="true" />
}

function Button({ children, variant = 'primary', icon, iconAfter, onClick, disabled, className = '', type = 'button' }) {
  return (
    <button type={type} className={`op-btn op-btn-${variant} ${className}`} onClick={onClick} disabled={disabled}>
      {icon && <AppIcon name={icon} size={17} />}
      <span>{children}</span>
      {iconAfter && <AppIcon name={iconAfter} size={16} className="op-icon-right" />}
    </button>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text', wide = false, suffix }) {
  return (
    <label className={`op-field ${wide ? 'op-field-wide' : ''}`}>
      <span>{label}</span>
      <span className="op-input-wrap">
        <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
        {suffix && <small>{suffix}</small>}
      </span>
    </label>
  )
}

function SelectField({ label, value, onChange, options, wide = false }) {
  return (
    <label className={`op-field ${wide ? 'op-field-wide' : ''}`}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
    </label>
  )
}

function Toggle({ checked, onChange, label, sub }) {
  return (
    <div className="op-toggle-row">
      <div><strong>{label}</strong>{sub && <span>{sub}</span>}</div>
      <button type="button" role="switch" aria-checked={checked} className={`op-toggle ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}>
        <span />
      </button>
    </div>
  )
}

function PreviewHeader({ lang, setLang, surface, startQuick, startTour, openSupport, t }) {
  return (
    <header className="op-header">
      <div className="op-brand">
        <img src="/brand/logo_main_navy_transparent.svg" alt="CFO AI Financial OS" />
        <span className="op-preview-tag">Design preview</span>
      </div>
      <div className="op-header-tools">
        <div className="op-mode-switch" role="tablist" aria-label="Onboarding mode">
          <button className={surface === 'quick' ? 'is-active' : ''} onClick={startQuick} role="tab" aria-selected={surface === 'quick'}>
            <AppIcon name="check" size={15} />{t.quickMode}
          </button>
          <button className={surface === 'tour' ? 'is-active' : ''} onClick={startTour} role="tab" aria-selected={surface === 'tour'}>
            <AppIcon name="play" size={15} />{t.tourMode}
          </button>
        </div>
        <label className="op-language">
          <AppIcon name="globe" size={16} />
          <select value={lang} onChange={(event) => setLang(event.target.value)} aria-label="Language">
            <option value="en">English</option>
            <option value="id">Indonesian</option>
            <option value="ru">Russian</option>
          </select>
        </label>
        <button className="op-help-btn" onClick={openSupport} title={t.needHelp} aria-label={t.needHelp}>
          <span>?</span><b>{t.needHelp}</b>
        </button>
      </div>
    </header>
  )
}

function WelcomeScreen({ t, roles, role, setRole, startQuick, startTour, resumeTour, savedTour, skip }) {
  return (
    <main className="op-welcome">
      <section className="op-welcome-copy">
        <div className="op-eyebrow"><span /> Finance workspace setup</div>
        <h1>{t.welcomeTitle}</h1>
        <p>{t.welcomeSubtitle}</p>
        <div className="op-role-picker">
          <div><strong>{roles.prompt}</strong><span>{roles.note}</span></div>
          <div role="radiogroup" aria-label={roles.prompt}>
            {Object.entries(roles.items).map(([key, item]) => (
              <button key={key} type="button" role="radio" aria-checked={role === key} className={role === key ? 'is-selected' : ''} onClick={() => setRole(key)}>
                <i><AppIcon name={item.icon} size={17} /></i><span><b>{item.label}</b><small>{item.description}</small></span>
              </button>
            ))}
          </div>
        </div>
        {savedTour && <button className="op-resume-tour" onClick={resumeTour}><AppIcon name="play" size={18} /><span><b>{roles.resume}</b><small>{roles.resumeNote}</small></span><AppIcon name="chev" size={16} /></button>}
        <div className="op-welcome-actions">
          <Button onClick={startQuick} icon="check" iconAfter="chev">{t.quick}</Button>
          <Button onClick={startTour} variant="secondary" icon="play">{t.tour}</Button>
          <button className="op-skip-link" onClick={skip}>{t.skip}</button>
        </div>
        <div className="op-trust-row">
          <span><AppIcon name="lock" size={15} /> Private workspace</span>
          <span><AppIcon name="check" size={15} /> Guided setup</span>
          <span><AppIcon name="cfo" size={15} /> AI assistance</span>
        </div>
      </section>

      <section className="op-welcome-visual" aria-label="Finance workspace preview">
        <div className="op-visual-top">
          <div><small>WORKSPACE READINESS</small><strong>Ready for the first report</strong></div>
          <span className="op-status"><i /> On track</span>
        </div>
        <div className="op-readiness-layout">
          <div className="op-score-ring" style={{ '--score': '72%' }}><span>72<small>%</small></span></div>
          <div className="op-readiness-copy">
            <strong>3 core steps completed</strong>
            <p>Company context is ready. Add financial sources to unlock your first Pulse.</p>
          </div>
        </div>
        <div className="op-mini-metrics">
          <div><span>Company</span><strong>Complete</strong><i className="green" /></div>
          <div><span>Accounting</span><strong>In review</strong><i className="blue" /></div>
          <div><span>Connections</span><strong>2 remaining</strong><i className="amber" /></div>
        </div>
        <div className="op-visual-chart">
          <div className="op-chart-head"><span>Projected workspace readiness</span><b>Today</b></div>
          <div className="op-bars" aria-hidden="true">
            {[32, 46, 44, 58, 64, 72, 86].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
          </div>
        </div>
      </section>
    </main>
  )
}

function QuickStepRail({ current, onSelect, role, roles }) {
  return (
    <aside className="op-step-rail">
      <div className="op-step-rail-head"><span>QUICK SETUP</span><strong>{current + 1} of {QUICK_STEPS.length}</strong></div>
<div className="op-rail-progress"><span style={{ width: `${((current + 1) / QUICK_STEPS.length) * 100}%` }} /></div>
      <div className="op-role-context"><i><AppIcon name={roles.items[role].icon} size={16} /></i><span><small>{roles.path}</small><b>{roles.items[role].label}</b></span></div>
      <nav aria-label="Quick setup steps">
        {QUICK_STEPS.map((step, index) => {
          const complete = index < current
          const active = index === current
          return (
            <button key={step.key} className={`${active ? 'is-active' : ''} ${complete ? 'is-complete' : ''}`} onClick={() => onSelect(index)} aria-current={active ? 'step' : undefined}>
              <span className="op-step-number">{complete ? <AppIcon name="check" size={14} /> : index + 1}</span>
              <span><strong>{step.label}</strong><small>{active ? 'In progress' : complete ? 'Completed' : 'Not started'}</small></span>
            </button>
          )
        })}
      </nav>
      <div className="op-rail-note">
        <AppIcon name="lock" size={17} />
        <span><strong>Save and return anytime</strong><small>Progress stays with your workspace.</small></span>
      </div>
    </aside>
  )
}

function StepSection({ eyebrow, title, description, children }) {
  return (
    <section className="op-step-section">
      <div className="op-step-heading"><span>{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>
      {children}
    </section>
  )
}

function CompanyStep({ form, setForm }) {
  return (
    <StepSection eyebrow="STEP 1" title="Tell us about your company" description="This creates the reporting context used across your workspace.">
      <div className="op-form-grid">
        <Field label="Company name" value={form.companyName} onChange={(value) => setForm({ ...form, companyName: value })} wide />
        <SelectField label="Country" value={form.country} onChange={(value) => setForm({ ...form, country: value })} options={['Indonesia', 'Singapore', 'United Kingdom', 'United States']} />
        <SelectField label="Reporting currency" value={form.currency} onChange={(value) => setForm({ ...form, currency: value })} options={['IDR', 'USD', 'SGD', 'EUR']} />
        <SelectField label="Timezone" value={form.timezone} onChange={(value) => setForm({ ...form, timezone: value })} options={['Asia/Jakarta (WIB)', 'Asia/Makassar (WITA)', 'Asia/Singapore', 'Europe/London']} />
        <SelectField label="Financial year starts" value={form.financialYear} onChange={(value) => setForm({ ...form, financialYear: value })} options={['January', 'April', 'July', 'October']} />
      </div>
      <div className="op-context-strip">
        <AppIcon name="cfo" size={20} />
        <div><strong>Workspace context</strong><span>Reports will use {form.currency} and {form.timezone} for {form.companyName || 'your company'}.</span></div>
        <span className="op-ready-badge">Ready</span>
      </div>
    </StepSection>
  )
}

function AccountantStep({ form, setForm, t }) {
  const readiness = useMemo(() => {
    const fields = [form.legalType, form.country, form.nib, form.npwp, form.kbli, form.taxScheme, form.employees]
    const extras = [form.companyDocs, form.firstDocument, form.payrollActive]
    return Math.round(([...fields, ...extras].filter(Boolean).length / 10) * 100)
  }, [form])

  return (
    <StepSection eyebrow="STEP 2" title={t.aiSetup} description="Give AI Accountant enough legal, tax, payroll, and evidence context to prepare reliable work.">
      <div className="op-accountant-summary">
        <div className="op-score-ring small" style={{ '--score': `${readiness}%` }}><span>{readiness}<small>%</small></span></div>
        <div><small>ACCOUNTING READINESS SCORE</small><strong>{readiness >= 80 ? 'Ready for review' : 'Company context in progress'}</strong><p>Complete identifiers and upload the first source document to improve readiness.</p></div>
        <span className="op-score-status">{readiness >= 80 ? 'Strong' : 'Developing'}</span>
      </div>

      <div className="op-section-label"><span>Legal and registration</span><i /></div>
      <div className="op-form-grid op-form-compact">
        <SelectField label="Legal entity type" value={form.legalType} onChange={(value) => setForm({ ...form, legalType: value })} options={['PT (Perseroan Terbatas)', 'CV', 'Yayasan', 'Sole proprietor']} />
        <SelectField label="Country" value={form.country} onChange={(value) => setForm({ ...form, country: value })} options={['Indonesia', 'Singapore', 'United Kingdom']} />
        <Field label="NIB" value={form.nib} onChange={(value) => setForm({ ...form, nib: value })} placeholder="13-digit business number" />
        <Field label="NPWP" value={form.npwp} onChange={(value) => setForm({ ...form, npwp: value })} placeholder="00.000.000.0-000.000" />
        <Field label="KBLI" value={form.kbli} onChange={(value) => setForm({ ...form, kbli: value })} placeholder="Primary business classification" wide />
      </div>

      <div className="op-inline-setting">
        <div><span>PKP status</span><small>Is the company registered as a taxable entrepreneur?</small></div>
        <div className="op-segmented">
          {['Registered', 'Not registered', 'Unsure'].map((value) => <button key={value} className={form.pkp === value ? 'is-active' : ''} onClick={() => setForm({ ...form, pkp: value })}>{value}</button>)}
        </div>
      </div>

      <div className="op-section-label"><span>Tax and payroll context</span><i /></div>
      <div className="op-form-grid op-form-compact">
        <SelectField label="Tax profile" value={form.taxScheme} onChange={(value) => setForm({ ...form, taxScheme: value })} options={['Standard corporate income tax', 'Final tax - UMKM', 'Not confirmed']} />
        <Field label="Employees" value={form.employees} onChange={(value) => setForm({ ...form, employees: value })} type="number" suffix="people" />
      </div>
      <Toggle checked={form.payrollActive} onChange={(value) => setForm({ ...form, payrollActive: value })} label="Payroll is active" sub="Include employee and payroll obligations in accounting readiness." />

      <div className="op-section-label"><span>Evidence readiness</span><i /></div>
      <div className="op-evidence-grid">
        <button className={form.companyDocs ? 'is-complete' : ''} onClick={() => setForm({ ...form, companyDocs: !form.companyDocs })}>
          <span><AppIcon name="doc" size={19} /></span><div><strong>Company documents</strong><small>Deed, NIB, NPWP, and tax registration</small></div><i>{form.companyDocs ? 'Added' : 'Add'}</i>
        </button>
        <button className={form.firstDocument ? 'is-complete' : ''} onClick={() => setForm({ ...form, firstDocument: !form.firstDocument })}>
          <span><AppIcon name="list" size={19} /></span><div><strong>First invoice or receipt</strong><small>Give AI Accountant a real example to review</small></div><i>{form.firstDocument ? 'Added' : 'Add'}</i>
        </button>
      </div>
    </StepSection>
  )
}

function WalletStep({ wallet, setWallet }) {
  const choices = [
    { id: 'bank', name: 'Bank account', meta: 'Operating account', icon: 'bank' },
    { id: 'cash', name: 'Petty cash', meta: 'Cash on hand', icon: 'wallet' },
    { id: 'gateway', name: 'Payment balance', meta: 'Provider wallet', icon: 'card' },
  ]
  return (
    <StepSection eyebrow="STEP 3" title="Add your first wallet" description="Start with the account you use most. You can add more currencies and sources later.">
      <div className="op-choice-grid">
        {choices.map((choice) => (
          <button key={choice.id} className={wallet.type === choice.id ? 'is-selected' : ''} onClick={() => setWallet({ ...wallet, type: choice.id })}>
            <span><AppIcon name={choice.icon} size={20} /></span><strong>{choice.name}</strong><small>{choice.meta}</small><i><AppIcon name="check" size={13} /></i>
          </button>
        ))}
      </div>
      <div className="op-form-grid op-form-compact">
        <Field label="Wallet name" value={wallet.name} onChange={(value) => setWallet({ ...wallet, name: value })} placeholder="Main operating account" wide />
        <SelectField label="Currency" value={wallet.currency} onChange={(value) => setWallet({ ...wallet, currency: value })} options={['IDR', 'USD', 'SGD']} />
        <Field label="Opening balance" value={wallet.balance} onChange={(value) => setWallet({ ...wallet, balance: value })} placeholder="0" suffix={wallet.currency} />
      </div>
      <div className="op-context-strip neutral">
        <AppIcon name="lock" size={19} /><div><strong>No bank connection yet</strong><span>This preview only creates a workspace structure. No credentials are requested.</span></div>
      </div>
    </StepSection>
  )
}

function DocumentsStep({ documentAdded, setDocumentAdded }) {
  return (
    <StepSection eyebrow="STEP 4" title="Upload the first document" description="A source document helps show how evidence, transactions, and AI review work together.">
      <button className={`op-dropzone ${documentAdded ? 'is-added' : ''}`} onClick={() => setDocumentAdded(!documentAdded)}>
        <span className="op-drop-icon"><AppIcon name={documentAdded ? 'check' : 'cloud'} size={25} /></span>
        <strong>{documentAdded ? 'Invoice_July_2026.pdf added' : 'Choose a sample invoice or receipt'}</strong>
        <p>{documentAdded ? 'Ready for AI Accountant review' : 'PDF, JPG, PNG or spreadsheet - design preview only'}</p>
        <span className="op-inline-action">{documentAdded ? 'Remove sample' : 'Browse files'}</span>
      </button>
      <div className="op-document-flow">
        <div><span>1</span><strong>Upload</strong><small>Keep the original evidence</small></div><i />
        <div><span>2</span><strong>AI review</strong><small>Extract date, amount, and supplier</small></div><i />
        <div><span>3</span><strong>Confirm</strong><small>You stay in control</small></div>
      </div>
    </StepSection>
  )
}

function PaymentsStep({ provider, setProvider }) {
  return (
    <StepSection eyebrow="STEP 5" title="Connect a payment provider" description="Choose a provider to preview how incoming payment connections will appear. No connection is created.">
      <div className="op-provider-list">
        {PROVIDERS.map((item) => (
          <button key={item.id} className={provider === item.id ? 'is-selected' : ''} onClick={() => setProvider(provider === item.id ? '' : item.id)}>
            <span className={`op-provider-mark ${item.id}`}>{item.mark}</span>
            <span><strong>{item.name}</strong><small>{item.meta}</small></span>
            <i>{provider === item.id ? 'Selected' : 'Select'}</i>
          </button>
        ))}
      </div>
      <div className="op-safe-note"><AppIcon name="lock" size={18} /><span><strong>Design-only connection</strong>No keys, credentials, or provider data are requested in this prototype.</span></div>
    </StepSection>
  )
}

function FinishStep({ form, openDashboard, startTour }) {
  return (
    <StepSection eyebrow="STEP 6" title="Your workspace is ready to explore" description="The foundation is in place. Continue setup from Pulse or take a guided product tour.">
      <div className="op-finish-panel">
        <span className="op-finish-check"><AppIcon name="check" size={30} /></span>
        <div><small>WORKSPACE CREATED</small><strong>{form.companyName}</strong><p>{form.currency} reporting - {form.country} - AI Accountant context started</p></div>
      </div>
      <div className="op-finish-summary">
        <div><AppIcon name="bank" size={18} /><span><small>Company profile</small><strong>Complete</strong></span></div>
        <div><AppIcon name="acct" size={18} /><span><small>AI Accountant</small><strong>In progress</strong></span></div>
        <div><AppIcon name="wallet" size={18} /><span><small>First wallet</small><strong>Added</strong></span></div>
      </div>
      <div className="op-finish-actions">
        <Button onClick={openDashboard} icon="pulse">Open Pulse dashboard</Button>
        <Button onClick={startTour} variant="secondary" icon="play">Start full product tour</Button>
      </div>
    </StepSection>
  )
}

function QuickSetup({ current, setCurrent, t, role, roles, openDashboard, startTour }) {
  const [form, setForm] = useState({
    companyName: 'PT Aruna Commerce', country: 'Indonesia', currency: 'IDR', timezone: 'Asia/Jakarta (WIB)', financialYear: 'January',
    legalType: 'PT (Perseroan Terbatas)', nib: '9120304050607', npwp: '', pkp: 'Not registered', kbli: '62019 - Other IT activities',
    taxScheme: 'Standard corporate income tax', employees: '18', payrollActive: true, companyDocs: true, firstDocument: false,
  })
  const [wallet, setWallet] = useState({ type: 'bank', name: 'BCA Operating Account', currency: 'IDR', balance: '125,000,000' })
  const [documentAdded, setDocumentAdded] = useState(false)
  const [provider, setProvider] = useState('')

  const content = [
    <CompanyStep key="company" form={form} setForm={setForm} />,
    <AccountantStep key="accountant" form={form} setForm={setForm} t={t} />,
    <WalletStep key="wallet" wallet={wallet} setWallet={setWallet} />,
    <DocumentsStep key="documents" documentAdded={documentAdded} setDocumentAdded={setDocumentAdded} />,
    <PaymentsStep key="payments" provider={provider} setProvider={setProvider} />,
    <FinishStep key="finish" form={form} openDashboard={openDashboard} startTour={startTour} />,
  ]

  return (
    <main className="op-quick">
      <QuickStepRail current={current} onSelect={setCurrent} role={role} roles={roles} />
      <div className="op-step-workspace">
        {content[current]}
        {current < QUICK_STEPS.length - 1 && (
          <div className="op-step-actions">
            <Button variant="ghost" onClick={() => setCurrent(Math.max(0, current - 1))} disabled={current === 0} icon="chev">{t.back}</Button>
            <span>Changes are saved in this preview only</span>
            <Button onClick={() => setCurrent(Math.min(QUICK_STEPS.length - 1, current + 1))} iconAfter="chev">{t.continue}</Button>
          </div>
        )}
      </div>
    </main>
  )
}

function DashboardChecklist({ continueSetup, startTour, resumeTour, savedTour }) {
  const [hidden, setHidden] = useState(false)
  const completed = new Set([0, 1, 2])
  if (hidden) return <button className="op-restore-checklist" onClick={() => setHidden(false)}><AppIcon name="check" size={16} /> Show setup checklist</button>
  return (
    <section className="op-checklist-card">
      <div className="op-checklist-head"><div><span>SETUP CHECKLIST</span><strong>Finish your workspace foundation</strong></div><b>3/8 completed</b></div>
      <div className="op-checklist-progress"><span style={{ width: '37.5%' }} /></div>
      <div className="op-checklist-items">
        {CHECKLIST_ITEMS.map((item, index) => (
          <div key={item} className={completed.has(index) ? 'is-complete' : ''}>
            <span>{completed.has(index) ? <AppIcon name="check" size={13} /> : index + 1}</span>
            <strong>{item}</strong>
            {!completed.has(index) && <AppIcon name="chev" size={14} />}
          </div>
        ))}
      </div>
      <div className="op-checklist-actions">
        <Button onClick={continueSetup}>Continue setup</Button>
        <Button variant="secondary" onClick={savedTour ? resumeTour : startTour}>{savedTour ? 'Resume full tour' : 'Start full tour'}</Button>
        <button onClick={() => setHidden(true)}>Hide</button>
      </div>
    </section>
  )
}

function PulseDashboard({ continueSetup, startTour, resumeTour, savedTour }) {
  return (
    <main className="op-dashboard">
      <div className="op-dashboard-head">
        <div><span>PT ARUNA COMMERCE</span><h1>Good morning, Andrey</h1><p>Here is what needs your attention today.</p></div>
        <Button variant="secondary" icon="plus">Add transaction</Button>
      </div>
      <div className="op-dashboard-metrics">
        <article><span>Available cash</span><strong>IDR 825.4M</strong><small className="positive">Up 6.2% this month</small></article>
        <article><span>Receivables</span><strong>IDR 214.0M</strong><small>3 invoices due this week</small></article>
        <article><span>Payables</span><strong>IDR 96.8M</strong><small className="warning">IDR 24M needs approval</small></article>
        <article><span>Runway</span><strong>7.4 months</strong><small>Based on current burn</small></article>
      </div>
      <div className="op-dashboard-grid">
        <section className="op-pulse-panel">
          <div className="op-panel-head"><div><span>AI FINANCIAL PULSE</span><strong>Cash position is stable</strong></div><span className="op-status"><i /> Healthy</span></div>
          <p>Collections are ahead of last month. Two supplier payments need approval before Friday, and payroll is fully funded.</p>
          <div className="op-cash-chart">
            <div className="op-chart-scale"><span>900M</span><span>750M</span><span>600M</span></div>
            <div className="op-chart-columns">
              {[66, 70, 64, 78, 74, 86, 82, 91].map((height, index) => <div key={index}><i style={{ height: `${height}%` }} /><small>{index % 2 === 0 ? `W${index + 1}` : ''}</small></div>)}
            </div>
          </div>
          <div className="op-action-row"><span><i className="amber" /><b>2 approvals</b> need owner review</span><button>Review now</button></div>
        </section>
        <DashboardChecklist continueSetup={continueSetup} startTour={startTour} resumeTour={resumeTour} savedTour={savedTour} />
      </div>
    </main>
  )
}

function SupportDrawer({ open, onClose, t }) {
  const [question, setQuestion] = useState('')
  const [escalated, setEscalated] = useState(false)
  const suggestions = ['How do I connect Xendit?', 'What documents do I need?', 'How do I complete AI Accountant setup?']
  if (!open) return null
  return (
    <div className="op-support-layer">
      <button className="op-support-scrim" onClick={onClose} aria-label="Close support" />
      <aside className="op-support" role="dialog" aria-modal="true" aria-label="CFO AI Support">
        <div className="op-support-head">
          <div><span><AppIcon name="cfo" size={20} /></span><div><strong>CFO AI {t.support}</strong><small><i /> AI assistant is online</small></div></div>
          <button onClick={onClose} aria-label="Close">x</button>
        </div>
        <div className="op-support-body">
          <div className="op-assistant-note"><AppIcon name="cfo" size={18} /><span><strong>Ask the AI assistant first</strong><small>Get an immediate answer about setup and product workflows.</small></span></div>
          <div className="op-chat-preview">
            <span className="op-chat-avatar"><AppIcon name="cfo" size={16} /></span>
            <div><strong>Welcome to CFO Finance OS support.</strong><p>What would you like help setting up today?</p></div>
          </div>
          {question && (
            <>
              <div className="op-chat-user">{question}</div>
              <div className="op-chat-preview compact"><span className="op-chat-avatar"><AppIcon name="cfo" size={15} /></span><div><p>I can guide you through this in the prototype. The real support flow can add contextual help and verified documentation here.</p></div></div>
            </>
          )}
          <div className="op-suggestions"><span>SUGGESTED QUESTIONS</span>{suggestions.map((item) => <button key={item} onClick={() => setQuestion(item)}>{item}<AppIcon name="chev" size={14} /></button>)}</div>
        </div>
        <div className="op-support-compose"><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about onboarding..." /><button aria-label="Send"><AppIcon name="chev" size={16} /></button></div>
        <div className="op-support-escalate">
          {escalated ? <span><AppIcon name="check" size={16} /> Human support request prepared</span> : <button onClick={() => setEscalated(true)}><AppIcon name="users" size={17} /> Escalate to human support</button>}
        </div>
      </aside>
    </div>
  )
}

export default function OnboardingPreview() {
  const [surface, setSurface] = useState('welcome')
  const [quickStep, setQuickStep] = useState(0)
const [tourStep, setTourStep] = useState(0)
  const [lang, setLang] = useState('en')
  const [supportOpen, setSupportOpen] = useState(false)
  const [savedTour, setSavedTour] = useState(readTourProgress)
  const [role, setRole] = useState(savedTour?.role || 'owner')
  const [tourResume, setTourResume] = useState(false)
  const t = TRANSLATIONS[lang]
  const roles = ROLE_CONTENT[lang]

  useEffect(() => {
    const previous = document.title
    document.title = 'CFO Finance OS - Onboarding Design Preview'
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    meta.id = 'onboarding-preview-robots'
    document.head.appendChild(meta)
    return () => {
      document.title = previous
      document.getElementById('onboarding-preview-robots')?.remove()
    }
  }, [])

const startQuick = () => setSurface('quick')
  const startTour = (resume = false) => { setTourResume(resume === true); setTourStep((value) => value + 1); setSurface('tour') }
  const openDashboard = () => setSurface('dashboard')
  const updateTourProgress = (progress) => {
    setSavedTour(progress)
    if (progress) localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(progress))
    else localStorage.removeItem(TOUR_STORAGE_KEY)
  }
  const exitTour = ({ complete = false } = {}) => {
    if (complete) updateTourProgress(null)
    openDashboard()
  }

  return (
    <div className="op-root">
<PreviewHeader lang={lang} setLang={setLang} surface={surface} startQuick={startQuick} startTour={() => startTour(false)} openSupport={() => setSupportOpen(true)} t={t} />
      {surface === 'welcome' && <WelcomeScreen t={t} roles={roles} role={role} setRole={setRole} startQuick={startQuick} startTour={() => startTour(false)} resumeTour={() => startTour(true)} savedTour={savedTour?.role === role ? savedTour : null} skip={openDashboard} />}
      {surface === 'quick' && <QuickSetup current={quickStep} setCurrent={setQuickStep} t={t} role={role} roles={roles} openDashboard={openDashboard} startTour={() => startTour(false)} />}
      {surface === 'dashboard' && <PulseDashboard continueSetup={() => { setQuickStep(3); startQuick() }} startTour={() => startTour(false)} resumeTour={() => startTour(true)} savedTour={savedTour} />}
      {surface === 'tour' && <OnboardingTourPreview key={tourStep} lang={lang} role={role} initialProgress={tourResume && savedTour?.role === role ? savedTour : null} onProgress={updateTourProgress} onExit={exitTour} />}
      <SupportDrawer open={supportOpen} onClose={() => setSupportOpen(false)} t={t} />
    </div>
  )
}

