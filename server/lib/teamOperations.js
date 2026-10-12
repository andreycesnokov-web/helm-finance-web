'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function teamError(res,error){
 const message=error?.message||'';
 for(const [code,status]of [['invalid_team_change',400],['team_actor_required',401],['team_self_protected',400],['team_owner_protected',403],['team_forbidden',403],['team_business_required',403],['team_member_not_found',404],['team_invite_not_found',404],['team_invite_unavailable',410]])if(message.includes(code))return res.status(status).json({error:code});
 if(['PGRST202','42883','42703','42P01'].includes(error?.code))return res.status(503).json({error:'team_schema_unavailable',outcome:'rolled_back'});
 return res.status(503).json({error:'team_outcome_unknown',outcome:'unknown',automatic_retry:false});
}
function registerTeamOperations(app,{auth,supabase,requireBusiness}){
 app.get('/api/invite/:code/membership',auth,async(req,res)=>{
  res.set({'Cache-Control':'private, no-store',Vary:'Authorization'});
  const code=String(req.params.code||'').trim().toUpperCase();if(!/^[A-Z0-9]{4,32}$/.test(code))return res.status(400).json({error:'invalid_invite_code'});
  try{
   const{data:invite,error:inviteError}=await supabase.from('business_invites').select('business_id').eq('code',code).maybeSingle();if(inviteError)return teamError(res,inviteError);
   if(!invite)return res.json({state:'not_joined'});
   const{data:business,error:businessError}=await supabase.from('businesses').select('id,name,type,owner_user_id').eq('id',invite.business_id).maybeSingle();if(businessError)return teamError(res,businessError);
   if(!business||business.type!=='business')return res.json({state:'not_joined'});
   const{data:member,error:memberError}=await supabase.from('business_members').select('role').eq('business_id',business.id).eq('user_id',req.user.userId).eq('status','active').maybeSingle();if(memberError)return teamError(res,memberError);
   const role=String(business.owner_user_id)===String(req.user.userId)?'owner':member?.role;
   return res.json(role?{state:'joined',business_id:business.id,business_name:business.name,role}:{state:'not_joined'});
  }catch(e){teamError(res,e)}
 });
 app.post('/api/invite/:code/accept',auth,async(req,res)=>{
  res.set({'Cache-Control':'private, no-store',Vary:'Authorization'});
  const code=String(req.params.code||'').trim().toUpperCase();if(!/^[A-Z0-9]{4,32}$/.test(code))return res.status(400).json({error:'invalid_invite_code'});
  try{const{data,error}=await supabase.rpc('rpc_accept_business_invite',{p_actor:req.user.userId,p_code:code});if(error)return teamError(res,error);
   if(!data?.ok||!UUID.test(data.business_id||''))return teamError(res,{});return res.json(data);
  }catch(e){teamError(res,e)}
 });
 const change=method=>async(req,res)=>{
  try{const biz=await requireBusiness(req,res);if(!biz)return;
   if(!UUID.test(req.params.memberId||''))return res.status(400).json({error:'invalid_team_member'});
   const patch=method==='delete'?{status:'removed'}:req.body;
   const memberId=req.params.memberId.toLowerCase();
   const{data,error}=await supabase.rpc('rpc_change_business_member',{p_actor:req.user.userId,p_business:biz.business.id,p_member:memberId,p_patch:patch});if(error)return teamError(res,error);
   if(!data?.id||data.id!==memberId||data.business_id!==biz.business.id)return teamError(res,{});
   if(method==='delete'?data.status!=='removed':Object.entries(patch||{}).some(([key,value])=>['role','status'].includes(key)&&data[key]!==value))return teamError(res,{});
   return res.json(method==='delete'?{ok:true}:data);
  }catch(e){teamError(res,e)}
 };
 app.patch('/api/team/members/:memberId',auth,change('patch'));
 app.delete('/api/team/members/:memberId',auth,change('delete'));
}
module.exports={registerTeamOperations,teamError};
