// Sign-in, the personal account before a company exists, and joining by invitation — designs
// reg/R1 (sign in), R2 (check your email), R3 (account), R9 (invitation), R10 (errors).
// Rendered by App.jsx only when VITE_DESIGN_V2 and VITE_EMAIL_AUTH_ENABLED are both on. The
// Telegram widget, the upload link and the OAuth consent keep their logic and only get the v2 frame.
//
// Server routes (all existing): POST /api/auth/email/start · POST /api/auth/email/verify ·
// GET/PATCH /api/me/profile · GET /api/workspaces · GET /api/invite/:code · POST /api/invite/:code/accept.
// Writes go through lib/actions.js like every v2 screen.
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useTranslation } from '../../hooks/useTranslation'
import { consumePostLoginRedirect, setActiveBusinessId } from '../../lib/api'
import { financialActor } from '../../lib/financialRecovery'
import { confirmedInvitation } from '../lib/invitation'
import { accountBody, ownProfile, profileMatches, readAccountDraft, writeAccountDraft, clearAccountDraft, confirmedAccountProfile } from '../lib/accountProfile'
import I from '../icons'
import { useT, useLang } from '../i18n'
import UploadLink from '../../pages/UploadLink'
import OAuthConsent from '../../pages/OAuthConsent'
import TelegramLoginWidget from '../../components/TelegramLoginWidget'
import {
  startEmailSignIn, verifyEmailSignIn, updateMyProfile, acceptInvite,
  lookupInvite, readInviteMembership, readMyProfile, readWorkspaces,
} from '../lib/actions'
import '../v2.css'

const SYMBOL = '/brand/symbol_navy_transparent.svg'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const RESEND_SECONDS = 45
const INVITE_KEY = 'post_login_redirect'

function detectTimezone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }

/** Compact language switch: three short buttons, the current one pressed. */
export function LangSwitch() {
  const { lang, changeLang } = useTranslation()
  const t = useT()
  return (
    <div className="v2-seg v2-auth-lang" role="group" aria-label={t('auth.lang')}>
      {['ru', 'en', 'id'].map((l) => (
        <button key={l} type="button" className="v2-seg-btn" aria-pressed={lang === l} onClick={() => changeLang(l)}>{l.toUpperCase()}</button>
      ))}
    </div>
  )
}

function AuthFrame({ children, right, wide = false }) {
  const t = useT()
  return (
    <div className="v2-root v2-auth">
      <header className="v2-auth-top">
        <Link to="/login" className="v2-auth-brand"><img src={SYMBOL} alt="" aria-hidden="true" width="32" height="32" /><span className="v2-brand-name">{t('shell.brand')}</span></Link>
        <div className="v2-auth-top-right">{right}<LangSwitch /></div>
      </header>
      <main className={`v2-auth-main${wide ? ' is-wide' : ''}`} id="v2-main">{children}</main>
    </div>
  )
}

const errText = (t, e) => {
  const code = e?.data?.error || e?.code || ''
  if (code === 'rate_limited') return t('auth.err.rate')
  if (code === 'invalid_email') return t('auth.err.email')
  if (code === 'auth_temporarily_unavailable') return t('auth.err.down')
  if (e?.status === 404) return t('auth.err.off')
  return t('auth.err.generic')
}

