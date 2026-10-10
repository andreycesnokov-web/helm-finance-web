// Settings (designs Settings + w2/S2SettingsDialogs) — everything the classic settings, team and
// payment-gateway pages did, in one v2 page; no "classic view".
// Sections (?tab=): me · company · books · connections · team.
// Reads: GET /api/me/profile, /business/targets (TargetsCard), /accountant/applicability,
// /cashflow-categories (and ?archived=1), /account/integrations/telegram, /telegram/config,
// /payment-connections, /wallets, /team. Writes go through lib/actions.js; the server checks roles.
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useTranslation } from '../../hooks/useTranslation'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { useAccess } from '../../hooks/useAccess'
import I from '../icons'
import { PageHead, Card, Pill, Btn, Skeleton, ErrorBox } from '../ui'
import { useT } from '../i18n'
import { useApi, useInvalidate } from '../data'
import TargetsCard from '../components/TargetsCard'
import Modal from '../components/Modal'
import {
  updateMyProfile, updateCompanyBasics, createCategory, updateCategory, archiveCategory,
  telegramLinkToken, telegramUnlink, createGateway, inviteMember, revokeInvite, updateMember, removeMember,
} from '../lib/actions'

const TABS = ['me', 'company', 'books', 'connections', 'team']
const ROLES = ['admin', 'ceo', 'cfo', 'accountant', 'manager', 'employee', 'auditor']
const PROVIDERS = ['xendit', 'midtrans', 'doku', 'hitpay', 'duitku', 'ipaymu']
const initial = (s) => (String(s || '?').trim()[0] || '?').toUpperCase()
const errMsg = (t, x) => (x?.status === 403 ? t('set.err.role') : x?.data?.message || x?.data?.error || x?.message || t('set.err.generic'))

/** "Saved." / "Not saved: …" above the section where Save was pressed; gone after 5 s. */
function useFlash() {
  const [m, setM] = useState(null)
  useEffect(() => { if (!m) return undefined; const id = setTimeout(() => setM(null), 5000); return () => clearTimeout(id) }, [m])
  const node = m && <div className={`v2-banner v2-tone-${m.tone}`} role="status"><span className="v2-banner-text">{m.text}</span></div>
  return [node, setM]
}

export default function Settings() {
  const t = useT()
  const [sp, setSp] = useSearchParams()
  const { active } = useWorkspace()
  const tabs = ['manager', 'employee'].includes(active?.role) ? ['me'] : TABS
  const tab = tabs.includes(sp.get('tab')) ? sp.get('tab') : 'me'
  return (
    <div className="v2-page">
      <PageHead title={t('nav.settings')} sub={t('set.sub2', { name: active?.name || '' })} />
      <nav className="v2-seg v2-set-tabs" role="tablist" aria-label={t('set.sections')}>
        {tabs.map((k) => (
          <button key={k} type="button" role="tab" className="v2-seg-btn" aria-selected={tab === k} aria-pressed={tab === k}
            onClick={() => setSp((p) => { const n = new URLSearchParams(p); n.set('tab', k); return n }, { replace: true })}>{t(`set.tab.${k}`)}</button>
        ))}
      </nav>
      {tab === 'me' && <MeTab />}
      {tab === 'company' && <CompanyTab />}
      {tab === 'books' && <BooksTab />}
      {tab === 'connections' && <ConnectionsTab />}
      {tab === 'team' && <TeamTab />}
      <SignOut />
    </div>
  )
}

