// Radar forecast chart (designs/Radar.dc.html). Expected = solid navy step line,
// best-to-worst range = soft band, worst case = dashed warning line. One y-axis.
// Every chart has a "Show as table" view (DESIGN_SPEC §2), and the SVG carries a
// text summary for assistive technology.
import { useState } from 'react'
import { useWidth } from './useWidth'
import { compact, money, shortDate } from '../lib/format'
import { useT, useLang } from '../i18n'

const niceMax = (v) => {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p
  return 10 * p
}

// Cash changes on a day, so lines are steps: hold the value, then jump.
function stepPoints(pts) {
  const out = []
  pts.forEach(([px, py], i) => { if (i > 0) out.push([px, pts[i - 1][1]]); out.push([px, py]) })
  return out
}
const pathOf = (pts) => pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('')
const stepPath = (pts) => pathOf(stepPoints(pts))

export default function ForecastChart({ days, lowest, worstLowest, showWorst = true, height = 260 }) {
  const t = useT()
  const lang = useLang()
  const [asTable, setAsTable] = useState(false)
  const [ref, width] = useWidth()
  const H = width < 560 ? Math.min(height, 200) : height
  if (!days?.length) return null

  const narrow = width < 560
  const padL = 8, padR = narrow ? 40 : 56, padT = 16, padB = 28
  const W = width
  const vals = days.flatMap((d) => [d.expected, d.best, d.worst])
  const hi = niceMax(Math.max(...vals, 0))
  const lo = Math.min(0, ...vals) < 0 ? -niceMax(-Math.min(...vals)) : 0
  const x = (i) => padL + (i / (days.length - 1)) * (W - padL - padR)
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB)
  const ticks = [lo, lo + (hi - lo) / 3, lo + (2 * (hi - lo)) / 3, hi]

  const exp = days.map((d, i) => [x(i), y(d.expected)])
  const worst = days.map((d, i) => [x(i), y(d.worst)])
  const bandTop = days.map((d, i) => [x(i), y(Math.max(d.best, d.worst, d.expected))])
  const bandBot = days.map((d, i) => [x(i), y(Math.min(d.best, d.worst, d.expected))])
  const band = pathOf([...stepPoints(bandTop), ...stepPoints(bandBot).reverse()]) + 'Z'
  const xLabels = days.filter((d, i) => i === 0 || (i % (narrow ? 8 : 7) === 0 && i < days.length - 2))
  const lowI = days.findIndex((d) => d.date === lowest?.date)
  const wI = days.findIndex((d) => d.date === worstLowest?.date)
  const summary = t('radar.chartSummary', {
    end: money(days[days.length - 1].expected), low: money(lowest?.value), lowDate: shortDate(lowest?.date, lang),
    worst: money(worstLowest?.value), worstDate: shortDate(worstLowest?.date, lang),
  })

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
                  <td className="v2-r v2-num">{money(d.best)}</td><td className="v2-r v2-num">{money(d.worst)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="v2-chart-svg">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} className={v === 0 ? 'v2-axis' : 'v2-grid'} />
              <text x={W - padR + 8} y={y(v) + 4} className="v2-tick">{v === 0 ? '0' : compact(v)}</text>
            </g>
          ))}
          <path d={band} className="v2-band" />
          {showWorst && <path d={stepPath(worst)} className="v2-line-worst" />}
          <path d={stepPath(exp)} className="v2-line-exp" />
          <circle cx={exp[0][0]} cy={exp[0][1]} r="4" className="v2-dot-exp" />
          {!narrow && lowI > 0 && (() => {
            const [px, py] = exp[lowI]
            const right = px > W * 0.6
            return (
              <g>
                <circle cx={px} cy={py} r="5" className="v2-dot-ring" />
                <text x={right ? px - 10 : px + 10} y={py - 10} textAnchor={right ? 'end' : 'start'} className="v2-annot">
                  {t('radar.lowestShort', { v: money(lowest.value) })}
                </text>
              </g>
            )
          })()}
          {!narrow && showWorst && wI > 0 && (() => {
            const [px, py] = worst[wI]
            const right = px > W * 0.6
            return (
              <g>
                <circle cx={px} cy={py} r="5" className="v2-dot-ring-warn" />
                <text x={right ? px - 10 : px + 10} y={Math.min(py + 18, H - padB - 4)} textAnchor={right ? 'end' : 'start'} className="v2-annot v2-annot-warn">
                  {t('radar.worstShort', { v: money(worstLowest.value) })}
                </text>
              </g>
            )
          })()}
          {xLabels.map((d) => (
            <text key={d.date} x={x(d.day)} y={H - 6} className="v2-tick" textAnchor={d.day === 0 ? 'start' : 'middle'}>
              {d.day === 0 ? t('radar.today') : shortDate(d.date, lang)}
            </text>
          ))}
        </svg>
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
