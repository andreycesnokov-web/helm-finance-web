// Probe every extended column, including on an empty table. A transport/permission
// error is not evidence of an old schema and must fail the request, not fake success.
const cache = new WeakMap();
async function profileColumns(client, fields) {
  const hit = cache.get(client);
  if (hit && Date.now() - hit.at < 60000) return hit.value;
  const supported = [...fields], unsupported = [];
  while (supported.length) {
    const { error } = await client.from('tax_profiles').select(supported.join(',')).limit(0);
    if (!error) break;
    const m = /find the '([a-z_]+)' column|column (?:"?(?:tax_profiles\.)?)([a-z_]+)"? (?:of relation .* )?does not exist/i.exec(error.message || '');
    const field = m?.[1] || m?.[2];
    if (!field || !supported.includes(field)) throw new Error(error.message || 'profile_schema_unavailable');
    supported.splice(supported.indexOf(field), 1); unsupported.push(field);
  }
  const value = { supported, unsupported };
  cache.set(client, { at: Date.now(), value });
  return value;
}
module.exports = { profileColumns };
