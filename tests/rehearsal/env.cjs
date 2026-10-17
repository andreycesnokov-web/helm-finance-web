'use strict';
// Clean-install rehearsal — shared paths. Secrets, state, logs and backups live OUTSIDE the repository
// (REHEARSAL_HOME, default <tmp>/cfo-rehearsal) and are deleted by `run_all.sh --cleanup`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const HOME = process.env.REHEARSAL_HOME || path.join(os.tmpdir(), 'cfo-rehearsal');
fs.mkdirSync(HOME, { recursive: true });
const SECRETS = path.join(HOME, 'secrets.json');
function secrets() {
  if (!fs.existsSync(SECRETS)) {
    const crypto = require('crypto'), jwt = require(path.join(ROOT, 'node_modules', 'jsonwebtoken'));
    const sb = crypto.randomBytes(32).toString('hex'), now = Math.floor(Date.now() / 1000);
    const k = (role) => jwt.sign({ role, iss: 'supabase', iat: now, exp: now + 86400 * 30 }, sb);
    fs.writeFileSync(SECRETS, JSON.stringify({ db_password: crypto.randomBytes(16).toString('hex'), supabase_jwt_secret: sb, anon_key: k('anon'),
      service_key: k('service_role'), app_jwt_secret: crypto.randomBytes(32).toString('hex') }, null, 1), { mode: 0o600 });
  }
  return JSON.parse(fs.readFileSync(SECRETS, 'utf8'));
}
// Ports (127.0.0.1 only).
const PORTS = { db: 55440, mail: 55441, auth: 55443, rest: 55444, storage: 55445, gateway: 55450, api: 55460, app: 55470 };
module.exports = { ROOT, HOME, SECRETS, secrets, PORTS };
if (require.main === module) { const s = secrets(); const k = process.argv[2]; process.stdout.write(k ? String(s[k]) : HOME); }
