// Radar forecast chart (designs/Radar.dc.html). Expected = solid navy step line,
// best-to-worst range = soft band, worst case = dashed warning line. One y-axis on round
// numbers that always shows 0 (and tints the area below it), so a negative balance is never
// read as a positive one. Interactive: a crosshair snaps to the nearest day and one tooltip
// lists every series; arrow keys do the same from the keyboard. Every chart has a
// "Show as table" view (DESIGN_SPEC §2), and the SVG carries a text summary.
import { useState } from 'react'
import { useWidth } from './useWidth'
import ChartTip from './ChartTip'
import { niceTicks, tickLabel, nearestIndex } from './scale'
import { money, shortDate } from '../lib/format'
import { useT, useLang } from '../i18n'

// Cash changes on a day, so lines are steps: hold the value, then jump.
function stepPoints(pts) {
  const out = []
  pts.forEach(([px, py], i) => { if (i > 0) out.push([px, pts[i - 1][1]]); out.push([px, py]) })
  return out
}
const pathOf = (pts) => pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('')
const stepPath = (pts) => pathOf(stepPoints(pts))

// Annotation next to a point: a small pill (surface fill, tone border) so the lines and the
// band never cut through the text. Kept inside the plot, above the point unless there is
// no room. Text width is estimated (13px bold ≈ 7.4px a character) — the pill only needs
// to cover the text, not match it exactly.
function placeLabel(text, px, py, { W, padL, padR, padT, below = false }) {
  const tw = Math.ceil(String(text).length * 7.4), w = tw + 16, h = 24
  const right = px > padL + (W - padL - padR) * 0.55
  let x0 = right ? px - 12 - w : px + 12
  x0 = Math.max(padL + 2, Math.min(x0, W - padR - 4 - w))
  const y0 = below || py - 16 - h < padT - 8 ? py + 12 : py - 14 - h
  return { text, rect: { x: x0, y: y0, w, h }, tx: x0 + w / 2, ty: y0 + h / 2 + 4.5 }
}
const Label = ({ l, warn }) => (
  <g className="v2-fadein">
    <rect x={l.rect.x} y={l.rect.y} width={l.rect.w} height={l.rect.h} rx="7" className={`v2-annot-pill${warn ? ' is-warn' : ''}`} />
    <text x={l.tx} y={l.ty} textAnchor="middle" className={`v2-annot${warn ? ' v2-annot-warn' : ''}`}>{l.text}</text>
  </g>
)

