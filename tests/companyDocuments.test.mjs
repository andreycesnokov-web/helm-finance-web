import test from 'node:test'
import assert from 'node:assert/strict'
import {confirmedCompanyType,confirmCompanyDocument} from '../client/src/v2/lib/companyDocuments.js'
const doc=(status,type='nib',confidence='high')=>({id:'doc-A',extracted_json:{ai_intake:{doc_type:type,classification_status:status,confidence}}})
const request={isCurrent:()=>true}
test('document checklist excludes unconfirmed proposals, archived documents and filename-only derived hints',()=>{
 assert.equal(confirmedCompanyType(doc('manually_confirmed')),'nib')
 for(const value of [doc('needs_review'),doc('auto_classified'),doc('auto_classified','nib','medium'),{...doc('manually_confirmed'),archived_at:'2026-10-12'},doc('manually_confirmed','bank_statement'),{id:'A',document_type:'nib'},{...doc('manually_confirmed'),document_type:'vendor_invoice'}])assert.equal(confirmedCompanyType(value),null)
})
test('failed confirmation cannot become completed classification or a checklist tick',async()=>{
 let reads=0
 await assert.rejects(confirmCompanyDocument(request,'doc-A','nib',{confirm:async()=>{throw Error('actual operation refusal')},read:async()=>{reads++;return{document:doc('manually_confirmed')}}}),/actual operation refusal/);assert.equal(reads,0)
 await assert.rejects(confirmCompanyDocument(request,'doc-A','nib',{confirm:async()=>({ok:true,id:'doc-A',doc_type:'nib',classification_status:'manually_confirmed'}),read:async()=>({document:doc('needs_review')})}),/classification_not_confirmed/)
})
test('actual acknowledgement and scoped readback must agree; a switch refuses late result',async()=>{
 const confirm=async()=>({ok:true,id:'doc-A',doc_type:'nib',classification_status:'manually_confirmed'}),read=async()=>({document:doc('manually_confirmed')})
 assert.equal((await confirmCompanyDocument(request,'doc-A','nib',{confirm,read})).id,'doc-A')
 await assert.rejects(confirmCompanyDocument({isCurrent:()=>false},'doc-A','nib',{confirm,read}),/workspace_changed/)
})
