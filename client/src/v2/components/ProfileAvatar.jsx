import { useEffect, useRef, useState } from 'react'
import { Btn } from '../ui'
import { useT } from '../i18n'
import { useBusinessRequest } from '../lib/useBusinessRequest'
import { readMyAvatar, uploadMyAvatar, updateMyProfile } from '../lib/actions'
const TYPES=['image/jpeg','image/png','image/webp','image/gif']
export default function ProfileAvatar({ profile, onUpdated, disabled=false }) {
  const t=useT(),request=useBusinessRequest(),input=useRef(null)
  const [preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(null)
  useEffect(()=>{
    let alive=true,url=null;const controller=new AbortController();setPreview(null);setError(null)
    if(profile?.avatar_url)readMyAvatar(request,controller.signal).then(blob=>{
      if(!alive)return;url=URL.createObjectURL(blob);setPreview(url)
    }).catch(e=>{if(alive&&e.name!=='AbortError')setError(t('avatar.readError'))})
    return()=>{alive=false;controller.abort();if(url)URL.revokeObjectURL(url)}
  },[profile?.avatar_url,request,t])
  const pick=async e=>{
    const file=e.target.files?.[0];e.target.value='';if(!file)return
    if(!TYPES.includes(file.type)||file.size>5*1024*1024){setError(t('avatar.limit'));return}
    setBusy(true);setError(null)
    try{
      const result=await uploadMyAvatar(request,file)
      if(result?.ok!==true||!result.avatar_url)throw new Error(t('refs.unconfirmed'))
      onUpdated()
    }catch(e){setError(e?.data?.message||e?.message||t('avatar.readError'))}
    finally{setBusy(false)}
  }
  const remove=async()=>{
    setBusy(true);setError(null)
    try{
      const result=await updateMyProfile(request,{avatar_url:''})
      if(result?.profile?.avatar_url!=='')throw new Error(t('refs.unconfirmed'))
      onUpdated();if(result.avatar_cleanup_pending)setError(t('avatar.cleanupPending'))
    }catch(e){setError(e?.data?.message||e?.message||t('avatar.readError'))}
    finally{setBusy(false)}
  }
  return <section className="v2-field" aria-label={t('avatar.title')}>
    <span className="v2-field-label">{t('avatar.title')}</span>
    <div className="v2-row-gap">
      {preview?<img src={preview} alt={t('avatar.title')} width="64" height="64" style={{borderRadius:'var(--radius-md)',objectFit:'cover'}}/>:
        <span className="v2-ava" aria-hidden="true">{String(profile?.display_name||'?').trim().slice(0,1).toUpperCase()}</span>}
      <input ref={input} type="file" accept={TYPES.join(',')} className="v2-sr" aria-label={t('avatar.upload')} disabled={disabled||busy} onChange={pick}/>
      <Btn disabled={disabled||busy} onClick={()=>input.current?.click()}>{t('avatar.upload')}</Btn>
      {profile?.avatar_url&&<Btn disabled={disabled||busy} onClick={remove}>{t('avatar.remove')}</Btn>}
    </div>
    <span className="v2-muted v2-small">{t('avatar.limit')}</span>
    {error&&<p className="v2-inline-err" role="alert">{error}</p>}
  </section>
}
