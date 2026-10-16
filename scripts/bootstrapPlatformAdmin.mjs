#!/usr/bin/env node
/**
 * CFO AI — Secure Platform Admin Bootstrap CLI
 *
 * Usage:
 *   node scripts/bootstrapPlatformAdmin.mjs --email=owner@example.com
 *   node scripts/bootstrapPlatformAdmin.mjs owner@example.com
 *
 * Requirements:
 *   - The email identity must already exist in user_email_identities.
 *   - The email identity must be verified (email_verified_at IS NOT NULL).
 *   - Fails closed if another active super_admin already exists (preventing takeover).
 *   - Idempotent: safe to run multiple times with the same verified email.
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { bootstrapSuperAdmin } from '../server/lib/platformAdmin.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) environment variables are required.')
  process.exit(1)
}

const args = process.argv.slice(2)
let email = null

for (const arg of args) {
  if (arg.startsWith('--email=')) {
    email = arg.slice(8).trim()
  } else if (!arg.startsWith('-') && !email) {
    email = arg.trim()
  }
}

if (!email) {
  console.error('Usage: node scripts/bootstrapPlatformAdmin.mjs --email=<verified-email>')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

async function run() {
  console.log(`[bootstrap] Initiating platform admin bootstrap for: ${email}`)
  try {
    // Role and audit row are one PostgreSQL transaction (073): no role is granted without its audit event.
    const res = await bootstrapSuperAdmin(supabase, email)

    if (res.status === 'already_super_admin') {
      console.log(`[bootstrap] SUCCESS (Idempotent): User ${res.userId} (${res.email}) is already an active super_admin.`)
    } else {
      console.log(`[bootstrap] SUCCESS: User ${res.userId} (${res.email}) successfully granted super_admin role.`)
    }
    process.exit(0)
  } catch (err) {
    if (err.message === 'invalid_email') {
      console.error('[bootstrap] FAILED: Invalid email address format.')
    } else if (err.message === 'email_identity_not_found') {
      console.error(`[bootstrap] FAILED: No user account found with email "${email}". User must sign up / link email first.`)
    } else if (err.message === 'email_not_verified') {
      console.error(`[bootstrap] FAILED: Email "${email}" has not been verified. Only verified email accounts can be assigned admin roles.`)
    } else if (err.code === 'super_admin_already_exists') {
      console.error(`[bootstrap] REFUSED: An active super_admin already exists in the system. Additional administrators must be appointed via Platform Admin UI/API by an existing super_admin.`)
    } else if (err.code === 'bootstrap_rpc_failed') {
      console.error(`[bootstrap] REFUSED: the bootstrap transaction failed and nothing was granted (role and audit are atomic). (${err.message})`)
    } else {
      console.error('[bootstrap] FAILED unexpected error:', err.message)
    }
    process.exit(1)
  }
}

run()
