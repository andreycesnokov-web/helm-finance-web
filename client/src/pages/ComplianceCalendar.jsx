import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { apiFetch } from '../lib/api'
import { getLang } from '../i18n/index'
import InfoTooltip from '../components/InfoTooltip'
import TaxKnowledgeCard from '../components/TaxKnowledgeCard'
import { listTaxCards, getTaxCard, matchTopicId } from '../lib/taxKnowledgeFixtures'

const L = {
  en: { title: 'Compliance calendar', subtitle: 'Tax obligations & deadlines · Indonesia',
    all: 'All', upcoming: 'Upcoming 30d', overdue: 'Overdue', review: 'Needs review',
    period: 'Period', due: 'Due', source: 'Official source', version: 'Rule version', verified: 'Last verified',
    amount: 'Amount', unknown: 'unknown', empty: 'No obligations yet. Complete and verify your tax profile and activate verified rules.',
    sourceReq: 'rules need source verification', open: 'Open source',
    disclaimer: 'This information is for guidance only and does not constitute legal, tax or accounting advice. Confirm calculations with a licensed professional before making a tax payment or filing a return.' },
  ru: { title: 'Календарь compliance', subtitle: 'Налоговые обязательства и сроки · Индонезия',
    all: 'Все', upcoming: 'Ближайшие 30д', overdue: 'Просрочено', review: 'Нужна проверка',
    period: 'Период', due: 'Срок', source: 'Официальный источник', version: 'Версия правила', verified: 'Проверено',
    amount: 'Сумма', unknown: 'неизвестна', empty: 'Обязательств пока нет. Заполните и подтвердите налоговый профиль и активируйте проверенные правила.',
    sourceReq: 'правил требуют проверки источника', open: 'Открыть источник',
    disclaimer: 'Информация носит рекомендательный характер и не является юридической, налоговой или бухгалтерской консультацией. Перед платежом или подачей отчётности подтвердите расчёты у лицензированного специалиста.' },
  id: { title: 'Kalender kepatuhan', subtitle: 'Kewajiban & tenggat pajak · Indonesia',
    all: 'Semua', upcoming: '30 hari ke depan', overdue: 'Terlambat', review: 'Perlu ditinjau',
    period: 'Periode', due: 'Jatuh tempo', source: 'Sumber resmi', version: 'Versi aturan', verified: 'Terverifikasi',
    amount: 'Jumlah', unknown: 'tidak diketahui', empty: 'Belum ada kewajiban. Lengkapi & verifikasi profil pajak dan aktifkan aturan terverifikasi.',
    sourceReq: 'aturan perlu verifikasi sumber', open: 'Buka sumber',
    disclaimer: 'Informasi ini hanya bersifat panduan dan bukan merupakan nasihat hukum, pajak, atau akuntansi. Konfirmasikan perhitungan dengan profesional berlisensi sebelum melakukan pembayaran atau pelaporan pajak.' },
}
const STATUS = { overdue: ['#991B1B', '#FEE2E2'], due_soon: ['#92400E', '#FEF3C7'], upcoming: ['#1e40af', '#EFF6FF'] }
const fmt = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export default function ComplianceCalendar() {
  const { token } = useAuth()
  const lang = ['ru', 'id'].includes(getLang()) ? getLang() : 'en'
  const l = L[lang]
  const [data, setData] = useState(null)
  const [view, setView] = useState('all')
  const [taxCardsState, setTaxCardsState] = useState({ loading: true, error: null, cards: [] })

  const load = useCallback(() => { apiFetch('/accountant/calendar', token).then(setData).catch(e => setData({ error: e.message })) }, [token])
  useEffect(() => { if (token) load() }, [token, load])

  useEffect(() => {
    let active = true
    setTaxCardsState({ loading: true, error: null, cards: [] })
    if (!token) {
      setTaxCardsState({ loading: false, error: null, cards: listTaxCards(lang) })
      return
    }
    apiFetch(`/accountant/tax-knowledge/cards?lang=${lang}`, token)
      .then(res => {
        if (!active) return
        if (Array.isArray(res?.cards) && res.cards.length > 0) {
          setTaxCardsState({ loading: false, error: null, cards: res.cards })
        } else {
          setTaxCardsState({ loading: false, error: null, cards: listTaxCards(lang) })
        }
      })
      .catch(err => {
        if (!active) return
        const isAuthErr = err?.status === 401 || err?.status === 403 || /401|403|unauthorized|forbidden/i.test(err?.message || '')
        if (isAuthErr) {
          setTaxCardsState({ loading: false, error: 'forbidden', cards: [] })
        } else {
          setTaxCardsState({ loading: false, error: 'offline', cards: listTaxCards(lang) })
        }
      })
    return () => { active = false }
  }, [token, lang])

  if (!data) return <div style={{ padding: 40, color: 'var(--text-3)' }}>Loading…</div>
  const events = data.events || []
  const filtered = events.filter(e =>
    view === 'all' ? true
    : view === 'overdue' ? e.status === 'overdue'
    : view === 'upcoming' ? e.status !== 'overdue'
    : view === 'review' ? (e.professional_review_status && e.professional_review_status !== 'not_started') || e.owner_approval_status === 'required'
    : true)

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        📅 {l.title}
        <InfoTooltip term="tax_data_status" lang={lang} />
      </h1>
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>{l.subtitle}</div>

      {data.active_unverified > 0 && (
        <div style={{ fontSize: 12, color: 'var(--amber-dark)', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '7px 10px', marginBottom: 12 }}>
          ⚠ {data.active_unverified} {l.sourceReq}
        </div>
      )}
      {(data.warnings || []).map((w, i) => <div key={i} style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>· {w}</div>)}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {['all', 'upcoming', 'overdue', 'review'].map(v => (
          <button key={v} onClick={() => setView(v)} style={{ padding: '5px 12px', borderRadius: 20, border: '1px solid var(--border)', cursor: 'pointer',
            background: view === v ? 'var(--accent,#4F46E5)' : 'var(--bg-3)', color: view === v ? '#fff' : 'var(--text-2)', fontWeight: 600, fontSize: 12 }}>{l[v]}</button>
        ))}
      </div>

      {filtered.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-3)', padding: 20, textAlign: 'center' }}>{l.empty}</div>}

      {filtered.map((e, i) => {
        const [fg, bg] = STATUS[e.status] || STATUS.upcoming
        const src = e.official_source
        const topicId = matchTopicId(e.rule_code || e.title)
        const matchedCard = topicId ? getTaxCard(topicId, lang) : null
        const whatText = Array.isArray(matchedCard?.what_is) && matchedCard.what_is[0]?.text
          ? matchedCard.what_is[0].text
          : (Array.isArray(matchedCard?.summary) && matchedCard.summary[0]?.text ? matchedCard.summary[0].text : '')
        const howText = Array.isArray(matchedCard?.how_it_works) && matchedCard.how_it_works[0]?.text
          ? matchedCard.how_it_works[0].text
          : (matchedCard?.section_status?.how_it_works === 'unavailable' ? 'Archived procedure under research review.' : '')

        return (
          <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {e.title}
                  {matchedCard && (
                    <InfoTooltip
                      title={matchedCard.name}
                      what={whatText}
                      how={howText}
                      interpret={matchedCard.required_notice}
                      lang={lang}
                    />
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{e.rule_code} · v{e.rule_version} · {l.period}: {e.period}</div>
              </div>
              <span style={{ background: bg, color: fg, borderRadius: 6, padding: '3px 9px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{e.status}</span>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, flexWrap: 'wrap' }}>
              <span><b>{l.due}:</b> {fmt(e.due_date)}</span>
              <span><b>{l.amount}:</b> {e.amount_status === 'unknown' ? l.unknown : (e.confirmed_amount || e.estimated_amount || l.unknown)}</span>
            </div>
            {src && (
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8, borderTop: '0.5px solid var(--border)', paddingTop: 6 }}>
                {l.source}: <a href={src.url} target="_blank" rel="noreferrer">{src.title}</a> · {l.verified}: {fmt(src.last_verified_at)}
              </div>
            )}
          </div>
        )
      })}

      <div style={{ marginTop: 28, borderTop: '1px solid var(--border-default, #d0d7de)', paddingTop: 20 }}>
        <h3 style={{ fontSize: 17, fontWeight: 800, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
          Tax Knowledge Reference
          <InfoTooltip term="tax_data_status" lang={lang} />
        </h3>
        <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '0 0 14px' }}>
          Archived statutory references for Indonesia tax rules (PPh 21, 26, 23, Final rent, 25, 29, PPN, PKP, NPWP/NIK).
        </p>

        {taxCardsState.error === 'forbidden' && (
          <div style={{ fontSize: 12, color: 'var(--crit, #dc2626)', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '7px 10px', marginBottom: 12 }}>
            Access denied: workspace not authorized for tax knowledge reference.
          </div>
        )}
        {taxCardsState.error === 'offline' && (
          <div style={{ fontSize: 12, color: 'var(--amber-dark, #92400e)', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '7px 10px', marginBottom: 12 }}>
            Offline mode: displaying reviewed tax reference snapshot.
          </div>
        )}
        {taxCardsState.loading && (
          <div style={{ padding: '20px 0', color: 'var(--text-3)' }}>Loading tax knowledge cards…</div>
        )}
        {!taxCardsState.loading && taxCardsState.error !== 'forbidden' && (
          <div className="tax-cards-grid">
            {taxCardsState.cards.map(card => (
              <TaxKnowledgeCard key={card.topic_id} card={card} lang={lang} />
            ))}
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 14 }}>{l.disclaimer}</div>
    </div>
  )
}
