// Radar chart: expected line, best-to-worst band, dashed worst case. One y-axis,
// 2px lines, step shape (cash moves on dates, not smoothly). Has a table view.
import { useState } from 'react'
import { ChartFrame } from './index'
import { money, dayMonth } from '../lib/format'


function niceStep(range) {
  const raw = range / 4
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1)))
  const n = raw / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag
}

const compactAxis = (v) => {
  const a = Math.abs(v)
  const s = a >= 1e9 ? `${+(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${+(a / 1e6).toFixed(0)}M` : a >= 1e3 ? `${+(a / 1e3).toFixed(0)}K` : String(Math.round(a))
  return v < 0 ? `−${s}` : s
}

export default function ForecastChart({ forecast, t, locale, compact, showWorst = true }) {
  // Phone draws on a narrower canvas so 12px labels stay 12px, not shrunk to 4px.
  const W = compact ? 360 : 1000, H = compact ? 220 : 260, PR = compact ? 44 : 64, PT = 12, PB = 30
  const LBL = compact ? 110 : 150
  const [table, setTable] = useState(false)
  const days = forecast.days
  const n = days.length - 1
  const vals = days.flatMap((d) => [d.expected, d.best, d.worst])
  const lo = Math.min(0, ...vals), hi = Math.max(...vals, 1)
  const step = niceStep(hi - lo || 1)
  const yMin = Math.floor(lo / step) * step, yMax = Math.ceil((hi * 1.05) / step) * step
  const x = (i) => (i / n) * (W - PR)
  const y = (v) => PT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - PT - PB)
  const stepPath = (key) => days.map((d, i) => (i === 0 ? `M${x(0)},${y(d[key])}` : `H${x(i)}V${y(d[key])}`)).join('') + `H${x(n)}`
  const band = (() => {
    let top = `M${x(0)},${y(days[0].best)}`
    days.forEach((d, i) => { if (i) top += `H${x(i)}V${y(d.best)}` })
    top += `H${x(n)}V${y(days[n].worst)}`
    for (let i = n; i >= 1; i--) top += `H${x(i)}V${y(days[i - 1].worst)}`
    return top + `H${x(0)}Z`
  })()
  const ticks = []
  for (let v = yMin; v <= yMax + 1; v += step) ticks.push(v)
  const xLabels = (compact ? [0, 14, 28] : [0, 7, 14, 21, 28]).filter((i) => i <= n)
  const low = forecast.lowest, wl = forecast.worstLow

  const legend = <>
    <span className="v2-legend-item"><span className="v2-legend-swatch" />{t('radar.legendExpected')}</span>
    <span className="v2-legend-item"><span className="v2-legend-swatch band" />{t('radar.legendRange')}</span>
    {showWorst && <span className="v2-legend-item"><span className="v2-legend-swatch dash" />{t('radar.legendWorst')}</span>}
  </>
  const rows = days.filter((d) => d.day % 7 === 0 || d.day === n)
  const tableEl = (
    <div className="v2-table-wrap"><table className="v2-table">
      <caption className="v2-sr">{t('radar.chartTitle')}</caption>
      <thead><tr><th>{t('radar.colDate')}</th><th className="r">{t('radar.legendExpected')}</th><th className="r">{t('radar.best')}</th><th className="r">{t('radar.worst')}</th></tr></thead>
      <tbody>{rows.map((d) => <tr key={d.day}><td>{d.day === 0 ? t('radar.today') : dayMonth(d.date, locale)}</td>
        <td className="r v2-num">{money(d.expected)}</td><td className="r v2-num">{money(d.best)}</td><td className="r v2-num">{money(d.worst)}</td></tr>)}</tbody>
    </table></div>
  )

  return (
    <ChartFrame title={t('radar.chartTitle')} legend={legend} table={tableEl} tableOn={table} onToggle={() => setTable((v) => !v)}
      showTableLabel={t('chart.showTable')} showChartLabel={t('chart.showChart')}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('radar.chartAria', { end: money(forecast.end.expected), low: money(low.expected) })}>
        {ticks.map((v) => <g key={v}>
          <line x1="0" x2={W - PR} y1={y(v)} y2={y(v)} stroke="var(--border-subtle)" strokeWidth="1" />
          <text x={W - PR + 10} y={y(v) + 4} fontSize="12" fill="var(--text-muted)">{compactAxis(v)}</text>
        </g>)}
        <path d={band} fill="var(--info-soft)" stroke="none" />
        {showWorst && <path d={stepPath('worst')} fill="none" stroke="var(--warning)" strokeWidth="2" strokeDasharray="6 5" />}
        <path d={stepPath('expected')} fill="none" stroke="var(--brand-navy)" strokeWidth="2" />
        <circle cx={x(0)} cy={y(days[0].expected)} r="5" fill="var(--brand-navy)" />
        {low.day > 0 && low.expected < days[0].expected && <g>
          <circle cx={x(low.day)} cy={y(low.expected)} r="6" fill="var(--surface-card)" stroke="var(--brand-navy)" strokeWidth="2" />
          <text x={Math.max(0, Math.min(x(low.day) + 10, W - PR - LBL))} y={y(low.expected) + 22} fontSize="13" fontWeight="700" fill="var(--brand-navy)">
            {t('radar.lowestLabel', { v: money(low.expected) })}</text>
        </g>}
        {showWorst && wl.worst < low.expected && <g>
          <circle cx={x(wl.day)} cy={y(wl.worst)} r="6" fill="var(--surface-card)" stroke="var(--warning)" strokeWidth="2" />
          <text x={Math.max(0, Math.min(x(wl.day) - LBL, W - PR - LBL - 20))} y={Math.min(y(wl.worst) + 22, H - PB - 4)} fontSize="13" fontWeight="700" fill="var(--warning-ink)">
            {t('radar.worstLabel', { v: money(wl.worst) })}</text>
        </g>}
        {xLabels.map((i) => <text key={i} x={x(i)} y={H - 6} fontSize="12" fill="var(--text-muted)" textAnchor={i === 0 ? 'start' : 'middle'}>
          {i === 0 ? t('radar.today') : dayMonth(days[i].date, locale)}</text>)}
      </svg>
    </ChartFrame>
  )
}
