import { VAULT_TYPES, isConfirmedCompanyDoc } from '../../pages/business/companyVault.js'
export const COMPANY_DOCUMENT_TYPES = VAULT_TYPES
export function documentReadingUnavailable(identify){return !identify||typeof identify.unavailable_reason==='string'&&identify.unavailable_reason.length>0}
// A proposal or filename hint is not proof that the document was read by AI.
// Only a persisted human classification accepted by the existing Company Vault can
// fill a company-document slot. Extraction/profile suggestions are separate.
export function confirmedCompanyType(doc) {
 const intake=doc?.extracted_json?.ai_intake
 if(!doc?.id||doc.archived_at||!COMPANY_DOCUMENT_TYPES.includes(intake?.doc_type))return null
 return isConfirmedCompanyDoc(doc)?intake.doc_type:null
}
export async function confirmCompanyDocument(request,id,type,{confirm,read}) {
 if(!COMPANY_DOCUMENT_TYPES.includes(type))throw new Error('invalid_company_document_type')
 if(!request.isCurrent())throw new Error('workspace_changed')
 const result=await confirm(request,id,type)
 if(!request.isCurrent())throw new Error('workspace_changed')
 if(result?.ok!==true||result.id!==id||result.doc_type!==type||result.classification_status!=='manually_confirmed')throw new Error('classification_not_confirmed')
 const actual=await read(request,id)
 if(!request.isCurrent())throw new Error('workspace_changed')
 if(actual?.document?.id!==id||confirmedCompanyType(actual.document)!==type)throw new Error('classification_not_confirmed')
 return actual.document
}
