// Radar — 30-day cash forecast. Container only: token, fetch, loading and error.
//
// WHAT DID NOT CHANGE: every figure on this page. balance, burnRate, debts and
// the three scenarios (proj30 / projBest / projWorst), monthlyBurn and runway are
// the same expressions over the same GET /api/pulse?scope=business response,
// moved verbatim into radarFigures() in RadarBlocks.jsx, and still formatted with
// the same fmt/fmtFull helpers. The numbers a user reads today are the numbers
// they read before. No calculation, data source or currency handling was touched.
//
// WHAT CHANGED: this was the last page outside the shared design system. It drew
// its own header, its own navy hero as an inline linear-gradient with a
// graph-paper grid built from repeating-linear-gradient, and hf-card panels. The
// markup now lives in RadarBlocks.jsx on the shared components — which is also
// what lets the design preview photograph the real thing.
import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useAccess } from '../hooks/useAccess'
import { useTranslation } from '../hooks/useTranslation'
import { apiFetch } from '../lib/api'
import { Card, LoadingSkeleton, ErrorState } from '../shell/ui'
import { RadarHeader, RadarForecast, radarFigures } from './RadarBlocks'

export default function Radar() {
  const { token } = useAuth()
  const { hasFeature } = useAccess()
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  // A failed load used to be swallowed into console.error, leaving the page to
  // render a forecast of zero — which is a claim, not an absence of one.
  const [error, setError] = useState(null)

  const load = () => {
    setLoading(true)
    setError(null)
    apiFetch('/pulse?scope=business', token)
      .then(setData)
      .catch((e) => { console.error(e); setError(e.message || 'Request failed') })
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const figures = radarFigures(data)

  if (loading) {
    return (
      <div className="hf-page">
        <RadarHeader t={t} isHealthy badge={false} />
        <Card><LoadingSkeleton rows={5} height={18} /></Card>
      </div>
    )
  }
  if (error) {
    return (
      <div className="hf-page">
        <RadarHeader t={t} isHealthy badge={false} />
        <ErrorState description={error} onRetry={load} />
      </div>
    )
  }

  return (
    <div className="hf-page">
      <RadarHeader t={t} isHealthy={figures.isHealthy} />
      <RadarForecast
        figures={figures}
        t={t}
        hasAdvanced={hasFeature('advanced_radar_enabled')}
      />
    </div>
  )
}
