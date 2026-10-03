// v2 error boundary (review 8.2 #1). A render error in one page or in the AI panel shows a
// short message with "Try again" instead of white-screening the whole app. It resets when
// the route changes (resetKey). Nothing is sent anywhere; the error goes to the console.
import { Component } from 'react'
import { useLocation } from 'react-router-dom'
import { useT } from '../i18n'
import I from '../icons'

class Boundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error) { console.error('[v2] screen error', error) } // eslint-disable-line no-console
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false }) }
  render() {
    if (!this.state.failed) return this.props.children
    const { title, retry, compact } = this.props
    return (
      <div className={`v2-error${compact ? ' v2-error-compact' : ''}`} role="alert">
        <I.warn size={18} />
        <span className="v2-error-text">{title}</span>
        <button type="button" className="v2-btn v2-btn-secondary" onClick={() => this.setState({ failed: false })}>{retry}</button>
      </div>
    )
  }
}

export default function ErrorBoundary({ children, compact = false }) {
  const t = useT()
  const loc = useLocation()
  return <Boundary resetKey={loc.pathname + loc.search} title={t('shell.crash')} retry={t('shell.retry')} compact={compact}>{children}</Boundary>
}
