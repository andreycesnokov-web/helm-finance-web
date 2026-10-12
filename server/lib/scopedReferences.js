const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = [
  { path: '/api/business-directions', table: 'business_directions', one: 'direction', many: 'directions', code: 'slug' },
  { path: '/api/activity-types', table: 'activity_types', one: 'activityType', many: 'activityTypes', code: 'code' },
];
function referencePatch(body, create, code) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_reference_fields');
  const allowed = create ? ['name', code] : ['name', 'is_active'];
  if (Object.keys(body).some(k => !allowed.includes(k))) throw new Error('invalid_reference_fields');
  const patch = {};
  if (create || 'name' in body) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120) throw new Error('invalid_reference_name');
    patch.name = body.name.trim();
  }
  if (create && code in body && body[code] != null && body[code] !== '') {
    if (typeof body[code] !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(body[code])) throw new Error('invalid_reference_code');
    patch[code] = body[code];
  }
  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean') throw new Error('invalid_reference_state');
    patch.is_active = body.is_active;
  }
  if (!Object.keys(patch).length) throw new Error('nothing_to_update');
  return patch;
}

function registerScopedReferences(app, { auth, supabase, requireBusiness, canManageCategories, recordAudit }) {
  for (const spec of TYPES) {
    const failure = (res, e) => res.status(500).json({ error: 'reference_request_failed', message: 'Could not read or save the reference list.' });
    app.get(spec.path, auth, async (req, res) => {
      try {
        const biz = await requireBusiness(req, res); if (!biz) return;
        const { data, error } = await supabase.from(spec.table).select('*')
          .eq('business_id', biz.business.id).eq('is_active', req.query.archived !== '1')
          .order('sort_order', { ascending: true }).order('id', { ascending: true });
        if (error) throw error;
        res.json({ [spec.many]: data || [], can_edit: canManageCategories(biz.role) });
      } catch (e) { failure(res, e); }
    });
    app.post(spec.path, auth, async (req, res) => {
      try {
        const biz = await requireBusiness(req, res); if (!biz) return;
        if (!canManageCategories(biz.role)) return res.status(403).json({ error: 'reference_edit_forbidden' });
        let patch;try { patch = referencePatch(req.body, true, spec.code); } catch (e) { return res.status(400).json({ error: e.message }); }
        const { data, error } = await supabase.from(spec.table).insert({ ...patch,
          user_id: biz.ownerUserId, business_id: biz.business.id, is_system: false, is_active: true, source: 'user' }).select().single();
        if (error) throw error;
        await recordAudit({ businessId: biz.business.id, actorUserId: req.user.userId, actorRole: biz.role,
          entityType: spec.table, entityId: data.id, action: 'reference_created', after: data });
        res.json({ [spec.one]: data });
      } catch (e) { failure(res, e); }
    });
    const update = (archive) => async (req, res) => {
      try {
        const biz = await requireBusiness(req, res); if (!biz) return;
        if (!canManageCategories(biz.role)) return res.status(403).json({ error: 'reference_edit_forbidden' });
        if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'reference_not_found' });
        let patch;try { patch = archive ? { is_active: false } : referencePatch(req.body, false, spec.code); } catch (e) { return res.status(400).json({ error: e.message }); }
        const { data: before, error: readError } = await supabase.from(spec.table).select('*')
          .eq('id', req.params.id).eq('business_id', biz.business.id).eq('is_system', false).maybeSingle();
        if (readError) throw readError;
        if (!before) return res.status(404).json({ error: 'reference_not_found' });
        const { data, error } = await supabase.from(spec.table).update(patch)
          .eq('id', req.params.id).eq('business_id', biz.business.id).eq('is_system', false).select().maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'reference_not_found' });
        await recordAudit({ businessId: biz.business.id, actorUserId: req.user.userId, actorRole: biz.role,
          entityType: spec.table, entityId: data.id, action: archive ? 'reference_archived' : 'reference_updated', before, after: data });
        // Reference records are retained. No transaction/ledger row is rewritten.
        res.json({ [spec.one]: data });
      } catch (e) { failure(res, e); }
    };
    app.patch(spec.path + '/:id', auth, update(false));
    app.delete(spec.path + '/:id', auth, update(true));
  }
}
module.exports = { registerScopedReferences, referencePatch, TYPES };
