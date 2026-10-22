'use strict';
// Offline combined tests: remove inherited paid-provider credentials. Local HTTP
// and injected synthetic transports still work; accidental external fetch fails.
for(const key of ['NANONETS_API_KEY','NANONETS_OCR_API_KEY','ANTHROPIC_API_KEY','OPENAI_API_KEY','RESEND_API_KEY','TELEGRAM_BOT_TOKEN'])delete process.env[key];
process.env.DOCUMENT_OCR_NANONETS_ENABLED='false';
process.env.DOCUMENT_OCR_VISION_ENABLED='false';
const original=globalThis.fetch;
globalThis.fetch=(input,init)=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('OFFLINE_RC_EXTERNAL_FETCH_BLOCKED');
 return original(input,init);
};
