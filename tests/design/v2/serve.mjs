// Local harness for design-v2 screenshots: serves client/dist with SPA fallback and
// answers /api/* from fixtures.mjs. Never talks to a real backend or database.
//   node tests/design/v2/serve.mjs [port]
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { routes } from './fixtures.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const DIST = path.join(ROOT, 'client', 'dist')
const PORT = Number(process.argv[2] || 4317)
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json' }

export function start(port = PORT) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    if (u.pathname.startsWith('/api/')) {
      const key = `${req.method} ${u.pathname}`
      let h = routes[key]
      if (!h) {
        // Parametrised routes: 'GET /api/x/:id'
        for (const [k, fn] of Object.entries(routes)) {
          const [m, p] = k.split(' ')
          if (m !== req.method || !p.includes(':')) continue
          const re = new RegExp('^' + p.replace(/:[^/]+/g, '[^/]+') + '$')
          if (re.test(u.pathname)) { h = fn; break }
        }
      }
      // FIXTURE_MODE=error: every data call fails (500); =empty: every data call answers
      // with nothing. The shell's own calls (workspaces, access, admin status) still work, so
      // each screen's error and empty states can be walked (tests/design/v2/walk.mjs).
      const SHELL = /^\/api\/(workspaces|workspace-preferences|access\/status|admin\/status)$/
      const mode = process.env.FIXTURE_MODE
      // The app's own sign-in check calls a bare /api/pulse; v2 screens call it with ?scope=business.
      const shellCall = SHELL.test(u.pathname) || (u.pathname === '/api/pulse' && !u.search)
      if (mode && h && !shellCall && req.method === 'GET') {
        if (mode === 'error') { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'harness_error' })); return }
        if (mode === 'empty') {
          const sample = h ? h(u, req) : null
          // runway 999 is what the server answers when there is no spending to measure.
          const empty = (v) => Array.isArray(v) ? [] : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'boolean' ? x : k === 'runway' ? 999 : empty(x)])) : typeof v === 'number' ? 0 : v
          res.writeHead(h ? 200 : 404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(h ? empty(sample) : { error: 'not_in_fixture' })); return
        }
      }
      const body = h ? h(u, req) : { error: 'not_in_fixture' }
      res.writeHead(h ? 200 : 404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
      return
    }
    let f = path.join(DIST, decodeURIComponent(u.pathname))
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html')
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' })
    fs.createReadStream(f).pipe(res)
  })
  return new Promise((r) => server.listen(port, () => r(server)))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start().then(() => console.log(`design-v2 harness on http://localhost:${PORT}`))
}
