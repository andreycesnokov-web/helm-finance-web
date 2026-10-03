// Grouped bar chart (design v2 chart rules): series in fixed order (--chart-1/2/3),
// bars rounded 4px at the data end, one y-axis, zero line, and a "Show as table" view.
import { useState } from 'react'
import { useWidth } from './useWidth'
import { compact, money } from '../lib/format'
import { useT } from '../i18n'

const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)']

const niceMax = (v) => {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p
  return 10 * p
}

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
  const [ref, width] = useWidth()
  if (!rows?.length) return null
  const narrow = width < 560
  const H = narrow ? Math.min(height, 180) : height
  const padL = 4, padR = narrow ? 38 : 50, padT = 10, padB = 24
  const vals = rows.flatMap((r) => series.map((s) => Number(r.values[s.key]) || 0))
  const hi = niceMax(Math.max(0, ...vals))
  const lo = Math.min(0, ...vals) < 0 ? -niceMax(-Math.min(...vals)) : 0
  const y = (v) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB)
  const band = (width - padL - padR) / rows.length
  const bw = Math.max(3, Math.min(18, (band * 0.7) / series.length))
  const ticks = lo < 0 ? [lo, 0, hi] : [0, hi / 2, hi]

  return (
    <figure className="v2-chart" ref={ref}>
      {asTable ? (
        <div className="v2-tablewrap">
          <table className="v2-table">
            {caption && <caption className="v2-sr">{caption}</caption>}
            <thead><tr><th scope="col">{t('perf.col.month')}</th>{series.map((s) => <th key={s.key} scope="col" className="v2-r">{s.label}</th>)}</tr></thead>
            <tbody>{rows.map((r) => <tr key={r.key}><td>{r.label}</td>{series.map((s) => <td key={s.key} className="v2-r v2-num">{r.values[s.key] == null ? '—' : money(r.values[s.key])}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={caption} className="v2-chart-svg">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={padL} x2={width - padR} y1={y(v)} y2={y(v)} className={v === 0 ? 'v2-axis' : 'v2-grid'} />
              <text x={width - padR + 6} y={y(v) + 4} className="v2-tick">{v === 0 ? '0' : (v < 0 ? '−' : '') + compact(v)}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const x0 = padL + i * band + (band - bw * series.length) / 2
            return (
              <g key={r.key} opacity={highlight && highlight !== r.key ? 0.45 : 1}>
                {series.map((s, j) => {
                  const v = Number(r.values[s.key]) || 0
                  return <path key={s.key} d={barPath(x0 + j * bw, y(0), bw - 1, y(v))} fill={SERIES[j % SERIES.length]} />
                })}
                {(!narrow || i % 2 === 0) && <text x={padL + i * band + band / 2} y={H - 6} textAnchor="middle" className="v2-tick">{r.short || r.label}</text>}
              </g>
            )
          })}
        </svg>
      )}
      <figcaption className="v2-legend">
        {series.map((s, j) => <span key={s.key} className="v2-legend-item"><span className="v2-key-dot" style={{ background: SERIES[j % SERIES.length] }} aria-hidden="true" />{s.label}</span>)}
        <button type="button" className="v2-btn-link v2-legend-toggle" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>{asTable ? t('chart.showChart') : t('chart.showTable')}</button>
      </figcaption>
    </figure>
  )
}
