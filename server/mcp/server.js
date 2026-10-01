// MCP protocol handler — Streamable HTTP, stateless.
//
// CommonJS module that lazy-loads the ESM MCP SDK on first request (the SDK is ESM-only;
// the rest of the backend is CommonJS). Stateless transport: a fresh McpServer + transport
// is built per request, as the SDK's stateless pattern recommends. This file is a thin
// boundary — it contains NO accounting logic; tool handlers live in tools.js and call the
// existing CFO services injected from server/index.js.

const { phase1Tools } = require('./tools');

const SERVER_INSTRUCTIONS = [
  'CFO AI (CFO Finance) MCP server. CFO AI is the system of record for accounting and documents;',
  'these tools are a read-only interface to it (Phase 1) — nothing you call here saves or changes',
  'data. Always call get_company_context first to learn which company the user can act in — never',
  'guess a company_id. Tools return structured data computed by CFO Finance; present it to the user',
  'and do not recompute financial figures yourself. To analyze an invoice the user gave you, pass its',
  'full text to analyze_invoice; amounts you read are treated as a model reading and need confirmation.',
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

// How the server introduces itself to AI clients (MCP `serverInfo`): brand name, a short
// description, the website and the official CFO AI app icon — navy for light UIs, white for
// dark ones. Icons need absolute URLs, so they are only advertised when the public base URL
// is known (MCP_PUBLIC_BASE_URL / APP_BASE_URL).
function serverInfo(baseUrl) {
  const info = {
    name: 'cfo-finance-mcp',
    title: 'CFO AI',
    version: '0.3.0',
    description: 'CFO AI — Financial OS: your companies, financial position, missing documents and invoice analysis (read-only).',
  };
  if (baseUrl) {
    info.websiteUrl = baseUrl;
    info.icons = [
      { src: `${baseUrl}/brand/app_icon_navy_rounded_1024.png`, mimeType: 'image/png', sizes: ['1024x1024'], theme: 'light' },
      { src: `${baseUrl}/brand/app_icon_navy_rounded.svg`, mimeType: 'image/svg+xml', sizes: ['any'], theme: 'light' },
      { src: `${baseUrl}/brand/app_icon_white_rounded_1024.png`, mimeType: 'image/png', sizes: ['1024x1024'], theme: 'dark' },
      { src: `${baseUrl}/brand/app_icon_white_rounded.svg`, mimeType: 'image/svg+xml', sizes: ['any'], theme: 'dark' },
    ];
  }
  return info;
}

// Build a configured McpServer for the given identity context. Transport-agnostic, so it
// can be driven by the HTTP transport (production) or an in-memory client (tests).
async function buildServer(ctx) {
  const { McpServer } = await loadSdk();
  const server = new McpServer(
    serverInfo(ctx && ctx.baseUrl),
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

module.exports = { handleMcpRequest, buildServer, serverInfo, SERVER_INSTRUCTIONS };
