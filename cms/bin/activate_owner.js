#!/usr/bin/env node

/**
 * CFO AI CMS — Secure Owner Account Activation CLI
 * 
 * Usage:
 *   node cms/bin/activate_owner.js [owner-email]
 * 
 * Example:
 *   node cms/bin/activate_owner.js andrey@cfo-ai.site
 * 
 * Generates a one-time 32-byte cryptographic token (valid for 60 min)
 * and produces a private direct activation URL for the owner to set their personal password.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ContentStore = require('../engine/contentStore');

const targetEmail = process.argv[2] ? process.argv[2].trim().toLowerCase() : null;

const store = new ContentStore(path.join(__dirname, '../data'));
const users = store.getUsers();

let owner = users.find(u => u.role === 'owner');
if (!owner) {
  owner = {
    id: `usr-${Date.now()}`,
    name: 'Administrator (Owner)',
    email: targetEmail || 'admin@cfo-ai.site',
    role: 'owner',
    avatar: '/assets/avatars/owner.png',
    created_at: new Date().toISOString(),
    status: 'pending_activation'
  };
}

if (targetEmail) {
  owner.email = targetEmail;
}

const token = crypto.randomBytes(32).toString('hex');
owner.reset_token = token;
owner.reset_token_expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 60 minutes

store.saveUser(owner, 'cli_owner_activation');
store.logAudit(owner.email, 'generate_owner_activation_token', 'auth', { valid_minutes: 60 });

console.log('\n==============================================================');
console.log('       CFO AI CMS — SECURE OWNER ACTIVATION LINK              ');
console.log('==============================================================');
console.log(`Owner Account   : ${owner.email}`);
console.log(`Role            : ${owner.role.toUpperCase()}`);
console.log(`Token Validity  : 60 minutes`);
console.log('--------------------------------------------------------------');
console.log('Open one of the following URLs in your browser to activate');
console.log('and personally set your password:');
console.log('');
console.log(`Local Staging   : http://localhost:3003/admin/#reset=${token}`);
console.log(`Production URL  : https://admin.cfo-ai.site/admin/#reset=${token}`);
console.log('==============================================================\n');
