/**
 * Automated Verification: CMS Content Persistence Across Container Restarts
 * Proves that ContentStore mounted on a persistent volume survives restarts with 0 content loss.
 */

const fs = require('fs');
const path = require('path');
const ContentStore = require('../cms/engine/contentStore');

async function testPersistenceAcrossRestarts() {
  console.log('--- STARTING CMS PERSISTENCE & RESTART VERIFICATION ---');

  const testDir = path.join(__dirname, 'persistence_test_data');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  // Copy initial seed data from cms/data
  const srcDataDir = path.join(__dirname, '../cms/data');
  const filesToCopy = [
    'pricing.json',
    'locales.json',
    'seo.json',
    'users.json',
    'billing_catalog_reference.json',
    'pages.json',
    'hub_articles.json',
    'hub_categories.json'
  ];
  for (const f of filesToCopy) {
    if (fs.existsSync(path.join(srcDataDir, f))) {
      fs.copyFileSync(path.join(srcDataDir, f), path.join(testDir, f));
    }
  }

  // STEP 1: Launch Container Instance 1
  console.log('\n[Step 1] Initializing Container Instance 1 with volume mount...');
  let store1 = new ContentStore(testDir);
  const initialRelease = store1.getActiveRelease();
  console.log(`  ✓ Instance 1 initialized active release: ${initialRelease.release_id}`);

  // STEP 2: Mutate data in Instance 1
  console.log('\n[Step 2] Applying CMS edit and publishing new release in Instance 1...');
  const testTitle = 'Indonesian Tax Modernization 2026: Persistent Staging Guide';
  const newArticle = {
    id: 'art-persist-test',
    slug: 'persistent-staging-guide-2026',
    translations: {
      en: { title: testTitle, summary: 'Verification of persistent storage survival.' },
      id: { title: 'Panduan Staging Persisten 2026', summary: 'Verifikasi kelangsungan penyimpanan persisten.' }
    },
    review_status: 'published',
    jurisdiction: 'ID',
    statutes: ['PMK 81/2024'],
    updated_at: new Date().toISOString()
  };
  store1.saveArticle(newArticle, 'owner@cfo-ai.site');

  const release2 = store1.createRelease({
    author: 'owner@cfo-ai.site',
    notes: 'Release with persistent article test'
  });
  console.log(`  ✓ Instance 1 published Release 2: ${release2.release_id}`);

  // STEP 3: Simulate Hard Container Crash & Termination
  console.log('\n[Step 3] Simulating hard container crash/restart (destroying Instance 1)...');
  store1 = null; // Unload from memory

  // STEP 4: Launch Container Instance 2 on same persistent volume
  console.log('\n[Step 4] Booting Container Instance 2 from persistent volume mount...');
  const store2 = new ContentStore(testDir);
  const activeReleaseAfterRestart = store2.getActiveRelease();

  // STEP 5: Verification Assertions
  console.log('\n[Step 5] Running integrity assertions on Instance 2...');
  let passed = 0;
  function assert(cond, msg) {
    if (cond) {
      console.log(`  ✓ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${msg}`);
      throw new Error(`Assertion failed: ${msg}`);
    }
  }

  assert(activeReleaseAfterRestart !== null, 'Active release exists after restart');
  assert(activeReleaseAfterRestart.release_id === release2.release_id, `Active release matches pre-crash release (${release2.release_id})`);

  const retrievedArticle = store2.getHubArticle('persistent-staging-guide-2026');
  assert(retrievedArticle !== null, 'Custom published article retrieved after container restart');
  assert(retrievedArticle.translations.en.title === testTitle, 'Article title matches pre-restart mutation');
  assert(retrievedArticle.statutes.includes('PMK 81/2024'), 'Statutory metadata preserved');

  const audits = store2.getAuditLogs(10);
  const relevantAudit = audits.find(a => a.entity.includes('persistent-staging-guide-2026'));
  assert(relevantAudit !== undefined, 'Audit log trail preserved across container crash');
  assert(relevantAudit.actor === 'owner@cfo-ai.site', 'Audit actor correctly recorded');

  // STEP 6: Verify Rollback Works on Instance 2
  console.log('\n[Step 6] Testing 1-click rollback on post-restart container...');
  const rollbackResult = store2.rollbackRelease(initialRelease.release_id, 'owner@cfo-ai.site');
  assert(rollbackResult.release_id === initialRelease.release_id, 'Rollback succeeds instantly on restarted container');
  assert(store2.getActiveRelease().release_id === initialRelease.release_id, 'Current release active pointer points to baseline');

  // Cleanup
  fs.rmSync(testDir, { recursive: true, force: true });

  console.log(`\n======================================================`);
  console.log(`PERSISTENCE VERIFICATION COMPLETE: ALL ${passed} ASSERTIONS PASSED`);
  console.log(`======================================================`);
}

testPersistenceAcrossRestarts().catch(err => {
  console.error('Persistence verification failed:', err);
  process.exit(1);
});
