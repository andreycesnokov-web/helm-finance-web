// Design v2 primitives. Presentational only; every colour, radius and font comes
// from brand/tokens.css through v2.css. Status is never colour alone: Pill always
// carries its text label.
import { Link } from 'react-router-dom'
import I from './icons'
import { useT } from './i18n'

export function PageHead({ title, sub, actions, back }) {
  return (
    <header className="v2-pagehead">
      <div className="v2-pagehead-text">
        {back && (
          <Link className="v2-back" to={back.to}><I.chevLeft size={16} />{back.label}</Link>
        )}
        <h1 className="v2-h1">{title}</h1>
        {sub && <p className="v2-sub">{sub}</p>}
      </div>
      {actions && <div className="v2-pagehead-actions">{actions}</div>}
    </header>
  )
}

export function Card({ title, aside, children, className = '', as: As = 'section', ...p }) {
  return (
    <As className={`v2-card ${className}`} {...p}>
      {(title || aside) && (
        <div className="v2-card-head">
          {title && <h2 className="v2-h2">{title}</h2>}
          {aside && <div className="v2-card-aside">{aside}</div>}
        </div>
      )}
      {children}
    </As>
  )
}

/** tone: good | warn | crit | info | neutral. Always pass visible text. */
export function Pill({ tone = 'neutral', dot = false, children, className = '' }) {
  return (
    <span className={`v2-pill v2-pill-${tone} ${className}`}>
      {dot && <span className="v2-pill-dot" aria-hidden="true" />}
      {children}
    </span>
  )
}

export function Btn({ variant = 'secondary', to, href, icon, children, className = '', ...p }) {
  const cls = `v2-btn v2-btn-${variant} ${className}`
  if (to) return <Link className={cls} to={to} {...p}>{icon}{children}</Link>
  if (href) return <a className={cls} href={href} {...p}>{icon}{children}</a>
  return <button type="button" className={cls} {...p}>{icon}{children}</button>
}

/** An action that does not exist yet: visible, disabled, and says so. Never a dead click. */
export function NotYet({ children, note, className = '' }) {
  const t = useT()
  return (
    <button type="button" className={`v2-btn v2-btn-secondary ${className}`} disabled
      aria-disabled="true" title={note || t('placeholder.soon')}>
      {children}<span className="v2-notyet">{note || t('placeholder.soon')}</span>
    </button>
  )
}

export function Empty({ icon, title, text, action }) {
  return (
    <div className="v2-empty">
      {icon && <span className="v2-empty-ic" aria-hidden="true">{icon}</span>}
      {title && <p className="v2-empty-title">{title}</p>}
      {text && <p className="v2-empty-text">{text}</p>}
      {action}
    </div>
  )
}

export function Skeleton({ rows = 3 }) {
  return (
    <div className="v2-skel" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => <span key={i} className="v2-skel-row" />)}
    </div>
  )
}

export function ErrorBox({ error, onRetry }) {
  const t = useT()
  const msg = typeof error === 'string' ? error : error?.message || 'Request failed'
  return (
    <div className="v2-error" role="alert">
      <I.warn size={18} />
      <span className="v2-error-text">{msg}</span>
      {onRetry && <button type="button" className="v2-btn v2-btn-secondary" onClick={onRetry}>{t('shell.retry')}</button>}
    </div>
  )
}
