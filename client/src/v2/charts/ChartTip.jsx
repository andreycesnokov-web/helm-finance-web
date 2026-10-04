// The one tooltip every v2 chart uses: the value leads, the series name follows, each row
// keyed by a short stroke of its colour. Plain React text (never innerHTML).
import { useLayoutEffect, useRef, useState } from 'react'
import { tipLeft } from './scale'

export default function ChartTip({ x, y, width, title, rows }) {
  const ref = useRef(null)
  const [w, setW] = useState(180)
  useLayoutEffect(() => { if (ref.current) setW(ref.current.offsetWidth) }, [title, rows])
  return (
    <div ref={ref} className="v2-tip" role="presentation" style={{ left: tipLeft(x, w, width), top: Math.max(0, y) }}>
      <div className="v2-tip-title">{title}</div>
      {rows.map((r) => r.note ? <div key={r.label} className="v2-tip-note">{r.note}</div> : (
        <div key={r.label} className={`v2-tip-row${r.tone ? ` v2-tip-${r.tone}` : ''}`}>
          <span className={`v2-tip-key${r.dashed ? ' is-dashed' : ''}${r.box ? ' is-box' : ''}`} style={{ '--k': r.color }} aria-hidden="true" />
          <span className="v2-tip-v v2-num">{r.value}</span>
          <span className="v2-tip-l">{r.label}</span>
        </div>
      ))}
    </div>
  )
}