/* ── R1 + R2: email → link sent ─────────────────────────────────────────── */
export function SignIn() {
  const t = useT()
  const nav = useNavigate()
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(null)        // { email, devLink }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [wait, setWait] = useState(0)
  const [showCode, setShowCode] = useState(false)
  useEffect(() => { if (user) nav('/account', { replace: true }) }, [user]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (wait <= 0) return undefined; const id = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(id) }, [wait])

  const send = async (e, again = false) => {
    e?.preventDefault?.()
    const em = (again ? sent.email : email).trim().toLowerCase()
    if (!EMAIL_RE.test(em)) { setErr(t('auth.err.email')); return }
    setBusy(true); setErr('')
    try {
      const r = await startEmailSignIn(em)
      setSent({ email: em, devLink: r?.magic_link || '', devCode: r?.dev_code || '' })
      setWait(RESEND_SECONDS)
    } catch (x) { setErr(errText(t, x)) } finally { setBusy(false) }
  }

  if (sent) {
    return (
      <AuthFrame>
        <section className="v2-auth-card" aria-labelledby="r2-title">
          <span className="v2-auth-icon" aria-hidden="true"><I.send size={22} /></span>
          <h1 id="r2-title" className="v2-auth-h1">{t('auth.r2.title')}</h1>
          <p className="v2-auth-p">{t('auth.r2.p', { email: sent.email })}</p>
          <button type="button" className="v2-btn v2-btn-secondary v2-btn-block" disabled={busy || wait > 0} onClick={(e) => send(e, true)}>
            {wait > 0 ? t('auth.r2.resendIn', { s: `0:${String(wait).padStart(2, '0')}` }) : t('auth.r2.resend')}
          </button>
          <button type="button" className="v2-btn-link" onClick={() => { setSent(null); setErr(''); setShowCode(false) }}>{t('auth.r2.other')}</button>
          {!showCode
            ? <button type="button" className="v2-btn-link v2-small" onClick={() => setShowCode(true)}>{t('auth.r2.codeInstead')}</button>
            : <CodeForm email={sent.email} />}
          {err && <p className="v2-inline-err" role="alert">{err}</p>}
          <p className="v2-muted v2-small">{t('auth.r2.spam')}</p>
          {(sent.devLink || sent.devCode) && (
            <div className="v2-banner v2-tone-warn"><span className="v2-banner-text">
              {t('auth.dev')} {sent.devLink && <a href={sent.devLink}>{t('auth.devLink')}</a>}{sent.devCode && <> · {t('auth.devCode')} <strong>{sent.devCode}</strong></>}
            </span></div>
          )}
        </section>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame wide>
      <div className="v2-auth-split">
        <section className="v2-auth-hero">
          <h1 className="v2-auth-hero-h">{t('auth.r1.hero')}</h1>
          <p className="v2-auth-hero-p">{t('auth.r1.heroP')}</p>
          <ul className="v2-auth-ticks">
            {['b1', 'b2', 'b3'].map((k) => <li key={k}><I.check size={18} />{t(`auth.r1.${k}`)}</li>)}
          </ul>
        </section>
        <section className="v2-auth-card" aria-labelledby="r1-title">
          <h2 id="r1-title" className="v2-auth-h1">{t('auth.r1.title')}</h2>
          <p className="v2-auth-p">{t('auth.r1.p')}</p>
          <form onSubmit={send} noValidate>
            <label className="v2-field"><span className="v2-field-label">{t('auth.email')}</span>
              <input className="v2-input" type="email" autoComplete="email" autoFocus value={email} placeholder="name@company.com"
                aria-invalid={!!err} aria-describedby={err ? 'r1-err' : undefined} onChange={(e) => { setEmail(e.target.value); setErr('') }} />
            </label>
            {err && <p id="r1-err" className="v2-inline-err" role="alert">{err}</p>}
            <button type="submit" className="v2-btn v2-btn-primary v2-btn-block" disabled={busy}>{busy ? t('auth.sending') : t('auth.r1.send')}</button>
          </form>
          <div className="v2-auth-or"><span>{t('auth.or')}</span></div>
          <Link to="/join" className="v2-btn v2-btn-secondary v2-btn-block">{t('auth.r1.invite')}</Link>
          <p className="v2-muted v2-small">{t('auth.r1.tg')} <Link to="/login/telegram">{t('auth.r1.tgLink')}</Link>. {t('auth.r1.terms')}</p>
        </section>
      </div>
    </AuthFrame>
  )
}

function CodeForm({ email }) {
  const t = useT()
  const nav = useNavigate()
  const { loginWithToken } = useAuth()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    if (!/^\d{6}$/.test(code)) { setErr(t('auth.err.code')); return }
    setBusy(true); setErr('')
    try {
      const r = await verifyEmailSignIn({ email, code })
      loginWithToken(r.token, r.user ? { id: r.user.id, firstName: r.user.display_name } : null)
      nav(consumePostLoginRedirect() || '/account', { replace: true })
    } catch (x) { setErr(String(x?.data?.error || '').includes('invalid_or_expired') ? t('auth.err.codeBad') : errText(t, x)) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="v2-auth-code">
      <label className="v2-field"><span className="v2-field-label">{t('auth.r2.code')}</span>
        <input className="v2-input v2-auth-code-in" inputMode="numeric" maxLength={6} autoFocus value={code}
          onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr('') }} />
      </label>
      {err && <p className="v2-inline-err" role="alert">{err}</p>}
      <button type="submit" className="v2-btn v2-btn-primary v2-btn-block" disabled={busy}>{t('auth.r2.verify')}</button>
    </form>
  )
}

