// Grouped bar chart (design v2 chart rules): series in fixed order (--chart-1/2/3),
// bars rounded 4px at the data end, one y-axis on round numbers with a zero line, and a
// "Show as table" view. Interactive: the whole month column is the hit target; hovering or
// tapping it lifts that column, dims the rest and shows one tooltip with every series.
// Arrow keys move between columns. Bars grow from the zero line on first render.
import { useState } from 'react'
import { useWidth } from './useWidth'
import ChartTip from './ChartTip'
import { niceTicks, tickLabel, bandIndex } from './scale'
import { money } from '../lib/format'
import { useT } from '../i18n'

const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)']

function barPath(x, y0, w, y1, r = 4) {
  // Rounded only at the data end (top for positive, bottom for negative).
  const up = y1 < y0
  const h = Math.abs(y1 - y0)
  const rr = Math.min(r, h, w / 2)
  if (h < 0.5) return ''
  return up
    ? `M${x},${y0}V${y1 + rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 + rr}V${y0}Z`
    : `M${x},${y0}V${y1 - rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 - rr}V${y0}Z`
}

export default function BarChart({ rows, series, height = 220, caption, highlight }) {
  const t = useT()
  const [asTable, setAsTable] = useState(false)
  const [hover, setHover] = useState(null)
  const [ref, width] = useWidth()
  if (!rows?.length) return null
  const narrow = width < 560
  const H = narrow ? Math.min(height, 180) : height
  const padL = 4, padR = narrow ? 40 : 52, padT = 10, padB = 24
  const vals = rows.flatMap((r) => series.map((s) => Number(r.values[s.key]) || 0))
  const { lo, hi, ticks } = niceTicks(vals, 3)
  const y = (v) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB)
  const band = (width - padL - padR) / rows.length
  const bw = Math.max(3, Math.min(18, (band * 0.7) / series.length))

  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left
    setHover(px < padL || px > width - padR ? null : bandIndex(px, rows.length, padL, band))
  }
  const onKey = (e) => {
    const n = rows.length
    const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
    if (k) { e.preventDefault(); setHover((h) => Math.max(0, Math.min(n - 1, h == null ? (k > 0 ? 0 : n - 1) : h + k))) }
    else if (e.key === 'Home') { e.preventDefault(); setHover(0) }
    else if (e.key === 'End') { e.preventDefault(); setHover(n - 1) }
    else if (e.key === 'Escape') setHover(null)
  }
  const h = hover != null ? rows[hover] : null
  const tipRows = h?.empty && series.every((s) => !Number(h.values[s.key])) ? [{ label: 'none', note: t('chart.noData') }] : h ? series.map((s, j) => {
    const v = h.values[s.key]
    return { label: s.label, value: v == null ? '—' : money(v), color: SERIES[j % SERIES.length], box: true, tone: Number(v) < 0 ? 'neg' : null }
  }) : []
  const focusKey = hover != null ? rows[hover].key : highlight

  return (
    <figure className="v2-chart" ref={ref}>
      {asTable ? (
        <div className="v2-tablewrap">
          <table className="v2-table">
            {caption && <caption className="v2-sr">{caption}</caption>}
            <thead><tr><th scope="col">{t('perf.col.month')}</th>{series.map((s) => <th key={s.key} scope="col" className="v2-r">{s.label}</th>)}</tr></thead>
            <tbody>{rows.map((r) => <tr key={r.key}><td>{r.label}</td>{series.map((s) => <td key={s.key} className={`v2-r v2-num${Number(r.values[s.key]) < 0 ? ' v2-neg' : ''}`}>{r.values[s.key] == null ? '—' : money(r.values[s.key])}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="v2-plot">
          <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={caption} className="v2-chart-svg v2-chart-live"
            tabIndex={0} onPointerMove={pick} onPointerDown={pick}
            onPointerLeave={(e) => { if (e.pointerType !== 'touch') setHover(null) }}
            onKeyDown={onKey} onBlur={() => setHover(null)}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={padL} x2={width - padR} y1={y(v)} y2={y(v)} className={v === 0 ? 'v2-axis' : 'v2-grid'} />
                <text x={width - padR + 6} y={y(v) + 4} className={`v2-tick${v < 0 ? ' v2-tick-neg' : ''}`}>{tickLabel(v)}</text>
              </g>
            ))}
            {hover != null && <rect x={padL + hover * band + 1} y={padT - 4} width={Math.max(0, band - 2)} height={H - padT - padB + 4} rx="6" className="v2-col-hover" />}
            {rows.map((r, i) => {
              const x0 = padL + i * band + (band - bw * series.length) / 2
              return (
                <g key={r.key} className="v2-bars" opacity={focusKey && focusKey !== r.key ? 0.45 : 1}>
                  {series.map((s, j) => {
                    const v = Number(r.values[s.key]) || 0
                    return <path key={s.key} d={barPath(x0 + j * bw, y(0), bw - 1, y(v))} fill={SERIES[j % SERIES.length]}
                      className={v < 0 ? 'v2-bar v2-bar-neg' : 'v2-bar'} style={{ animationDelay: `${i * 35}ms` }} />
                  })}
                  {(!narrow || i % 2 === 0) && <text x={padL + i * band + band / 2} y={H - 6} textAnchor="middle" className={`v2-tick${hover === i ? ' v2-tick-on' : ''}`}>{r.short || r.label}</text>}
                </g>
              )
            })}
          </svg>
          {h && <ChartTip x={padL + hover * band + band / 2 + Math.min(band / 2, 14)} y={padT} width={width} title={h.label} rows={tipRows} />}
          <div className="v2-sr" aria-live="polite">{h ? `${h.label}: ${tipRows.map((r) => `${r.label} ${r.value}`).join(', ')}` : ''}</div>
        </div>
      )}
      <figcaption className="v2-legend">
        {series.map((s, j) => <span key={s.key} className="v2-legend-item"><span className="v2-key-dot" style={{ background: SERIES[j % SERIES.length] }} aria-hidden="true" />{s.label}</span>)}
        <button type="button" className="v2-btn-link v2-legend-toggle" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>{asTable ? t('chart.showChart') : t('chart.showTable')}</button>
      </figcaption>
    </figure>
  )
}
