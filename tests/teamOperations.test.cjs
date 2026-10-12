const {test}=require('node:test'),assert=require('node:assert/strict'),{registerTeamOperations}=require('../server/lib/teamOperations');
const business='00000000-0000-4000-8000-000000000001',member='00000000-0000-4000-8000-000000000002';
function fixture(rpc){const routes=new Map(),app=Object.fromEntries(['get','post','patch','delete'].map(method=>[method,(path,...handlers)=>routes.set(method+path,handlers.at(-1))]));registerTeamOperations(app,{auth(){},supabase:{rpc},requireBusiness:async()=>({business:{id:business},role:'admin'})});const res={code:200,body:null,status(n){this.code=n;return this},set(){return this},json(x){this.body=x;return this}};return{routes,res}}
test('membership RPC receives actual signed actor and active Business, not forged body identity',async()=>{
 let actual;const{routes,res}=fixture(async(name,args)=>{actual={name,args};return{data:{id:member,business_id:business,role:'employee'}}});
 await routes.get('patch/api/team/members/:memberId')({user:{userId:-9},params:{memberId:member},body:{role:'employee',p_actor:7,business_id:'foreign'}},res);
 assert.equal(actual.args.p_actor,-9);assert.equal(actual.args.p_business,business);assert.equal(actual.name,'rpc_change_business_member');assert.equal(res.code,200)
})
test('missing team schema fails closed; unknown RPC response never becomes successful membership',async()=>{
 for(const error of [{code:'PGRST202'},{message:'network response lost'}]){const{routes,res}=fixture(async()=>({error}));await routes.get('post/api/invite/:code/accept')({user:{userId:-9},params:{code:'TEST1234'}},res);assert.equal(res.code,503);assert.equal(res.body.outcome,error.code?'rolled_back':'unknown')}
 const{routes,res}=fixture(async()=>({data:{ok:true}}));await routes.get('post/api/invite/:code/accept')({user:{userId:-9},params:{code:'TEST1234'}},res);assert.equal(res.code,503)
})
test('invite replay preserves actual authorized company and business errors reach HTTP status',async()=>{
 const{routes,res}=fixture(async()=>({data:{ok:true,already_member:true,business_id:business,role:'employee'}}));await routes.get('post/api/invite/:code/accept')({user:{userId:-9},params:{code:'test1234'}},res);assert.equal(res.body.business_id,business);assert.equal(res.body.already_member,true)
 for(const [message,status]of [['team_forbidden',403],['invalid_team_change',400],['team_invite_unavailable',410],['team_member_not_found',404]]){const f=fixture(async()=>({error:{message}}));await f.routes.get('patch/api/team/members/:memberId')({user:{userId:-9},params:{memberId:member},body:{role:'employee'}},f.res);assert.equal(f.res.code,status)}
})
