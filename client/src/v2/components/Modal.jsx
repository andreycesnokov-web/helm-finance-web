// One dialog for v2 screens: centred window on a scrim, Esc and the close button cancel, focus
// moves into the window and comes back to the button that opened it. Nothing is saved on close.
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import I from '../icons'
import { useT } from '../i18n'

export default function Modal({ title, onClose, children, footer, wide = false, labelledBy }) {
  const t = useT()
  const box = useRef(null)
  const back = useRef(typeof document !== 'undefined' ? document.activeElement : null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const first = box.current?.querySelector('input, select, textarea, button:not([data-modal-x])')
    ;(first || box.current)?.focus()
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close.current?.() } }
    document.addEventListener('keydown', onKey)
    const prev = back.current
    return () => { document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus() }
  }, [])
  const id = labelledBy || 'v2-modal-title'
  return createPortal(
    <div className="v2-root v2-modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div ref={box} className={`v2-modal${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <div className="v2-modal-head">
          <h2 id={id} className="v2-h2">{title}</h2>
          <button type="button" className="v2-icon-btn" data-modal-x aria-label={t('modal.close')} onClick={onClose}><I.close size={18} /></button>
        </div>
        <div className="v2-modal-body">{children}</div>
        {footer && <div className="v2-modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
