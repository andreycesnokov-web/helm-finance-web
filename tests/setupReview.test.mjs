import test from 'node:test'
import assert from 'node:assert/strict'
import {readReviewDraft,saveReviewDraft,clearReviewDraft,reviewCountry,reviewBody} from '../client/src/v2/lib/setupReview.js'
const token=id=>'x.'+Buffer.from(JSON.stringify({userId:id})).toString('base64url')+'.x'
const A={token:token(-9),businessId:'00000000-0000-4000-8000-000000000001',isCurrent:()=>true},B={...A,businessId:'00000000-0000-4000-8000-000000000002'}
const memory=new Map();global.localStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)}
test('review draft reload is actor/company isolated and stores only explicit bounded fields/answers',()=>{
 saveReviewDraft(A,{fields:{company_legal_name:'Fictional',npwp:'TEST',token:'secret',raw_document:'no'},answers:{employee_status:'no_employees',fy:'jan',pkp_status:'invalid'}})
 assert.deepEqual(readReviewDraft(A),{fields:{company_legal_name:'Fictional',npwp:'TEST'},answers:{employee_status:'no_employees',fy:'jan'}})
 assert.deepEqual(readReviewDraft(B),{fields:{},answers:{}});assert.deepEqual(readReviewDraft({...A,token:token(-10)}),{fields:{},answers:{}})
 assert(![...memory.values()].join('').includes('secret'));clearReviewDraft(A);assert.deepEqual(readReviewDraft(A),{fields:{},answers:{}})
})
test('stale workspace or changed signed-in actor cannot write another draft',()=>{
 assert.throws(()=>saveReviewDraft({...A,isCurrent:()=>false},{fields:{}}),/workspace_changed/)
 memory.set('hf_token',token(-10));assert.throws(()=>saveReviewDraft(A,{fields:{}}),/workspace_changed/);memory.delete('hf_token')
})
test('review reload retains the original version and bounded baseline, not a newer server version',()=>{
 saveReviewDraft(A,{fields:{brand_name:'ignored',company_legal_name:'draft'},answers:{fy:'other'},expected_version:'7',before:{company_legal_name:'old',financial_year_start:'2025-07-01',token:'secret',profile_version:99}})
 const d=readReviewDraft(A);assert.equal(d.expected_version,'7');assert.equal(d.before.financial_year_start,'2025-07-01');assert.equal(d.before.company_legal_name,'old');assert(!Object.hasOwn(d.before,'token'));assert(!Object.hasOwn(d.before,'profile_version'));assert(!Object.hasOwn(d.fields,'brand_name'));clearReviewDraft(A)
})
test('Singapore and unspecified countries never inherit Indonesian identifiers, PKP or tax regime',()=>{
 const country=reviewCountry({country:'Singapore'},null);assert.equal(country.jurisdiction,'SG');assert.equal(country.isID,false)
 const body=reviewBody({country,vals:{npwp:{value:'TEST',user:true},company_legal_name:{value:'Fictional',user:true}},answers:{employee_status:'no_employees',pkp_status:'non_pkp',tax_regime:'pph_final_umkm',fy:'jan'},year:2026})
 assert.equal(body.jurisdiction,'SG');assert.equal(body.country,'Singapore');for(const k of ['npwp','pkp_status','vat_status','tax_regime','business_activity_codes'])assert(!Object.hasOwn(body,k))
 assert.throws(()=>reviewBody({country:reviewCountry({country:'Other'},null)}),/review_country_required/)
 assert.throws(()=>reviewBody({country:reviewCountry({country:'Singapore'},{jurisdiction:'ID'})}),/review_country_required/)
})
test('existing financial year preserved unless explicitly changed; identifier suggestions retain source',()=>{
 const body=reviewBody({country:reviewCountry({country:'Indonesia'},null),vals:{nib:{value:'TEST',sources:[{document_id:'actual-owned-doc'}]}},answers:{pkp_status:'non_pkp',employee_status:'no_employees',fy:'jan'},profile:{financial_year_start:'2025-07-01'}})
 assert(!Object.hasOwn(body,'financial_year_start'));assert.deepEqual(body.field_verification.nib,{state:'extracted',document_id:'actual-owned-doc'});assert.equal(body.vat_status,null)
})
