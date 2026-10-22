'use strict';
// Test-only bootstrap using the previously admitted transport guard. The product
// backend, auth and API responses are unchanged. Docker networks have no egress.
const guard=require('/infra/approved-entry.cjs'),fs=require('fs');
guard.validateEnvironment(process.env);
if(fs.existsSync('/candidate/.env'))throw Error('Candidate env file forbidden');
if(process.env.DOCUMENT_OCR_NANONETS_ENABLED!=='false'||process.env.DOCUMENT_OCR_VISION_ENABLED!=='false'||process.env.MCP_ALLOW_UNAUTHENTICATED==='true'||process.env.MCP_DEV_TOKEN)throw Error('Unsafe native test flags');
globalThis.fetch=guard.createStageFetch(globalThis.fetch);
const redact=s=>{for(const k of ['JWT_SECRET','CFO_PLATFORM_JWT_SECRET','TELEGRAM_WEBHOOK_SECRET','SUPABASE_SECRET_KEY'])if(process.env[k])s=s.split(process.env[k]).join('[REDACTED]');return s.replace(/eyJ[A-Za-z0-9_.-]+/g,'[JWT REDACTED]').replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]');};
for(const method of ['log','warn','error']){const fn=console[method];console[method]=(...args)=>{const s=require('util').format(...args);if(s.includes('[email-auth][dev] magic link'))return;fn(redact(s));};}
process.chdir('/candidate');require('/candidate/server/index.js');