/* ── The emailed link lands here ─────────────────────────────────────────── */
export function SignInCallback() {
  const t = useT()
  const nav = useNavigate()
  const { loginWithToken } = useAuth()
  const [state, setState] = useState('working')   // working | expired | failed
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const token = new URLSearchParams(window.location.search).get('token')
    if (!token) { setState('expired'); return }
    verifyEmailSignIn({ token })
      .then((r) => {
        loginWithToken(r.token, r.user ? { id: r.user.id, firstName: r.user.display_name } : null)
        nav(consumePostLoginRedirect() || '/account', { replace: true })
      })
      .catch((x) => setState(String(x?.data?.error || '').includes('invalid_or_expired') || x?.status === 400 ? 'expired' : 'failed'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AuthFrame>
      <section className="v2-auth-card" aria-live="polite">
        {state === 'working' && <><h1 className="v2-auth-h1">{t('auth.cb.working')}</h1><p className="v2-auth-p">{t('auth.cb.wait')}</p></>}
        {state !== 'working' && (
          <>
            <span className="v2-auth-icon is-warn" aria-hidden="true"><I.warn size={22} /></span>
            <h1 className="v2-auth-h1">{state === 'expired' ? t('auth.cb.expired') : t('auth.cb.failed')}</h1>
            <p className="v2-auth-p">{state === 'expired' ? t('auth.cb.expiredP') : t('auth.err.generic')}</p>
            <Link to="/login" className="v2-btn v2-btn-primary v2-btn-block">{t('auth.cb.again')}</Link>
          </>
        )}
      </section>
    </AuthFrame>
  )
}

/* ── R3: signed in, no company yet (or choose one) ───────────────────────── */
export function Account() {
  const t = useT()
  const nav = useNavigate()
  const { token, logout } = useAuth()
  const [prof, setProf] = useState(null)
  const [ws, setWs] = useState(null)
  const [name, setName] = useState('')
  const [tz, setTz] = useState(detectTimezone())
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [profileState,setProfileState]=useState('loading'),[workspaceState,setWorkspaceState]=useState('loading')
  const [reload,setReload]=useState(0),[pending,setPending]=useState(false)
  const mounted=useRef(true),currentToken=useRef(token),saving=useRef(false)
  currentToken.current=token
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  const actorRequest=()=>{const actor=financialActor(token);return{token,isCurrent:()=>{try{return mounted.current&&!!actor&&financialActor(currentToken.current)===actor&&financialActor(localStorage.getItem('hf_token'))===actor}catch{return false}}}}
  useEffect(() => {
    if (!token) { nav('/login', { replace: true }); return }
    let live=true;const request=actorRequest(),valid=()=>live&&request.isCurrent()
    setProf(null);setWs(null);setProfileState('loading');setWorkspaceState('loading');setMsg(null);setBusy(false);saving.current=false
    readMyProfile(token).then(r=>{
      if(!valid())return;const p=ownProfile(request,r),draft=readAccountDraft(request)
      setProf({...p,email:r.identity?.email_verified?r.identity.email:null});setProfileState('ready')
      if(draft?.pending&&profileMatches(p,accountBody(draft.display_name,draft.timezone))){clearAccountDraft(request);setPending(false);setName(p.display_name||'');setTz(p.timezone||detectTimezone());setMsg({tone:'good',text:t('auth.r3.saved')})}
      else {setName(draft?.display_name??p?.display_name??'');setTz(draft?.timezone??p?.timezone??detectTimezone());setPending(!!draft?.pending);if(draft?.pending)setMsg({tone:'warn',text:t('auth.r3.unconfirmed')})}
    }).catch(()=>{if(valid())setProfileState('error')})
    readWorkspaces(token).then(r=>{if(!valid())return;if(!Array.isArray(r?.business))throw Error('account_workspaces_invalid');setWs(r);setWorkspaceState('ready')}).catch(()=>{if(valid())setWorkspaceState('error')})
    return()=>{live=false}
  }, [token,reload]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!token) return null
  const companies = ws?.business || []
  const open = (b) => { setActiveBusinessId(b.id); try { localStorage.setItem('activeWorkspaceId', b.id); localStorage.setItem('last_active_workspace_id', b.id) } catch { /* private mode */ } window.location.assign('/business/pulse') }
  const edit=(field,value)=>{const request=actorRequest();if(!request.isCurrent()||profileState!=='ready'||busy)return
    const draft={display_name:field==='name'?value:name,timezone:field==='tz'?value:tz,pending:false}
    try{writeAccountDraft(request,draft);setMsg(null)}catch{setMsg({tone:'warn',text:t('auth.r3.draftError')})}
    setPending(false);if(field==='name')setName(value);else setTz(value)
  }
  const save=async e=>{
    e.preventDefault();const request=actorRequest();if(saving.current||pending||profileState!=='ready'||!request.isCurrent())return
    const body=accountBody(name,tz)
    try{writeAccountDraft(request,{...body,pending:true})}catch{setMsg({tone:'warn',text:t('auth.r3.draftError')});return}
    saving.current=true;setBusy(true);setPending(true);setMsg(null)
    try{const p=await confirmedAccountProfile(request,body,{write:updateMyProfile,read:readMyProfile});if(!request.isCurrent())return;clearAccountDraft(request);setProf(old=>({...p,email:old?.email}));setName(p.display_name);setTz(p.timezone);setPending(false);setMsg({tone:'good',text:t('auth.r3.saved')})}
    catch(x){if(request.isCurrent()){if(x?.status>=400&&x?.status<500){try{writeAccountDraft(request,{...body,pending:false});setPending(false);setMsg({tone:'warn',text:t('auth.err.generic')})}catch{setMsg({tone:'warn',text:t('auth.r3.draftError')})}}else setMsg({tone:'warn',text:t('auth.r3.unconfirmed')})}}
    finally{if(request.isCurrent()){saving.current=false;setBusy(false)}}
  }
  return (
    <AuthFrame wide right={<button type="button" className="v2-btn v2-btn-ghost" onClick={() => { logout(); nav('/login') }}>{t('auth.r3.logout')}</button>}>
      <h1 className="v2-auth-h1 v2-auth-h1-page">{t('auth.r3.hello')}</h1>
      {profileState==='ready'&&workspaceState==='ready'&&<p className="v2-auth-p">{companies.length ? t('auth.r3.pickP', { email: prof?.email || '' }) : t('auth.r3.p', { email: prof?.email || '' })}</p>}
      {(profileState==='loading'||workspaceState==='loading')&&<p role="status">{t('auth.r3.loading')}</p>}
      {(profileState==='error'||workspaceState==='error')&&<div className="v2-banner v2-tone-warn" role="alert"><span className="v2-banner-text">{t('auth.r3.loadError')}</span><button type="button" className="v2-btn v2-btn-secondary" onClick={()=>setReload(n=>n+1)}>{t('auth.r3.retry')}</button></div>}
      {companies.length > 0 && (
        <section className="v2-card v2-auth-list" aria-label={t('auth.r3.yours')}>
          <h2 className="v2-h2">{t('auth.r3.yours')}</h2>
          <ul className="v2-auth-cos">
            {companies.map((b) => (
              <li key={b.id} className="v2-auth-co">
                <span><strong>{b.name}</strong><span className="v2-muted v2-small v2-block">{t(`set.role.${b.role}`) !== `set.role.${b.role}` ? t(`set.role.${b.role}`) : b.role}{b.business_code ? ` · ${b.business_code}` : ''}</span></span>
                <button type="button" className="v2-btn v2-btn-primary" onClick={() => open(b)}>{t('auth.r3.open')}</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {workspaceState==='ready'&&<div className="v2-auth-choices">
        <Link to="/business/new" className="v2-auth-choice">
          <span className="v2-auth-choice-ic" aria-hidden="true"><I.plus size={22} /></span>
          <strong>{companies.length ? t('auth.r3.createAnother') : t('auth.r3.create')}</strong>
          <span className="v2-muted">{t('auth.r3.createP')}</span>
          <span className="v2-btn v2-btn-primary">{t('auth.r3.start')}</span>
        </Link>
        <Link to="/join" className="v2-auth-choice">
          <span className="v2-auth-choice-ic" aria-hidden="true"><I.link size={22} /></span>
          <strong>{t('auth.r3.invite')}</strong>
          <span className="v2-muted">{t('auth.r3.inviteP')}</span>
          <span className="v2-btn v2-btn-secondary">{t('auth.r3.enterCode')}</span>
        </Link>
      </div>}
      <form className="v2-card v2-auth-profile" onSubmit={save}>
        <h2 className="v2-h2">{t('auth.r3.profile')}</h2>
        <div className="v2-field-row">
          <label className="v2-field"><span className="v2-field-label">{t('auth.r3.name')}</span>
            <input className="v2-input" value={profileState==='ready'?name:''} disabled={profileState!=='ready'||busy} maxLength={80} onChange={(e) => edit('name',e.target.value)} /></label>
          <label className="v2-field"><span className="v2-field-label">{t('auth.r3.tz')}</span>
            <input className="v2-input" value={profileState==='ready'?tz:''} disabled={profileState!=='ready'||busy} maxLength={64} onChange={(e) => edit('tz',e.target.value)} />
            <span className="v2-muted v2-small">{t('auth.r3.tzAuto', { tz: detectTimezone() })}</span></label>
        </div>
        {msg && <div className={`v2-banner v2-tone-${msg.tone}`} role="status"><span className="v2-banner-text">{msg.text}</span></div>}
        {pending&&!busy&&<button type="button" className="v2-btn v2-btn-secondary" onClick={()=>setReload(n=>n+1)}>{t('auth.r3.retry')}</button>}
        <div className="v2-row-gap"><button type="submit" className="v2-btn v2-btn-primary" disabled={busy||pending||profileState!=='ready'}>{t('auth.r3.save')}</button>
          <span className="v2-muted v2-small">{t('auth.r3.tg')}</span></div>
      </form>
    </AuthFrame>
  )
}

/* ── R9: join by invitation (code or /invite/:code link) ─────────────────── */
export function Join() {
  const t = useT()
  const nav = useNavigate()
  const loc = useLocation()
  const params = useParams()
  const { token } = useAuth()
  const [code, setCode] = useState(params.code || new URLSearchParams(loc.search).get('code') || '')
  const [inv, setInv] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const lookupRevision=useRef(0),currentToken=useRef(token),mounted=useRef(true)
  currentToken.current=token
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;lookupRevision.current++}},[])
  const actorRequest=()=>{const actor=financialActor(token);return{token,isCurrent:()=>{try{return mounted.current&&!!actor&&financialActor(currentToken.current)===actor&&financialActor(localStorage.getItem('hf_token'))===actor}catch{return false}}}}
  const check = async (e, c = code) => {
    e?.preventDefault?.()
    const v = String(c || '').trim()
    if (!v) { setErr(t('auth.r9.empty')); return }
    const revision=++lookupRevision.current,identity=actorRequest(),isCurrent=()=>mounted.current&&lookupRevision.current===revision&&(!token||identity.isCurrent())
    setBusy(true); setErr(''); setInv(null)
    try {
      const preview=await lookupInvite(v);if(!isCurrent())return
      const membership=token?await readInviteMembership(token,v):null;if(!isCurrent())return
      setInv(membership?.state==='joined'?{...preview,role:membership.role,already_member:true}:preview)
    } catch (x) {
      if(!isCurrent())return
      if(x?.status===410&&token){try{const membership=await readInviteMembership(token,v);if(!isCurrent())return;if(membership?.state==='joined'){setInv({...membership,code:v.toUpperCase(),already_member:true});return}}catch{if(!isCurrent())return}}
      setErr(x?.status === 429 ? t('auth.err.rate') : t('auth.r9.bad'))
    } finally { if(isCurrent())setBusy(false) }
  }
  useEffect(() => { lookupRevision.current++;setInv(null);setBusy(false);if (params.code){setCode(params.code);check(null, params.code)} }, [params.code,token]) // eslint-disable-line react-hooks/exhaustive-deps
  const accept = async () => {
    if (!token) { try { localStorage.setItem(INVITE_KEY, `/invite/${inv.code}`) } catch { /* private mode */ } nav('/login'); return }
    const identity=actorRequest();if(busy||!identity.isCurrent())return
    setBusy(true); setErr('')
    try {
      const r=inv.already_member?await readInviteMembership(token,inv.code):await confirmedInvitation(identity,inv.code,{accept:acceptInvite,read:readInviteMembership})
      if(!identity.isCurrent())return
      if(r?.state!=='joined'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.business_id||''))throw Error('invitation_not_confirmed')
      setActiveBusinessId(r.business_id)
      try { localStorage.setItem('activeWorkspaceId', r.business_id); localStorage.setItem('last_active_workspace_id', r.business_id) } catch { /* private mode */ }
      window.location.assign('/business/pulse')
    } catch (x) { if(identity.isCurrent())setErr(x?.status === 410 ? t('auth.r9.bad') : t('auth.r9.unconfirmed')) } finally { if(identity.isCurrent())setBusy(false) }
  }
  const roleKey = inv?.role ? `set.role.${inv.role}` : ''
  return (
    <AuthFrame right={<Link to={token ? '/account' : '/login'} className="v2-btn v2-btn-ghost">{token ? t('auth.r9.backAcc') : t('auth.r9.back')}</Link>}>
      <section className="v2-auth-card" aria-labelledby="r9-title">
        <h1 id="r9-title" className="v2-auth-h1">{t('auth.r9.title')}</h1>
        <p className="v2-auth-p">{t('auth.r9.p')}</p>
        <form onSubmit={check} noValidate>
          <label className="v2-field"><span className="v2-field-label">{t('auth.r9.code')}</span>
            <input className="v2-input" value={code} autoFocus={!params.code} aria-invalid={!!err} onChange={(e) => { lookupRevision.current++;setCode(e.target.value);setInv(null);setBusy(false);setErr('') }} /></label>
          {err && <p className="v2-inline-err" role="alert">{err}</p>}
          {!inv && <button type="submit" className="v2-btn v2-btn-primary v2-btn-block" disabled={busy}>{t('auth.r9.check')}</button>}
        </form>
        {!token && !inv && <p className="v2-muted v2-small">{t('auth.r9.notIn')} <Link to="/login">{t('auth.r9.signIn')}</Link></p>}
        {inv && (
          <div className="v2-auth-invite" data-invite-preview>
            <span className="v2-pill v2-tone-good">{t(inv.already_member?'auth.r9.alreadyJoined':'auth.r9.ok')}</span>
            <strong className="v2-auth-invite-co">{inv.business_name || inv.label || '—'}</strong>
            <span>{t(inv.already_member?'auth.r9.currentRole':'auth.r9.role', { role: t(roleKey) !== roleKey ? t(roleKey) : inv.role })}</span>
            {t(`auth.r9.can.${inv.role}`) !== `auth.r9.can.${inv.role}` && <span className="v2-muted v2-small">{t(`auth.r9.can.${inv.role}`)}</span>}
            <div className="v2-row-gap">
              <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={accept}>{token ? t(inv.already_member?'auth.r9.openJoined':'auth.r9.accept') : t('auth.r9.signInToAccept')}</button>
              <button type="button" className="v2-btn v2-btn-ghost" onClick={() => { lookupRevision.current++;setInv(null);setCode('') }}>{t(inv.already_member?'auth.r9.otherCode':'auth.r9.decline')}</button>
            </div>
          </div>
        )}
      </section>
    </AuthFrame>
  )
}

// Pages reached from outside the app — the AI assistant upload link (/upload), the MCP OAuth
// consent (/oauth/consent) and the legacy Telegram sign-in (/login/telegram). Their logic is the
// existing one (pages/UploadLink, pages/OAuthConsent, components/TelegramLoginWidget); only the
// frame is v2, so no v2 user lands on the classic design.
function FramedPage({ children }) {
  return <AuthFrame><section className="v2-auth-card">{children}</section></AuthFrame>
}

// These two pages carry their own RU/EN copy; they follow the v2 language switch (ID falls back to EN).
function UploadPage() {
  const lang = useLang()
  return <FramedPage><UploadLink embedded language={lang} /></FramedPage>
}

function ConsentPage() {
  const lang = useLang()
  return <FramedPage><OAuthConsent embedded language={lang} /></FramedPage>
}

function TelegramSignIn() {
  const t = useT()
  return (
    <FramedPage>
      <h1 className="v2-auth-h1">{t('auth.r1.tgTitle')}</h1>
      <p className="v2-auth-p">{t('auth.r1.tgP')}</p>
      <TelegramLoginWidget />
      <Link to="/login" className="v2-btn v2-btn-secondary v2-btn-block">{t('auth.r1.tgBack')}</Link>
    </FramedPage>
  )
}

export default function AuthApp({ page }) {
  if (page === 'callback') return <SignInCallback />
  if (page === 'account') return <Account />
  if (page === 'join') return <Join />
  if (page === 'upload') return <UploadPage />
  if (page === 'consent') return <ConsentPage />
  if (page === 'telegram') return <TelegramSignIn />
  return <SignIn />
}
