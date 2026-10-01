// MCP protocol handler — Streamable HTTP, stateless.
//
// CommonJS module that lazy-loads the ESM MCP SDK on first request (the SDK is ESM-only;
// the rest of the backend is CommonJS). Stateless transport: a fresh McpServer + transport
// is built per request, as the SDK's stateless pattern recommends. This file is a thin
// boundary — it contains NO accounting logic; tool handlers live in tools.js and (from
// PR3) call the existing server/lib/* services.

const { phase1Tools } = require('./tools');

const SERVER_INSTRUCTIONS = [
  'CFO Finance MCP server. CFO Finance OS is the system of record for accounting and documents;',
  'these tools are a read-only interface to it (Phase 1). Always call get_company_context first to',
  'learn which company the user can act in — never guess a company_id. Tools return structured data',
  'computed by CFO Finance; present it to the user and do not recompute financial figures yourself.',
].join(' ');

let _sdk = null;
async function loadSdk() {
  if (!_sdk) {
    const [mcp, http] = await Promise.all([
      import('@modelcontextprotocol/sdk/server/mcp.js'),
      import('@modelcontextprotocol/sdk/server/streamableHttp.js'),
    ]);
    _sdk = { McpServer: mcp.McpServer, StreamableHTTPServerTransport: http.StreamableHTTPServerTransport };
  }
  return _sdk;
}

// Build a configured McpServer for the given identity context. Transport-agnostic, so it
// can be driven by the HTTP transport (production) or an in-memory client (tests).
async function buildServer(ctx) {
  const { McpServer } = await loadSdk();
  const server = new McpServer(
    { name: 'cfo-finance-mcp', version: '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );
  for (const t of phase1Tools(ctx)) {
    server.registerTool(t.name, t.config, t.handler);
  }
  return server;
}

async function handleMcpRequest(req, res, ctx) {
  const { StreamableHTTPServerTransport } = await loadSdk();
  const server = await buildServer(ctx);

  // Stateless: no session id generator. New transport per request.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    try { transport.close(); } catch { /* noop */ }
    try { server.close(); } catch { /* noop */ }
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

module.exports = { handleMcpRequest, buildServer, SERVER_INSTRUCTIONS };