/* ── Personal ────────────────────────────────────────────────────────────── */
function MeTab() {
  const t = useT()
  const { token } = useAuth()
  const { lang, changeLang } = useTranslation()
  const prof = useApi('/me/profile')
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useFlash()
  useEffect(() => { if (prof.data && !f) { const p = prof.data.profile || {}; setF({ display_name: p.display_name || '', timezone: p.timezone || '' }) } }, [prof.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const pickLang = async (l) => { changeLang(l); try { await updateMyProfile(token, { locale: l }) } catch { /* the switch already applied on this device */ } }
  const save = async (e) => {
    e.preventDefault(); setBusy(true)
    try { await updateMyProfile(token, f); setFlash({ tone: 'good', text: t('set.saved') }) }
    catch (x) { setFlash({ tone: 'warn', text: t('set.notSaved', { msg: errMsg(t, x) }) }) } finally { setBusy(false) }
  }
  return (
    <>
      <Card title={t('set.tab.me')}>
        {flash}
        {prof.loading || !f ? <Skeleton rows={3} /> : (
          <form onSubmit={save} className="v2-set-form">
            <div className="v2-field-row">
              <label className="v2-field"><span className="v2-field-label">{t('set.me.name')}</span>
                <input className="v2-input" value={f.display_name} maxLength={80} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></label>
              <label className="v2-field"><span className="v2-field-label">{t('set.me.tz')}</span>
                <input className="v2-input" value={f.timezone} placeholder="Asia/Jakarta" onChange={(e) => setF({ ...f, timezone: e.target.value })} /></label>
            </div>
            <div className="v2-field"><span className="v2-field-label">{t('set.me.lang')}</span>
              <div className="v2-seg" role="group" aria-label={t('set.me.lang')}>
                {['ru', 'en', 'id'].map((l) => <button key={l} type="button" className="v2-seg-btn" aria-pressed={lang === l} onClick={() => pickLang(l)}>{l.toUpperCase()}</button>)}
              </div>
              <span className="v2-muted v2-small">{t('set.me.langHint')}</span>
            </div>
            <div className="v2-row-gap"><button type="submit" className="v2-btn v2-btn-primary" disabled={busy}>{t('set.save')}</button></div>
          </form>
        )}
      </Card>
      <TargetsCard />
    </>
  )
}

/* ── Company ─────────────────────────────────────────────────────────────── */
function CompanyTab() {
  const t = useT()
  const { token } = useAuth()
  const { active, refresh } = useWorkspace()
  const { planLabel } = useAccess()
  const appl = useApi('/accountant/applicability')
  const counts = useApi('/business/financial-counts')
  const [f, setF] = useState({ name: active?.name || '', country: active?.country || 'Indonesia', timezone: active?.timezone || '', base_currency: active?.base_currency || 'IDR' })
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useFlash()
  const hasTx = Number(counts.data?.counts?.transactions || 0) > 0
  const save = async (e) => {
    e.preventDefault(); setBusy(true)
    try {
      const body = { name: f.name.trim(), country: f.country, timezone: f.timezone }
      if (!hasTx) body.base_currency = f.base_currency
      await updateCompanyBasics(token, body); refresh(); setFlash({ tone: 'good', text: t('set.saved') })
    } catch (x) { setFlash({ tone: 'warn', text: t('set.notSaved', { msg: errMsg(t, x) }) }) } finally { setBusy(false) }
  }
  const pct = appl.data?.completeness?.percent
  return (
    <>
      <Card title={t('set.co.title')} aside={<Link to="/business/accountant/tax-profile">{t('set.co.profile')} →</Link>}>
        {flash}
        <form onSubmit={save} className="v2-set-form">
          <div className="v2-field-row">
            <label className="v2-field"><span className="v2-field-label">{t('set.co.name')}</span>
              <input className="v2-input" value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="v2-field"><span className="v2-field-label">{t('set.co.country')}</span>
              <select className="v2-select" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>
                {['Indonesia', 'Singapore', 'Malaysia', 'Thailand', 'Other'].map((c) => <option key={c} value={c}>{t(`setup.about.countries.${c}`)}</option>)}
              </select></label>
            <label className="v2-field"><span className="v2-field-label">{t('set.co.tz')}</span>
              <input className="v2-input" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></label>
            <label className="v2-field"><span className="v2-field-label">{t('set.co.currency')}</span>
              <select className="v2-select" value={f.base_currency} disabled={hasTx} onChange={(e) => setF({ ...f, base_currency: e.target.value })}>
                {['IDR', 'USD', 'SGD', 'EUR'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select></label>
          </div>
          <p className="v2-muted v2-small">{t('set.co.note')}</p>
          <div className="v2-row-gap"><button type="submit" className="v2-btn v2-btn-primary" disabled={busy || !f.name.trim()}>{t('set.save')}</button></div>
        </form>
      </Card>
      <Card title={t('set.co.taxTitle')}>
        <p className="v2-sec">{pct != null ? t('prof.pct', { n: pct }) : t('prof.unknownPct')}</p>
        <div className="v2-row-gap"><Btn to="/business/accountant/tax-profile/edit">{t('prof.edit')}</Btn><Btn to="/business/setup/docs">{t('set.co.docs')}</Btn></div>
      </Card>
      <Card title={t('set.co.plan')}>
        <p className="v2-sec">{planLabel || '—'}</p>
        <p className="v2-muted v2-small">{t('set.planNote')}</p>
      </Card>
    </>
  )
}

/* ── Books: cash-flow categories ─────────────────────────────────────────── */
function BooksTab() {
  const t = useT()
  const { token } = useAuth()
  const invalidate = useInvalidate()
  const cats = useApi('/cashflow-categories')
  const [showArch, setShowArch] = useState(false)
  const arch = useApi(showArch ? '/cashflow-categories?archived=1' : null)
  const [add, setAdd] = useState({ inflow: '', outflow: '' })
  const [dlg, setDlg] = useState(null)   // { kind: 'rename' | 'archive', cat }
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useFlash()
  const all = cats.data?.categories || []
  const by = (g) => all.filter((c) => c.group_type === g)
  const run = async (fn, ok) => {
    setBusy(true)
    try { await fn(); invalidate(); setFlash({ tone: 'good', text: ok }); setDlg(null) }
    catch (x) { setFlash({ tone: 'warn', text: t('set.notSaved', { msg: errMsg(t, x) }) }) } finally { setBusy(false) }
  }
  const addOne = (g) => { const v = add[g].trim(); if (!v) return; run(async () => { await createCategory(token, { name: v, group_type: g }); setAdd((a) => ({ ...a, [g]: '' })) }, t('set.books.added', { name: v })) }
  if (cats.loading) return <Card><Skeleton rows={6} /></Card>
  if (cats.error) return <ErrorBox error={cats.error} onRetry={cats.reload} />
  return (
    <Card title={t('set.books.title', { n: all.length })} aside={<button type="button" className="v2-btn-link v2-small" onClick={() => setShowArch((v) => !v)}>{showArch ? t('set.books.hideArch') : t('set.books.showArch')}</button>}>
      {flash}
      <div className="v2-set-cols">
        {['inflow', 'outflow'].map((g) => (
          <section key={g} aria-label={t(`set.books.${g}`)}>
            <h3 className="v2-set-h3">{t(`set.books.${g}`)} · {by(g).length}</h3>
            <ul className="v2-set-cats">
              {by(g).map((c) => (
                <li key={c.id}>
                  <span>{c.name}{c.is_system && <span className="v2-muted v2-small"> · {t('set.books.system')}</span>}</span>
                  {!c.is_system && <span className="v2-row-gap">
                    <button type="button" className="v2-btn-link v2-small" onClick={() => { setName(c.name); setDlg({ kind: 'rename', cat: c }) }}>{t('set.books.rename')}</button>
                    <button type="button" className="v2-btn-link v2-small" onClick={() => setDlg({ kind: 'archive', cat: c })}>{t('set.books.archive')}</button>
                  </span>}
                </li>
              ))}
            </ul>
            <form className="v2-set-addrow" onSubmit={(e) => { e.preventDefault(); addOne(g) }}>
              <input className="v2-input" value={add[g]} placeholder={t(`set.books.new.${g}`)} aria-label={t(`set.books.new.${g}`)} onChange={(e) => setAdd((a) => ({ ...a, [g]: e.target.value }))} />
              <button type="submit" className="v2-btn v2-btn-secondary" disabled={busy || !add[g].trim()}>{t('set.books.add')}</button>
            </form>
          </section>
        ))}
      </div>
      {showArch && (
        <section className="v2-set-arch">
          <h3 className="v2-set-h3">{t('set.books.archived')}</h3>
          {arch.loading ? <Skeleton rows={2} /> : (arch.data?.categories || []).length === 0 ? <p className="v2-muted">{t('set.books.noArch')}</p> : (
            <ul className="v2-set-cats">{arch.data.categories.map((c) => (
              <li key={c.id}><span>{c.name} <span className="v2-muted v2-small">· {t(`set.books.${c.group_type}`)}</span></span>
                <button type="button" className="v2-btn-link v2-small" disabled={busy} onClick={() => run(() => updateCategory(token, c.id, { is_active: true }), t('set.books.restored', { name: c.name }))}>{t('set.books.restore')}</button></li>
            ))}</ul>
          )}
        </section>
      )}
      <p className="v2-muted v2-small">{t('set.books.note')} <Link to="/business/performance/groups">{t('set.books.groups')}</Link></p>
      {dlg?.kind === 'rename' && (
        <Modal title={t('set.books.renameTitle')} onClose={() => setDlg(null)}
          footer={<><button type="button" className="v2-btn v2-btn-secondary" onClick={() => setDlg(null)}>{t('set.cancel')}</button>
            <button type="button" className="v2-btn v2-btn-primary" disabled={busy || !name.trim()} onClick={() => run(() => updateCategory(token, dlg.cat.id, { name: name.trim() }), t('set.saved'))}>{t('set.save')}</button></>}>
          <label className="v2-field"><span className="v2-field-label">{t('set.books.name')}</span><input className="v2-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <p className="v2-muted v2-small">{t('set.books.renameNote')}</p>
        </Modal>
      )}
      {dlg?.kind === 'archive' && (
        <Modal title={t('set.books.archiveTitle', { name: dlg.cat.name })} onClose={() => setDlg(null)}
          footer={<><button type="button" className="v2-btn v2-btn-secondary" onClick={() => setDlg(null)}>{t('set.cancel')}</button>
            <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={() => run(() => archiveCategory(token, dlg.cat.id), t('set.books.archivedOk', { name: dlg.cat.name }))}>{t('set.books.archive')}</button></>}>
          <p className="v2-sec">{t('set.books.archiveNote')}</p>
        </Modal>
      )}
    </Card>
  )
}

/* ── Connections ─────────────────────────────────────────────────────────── */
function ConnectionsTab() {
  const t = useT()
  const { token } = useAuth()
  const invalidate = useInvalidate()
  const tg = useApi('/account/integrations/telegram')
  const cfg = useApi('/telegram/config')
  const gw = useApi('/payment-connections')
  const wallets = useApi('/wallets')
  const [dlg, setDlg] = useState(null)        // 'tg' | 'tgOff' | 'gw' | 'ai'
  const [link, setLink] = useState(null)
  const [g, setG] = useState({ provider: 'xendit', environment: 'sandbox', display_name: '', linked_wallet_id: '', provider_account_id: '' })
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useFlash()
  const connected = tg.data?.status === 'connected'
  const bot = cfg.data?.bot_username || cfg.data?.username
  const openTg = async () => {
    setDlg('tg'); setLink(null)
    try { setLink(await telegramLinkToken(token)) } catch (x) { setLink({ error: x?.status === 503 ? t('set.conn.tgDown') : errMsg(t, x) }) }
  }
  const run = async (fn, ok) => {
    setBusy(true)
    try { await fn(); invalidate(); setFlash({ tone: 'good', text: ok }); setDlg(null) }
    catch (x) { setFlash({ tone: 'warn', text: t('set.notSaved', { msg: errMsg(t, x) }) }) } finally { setBusy(false) }
  }
  const list = gw.data?.connections || []
  const gwOff = gw.error?.status === 404
  // GET /api/wallets is already this company's accounts; the scope column is only a label (review 8.2 #4).
  const bizWallets = wallets.data?.wallets || []
  return (
    <Card title={t('set.tab.connections')}>
      {flash}
      <ul className="v2-conn">
        <li data-conn="telegram"><I.send size={18} />
          <span><strong>Telegram</strong> {connected ? <Pill tone="good">{t('set.conn.on')}</Pill> : <Pill tone="neutral">{t('set.conn.off')}</Pill>}
            <span className="v2-muted v2-small v2-block">{connected ? t('set.conn.tgOn', { h: tg.data?.handle || '', bot: bot ? `@${bot}` : '' }) : t('set.conn.tgOff')}</span></span>
          {connected
            ? <span className="v2-row-gap">{bot && <a className="v2-btn v2-btn-secondary" href={`https://t.me/${bot}`} target="_blank" rel="noreferrer">{t('set.conn.openBot')}</a>}<button type="button" className="v2-btn v2-btn-ghost" onClick={() => setDlg('tgOff')}>{t('set.conn.disconnect')}</button></span>
            : <button type="button" className="v2-btn v2-btn-primary" onClick={openTg}>{t('set.conn.connect')}</button>}
        </li>
        <li data-conn="ai"><I.cfo size={18} />
          <span><strong>{t('set.conn.ai')}</strong><span className="v2-muted v2-small v2-block">{t('set.conn.aiHint')}</span></span>
          <button type="button" className="v2-btn v2-btn-secondary" onClick={() => setDlg('ai')}>{t('set.conn.how')}</button>
        </li>
        <li data-conn="gateways"><I.link size={18} />
          <span><strong>{t('set.conn.gw')}</strong>
            <span className="v2-muted v2-small v2-block">{gwOff ? t('set.conn.gwOffP') : list.length ? list.map((c) => `${c.display_name || c.provider} · ${t(`set.conn.env.${c.environment}`)}`).join(' · ') : t('set.conn.gwHint')}</span></span>
          {gwOff ? <Pill tone="neutral">{t('set.conn.gwOff')}</Pill> : <button type="button" className="v2-btn v2-btn-secondary" onClick={() => setDlg('gw')}>{t('set.conn.addGw')}</button>}
        </li>
        <li data-conn="bank"><I.accounts size={18} />
          <span><strong>{t('set.conn.bank')}</strong><span className="v2-muted v2-small v2-block">{t('set.conn.bankHint', { n: bizWallets.length })}</span></span>
          <Btn to="/business/bank-import">{t('set.conn.import')}</Btn>
        </li>
      </ul>
      {dlg === 'tg' && (
        <Modal title={t('set.conn.tgTitle')} onClose={() => setDlg(null)}
          footer={<><button type="button" className="v2-btn v2-btn-secondary" disabled={!link?.deep_link} onClick={() => { try { navigator.clipboard.writeText(link.deep_link) } catch { /* no clipboard */ } setFlash({ tone: 'good', text: t('set.conn.copied') }) }}>{t('set.conn.copy')}</button>
            {link?.deep_link && <a className="v2-btn v2-btn-primary" href={link.deep_link} target="_blank" rel="noreferrer" onClick={() => setTimeout(() => tg.reload?.(), 4000)}>{t('set.conn.openTg')}</a>}</>}>
          {!link ? <Skeleton rows={2} /> : link.error ? <p className="v2-inline-err" role="alert">{link.error}</p> : (
            <><ol className="v2-set-steps"><li>{t('set.conn.tgS1')}</li><li>{t('set.conn.tgS2')}</li></ol>
              <p className="v2-muted v2-small">{t('set.conn.tgTtl')}</p></>
          )}
        </Modal>
      )}
      {dlg === 'tgOff' && (
        <Modal title={t('set.conn.tgOffTitle')} onClose={() => setDlg(null)}
          footer={<><button type="button" className="v2-btn v2-btn-secondary" onClick={() => setDlg(null)}>{t('set.cancel')}</button>
            <button type="button" className="v2-btn v2-btn-danger" disabled={busy} onClick={() => run(() => telegramUnlink(token), t('set.conn.tgOffOk'))}>{t('set.conn.disconnect')}</button></>}>
          <p className="v2-sec">{t('set.conn.tgOffP')}</p>
        </Modal>
      )}
      {dlg === 'ai' && (
        <Modal title={t('set.conn.ai')} onClose={() => setDlg(null)} footer={<button type="button" className="v2-btn v2-btn-primary" onClick={() => setDlg(null)}>{t('set.ok')}</button>}>
          <ol className="v2-set-steps"><li>{t('set.conn.aiS1')}</li><li>{t('set.conn.aiS2', { url: `${window.location.origin}/mcp` })}</li><li>{t('set.conn.aiS3')}</li></ol>
          <p className="v2-muted v2-small">{t('set.conn.aiNote')}</p>
        </Modal>
      )}
      {dlg === 'gw' && (
        <Modal title={t('set.conn.gwTitle')} onClose={() => setDlg(null)}
          footer={<><button type="button" className="v2-btn v2-btn-secondary" onClick={() => setDlg(null)}>{t('set.cancel')}</button>
            <button type="button" className="v2-btn v2-btn-primary" disabled={busy || !g.linked_wallet_id}
              onClick={() => run(() => createGateway(token, { ...g, display_name: g.display_name.trim() || null, provider_account_id: g.provider_account_id.trim() || null }), t('set.conn.gwOk'))}>{t('set.conn.gwConnect')}</button></>}>
          <div className="v2-field"><span className="v2-field-label">{t('set.conn.provider')}</span>
            <div className="v2-setup-chips">{PROVIDERS.map((p) => <button key={p} type="button" className="v2-chip" aria-pressed={g.provider === p} onClick={() => setG({ ...g, provider: p })}>{p[0].toUpperCase() + p.slice(1)}</button>)}</div></div>
          <label className="v2-field"><span className="v2-field-label">{t('set.conn.into')}</span>
            <select className="v2-select" value={g.linked_wallet_id} onChange={(e) => setG({ ...g, linked_wallet_id: e.target.value })}>
              <option value="">{t('pe.choose')}</option>
              {bizWallets.map((w) => <option key={w.id} value={w.id}>{w.name} · {w.currency}</option>)}
            </select>
            {bizWallets.length === 0 && <span className="v2-inline-err v2-small">{t('set.conn.noWallet')} <Link to="/business/accounts">{t('set.conn.addWallet')}</Link></span>}</label>
          <div className="v2-field"><span className="v2-field-label">{t('set.conn.mode')}</span>
            <div className="v2-seg" role="group">{['sandbox', 'production'].map((m) => <button key={m} type="button" className="v2-seg-btn" aria-pressed={g.environment === m} onClick={() => setG({ ...g, environment: m })}>{t(`set.conn.env.${m}`)}</button>)}</div></div>
          <div className="v2-field-row">
            <label className="v2-field"><span className="v2-field-label">{t('set.conn.gwName')}</span><input className="v2-input" value={g.display_name} onChange={(e) => setG({ ...g, display_name: e.target.value })} /></label>
            <label className="v2-field"><span className="v2-field-label">{t('set.conn.accId')}</span><input className="v2-input" value={g.provider_account_id} onChange={(e) => setG({ ...g, provider_account_id: e.target.value })} /></label>
          </div>
          <p className="v2-muted v2-small">{t('set.conn.gwNote')}</p>
        </Modal>
      )}
    </Card>
  )
}

/* ── Team ────────────────────────────────────────────────────────────────── */
function TeamTab() {
  const t = useT()
  const { token, user } = useAuth()
  const invalidate = useInvalidate()
  const team = useApi('/team')
  const [dlg, setDlg] = useState(null)   // { kind: 'invite' } | { kind: 'link', link, code, email } | { kind: 'remove', member }
  const [inv, setInv] = useState({ email: '', role: 'accountant' })
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useFlash()
  const run = async (fn, ok) => {
    setBusy(true)
    try { const r = await fn(); invalidate(); if (ok) setFlash({ tone: 'good', text: ok }); return r }
    catch (x) { setFlash({ tone: 'warn', text: t('set.notSaved', { msg: errMsg(t, x) }) }); return null } finally { setBusy(false) }
  }
  if (team.loading) return <Card><Skeleton rows={4} /></Card>
  if (team.error) return <Card title={t('set.tab.team')}><p className="v2-muted">{t('set.teamHidden')}</p></Card>
  const members = team.data?.members || []
  const invites = team.data?.invites || []
  const myRole = team.data?.my_role
  const canManage = ['owner', 'admin', 'ceo'].includes(myRole)
  const sendInvite = async () => {
    const r = await run(() => inviteMember(token, { role: inv.role, email: inv.email.trim() || undefined, expires_days: 7 }), null)
    if (r) setDlg({ kind: 'link', link: `${window.location.origin}${r.invite_url}`, code: r.invite?.code, email: inv.email.trim() })
  }
  return (
    <Card title={t('set.tab.team')} aside={canManage ? <button type="button" className="v2-btn v2-btn-primary" onClick={() => setDlg({ kind: 'invite' })}>{t('set.team.invite')}</button> : null}>
      {flash}
      <ul className="v2-team">
        {members.map((m) => (
          <li key={m.id} data-member={m.role}>
            <span className="v2-ava">{initial(m.name)}</span>
            <span className="v2-team-name">{m.name}{String(m.user_id) === String(user?.id) && <span className="v2-muted v2-small"> · {t('set.team.you')}</span>}</span>
            {canManage && m.role !== 'owner' && String(m.user_id) !== String(user?.id) ? (
              <select className="v2-select v2-set-role" value={m.role} aria-label={t('set.team.role')} disabled={busy}
                onChange={(e) => run(() => updateMember(token, m.id, { role: e.target.value }), t('set.saved'))}>
                {ROLES.map((r) => <option key={r} value={r}>{t(`set.role.${r}`)}</option>)}
              </select>
            ) : <Pill tone="neutral">{t(`set.role.${m.role}`)}</Pill>}
            <span className="v2-muted v2-small v2-team-what">{t(`set.roleWhat.${m.role}`)}</span>
            {canManage && m.role !== 'owner' && String(m.user_id) !== String(user?.id) && <button type="button" className="v2-btn-link v2-small" onClick={() => setDlg({ kind: 'remove', member: m })}>{t('set.team.remove')}</button>}
          </li>
        ))}
        {invites.map((i) => (
          <li key={i.id} data-invite={i.code}>
            <span className="v2-ava v2-ava-ghost"><I.send size={14} /></span>
            <span className="v2-team-name">{i.label || t('set.team.pending')}<span className="v2-muted v2-small v2-block">{t('set.team.waiting')}</span></span>
            <Pill tone="info">{t(`set.role.${i.role}`)}</Pill>
            <span className="v2-muted v2-small v2-team-what">{t('set.team.until', { d: String(i.expires_at || '').slice(0, 10) })}</span>
            {canManage && <button type="button" className="v2-btn-link v2-small" disabled={busy} onClick={() => run(() => revokeInvite(token, i.code), t('set.team.revoked'))}>{t('set.team.revoke')}</button>}
          </li>
        ))}
      </ul>
      {dlg?.kind === 'invite' && (
        <Modal title={t('set.team.inviteTitle')} onClose={() => setDlg(null)}
          footer={<><button type="button" className="v2-btn v2-btn-secondary" onClick={() => setDlg(null)}>{t('set.cancel')}</button>
            <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={sendInvite}>{t('set.team.send')}</button></>}>
          <label className="v2-field"><span className="v2-field-label">Email</span><input className="v2-input" type="email" value={inv.email} placeholder="name@company.com" onChange={(e) => setInv({ ...inv, email: e.target.value })} /></label>
          <label className="v2-field"><span className="v2-field-label">{t('set.team.role')}</span>
            <select className="v2-select" value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{t(`set.role.${r}`)} — {t(`set.roleWhat.${r}`)}</option>)}
            </select></label>
          <p className="v2-muted v2-small">{t('set.team.inviteNote')}</p>
        </Modal>
      )}
      {dlg?.kind === 'link' && (
        <Modal title={t('set.team.linkTitle')} onClose={() => setDlg(null)}
          footer={<><button type="button" className="v2-btn v2-btn-secondary" onClick={() => { try { navigator.clipboard.writeText(dlg.link) } catch { /* no clipboard */ } setFlash({ tone: 'good', text: t('set.conn.copied') }) }}>{t('set.conn.copy')}</button>
            <button type="button" className="v2-btn v2-btn-primary" onClick={() => setDlg(null)}>{t('set.ok')}</button></>}>
          <p className="v2-sec">{dlg.email ? t('set.team.linkEmail', { email: dlg.email }) : t('set.team.linkP')}</p>
          <input className="v2-input v2-num" readOnly value={dlg.link} onFocus={(e) => e.target.select()} data-invite-link />
          {dlg.code && <p className="v2-muted v2-small">{t('set.team.code', { code: dlg.code })}</p>}
        </Modal>
      )}
      {dlg?.kind === 'remove' && (
        <Modal title={t('set.team.removeTitle', { name: dlg.member.name })} onClose={() => setDlg(null)}
          footer={<><button type="button" className="v2-btn v2-btn-secondary" onClick={() => setDlg(null)}>{t('set.cancel')}</button>
            <button type="button" className="v2-btn v2-btn-danger" disabled={busy} onClick={async () => { await run(() => removeMember(token, dlg.member.id), t('set.team.removed')); setDlg(null) }}>{t('set.team.removeOk')}</button></>}>
          <p className="v2-sec">{t('set.team.removeP')}</p>
        </Modal>
      )}
    </Card>
  )
}

function SignOut() {
  const t = useT()
  const nav = useNavigate()
  const { logout } = useAuth()
  const [ask, setAsk] = useState(false)
  return (
    <div className="v2-set-foot">
      <span className="v2-muted v2-small">{t('shell.brand')}</span>
      <button type="button" className="v2-btn v2-btn-ghost" onClick={() => setAsk(true)}>{t('set.signOut')}</button>
      {ask && (
        <Modal title={t('set.signOutTitle')} onClose={() => setAsk(false)}
          footer={<><button type="button" className="v2-btn v2-btn-secondary" onClick={() => setAsk(false)}>{t('set.cancel')}</button>
            <button type="button" className="v2-btn v2-btn-primary" onClick={() => { logout(); nav('/login') }}>{t('set.signOut')}</button></>}>
          <p className="v2-sec">{t('set.signOutP')}</p>
        </Modal>
      )}
    </div>
  )
}
