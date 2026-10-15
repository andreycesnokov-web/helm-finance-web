'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EXTENDED,profileValue,buildProfileProvenance}=require('../server/lib/profileProvenance');
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002',D='00000000-0000-4000-8000-000000000003',FILE='00000000-0000-4000-8000-000000000004';
const source={state:'extracted',document_id:D},document=()=>({id:D,business_id:A,archived_at:null,file_id:FILE,file:{id:FILE,business_id:A},extracted_json:{ai_profile:{v:1,fields:{company_legal_name:{value:'STAGE legal name'}}}}});
const request=(extra={})=>({businessId:A,actorUserId:-9,updates:{company_legal_name:'STAGE legal name'},metadata:{company_legal_name:source},loadDocument:async()=>document(),...extra});
test('source requires an own current Business document and an own available file',async()=>{
 const r=await buildProfileProvenance(request());assert.deepEqual(r.field_verification.company_legal_name,source);
 for(const override of [{business_id:B},{archived_at:'2026-10-12'},{file:null},{file:{id:FILE,business_id:B}},{id:FILE}])await assert.rejects(buildProfileProvenance(request({loadDocument:async()=>({...document(),...override})})),{code:'profile_source_unavailable'});
 await assert.rejects(buildProfileProvenance(request({loadDocument:async()=>null})),{code:'profile_source_unavailable'});
});
test('actor/business scope is supplied to the source reader; malformed/fake source never passes',async()=>{
 let context;await buildProfileProvenance(request({loadDocument:async c=>{context=c;return document()}}));assert.deepEqual(context,{documentId:D,businessId:A,actorUserId:-9});
 await assert.rejects(buildProfileProvenance(request({businessId:null})),{code:'profile_context_required'});
 for(const actorUserId of [Number.MAX_SAFE_INTEGER+1,'9223372036854775808','null'])await assert.rejects(buildProfileProvenance(request({actorUserId})),{code:'profile_context_required'});
 await assert.rejects(buildProfileProvenance(request({metadata:{company_legal_name:{state:'extracted',document_id:'fake'}}})),{code:'profile_source_unavailable'});
});
test('manual edits cannot retain an old AI/accountant label and do not invoke extraction',async()=>{
 let reads=0;const r=await buildProfileProvenance(request({before:{company_legal_name:'old',field_verification:{company_legal_name:'accountant_verified',kpp:'user_declared'}},updates:{company_legal_name:'manual'},metadata:{},loadDocument:async()=>{reads++}}));assert.equal(r.field_verification.company_legal_name,'user_declared');assert.equal(r.field_verification.kpp,'user_declared');assert.equal(reads,0);
 await assert.rejects(buildProfileProvenance(request({metadata:{company_legal_name:'accountant_verified'}})),{code:'profile_confirmation_required'});
});
test('extracted attribution requires genuine server cache and the exact suggested value',async()=>{
 await assert.rejects(buildProfileProvenance(request({updates:{company_legal_name:'manual other'}})),{code:'profile_extraction_value_mismatch'});
 await assert.rejects(buildProfileProvenance(request({loadDocument:async()=>({...document(),extracted_json:{}})})),{code:'profile_extraction_not_confirmed'});
 await assert.rejects(buildProfileProvenance(request({metadata:{company_legal_name:'extracted'}})),{code:'profile_document_required'});
 // This fixture is a UNIT cache, not a claim of live/external AI acceptance.
});
test('explicit conflict remains a conflict; a client cannot attach extra metadata or inject fields',async()=>{
 const r=await buildProfileProvenance(request({metadata:{company_legal_name:{state:'conflict',document_id:D}}}));assert.equal(r.field_verification.company_legal_name.state,'conflict');
 await assert.rejects(buildProfileProvenance(request({metadata:{company_legal_name:{...source,email:'must not persist'}}})),{code:'profile_invalid_provenance'});
 await assert.rejects(buildProfileProvenance(request({updates:{business_id:B}})),{code:'profile_invalid_field'});
});
test('all16 extended field types are declared; dates/counts/arrays do not silently coerce invalid data',()=>{
 assert.equal(EXTENDED.length,16);assert.equal(profileValue('employee_count','0'),0);assert.equal(profileValue('bpjs_registered','false'),false);assert.equal(profileValue('nib_issue_date','2024-02-29'),'2024-02-29');assert.deepEqual(profileValue('additional_kbli',['11111','22222']),['11111','22222']);
 for(const [field,value]of [['employee_count','2oops'],['employee_count',-1],['employee_count',2147483648],['nib_issue_date','2026-02-30'],['bpjs_registered','unknown'],['transaction_types',[{}]]])assert.throws(()=>profileValue(field,value),{code:'profile_invalid_value'});
});
