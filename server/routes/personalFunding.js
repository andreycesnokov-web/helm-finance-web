// Personal Workspaces, Relationships, FX quotes, Wallet transfers & Funding Bridge.
// Backend V1. All money/rate fields are decimal STRINGS. Every mutation that touches
// the ledger goes through the atomic RPCs from migration 039 — this layer only does
// access control, validation, privacy shaping and provider selection.
//
// Mounted from server/index.js with injected deps so it shares the same auth,
// service-role supabase client and access helpers.
const express = require('express');
const fx = require('../lib/fxProvider');
const WA = require('../lib/workspaceAccess');

module.exports = function personalFundingRouter({ supabase, auth, getBusinessAccess, resolveUserDisplayName, TX }) {
  const router = express.Router();
  const channel = 'web';
  // money/rate values are returned as canonical decimal STRINGS (trailing zeros
  // trimmed) so precision is preserved without float coercion.
  const s = (v) => {
    if (v === null || v === undefined) return null;
    let str = String(v);
    if (str.includes('.')) str = str.replace(/0+$/, '').replace(/\.$/, '');
    return str;
  };
  const rpc = (fn, args) => supabase.rpc(fn, args);

  // CRITICAL: PostgREST serializes NUMERIC as JSON numbers; supabase-js then parses
  // them as JS doubles, silently truncating values beyond ~17 significant digits
  // (e.g. 0.123456789012345678 → 0.12345678901234568). We therefore read every
  // money/rate column as ::text so 18-decimal precision survives DB→HTTP intact, and
  // re-read rows after a mutating RPC (whose composite return is parsed lossily).
  const Q_SEL = 'id,provider,base_asset,quote_asset,rate::text,inverse_rate::text,bid::text,ask::text,market_timestamp,retrieved_at,valid_until,status,source_type,manual_reason,created_at';
  const FT_SEL = 'id,relationship_id,funding_type,status,repayable,source_workspace_id,source_wallet_id,target_business_id,target_wallet_id,source_asset,source_principal_amount::text,source_total_debit::text,target_asset,target_amount::text,fee_amount::text,fee_asset,network_fee_amount::text,booked_rate::text,reporting_currency,reporting_amount::text,contributor_user_id,fx_quote_id';
  const FR_SEL = 'id,funding_transfer_id,repayment_amount_native::text,repayment_asset,principal_reduction_amount::text,principal_asset,booked_rate::text,reporting_amount::text,status';
  const PFB_SEL = 'target_business_id,contributor_user_id,principal_asset,loans_principal::text,loans_repaid_principal::text,outstanding_principal_native::text,capital_contributed::text,loans_reporting_value::text';
  const rereadOne = async (table, id, sel) => { const { data } = await supabase.from(table).select(sel).eq('id', id).limit(1); return data?.[0] || null; };
  const rereadQuote = (id) => rereadOne('exchange_rate_quotes', id, Q_SEL);
  const rereadFunding = (id) => rereadOne('funding_transfers', id, FT_SEL);
  const rpcErr = (res, error) => {
    const m = error.message || 'error';
    if (/not active|not pending|relationship|revoked|not repayable/i.test(m)) return res.status(409).json({ error: m });
    if (/over-repayment|requires a quote|refresh_quote_required|mismatch|must |cannot |expired|positive|not in workspace|wallet asset|amounts must match/i.test(m)) return res.status(400).json({ error: m });
    if (/not found/i.test(m)) return res.status(404).json({ error: m });
    return res.status(500).json({ error: m });
  };

  // Two EXPLICIT entitlement keys — never derived from a Business plan. A founder/
  // enterprise Business subscription does NOT auto-unlock Personal features, and the
  // Personal-workspace key does NOT auto-unlock the Funding Bridge.
  //
  // personal_finance_workspace — create/use Personal Workspaces. Per-user: the add-on
  //   is attached to one of the user's workspaces (the billing entity). Resolved over
  //   the user's explicit memberships (no .limit(1) arbitrary pick of a single row).
  async function hasPersonalWorkspaceEntitlement(userId) {
    const memberships = await WA.listAccessibleWorkspaces(supabase, userId);
    const ids = memberships.map(m => m.business_id);
    if (!ids.length) return false;
    const { data } = await supabase.from('business_addons')
      .select('business_id').eq('addon', 'personal_finance_workspace').eq('status', 'active')
      .in('business_id', ids);
    return !!data?.length;
  }
  // personal_investor_funding — use the Funding Bridge. Resolved on the SPECIFIC
  //   personal workspace doing the funding (explicit workspace id), never on a Business.
  async function hasFundingEntitlement(personalWorkspaceId) {
    const { data } = await supabase.from('business_addons')
      .select('business_id').eq('business_id', personalWorkspaceId)
      .eq('addon', 'personal_investor_funding').eq('status', 'active').limit(1);
    return !!data?.length;
  }

  // ════════════════════════════ STAGE 1 — WORKSPACES ════════════════════════
  // GET /api/workspaces — all accessible workspaces grouped. NEVER returns balances.
  router.get('/workspaces', auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const memberships = await WA.listAccessibleWorkspaces(supabase, userId);
      const { data: prefs } = await supabase.from('user_workspace_preferences')
        .select('*').eq('user_id', userId).limit(1);
      const pref = prefs?.[0] || {};
      const shape = (m) => {
        const b = m.businesses;
        return {
          id: b.id, business_code: b.business_code || null, name: b.name, type: b.type || 'business',
          role: m.role, plan: b.plan || 'free',
          is_primary: String(pref.primary_personal_workspace_id || '') === String(b.id),
          is_default: String(pref.default_business_workspace_id || '') === String(b.id),
          is_last_active: String(pref.last_active_workspace_id || '') === String(b.id),
        };
      };
      const personal = memberships.filter(m => m.businesses.type === 'personal').map(shape);
      const business = memberships.filter(m => m.businesses.type !== 'personal').map(shape);
      res.json({ personal, business });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // POST /api/personal-workspaces — create a personal workspace (entitlement-gated).
  router.post('/personal-workspaces', auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      if (!await hasPersonalWorkspaceEntitlement(userId)) {
        return res.status(403).json({ error: 'Personal Finance Workspace is not enabled for your account', upgrade_required: true });
      }
      const name = (req.body?.name || '').toString().trim() || 'Personal';
      const currency = (req.body?.base_currency || 'IDR').toString().trim().toUpperCase();
      const { data: business, error } = await supabase.from('businesses').insert({
        owner_user_id: userId, name, type: 'personal', base_currency: currency, plan: 'free',
      }).select().single();
      if (error) return res.status(500).json({ error: error.message });
      // exactly one owner membership; owner-only privacy enforced by the 037 trigger.
      const { error: mErr } = await supabase.from('business_members').insert({
        business_id: business.id, user_id: userId, role: 'owner', status: 'active',
      });
      if (mErr) return res.status(500).json({ error: mErr.message });
      res.status(201).json({ id: business.id, name: business.name, type: 'personal', base_currency: business.base_currency });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // GET /api/personal-workspaces/:id — owner-only details (no balances leaked here).
  router.get('/personal-workspaces/:id', auth, async (req, res) => {
    try {
      const ws = await WA.resolvePersonalWorkspaceOwner(supabase, req.user.userId, req.params.id);
      res.json({ id: ws.id, name: ws.name, type: ws.type, base_currency: ws.base_currency, plan: ws.plan || 'free' });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // PATCH /api/workspace-preferences — validated upsert of user_workspace_preferences.
  router.patch('/workspace-preferences', auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const body = req.body || {};
      const patch = {};
      if (body.primary_personal_workspace_id !== undefined) {
        const id = body.primary_personal_workspace_id;
        if (id !== null) {
          const ws = await WA.resolvePersonalWorkspaceOwner(supabase, userId, id).catch(() => null);
          if (!ws) return res.status(400).json({ error: 'primary personal workspace must be your personal workspace' });
        }
        patch.primary_personal_workspace_id = id;
      }
      if (body.default_business_workspace_id !== undefined) {
        const id = body.default_business_workspace_id;
        if (id !== null) {
          const r = await WA.resolveActiveWorkspace(supabase, userId, id);
          if (!r || r.workspace.type !== 'business') return res.status(400).json({ error: 'default business must be an accessible business workspace' });
        }
        patch.default_business_workspace_id = id;
      }
      if (body.last_active_workspace_id !== undefined) {
        const id = body.last_active_workspace_id;
        if (id !== null) {
          const r = await WA.resolveActiveWorkspace(supabase, userId, id);
          if (!r) return res.status(400).json({ error: 'last active workspace not accessible' });
        }
        patch.last_active_workspace_id = id;
      }
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'nothing to update' });
      patch.user_id = userId; patch.updated_at = new Date().toISOString();
      const { data, error } = await supabase.from('user_workspace_preferences')
        .upsert(patch, { onConflict: 'user_id' }).select().single();
      if (error) return res.status(400).json({ error: error.message });
      res.json(data);
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ════════════════════════ STAGE 2 — RELATIONSHIPS ═════════════════════════
  // POST /api/personal-business-connections — caller owns the personal workspace.
  router.post('/personal-business-connections', auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const { personal_workspace_id, business_id, roles } = req.body || {};
      await WA.resolvePersonalWorkspaceOwner(supabase, userId, personal_workspace_id);
      const { data: bz } = await supabase.from('businesses').select('id,type').eq('id', business_id).limit(1);
      if (!bz?.length || bz[0].type !== 'business') return res.status(400).json({ error: 'target must be a business workspace' });
      const { data, error } = await rpc('rpc_request_personal_business_connection',
        { p_personal: personal_workspace_id, p_business: business_id, p_actor: userId, p_channel: channel });
      if (error) return rpcErr(res, error);
      const rel = Array.isArray(data) ? data[0] : data;
      // normalized role rows (optional at request time)
      if (Array.isArray(roles) && roles.length) {
        const rows = [...new Set(roles)].map(role => ({ relationship_id: rel.id, role }));
        await supabase.from('personal_business_relationship_roles').upsert(rows, { onConflict: 'relationship_id,role' });
      }
      res.status(201).json(rel);
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // Confirm/reject must be authorized on the BUSINESS side of the relationship.
  const businessSideAction = (rpcName) => async (req, res) => {
    try {
      const userId = req.user.userId;
      const { data: rels } = await supabase.from('personal_business_relationships').select('*').eq('id', req.params.id).limit(1);
      const rel = rels?.[0];
      if (!rel) return res.status(404).json({ error: 'relationship not found' });
      const role = await WA.isBusinessMember(supabase, userId, rel.business_id);
      if (!role || !['owner', 'ceo', 'admin', 'cfo'].includes(role)) return res.status(403).json({ error: 'business approver role required' });
      const { data, error } = await rpc(rpcName, { p_rel: req.params.id, p_actor: userId, p_channel: channel });
      if (error) return rpcErr(res, error);
      res.json(Array.isArray(data) ? data[0] : data);
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  };
  router.post('/personal-business-connections/:id/confirm', auth, businessSideAction('rpc_confirm_personal_business_connection'));
  router.post('/personal-business-connections/:id/reject', auth, businessSideAction('rpc_reject_personal_business_connection'));

  // Revoke may be initiated by the personal owner OR a business approver.
  router.post('/personal-business-connections/:id/revoke', auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const { data: rels } = await supabase.from('personal_business_relationships').select('*').eq('id', req.params.id).limit(1);
      const rel = rels?.[0];
      if (!rel) return res.status(404).json({ error: 'relationship not found' });
      const ownsPersonal = await WA.resolvePersonalWorkspaceOwner(supabase, userId, rel.personal_workspace_id).then(() => true).catch(() => false);
      const bizRole = await WA.isBusinessMember(supabase, userId, rel.business_id);
      if (!ownsPersonal && !['owner', 'ceo', 'admin', 'cfo'].includes(bizRole)) return res.status(403).json({ error: 'not authorized to revoke' });
      const { data, error } = await rpc('rpc_revoke_personal_business_connection', { p_rel: req.params.id, p_actor: userId, p_channel: channel });
      if (error) return rpcErr(res, error);
      res.json(Array.isArray(data) ? data[0] : data);
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // GET /api/personal-business-connections — only relationships involving the caller.
  router.get('/personal-business-connections', auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const memberships = await WA.listAccessibleWorkspaces(supabase, userId);
      const myPersonal = memberships.filter(m => m.businesses.type === 'personal').map(m => m.business_id);
      const myBusiness = memberships.filter(m => m.businesses.type !== 'personal').map(m => m.business_id);
      const out = [];
      if (myPersonal.length) {
        const { data } = await supabase.from('personal_business_relationships').select('*').in('personal_workspace_id', myPersonal);
        out.push(...(data || []).map(r => ({ ...r, perspective: 'personal' })));
      }
      if (myBusiness.length) {
        const { data } = await supabase.from('personal_business_relationships').select('*').in('business_id', myBusiness);
        out.push(...(data || []).map(r => ({ ...r, perspective: 'business' })));
      }
      // attach normalized roles
      for (const r of out) {
        const { data: roles } = await supabase.from('personal_business_relationship_roles').select('role').eq('relationship_id', r.id);
        r.roles = (roles || []).map(x => x.role);
      }
      res.json({ connections: out });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ═══════════════════════════ STAGE 2 — FX QUOTES ══════════════════════════
  // POST /api/fx/quotes — mock provider or audited manual quote. Decimal strings.
  router.post('/fx/quotes', auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const b = req.body || {};
      const base = (b.base_asset || '').toUpperCase(), quote = (b.quote_asset || '').toUpperCase();
      if (!base || !quote) return res.status(400).json({ error: 'base_asset and quote_asset required' });
      if (base === quote) return res.status(400).json({ error: 'base and quote must differ (stablecoins are not 1:1)' });
      let normalized;
      try {
        if (b.source_type === 'manual') {
          // manual quote needs an authorised role on the workspace it is created for
          normalized = fx.manualQuote({ base, quote, rate: b.rate, source: b.provider || 'manual', reason: b.manual_reason, actor: userId, effectiveDate: b.rate_effective_date });
        } else if (b.kind === 'historical' || b.rate_effective_date) {
          normalized = await fx.getHistoricalQuote(base, quote, b.rate_effective_date);
        } else if (b.kind === 'crypto') {
          normalized = await fx.getCryptoQuote(base, quote);
        } else {
          normalized = await fx.getCurrentQuote(base, quote);
        }
      } catch (e) {
        // provider failure must create NO quote/transfer
        return res.status(400).json({ error: 'fx_provider_error: ' + e.message });
      }
      const payload = {
        provider: normalized.provider, base_asset: normalized.base_asset, quote_asset: normalized.quote_asset,
        rate: normalized.rate, inverse_rate: normalized.inverse_rate, bid: normalized.bid, ask: normalized.ask,
        market_timestamp: normalized.market_timestamp, valid_until: normalized.valid_until,
        rate_effective_date: normalized.rate_effective_date, source_type: normalized.source_type,
        status: 'available', manual_reason: normalized.manual_reason, raw_metadata: normalized.raw_metadata,
        idempotency_key: b.idempotency_key || null,
      };
      const { data, error } = await rpc('rpc_create_fx_quote_record', { p: payload, p_actor: userId, p_channel: channel });
      if (error) return rpcErr(res, error);
      const row = Array.isArray(data) ? data[0] : data;
      res.status(201).json(shapeQuote(await rereadQuote(row.id) || row));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  router.get('/fx/quotes/:id', auth, async (req, res) => {
    try {
      const { data } = await supabase.from('exchange_rate_quotes').select(Q_SEL).eq('id', req.params.id).limit(1);
      if (!data?.length) return res.status(404).json({ error: 'quote not found' });
      res.json(shapeQuote(data[0]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/fx/quotes/:id/refresh — fetch a fresh quote for the same pair.
  router.post('/fx/quotes/:id/refresh', auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const { data: old } = await supabase.from('exchange_rate_quotes').select('*').eq('id', req.params.id).limit(1);
      if (!old?.length) return res.status(404).json({ error: 'quote not found' });
      const o = old[0];
      let normalized;
      try { normalized = await fx.getCurrentQuote(o.base_asset, o.quote_asset); }
      catch (e) { return res.status(400).json({ error: 'fx_provider_error: ' + e.message }); }
      const payload = {
        provider: normalized.provider, base_asset: normalized.base_asset, quote_asset: normalized.quote_asset,
        rate: normalized.rate, inverse_rate: normalized.inverse_rate, market_timestamp: normalized.market_timestamp,
        valid_until: normalized.valid_until, source_type: normalized.source_type, status: 'available',
        raw_metadata: normalized.raw_metadata,
      };
      const { data, error } = await rpc('rpc_create_fx_quote_record', { p: payload, p_actor: userId, p_channel: channel });
      if (error) return rpcErr(res, error);
      const row = Array.isArray(data) ? data[0] : data;
      res.status(201).json(shapeQuote(await rereadQuote(row.id) || row));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  function shapeQuote(q) {
    return {
      id: q.id, provider: q.provider, base_asset: q.base_asset, quote_asset: q.quote_asset,
      rate: s(q.rate), inverse_rate: s(q.inverse_rate), bid: s(q.bid), ask: s(q.ask),
      market_timestamp: q.market_timestamp, retrieved_at: q.retrieved_at || q.created_at,
      valid_until: q.valid_until, status: q.status, source_type: q.source_type,
      manual_reason: q.manual_reason || null,
    };
  }

  // ══════════════════════ STAGE 3 — WALLET TRANSFERS ════════════════════════
  // Helper: load a wallet + its workspace type, asserting caller membership.
  async function loadWalletForUser(userId, walletId) {
    const { data } = await supabase.from('wallets').select('*, businesses!inner(id,type,owner_user_id)').eq('id', walletId).limit(1);
    if (!data?.length) return null;
    const w = data[0];
    const r = await WA.resolveActiveWorkspace(supabase, userId, w.business_id);
    if (!r) return null;
    return { wallet: w, workspaceType: w.businesses.type, role: r.role };
  }

  // Ordinary transfer boundary: same workspace = internal; same-user personal↔personal
  // = controlled personal transfer. Personal↔Business is NEVER an ordinary transfer.
  function classifyTransfer(src, tgt) {
    if (src.wallet.business_id === tgt.wallet.business_id) return { kind: 'internal', ok: true };
    const sp = src.workspaceType === 'personal', tp = tgt.workspaceType === 'personal';
    if (sp && tp) return { kind: 'personal_to_personal', ok: true };           // same user (both resolved for caller)
    if (sp !== tp) return { kind: 'personal_business', ok: false, reason: 'Personal↔Business movement must use the Funding Bridge or a repayment, not an ordinary transfer' };
    return { kind: 'business_to_business', ok: true };
  }

  async function buildTransferPreview(userId, b) {
    const src = await loadWalletForUser(userId, b.source_wallet_id);
    const tgt = await loadWalletForUser(userId, b.target_wallet_id);
    if (!src || !tgt) return { error: { status: 403, message: 'source/target wallet not accessible' } };
    const cls = classifyTransfer(src, tgt);
    if (!cls.ok) return { error: { status: 403, message: cls.reason } };
    let quote = null, rate = '1';
    if ((b.source_asset || src.wallet.asset_code) !== (b.target_asset || tgt.wallet.asset_code)) {
      if (!b.fx_quote_id) return { error: { status: 400, message: 'cross-currency transfer requires a quote' } };
      const { data } = await supabase.from('exchange_rate_quotes').select(Q_SEL).eq('id', b.fx_quote_id).limit(1);
      quote = data?.[0];
      if (!quote) return { error: { status: 404, message: 'quote not found' } };
      if (quote.status === 'expired' || (quote.valid_until && new Date(quote.valid_until) < new Date())) return { error: { status: 400, message: 'refresh_quote_required' } };
      rate = s(quote.rate);
    }
    const preview = {
      kind: cls.kind,
      source_principal: s(b.source_amount), source_asset: b.source_asset || src.wallet.asset_code,
      target_amount: s(b.target_amount), target_asset: b.target_asset || tgt.wallet.asset_code,
      rate, fee_amount: s(b.fee_amount || null), fee_asset: b.fee_asset || null,
      total_debit: s(b.source_amount), reporting_currency: src.wallet.businesses?.base_currency || 'IDR',
      quote_expiry: quote?.valid_until || null,
      future_legs: [
        { type: 'fx_transfer_out', workspace_id: src.wallet.business_id, wallet_id: src.wallet.id, asset: b.source_asset || src.wallet.asset_code, amount: s(b.source_amount) },
        { type: 'fx_transfer_in', workspace_id: tgt.wallet.business_id, wallet_id: tgt.wallet.id, asset: b.target_asset || tgt.wallet.asset_code, amount: s(b.target_amount) },
      ],
    };
    return { preview, src, tgt };
  }

  router.post('/wallet-transfers/preview', auth, async (req, res) => {
    try {
      const { preview, error } = await buildTransferPreview(req.user.userId, req.body || {});
      if (error) return res.status(error.status).json({ error: error.message });
      res.json(preview); // writes NOTHING
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/wallet-transfers/confirm', auth, async (req, res) => {
    try {
      const userId = req.user.userId; const b = req.body || {};
      const { preview, src, tgt, error } = await buildTransferPreview(userId, b);
      if (error) return res.status(error.status).json({ error: error.message });
      const payload = {
        source_workspace_id: src.wallet.business_id, target_workspace_id: tgt.wallet.business_id,
        source_wallet_id: src.wallet.id, target_wallet_id: tgt.wallet.id,
        source_asset: preview.source_asset, target_asset: preview.target_asset,
        source_amount: b.source_amount, target_amount: b.target_amount,
        fx_quote_id: b.fx_quote_id || null, fee_amount: b.fee_amount || null, fee_asset: b.fee_asset || null,
        network_fee_amount: b.network_fee_amount || null, network_fee_asset: b.network_fee_asset || null,
        spread_bps: b.spread_bps || null,
        source_scope: src.workspaceType === 'personal' ? 'personal' : 'business',
        target_scope: tgt.workspaceType === 'personal' ? 'personal' : 'business',
        actor_user_id: userId,
      };
      const { data, error: rerr } = await rpc('rpc_create_wallet_transfer', { p: payload, p_actor: userId, p_channel: channel });
      if (rerr) return rpcErr(res, rerr);
      res.status(201).json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ═══════════════════════════ STAGE 3 — FUNDING ════════════════════════════
  // POST /api/funding — draft/pending only; creates NO transaction legs.
  router.post('/funding', auth, async (req, res) => {
    try {
      const userId = req.user.userId; const b = req.body || {};
      // caller must own the source personal workspace
      await WA.resolvePersonalWorkspaceOwner(supabase, userId, b.source_workspace_id);
      // Funding Bridge requires the personal_investor_funding entitlement on THIS workspace.
      if (!await hasFundingEntitlement(b.source_workspace_id)) {
        return res.status(403).json({ error: 'Funding Bridge (personal_investor_funding) is not enabled for this workspace', upgrade_required: true });
      }
      const payload = { ...b, contributor_user_id: b.contributor_user_id || userId,
        idempotency_key: b.idempotency_key || `fund-${userId}-${Date.now()}` };
      const { data, error } = await rpc('rpc_create_funding_transfer', { p: payload, p_actor: userId, p_channel: channel });
      if (error) return rpcErr(res, error);
      const row = Array.isArray(data) ? data[0] : data;
      res.status(201).json(shapePersonalFunding(await rereadFunding(row.id) || row));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // Confirm: business approver. Cancel: personal owner or business approver.
  router.post('/funding/:id/confirm', auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const ft = await loadFunding(req.params.id);
      if (!ft) return res.status(404).json({ error: 'funding not found' });
      const role = await WA.isBusinessMember(supabase, userId, ft.target_business_id);
      if (!['owner', 'ceo', 'admin', 'cfo'].includes(role)) return res.status(403).json({ error: 'business approver role required' });
      const { data, error } = await rpc('rpc_confirm_funding_transfer', { p_funding: req.params.id, p_actor: userId, p_channel: channel });
      if (error) return rpcErr(res, error);
      res.json(shapeBusinessFunding(await rereadFunding(req.params.id), await resolveUserDisplayName(ft.contributor_user_id), await rolesFor(ft.relationship_id)));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/funding/:id/cancel', auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const ft = await loadFunding(req.params.id);
      if (!ft) return res.status(404).json({ error: 'funding not found' });
      const ownsPersonal = await WA.resolvePersonalWorkspaceOwner(supabase, userId, ft.source_workspace_id).then(() => true).catch(() => false);
      const bizRole = await WA.isBusinessMember(supabase, userId, ft.target_business_id);
      if (!ownsPersonal && !['owner', 'ceo', 'admin', 'cfo'].includes(bizRole)) return res.status(403).json({ error: 'not authorized' });
      const { data, error } = await rpc('rpc_cancel_funding_transfer', { p_funding: req.params.id, p_actor: userId, p_channel: channel });
      if (error) return rpcErr(res, error);
      res.json(shapePersonalFunding(await rereadFunding(req.params.id)));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Repay: business side pays out, personal side principal reduced.
  router.post('/funding/:id/repay', auth, async (req, res) => {
    try {
      const userId = req.user.userId; const b = req.body || {};
      const ft = await loadFunding(req.params.id);
      if (!ft) return res.status(404).json({ error: 'funding not found' });
      const role = await WA.isBusinessMember(supabase, userId, ft.target_business_id);
      if (!['owner', 'ceo', 'admin', 'cfo'].includes(role)) return res.status(403).json({ error: 'business approver role required' });
      const payload = { ...b, funding_transfer_id: req.params.id, idempotency_key: b.idempotency_key || `repay-${req.params.id}-${Date.now()}` };
      const { data, error } = await rpc('rpc_repay_funding_transfer', { p: payload, p_actor: userId, p_channel: channel });
      if (error) return rpcErr(res, error);
      const row = Array.isArray(data) ? data[0] : data;
      res.status(201).json(await rereadOne('funding_repayments', row.id, FR_SEL) || row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/funding/outgoing', auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const memberships = await WA.listAccessibleWorkspaces(supabase, userId);
      const myPersonal = memberships.filter(m => m.businesses.type === 'personal').map(m => m.business_id);
      if (!myPersonal.length) return res.json({ funding: [] });
      const { data } = await supabase.from('funding_transfers').select(FT_SEL).in('source_workspace_id', myPersonal).order('created_at', { ascending: false });
      res.json({ funding: (data || []).map(shapePersonalFunding) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/funding/incoming', auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const memberships = await WA.listAccessibleWorkspaces(supabase, userId);
      const myBusiness = memberships.filter(m => m.businesses.type !== 'personal').map(m => m.business_id);
      if (!myBusiness.length) return res.json({ funding: [] });
      const { data } = await supabase.from('funding_transfers').select(FT_SEL).in('target_business_id', myBusiness).order('created_at', { ascending: false });
      const out = [];
      for (const r of (data || [])) out.push(shapeBusinessFunding(r, await resolveUserDisplayName(r.contributor_user_id), await rolesFor(r.relationship_id)));
      res.json({ funding: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/funding/summary', auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const memberships = await WA.listAccessibleWorkspaces(supabase, userId);
      const myBusiness = memberships.filter(m => m.businesses.type !== 'personal').map(m => m.business_id);
      if (!myBusiness.length) return res.json({ balances: [] });
      const { data } = await supabase.from('personal_funding_balances').select(PFB_SEL).in('target_business_id', myBusiness);
      // Financing values exposed SEPARATELY from revenue/operating expense.
      res.json({ balances: (data || []).map(r => ({
        target_business_id: r.target_business_id, contributor_user_id: r.contributor_user_id,
        principal_asset: r.principal_asset,
        loans_principal: s(r.loans_principal), loans_repaid_principal: s(r.loans_repaid_principal),
        outstanding_principal_native: s(r.outstanding_principal_native),
        capital_contributed: s(r.capital_contributed), loans_reporting_value: s(r.loans_reporting_value),
        economic_class: 'financing', affects_revenue: false, affects_operating_expense: false,
      })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/funding/:id — perspective-aware (personal owner vs business member).
  router.get('/funding/:id', auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const ft = await loadFunding(req.params.id);
      if (!ft) return res.status(404).json({ error: 'funding not found' });
      const ownsPersonal = await WA.resolvePersonalWorkspaceOwner(supabase, userId, ft.source_workspace_id).then(() => true).catch(() => false);
      const bizRole = await WA.isBusinessMember(supabase, userId, ft.target_business_id);
      if (ownsPersonal) {
        const reps = await repaymentsFor(ft.id);
        return res.json({ perspective: 'personal', ...shapePersonalFunding(ft), repayments: reps });
      }
      if (bizRole) {
        return res.json({ perspective: 'business', ...shapeBusinessFunding(ft, await resolveUserDisplayName(ft.contributor_user_id), await rolesFor(ft.relationship_id)) });
      }
      return res.status(403).json({ error: 'not authorized' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── helpers ──────────────────────────────────────────────────────────────
  async function loadFunding(id) {
    return rereadFunding(id);
  }
  async function rolesFor(relId) {
    const { data } = await supabase.from('personal_business_relationship_roles').select('role').eq('relationship_id', relId);
    return (data || []).map(r => r.role);
  }
  async function repaymentsFor(fundingId) {
    const { data } = await supabase.from('funding_repayments').select(FR_SEL).eq('funding_transfer_id', fundingId).eq('status', 'confirmed');
    return (data || []).map(r => ({ id: r.id, repayment_amount_native: s(r.repayment_amount_native), repayment_asset: r.repayment_asset,
      principal_reduction_amount: s(r.principal_reduction_amount), principal_asset: r.principal_asset, booked_rate: s(r.booked_rate) }));
  }

  // Personal-side view: full visibility of the investor's own position.
  function shapePersonalFunding(r) {
    return {
      id: r.id, relationship_id: r.relationship_id, funding_type: r.funding_type, status: r.status,
      source_workspace_id: r.source_workspace_id, source_wallet_id: r.source_wallet_id,
      target_business_id: r.target_business_id, target_wallet_id: r.target_wallet_id,
      source_asset: r.source_asset, source_principal_amount: s(r.source_principal_amount),
      source_total_debit: s(r.source_total_debit), target_asset: r.target_asset, target_amount: s(r.target_amount),
      fee_amount: s(r.fee_amount), fee_asset: r.fee_asset, booked_rate: s(r.booked_rate),
      reporting_currency: r.reporting_currency, reporting_amount: s(r.reporting_amount),
      economic_class: 'financing', affects_revenue: false, affects_operating_expense: false,
    };
  }

  // Business-side view: MUST NOT expose source personal balance, unrelated personal
  // transactions, other connected businesses, or uninvolved personal wallets.
  function shapeBusinessFunding(r, contributorName, roles) {
    return {
      id: r.id, funding_type: r.funding_type, status: r.status,
      contributor_display_name: contributorName || 'Investor', relationship_roles: roles || [],
      amount_received: s(r.target_amount), target_asset: r.target_asset,
      target_business_id: r.target_business_id, target_business_wallet_id: r.target_wallet_id,
      booked_rate: s(r.booked_rate), reporting_currency: r.reporting_currency, reporting_amount: s(r.reporting_amount),
      liability_or_capital: r.repayable ? 'liability' : 'capital',
      economic_class: 'financing', affects_revenue: false, affects_operating_expense: false,
      // intentionally omitted: source_workspace_id, source_wallet_id, source personal balances.
    };
  }

  return router;
};
