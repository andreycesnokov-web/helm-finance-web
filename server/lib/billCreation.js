'use strict';
// First bounded bill stage: creation only. This module is not installed until
// the native preview, source-backed callers and staging rollout gates pass.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields = new Set(['request_key','type','counterparty','amount','currency','due_date','description','scope']);
const invalid = code => { throw Object.assign(new Error(code), { code }); };
function amountIdentity(value) {
  if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) invalid('bill_invalid_amount');
  if (!['string','number'].includes(typeof value)) invalid('bill_invalid_amount');
  const text = String(value).trim();
  if (!/^\+?\d+(?:\.\d+)?$/.test(text)) invalid('bill_invalid_amount');
  let [integer, fraction=''] = text.replace(/^\+/, '').split('.');
  integer=integer.replace(/^0+(?=\d)/, '');fraction=fraction.replace(/0+$/, '');
  if (integer.length > 16 || fraction.length > 2 || integer==='0'&&!fraction) invalid('bill_invalid_amount');
  return integer + (fraction ? '.'+fraction : '');
}
function creationRequest(body={}) {
  if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!fields.has(k)) || !UUID.test(body.request_key||'')) invalid('bill_invalid_request');
  if (body.scope && body.scope !== 'business') invalid('bill_business_required');
  if (!['payable','receivable'].includes(body.type) || typeof body.counterparty!=='string' || !body.counterparty.trim()) invalid('bill_invalid_value');
  if (body.description != null && typeof body.description!=='string') invalid('bill_invalid_value');
  const currency=body.currency==null?'IDR':typeof body.currency==='string'?body.currency.trim().toUpperCase():'';
  if (!/^[A-Z]{3}$/.test(currency)) invalid('bill_invalid_value');
  const due=body.due_date||null;
  // Current web callers supply a calendar date. Other transport contracts must
  // be inspected separately rather than silently dropping their time/zone.
  if (due!==null && (typeof due!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(due) || due.startsWith('0000') || !Number.isFinite(Date.parse(due+'T00:00:00Z')) || new Date(due+'T00:00:00Z').toISOString().slice(0,10)!==due)) invalid('bill_invalid_value');
  return { request_key:body.request_key.toLowerCase(), payload:{type:body.type,counterparty:body.counterparty.trim(),amount:amountIdentity(body.amount),currency,due_date:due,description:body.description?.trim()||null,scope:'business'} };
}
module.exports={creationRequest,amountIdentity};
