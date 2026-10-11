// Shared chart maths (design v2). Pure; tested in tests/design/v2ChartScale.test.mjs.
import { compact } from '../lib/format.js'

const STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
const niceStep = (raw) => {
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const m of STEPS) if (m * p >= raw) return m * p
  return 10 * p
}

/**
 * Y-axis ticks on round numbers that always include 0 when the data crosses it, so the zero
 * line is drawn and a negative value is never read as a positive one.
 * Returns { lo, hi, ticks } with lo <= min(values, 0) and hi >= max(values, 0).
 */
export function niceTicks(values = [], count = 4) {
  const nums = values.map(Number).filter(Number.isFinite)
  const min = Math.min(0, ...nums), max = Math.max(0, ...nums)
  if (min === max) return { lo: 0, hi: 1, ticks: [0, 1] }
  const step = niceStep((max - min) / Math.max(1, count - 1))
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : Math.round(v * 1e6) / 1e6)
  return { lo, hi, ticks }
}

/** Axis label: compact, with a true minus for negatives ("−20M"), "0" for zero. */
export const tickLabel = (v) => (v === 0 ? '0' : (v < 0 ? '−' : '') + compact(v))

/** Index of the slot nearest to pixel `px`, for n evenly spaced slots between x0 and x1. */
export function nearestIndex(px, n, x0, x1) {
  if (n <= 1) return 0
  const i = Math.round(((px - x0) / (x1 - x0)) * (n - 1))
  return Math.max(0, Math.min(n - 1, i))
}

/** Index of the band (bar group) under pixel `px`; bands of equal width from x0. */
export function bandIndex(px, n, x0, bandW) {
  return Math.max(0, Math.min(n - 1, Math.floor((px - x0) / bandW)))
}

/** Left offset for a tooltip of width `tipW` next to anchor `ax`, kept inside [0, W]. */
export function tipLeft(ax, tipW, W, gap = 12) {
  const right = ax + gap
  if (right + tipW <= W) return right
  return Math.max(0, ax - gap - tipW)
}
