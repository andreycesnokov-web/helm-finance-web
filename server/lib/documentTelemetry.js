'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');

const context = new AsyncLocalStorage();
const instrumented = new WeakSet();
const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
const count = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
const elapsed = start => Math.round((performance.now() - start) * 100) / 100;
const httpStatus = v => Number.isInteger(v) && v >= 100 && v <= 599 ? v : null;
const defaultLogger = event => console.info('[document-processing]', JSON.stringify(event));
const TARIFF_VERSION = 'anthropic-standard-2026-09-09-v1';
const TARIFF_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';
const PRICED_MODEL = 'claude-sonnet-4-5-20250929';
const modelId = v => typeof v === 'string' && /^claude-[a-z0-9-]{1,64}$/.test(v) ? v : null;
const STAGES = new Set(['file_lookup', 'download', 'pdf_text', 'field_parse', 'vision', 'dates_parties']);

function usageOf(response) {
  const u = response?.usage;
  return { input_tokens:count(u?.input_tokens), output_tokens:count(u?.output_tokens),
    cache_read_input_tokens:count(u?.cache_read_input_tokens),
    cache_creation_input_tokens:count(u?.cache_creation_input_tokens) };
}
function estimate(model, usage) {
  // No cache is requested by this path. Unexpected cache usage is not silently
  // priced as ordinary input; cache write TTL and billing tier would be needed.
  if (model !== PRICED_MODEL || usage.input_tokens === null || usage.output_tokens === null ||
      usage.input_tokens > 200000 ||
      (usage.cache_read_input_tokens || 0) > 0 || (usage.cache_creation_input_tokens || 0) > 0) return null;
  return (usage.input_tokens * 3 + usage.output_tokens * 15) / 1e6;
}
function emit(run, event) {
  if (!run) return;
  try { run.logger({ schema_version:1, run_id:run.id, business_id:run.businessId,
    document_id:run.documentId, ...event }); } catch { /* Logs cannot break document reading. */ }
}

function createRun(businessId, documentId, logger = defaultLogger) {
  const run = { id:randomUUID(), businessId:uuid(businessId), documentId:uuid(documentId), logger };
  return {
    async execute(fn) {
      const start = performance.now();
      emit(run, {event:'run_started'});
      return context.run({run}, async () => {
        let reason = 'read_exception';
        let source = null;
        let ocrReason = null;
        try {
          const result = await fn();
          source = ['embedded_text','filename_only','ocr_vision'].includes(result?.readSource) ? result.readSource : null;
          ocrReason = ['ocr_disabled','ocr_not_configured','empty_file','file_too_large_for_ocr',
            'unsupported_media_type_for_ocr','ocr_timeout','ocr_request_failed',
            'ocr_empty_response','ocr_unparseable_response'].includes(result?.ocr?.reason) ? result.ocr.reason : null;
          reason = ['file_not_found','document_unavailable'].includes(result?.error) ? result.error :
            result?.error ? 'read_failed' : result?.ocr && !result.ocr.ok ? 'read_completed_with_ocr_fallback' : 'read_completed';
          return result;
        } finally { emit(run,{event:'run_finished',duration_ms:elapsed(start),reason,read_source:source,ocr_reason:ocrReason}); }
      });
    },
    async stage(name, fn) {
      if (!STAGES.has(name)) throw new Error('Invalid document telemetry stage');
      const start = performance.now();
      let outcome = 'error';
      try { const r = await fn(); outcome = r?.error ? 'error' : 'completed'; return r; }
      finally { emit(run,{event:'stage_finished',stage:name,duration_ms:elapsed(start),outcome}); }
    },
  };
}

function instrumentClient(client) {
  if (typeof client?.fetch !== 'function') return false;
  if (instrumented.has(client)) return true;
  const fetch = client.fetch;
  // SDK 0.20.9 fetch is the actual transport, including internal retry attempts.
  // Outside a document model call this wrapper is a transparent pass-through.
  const wrapped = async function (...args) {
    const c = context.getStore();
    if (!c?.call) return fetch.apply(this,args);
    const number = ++c.call.attempts;
    const start = performance.now();
    let status = null;
    let outcome = 'transport_error';
    try { const response = await fetch.apply(this,args); status = httpStatus(response?.status);
      outcome = status !== null && status >= 400 ? 'http_error' : 'response_headers'; return response; }
    finally { emit(c.run,{event:'model_attempt',logical_call_id:c.call.id,attempt:number,
      duration_ms:elapsed(start),http_status:status,outcome,completed_after_logical_call:c.call.closed}); }
  };
  try { client.fetch = wrapped; } catch { return false; }
  if (client.fetch !== wrapped) return false;
  instrumented.add(client);
  return true;
}

async function modelCall(client, requestedModel, fn) {
  const parent = context.getStore();
  const call = {id:randomUUID(),attempts:0,closed:false};
  const observed = instrumentClient(client);
  const start = performance.now();
  let response = null;
  let reason = 'provider_error';
  let status = null;
  let timedOut = false;
  return context.run({run:parent?.run,call}, async () => {
    try { return await fn({
      response(value) { response = value; },
      result(value) { reason = ['success','empty_response','unparseable_response'].includes(value) ? value : 'provider_error'; },
      failure(error, timeout) { timedOut = timeout === true; reason = timedOut ? 'timeout' : 'provider_error'; status = httpStatus(error?.status); },
    }); }
    finally {
      call.closed = true;
      const usage = usageOf(response);
      const actual = modelId(response?.model);
      const cost = estimate(actual,usage);
      emit(parent?.run,{event:'model_call_finished',logical_call_id:call.id,logical_calls:1,
        provider:'anthropic',requested_model:modelId(requestedModel),actual_model:actual,
        attempts_observed:observed ? call.attempts : null,
        retries_observed:observed ? Math.max(0,call.attempts-1) : null,
        attempt_observation:observed ? 'sdk_fetch' : 'unavailable',
        duration_ms:elapsed(start),reason,http_status:status,abort_requested:timedOut,
        usage,usage_scope:response ? 'final_response_only' : 'unknown',
        estimated_final_response_cost_usd:cost,
        estimated_total_cost_usd:observed && call.attempts === 1 ? cost : null,
        retry_cost_usd:null,tariff_version:TARIFF_VERSION,tariff_source:TARIFF_SOURCE,
        cost_basis:'standard_no_cache_response_usage_not_invoice'});
    }
  });
}
module.exports = {createRun,modelCall,usageOf,estimate,TARIFF_VERSION};
