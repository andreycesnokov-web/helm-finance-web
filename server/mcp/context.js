// CFO Finance MCP — who is calling, and which company a tool acts in.
//
// The authenticated user comes from the transport (auth.js). The COMPANY is resolved
// server-side by the same resolver every web route uses: a company_id supplied by the model
// is only a selector, and membership is re-verified on every call. A company the user is not
// an active member of is refused exactly like the web app refuses it. The default company is
// looked up read-only — a tool call can never bootstrap a workspace.

// Tool-level error codes are stable, generic and safe to show to a model or a user. No stack
// traces, SQL or internal messages ever leave this layer.
const KNOWN_RESOLVER_ERRORS = {
  workspace_not_accessible: 'You are not an active member of that company, or it does not exist.',
  business_workspace_required: 'That is a personal workspace. These tools work with company workspaces.',
  no_business: 'You do not have a company workspace yet.',
};

class ToolError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.code = code;
    this.extra = extra;
  }
}

function ok(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function fail(code, message, extra = {}) {
  const body = { error: code, message, ...extra };
  return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }], isError: true };
}

// Wraps a handler: authentication check, ToolError → structured error, anything else →
// generic error (logged server-side without payloads).
function guarded(name, ctx, handler) {
  return async (args) => {
    try {
      if (!ctx.mcpUser || ctx.mcpUser.userId == null) {
        // Only reachable in the explicit local MCP_ALLOW_UNAUTHENTICATED mode: tools that
        // read company data still require an identity.
        return fail('authentication_required', 'Sign in to CFO Finance to use this tool.');
      }
      return ok(await handler(args || {}, ctx));
    } catch (e) {
      if (e instanceof ToolError) return fail(e.code, e.message, e.extra);
      console.error(`[mcp] tool ${name} failed: ${e && e.message}`);
      return fail('internal_error', 'CFO Finance could not complete this request.');
    }
  };
}

async function resolveCompany(ctx, companyId) {
  const userId = ctx.mcpUser.userId;
  const req = {
    user: { userId },
    headers: {},
    query: {},
    body: companyId ? { business_id: String(companyId) } : {},
  };
  try {
    return await ctx.services.resolveBusinessReadOnly(req);
  } catch (e) {
    const code = e && KNOWN_RESOLVER_ERRORS[e.message] ? e.message : 'company_unavailable';
    throw new ToolError(code, KNOWN_RESOLVER_ERRORS[code] || 'The company could not be resolved.');
  }
}

function companyRef(biz) {
  return {
    company_id: biz.business.id,
    name: biz.business.name || null,
    business_code: biz.business.business_code || null,
    role: biz.role,
  };
}

module.exports = { ToolError, ok, fail, guarded, resolveCompany, companyRef };
