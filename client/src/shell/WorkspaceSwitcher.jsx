// Workspace Switcher — shared across Personal + Business. Presentational: parent
// supplies grouped `workspaces` (from GET /api/workspaces) + active id + onSelect.
// Never renders balances (master task §12). Groups Personal (🔒) and Business.
import { useState, useRef, useEffect } from 'react'
import { Icon } from './ui'

const initial = (name = '?') => (name.trim()[0] || '?').toUpperCase()

export default function WorkspaceSwitcher({ workspaces, activeId, onSelect }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  const personal = workspaces?.personal || []
  const business = workspaces?.business || []
  const all = [...personal, ...business]
  const active = all.find(w => String(w.id) === String(activeId)) || personal[0] || business[0]
  if (!active) return null
  const isPersonal = active.type === 'personal'

  const pick = (w) => { setOpen(false); if (String(w.id) !== String(active.id)) onSelect?.(w) }

  const Group = ({ title, items }) => items.length > 0 && (
    <>
      <div className="cfo-switch-grouptitle">{title}</div>
      {items.map(w => (
        <button key={w.id} className={`cfo-switch-opt${String(w.id) === String(active.id) ? ' is-active' : ''}`} onClick={() => pick(w)}>
          <span className={`cfo-switch-ava ${w.type === 'personal' ? 'personal' : 'business'}`}>{initial(w.name)}</span>
          <span className="cfo-switch-text">
            <span className="cfo-switch-name">{w.name}</span>
            <span className="cfo-switch-type">
              {w.type === 'personal' ? <><Icon.lock width="11" height="11" /> Personal</> : <>Business · {w.role || 'member'}</>}
              {w.business_code ? ` · ${w.business_code}` : ''}
            </span>
          </span>
        </button>
      ))}
    </>
  )

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="cfo-switch" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className={`cfo-switch-ava ${isPersonal ? 'personal' : 'business'}`}>{initial(active.name)}</span>
        <span className="cfo-switch-text">
          <span className="cfo-switch-name">{active.name}</span>
          <span className="cfo-switch-type">
            {isPersonal ? <><Icon.lock width="11" height="11" /> Personal</> : <>Business · {active.role || 'member'}</>}
            {active.business_code ? ` · ${active.business_code}` : ''}
          </span>
        </span>
        <Icon.chev className="cfo-switch-chev" width="16" height="16" />
      </button>
      {open && (
        <div className="cfo-switch-menu" role="listbox">
          <Group title="Personal" items={personal} />
          <Group title="Business" items={business} />
          <button className="cfo-switch-opt" onClick={() => { setOpen(false); window.location.assign('/business/new') }}>
            <span className="cfo-switch-ava business" aria-hidden>+</span>
            <span className="cfo-switch-text"><span className="cfo-switch-name">Create new business</span>
              <span className="cfo-switch-type">New owner workspace</span></span>
          </button>
        </div>
      )}
    </div>
  )
}
