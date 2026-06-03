/**
 * Tests for scripts/generate-repo-status.mjs
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('\n=== Testing generate-repo-status.mjs ===\n');

  let passed = 0;
  let failed = 0;

  const repoRoot = path.join(__dirname, '..', '..');
  const generatorPath = path.join(repoRoot, 'scripts', 'generate-repo-status.mjs');

  // Dynamic import of ESM module from CommonJS
  const { extractRoute } = await import('../../scripts/generate-repo-status.mjs');

  const routeTests = [
    { input: 'app/blog/[id]/page.tsx', expected: '/blog/[id]' },
    { input: 'src/app/page.jsx', expected: '/' },
    { input: 'app/(marketing)/blog/page.tsx', expected: '/blog' },
    { input: 'pages/about.js', expected: '/about' },
    { input: 'src/pages/contact/index.ts', expected: '/contact' },
    { input: 'routes/users.js', expected: '/users' },
    { input: 'src/routes/api/index.js', expected: '/api' },
    { input: 'src/utils/helper.js', expected: null },
    { input: 'package.json', expected: null }
  ];

  for (const t of routeTests) {
    const success = runTest(`extractRoute maps "${t.input}" to "${t.expected}"`, () => {
      const actual = extractRoute(t.input);
      assert.strictEqual(actual, t.expected);
    });
    if (success) passed++; else failed++;
  }

  // Test execution with --offline
  const offlineSuccess = runTest('generator runs successfully with --offline flag', () => {
    const result = spawnSync('node', [generatorPath, '--offline'], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.strictEqual(result.status, 0, `Script failed with error: ${result.stderr}`);

    const statusJsonPath = path.join(repoRoot, '.agent', 'state', 'repo-status.json');
    const statusMdPath = path.join(repoRoot, '.agent', 'state', 'repo-status.md');

    assert.ok(fs.existsSync(statusJsonPath), 'repo-status.json should exist');
    assert.ok(fs.existsSync(statusMdPath), 'repo-status.md should exist');

    const statusJson = JSON.parse(fs.readFileSync(statusJsonPath, 'utf8'));
    assert.strictEqual(statusJson.ci_status, 'unknown (offline/error)');
    assert.ok(statusJson.branch, 'branch field should be present');
    assert.ok(statusJson.head_sha, 'head_sha field should be present');
  });

  if (offlineSuccess) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Unhandled failure in test suite:', err);
  process.exit(1);
});