export default function ForecastChart({ days, lowest, worstLowest, showWorst = true, height = 280 }) {
  const t = useT()
  const lang = useLang()
  const [asTable, setAsTable] = useState(false)
  const [hover, setHover] = useState(null)
  const [ref, width] = useWidth()
  if (!days?.length) return null

  const narrow = width < 560
  const H = narrow ? Math.min(height, 220) : height
  const padL = 8, padR = narrow ? 44 : 60, padT = 18, padB = 28
  const W = width
  const vals = days.flatMap((d) => [d.expected, d.best, d.worst])
  const { lo, hi, ticks } = niceTicks(vals, narrow ? 4 : 5)
  const x = (i) => padL + (i / Math.max(1, days.length - 1)) * (W - padL - padR)
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB)

  const exp = days.map((d, i) => [x(i), y(d.expected)])
  const worst = days.map((d, i) => [x(i), y(d.worst)])
  const bandTop = days.map((d, i) => [x(i), y(Math.max(d.best, d.worst, d.expected))])
  const bandBot = days.map((d, i) => [x(i), y(Math.min(d.best, d.worst, d.expected))])
  const band = pathOf([...stepPoints(bandTop), ...stepPoints(bandBot).reverse()]) + 'Z'
  const xLabels = days.filter((d, i) => i === 0 || (i % (narrow ? 8 : 7) === 0 && i < days.length - 2))
  const lowI = days.findIndex((d) => d.date === lowest?.date)
  const wI = days.findIndex((d) => d.date === worstLowest?.date)
  const dayLabel = (d) => (d.day === 0 ? t('radar.today') : shortDate(d.date, lang))
  const summary = t('radar.chartSummary', {
    end: money(days[days.length - 1].expected), low: money(lowest?.value), lowDate: shortDate(lowest?.date, lang),
    worst: money(worstLowest?.value), worstDate: shortDate(worstLowest?.date, lang),
  })

  // Labels: the worst-case one first; the lowest-point one moves below its point if they would touch.
  const geo = { W, padL, padR, padT }
  const wLab = !narrow && showWorst && wI > 0 ? placeLabel(t('radar.worstShort', { v: money(worstLowest.value) }), ...worst[wI], geo) : null
  let lLab = !narrow && lowI > 0 ? placeLabel(t('radar.lowestShort', { v: money(lowest.value) }), ...exp[lowI], geo) : null
  const touch = (a, b) => a.rect.x < b.rect.x + b.rect.w && b.rect.x < a.rect.x + a.rect.w && a.rect.y < b.rect.y + b.rect.h && b.rect.y < a.rect.y + a.rect.h
  if (wLab && lLab && touch(wLab, lLab)) lLab = placeLabel(lLab.text, ...exp[lowI], { ...geo, below: true })

  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setHover(nearestIndex(e.clientX - r.left, days.length, padL, W - padR))
  }
  const onKey = (e) => {
    const n = days.length
    const k = { ArrowRight: 1, ArrowLeft: -1, PageUp: 7, PageDown: -7 }[e.key]
    if (k) { e.preventDefault(); setHover((h) => Math.max(0, Math.min(n - 1, (h ?? 0) + k))) }
    else if (e.key === 'Home') { e.preventDefault(); setHover(0) }
    else if (e.key === 'End') { e.preventDefault(); setHover(n - 1) }
    else if (e.key === 'Escape') setHover(null)
  }
  const h = hover != null ? days[hover] : null
  const tipRows = h ? [
    { label: t('radar.legend.expected'), value: money(h.expected), color: 'var(--brand-navy)' },
    { label: t('radar.best'), value: money(h.best), color: 'var(--info-soft)', box: true },
    ...(showWorst ? [{ label: t('radar.worst'), value: money(h.worst), color: 'var(--warning)', dashed: true, tone: h.worst < 0 ? 'neg' : null }] : []),
  ] : []

  return (
    <figure className="v2-chart" ref={ref}>
      {asTable ? (
        <div className="v2-tablewrap">
          <table className="v2-table">
            <caption className="v2-sr">{summary}</caption>
            <thead><tr><th scope="col">{t('radar.col.date')}</th><th scope="col" className="v2-r">{t('radar.legend.expected')}</th>
              <th scope="col" className="v2-r">{t('radar.best')}</th><th scope="col" className="v2-r">{t('radar.worst')}</th></tr></thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date}><td>{shortDate(d.date, lang)}</td><td className="v2-r v2-num">{money(d.expected)}</td>
                  <td className="v2-r v2-num">{money(d.best)}</td><td className={`v2-r v2-num${d.worst < 0 ? ' v2-neg' : ''}`}>{money(d.worst)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="v2-plot">
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="v2-chart-svg v2-chart-live"
            tabIndex={0} onPointerMove={pick} onPointerDown={pick}
            onPointerLeave={(e) => { if (e.pointerType !== 'touch') setHover(null) }}
            onKeyDown={onKey} onFocus={() => setHover((v) => v ?? 0)} onBlur={() => setHover(null)}>
            {lo < 0 && <rect x={padL} y={y(0)} width={W - padL - padR} height={y(lo) - y(0)} className="v2-below-zero" />}
            {ticks.map((v) => (
              <g key={v}>
                {v !== 0 && <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} className="v2-grid" />}
                <text x={W - padR + 8} y={y(v) + 4} className={`v2-tick${v < 0 ? ' v2-tick-neg' : ''}`}>{tickLabel(v)}</text>
              </g>
            ))}
            <g className="v2-reveal">
              <path d={band} className="v2-band" />
              <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} className="v2-axis-zero" />
              {showWorst && <path d={stepPath(worst)} className="v2-line-worst" />}
              <path d={stepPath(exp)} className="v2-line-exp" />
            </g>
            <circle cx={exp[0][0]} cy={exp[0][1]} r="4" className="v2-dot-exp" />
            {lLab && <circle cx={exp[lowI][0]} cy={exp[lowI][1]} r="5" className="v2-dot-ring v2-fadein" />}
            {wLab && <circle cx={worst[wI][0]} cy={worst[wI][1]} r="5" className="v2-dot-ring-warn v2-fadein" />}
            {lLab && <Label l={lLab} />}
            {wLab && <Label l={wLab} warn />}
            {xLabels.map((d) => (
              <text key={d.date} x={x(d.day)} y={H - 6} className="v2-tick" textAnchor={d.day === 0 ? 'start' : 'middle'}>{dayLabel(d)}</text>
            ))}
            {h && (
              <g className="v2-cross" aria-hidden="true">
                <line x1={x(hover)} x2={x(hover)} y1={padT - 6} y2={H - padB} />
                {showWorst && <circle cx={x(hover)} cy={y(h.worst)} r="5" className="v2-dot-ring-warn" />}
                <circle cx={x(hover)} cy={y(h.expected)} r="5.5" className="v2-dot-hover" />
              </g>
            )}
          </svg>
          {h && <ChartTip x={x(hover)} y={padT} width={W} title={dayLabel(h)} rows={tipRows} />}
          <div className="v2-sr" aria-live="polite">{h ? `${dayLabel(h)}: ${tipRows.map((r) => `${r.label} ${r.value}`).join(', ')}` : ''}</div>
        </div>
      )}
      <figcaption className="v2-legend">
        <span className="v2-legend-item"><span className="v2-key v2-key-exp" aria-hidden="true" />{t('radar.legend.expected')}</span>
        <span className="v2-legend-item"><span className="v2-key v2-key-band" aria-hidden="true" />{t('radar.legend.range')}</span>
        {showWorst && <span className="v2-legend-item"><span className="v2-key v2-key-worst" aria-hidden="true" />{t('radar.legend.worst')}</span>}
        <button type="button" className="v2-btn-link v2-legend-toggle" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
          {asTable ? t('chart.showChart') : t('chart.showTable')}
        </button>
      </figcaption>
    </figure>
  )
}
