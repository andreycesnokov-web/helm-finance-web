const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function current(request){if(!request.isCurrent())throw Error('invitation_actor_changed')}
export async function confirmedInvitation(request,code,{accept,read}){
 current(request);const response=await accept(request.token,code);current(request)
 if(response?.ok!==true||!UUID.test(response.business_id||''))throw Error('invitation_not_confirmed')
 const membership=await read(request.token,code);current(request)
 if(membership?.state!=='joined'||membership.business_id!==response.business_id)throw Error('invitation_not_confirmed')
 return membership
}
