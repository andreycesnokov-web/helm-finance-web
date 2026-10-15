// AI CFO (designs/AICFO.dc.html, AICFOMobile.dc.html). GET /api/ai-cfo/context only.
// Weekly brief, CFO score with its five factors, three recommended decisions, ask box.
// Decisions link to the screen where a human acts; "Why?" and the chips open the AI CFO
// panel. Nothing here approves or pays.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import I from '../icons'
import { PageHead, Card, Pill, Btn, Skeleton, ErrorBox } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi } from '../data'
import { money, longDate } from '../lib/format'
import { FACTORS, topDecisions, scoreTone, briefParts, questionsLeft } from '../lib/cfoModel'
import { useAsk, useAskContext } from '../ai/AskContext'
import { getLang } from '../../i18n/index'

const MONEY_KEYS = new Set(['v'])
const fmtVars = (v) => Object.fromEntries(Object.entries(v || {}).map(([k, x]) => [k, MONEY_KEYS.has(k) ? money(x) : x]))

export default function AICFO() {
  const t = useT()
  const lang = useLang()
  const { openAsk } = useAsk()
  const [q, setQ] = useState('')
  const ctx = useApi(`/ai-cfo/context?language=${getLang()}`)
  useAskContext(t('nav.cfo'), t('cfo.thisWeek'))
  const left = questionsLeft(ctx.data)
  const head = <PageHead title={t('nav.cfo')} sub={`${t('cfo.sub')} · ${longDate(new Date(), lang)}`}
    actions={left && <Pill tone="neutral">{t('cfo.left', { n: left.left, m: left.max })}</Pill>} />
  if (ctx.loading) return <>{head}<Card><Skeleton rows={8} /></Card></>
  if (ctx.error) return <>{head}<ErrorBox error={ctx.error?.status === 403 ? t('cfo.forbidden') : ctx.error} onRetry={ctx.reload} /></>

  const c = ctx.data || {}
  const score = c.cfo_score || null
  const decisions = topDecisions(c)
  const brief = briefParts(c)
  const chips = ['q1', 'q2', 'q3', 'q4']

  return (
    <div className="v2-page">
      {head}
      <div className="v2-grid-detail">
        <section className="v2-hero v2-hero-plain" aria-labelledby="v2-brief-title">
          <div className="v2-hero-text">
            <span className="v2-hero-label">{t('cfo.thisWeek')}</span>
            <h2 id="v2-brief-title" className="v2-hero-title">{c.ai_alert?.headline || score?.summary || t('cfo.noBrief')}</h2>
            <p className="v2-hero-p v2-show">{brief.map((b) => t(b.key, fmtVars(b.v))).join(' ')}</p>
            {c.ai_alert?.description && <p className="v2-hero-p v2-show">{c.ai_alert.description}</p>}
            <Link className="v2-hero-link" to="/business/radar">{t('cfo.seeForecast')}<I.chevRight size={16} /></Link>
          </div>
        </section>

        <Card title={t('cfo.score')} aside={score && <Pill tone={scoreTone(score.status)} dot>{score.label}</Pill>}>
          {score ? (
            <>
              <p className="v2-score v2-num" aria-label={t('cfo.scoreOf', { n: score.score })}>{score.score}<span className="v2-muted">/100</span></p>
              <ul className="v2-factors">
                {FACTORS.filter((k) => score.factors?.[k]).map((k) => {
                  const f = score.factors[k]
                  return (
                    <li key={k}>
                      <span className="v2-factor-name">{t(`cfo.f.${k}`)}</span>
                      <span className="v2-factor-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={f.score} aria-label={`${t(`cfo.f.${k}`)} ${f.score}`}>
                        <span className={`v2-factor-fill v2-impact-${f.impact || 'neutral'}`} style={{ width: `${Math.max(0, Math.min(100, f.score))}%` }} />
                      </span>
                      <span className="v2-num v2-factor-n">{f.score}</span>
                      {f.label && <span className="v2-factor-label v2-muted v2-small">{f.label}</span>}
                    </li>
                  )
                })}
              </ul>
              {score.summary && <p className="v2-sec v2-small">{score.summary}</p>}
            </>
          ) : <p className="v2-muted">{t('cfo.noScore')}</p>}
        </Card>
      </div>

      <section aria-labelledby="v2-dec-title">
        <h2 id="v2-dec-title" className="v2-h2 v2-section-title">{t('cfo.decisions')}</h2>
        {decisions.length === 0 ? <Card><p className="v2-muted">{t('cfo.noDecisions')}</p></Card> : (
          <div className="v2-cards3">
            {decisions.map((d, i) => (
              <Card key={i} as="article" className="v2-decision">
                <Pill tone={d.priority === 'high' || d.priority === 'critical' ? 'warn' : 'neutral'}>{t(`cfo.prio.${d.priority || 'medium'}`)}</Pill>
                <h3 className="v2-h3">{d.title}</h3>
                <p className="v2-sec v2-small">{d.description}</p>
                {d.amount ? <p className="v2-num v2-dec-amt">{money(d.amount)}</p> : null}
                <div className="v2-row-gap v2-row-start">
                  {d.to && <Btn variant="primary" to={d.to}>{t('cfo.open')}</Btn>}
                  <button type="button" className="v2-btn v2-btn-secondary" onClick={() => openAsk(t('cfo.why', { what: d.title }))}>{t('cfo.whyBtn')}</button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Card>
        <form className="v2-askbox" onSubmit={(e) => { e.preventDefault(); if (q.trim()) { openAsk(q); setQ('') } }}>
          <label htmlFor="cfo-ask" className="v2-field-label">{t('cfo.askLabel')}</label>
          <div className="v2-askrow">
            <input id="cfo-ask" className="v2-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('cfo.askPh')} maxLength={2000} />
            <button type="submit" className="v2-btn v2-btn-primary" aria-label={t('ask.send')} title={q.trim() ? undefined : t('ask.typeFirst')} disabled={!q.trim()}><I.send size={16} /></button>
          </div>
        </form>
        <div className="v2-chips">{chips.map((k) => <button key={k} type="button" className="v2-chip" onClick={() => openAsk(t(`cfo.chip.${k}`))}>{t(`cfo.chip.${k}`)}</button>)}</div>
      </Card>
    </div>
  )
}
