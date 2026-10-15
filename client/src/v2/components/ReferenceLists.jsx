import { useState } from 'react'
import { Card, Btn, Skeleton, ErrorBox, Empty } from '../ui'
import { useApi, useInvalidate } from '../data'
import { useBusinessRequest } from '../lib/useBusinessRequest'
import { useT } from '../i18n'
import Modal from './Modal'
import { createDirection, updateDirection, archiveDirection, createActivityType, updateActivityType, archiveActivityType } from '../lib/actions'
import { unsavedFields } from '../lib/savedFields'
const CONFIG = {
  directions: { path: '/business-directions', one: 'direction', many: 'directions', create: createDirection, update: updateDirection, archive: archiveDirection },
  activities: { path: '/activity-types', one: 'activityType', many: 'activityTypes', create: createActivityType, update: updateActivityType, archive: archiveActivityType },
}
export default function ReferenceLists({ kind }) {
  const spec=CONFIG[kind],t=useT(),request=useBusinessRequest(),invalidate=useInvalidate()
  const [archived,setArchived]=useState(false),[name,setName]=useState(''),[dialog,setDialog]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(null)
  const [editName,setEditName]=useState('')
  const list=useApi(spec.path+(archived?'?archived=1':''))
  const canEdit=list.data?.can_edit===true
  const save=async(action,row=null)=>{
    setBusy(true);setMessage(null)
    const body=action==='archive'?{is_active:false}:action==='restore'?{is_active:true}:{name:(action==='rename'?editName:name).trim()}
    try{
      const result=await(action==='create'?spec.create(request,body):action==='archive'?spec.archive(request,row.id):spec.update(request,row.id,body)),saved=result?.[spec.one]
      if(!saved?.id || row&&String(saved.id)!==String(row.id) || unsavedFields(body,saved,result).length) throw new Error(t('refs.unconfirmed'))
      invalidate();setDialog(null);if(action==='create')setName('');setMessage({good:true,text:t('set.saved')})
    }catch(e){setMessage({good:false,text:t('set.notSaved',{msg:e?.data?.message||e?.message||t('set.err.generic')})})}
    finally{setBusy(false)}
  }
  return <Card title={t(`refs.${kind}`)} aside={<Btn onClick={()=>{setArchived(!archived);setName('');setDialog(null)}}>{t(archived?'set.books.hideArch':'set.books.showArch')}</Btn>}>
    {message&&<p className={message.good?'v2-sec':'v2-inline-err'} role="status">{message.text}</p>}
    {list.loading?<Skeleton rows={3}/>:list.error?<ErrorBox error={list.error} onRetry={list.reload}/>:<>
      {!list.data?.[spec.many]?.length?<Empty title={t('refs.empty')}/>:<ul className="v2-set-cats">{list.data[spec.many].map(row=><li key={row.id}><span>{row.name}{row.is_system?' · '+t('set.books.system'):''}</span>
        {canEdit&&!row.is_system&&<span className="v2-row-gap">{archived?<Btn disabled={busy} onClick={()=>save('restore',row)}>{t('set.books.restore')}</Btn>:<>
          <Btn disabled={busy} onClick={()=>{setEditName(row.name);setDialog({action:'rename',row})}}>{t('set.books.rename')}</Btn>
          <Btn disabled={busy} onClick={()=>setDialog({action:'archive',row})}>{t('set.books.archive')}</Btn>
        </>}</span>}</li>)}</ul>}
      {canEdit&&!archived&&<form className="v2-set-addrow" onSubmit={e=>{e.preventDefault();save('create')}}>
        <input className="v2-input" aria-label={t(`refs.new.${kind}`)} placeholder={t(`refs.new.${kind}`)} value={name} maxLength={120} disabled={busy||!!dialog} onChange={e=>setName(e.target.value)}/>
        <button type="submit" className="v2-btn v2-btn-secondary" disabled={busy||!!dialog||!name.trim()}>{t('set.books.add')}</button>
      </form>}
      <p className="v2-muted v2-small">{t('refs.history')}</p>
    </>}
    {dialog&&<Modal title={t(dialog.action==='archive'?'set.books.archiveTitle':'refs.rename',{name:dialog.row.name})} onClose={()=>setDialog(null)}
      footer={<><Btn onClick={()=>setDialog(null)} disabled={busy}>{t('set.cancel')}</Btn><Btn variant="primary" disabled={busy||dialog.action==='rename'&&!editName.trim()} onClick={()=>save(dialog.action,dialog.row)}>{t(dialog.action==='archive'?'set.books.archive':'set.save')}</Btn></>}>
      {dialog.action==='rename'?<label className="v2-field"><span className="v2-field-label">{t('set.books.name')}</span><input className="v2-input" value={editName} maxLength={120} onChange={e=>setEditName(e.target.value)}/></label>:<p>{t('refs.history')}</p>}
    </Modal>}
  </Card>
}
