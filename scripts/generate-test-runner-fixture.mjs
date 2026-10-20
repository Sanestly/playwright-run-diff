#!/usr/bin/env node
/**
 * Generate a Playwright Test runner trace fixture (origin "testRunner").
 *
 * Unlike context.tracing archives, these zips contain multiple streams
 * (test.trace + N-trace.* per context), test steps, hooks and assertion
 * events - covering a second producer shape.
 *
 * Usage: node scripts/generate-test-runner-fixture.mjs
 * Requires: @playwright/test + `npx playwright install chromium`.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT =
  process.env.FIXTURE_OUT ??
  join(ROOT, 'fixtures', 'generated', 'test-runner');
const WORK = join(ROOT, 'fixtures', '.test-runner-work');
const PORT = 49883;

const SPEC = `import { test, expect } from '@playwright/test';
import http from 'node:http';

const PORT = ${PORT};
function pageHtml(variant) {
  const title = variant === 'b' ? 'Run Diff Demo - updated' : 'Run Diff Demo';
  return \`<!doctype html><html><body><h1>\${title}</h1><input id="name"/><button id="load">Load</button>\${variant === 'b' ? '<button id="extra">Extra</button>' : ''}<div id="out">idle</div>
<script>document.getElementById('load').addEventListener('click', async () => { const r = await fetch('/api/data'); const j = await r.json(); document.getElementById('out').textContent = 'loaded:' + (j.value ?? j.error); });
const ex = document.getElementById('extra'); if (ex) ex.addEventListener('click', () => { document.getElementById('out').textContent = 'x'; });
\${variant === 'b' ? "console.error('demo page error in candidate');" : ''}</script></body></html>\`;
}
let server;
test.beforeAll(async () => {
  const variant = process.env.FIXTURE_VARIANT ?? 'a';
  server = http.createServer((req, res) => {
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end(pageHtml(variant)); }
    else if (req.url === '/api/data') { res.setHeader('content-type', 'application/json'); if (variant === 'b') { res.statusCode = 500; res.end('{"error":"boom"}'); } else res.end('{"value":42}'); }
    else { res.statusCode = 404; res.end(); }
  }).listen(PORT, '127.0.0.1');
});
test.afterAll(() => server.close());
test.use({ trace: 'on', browserName: process.env.FIXTURE_BROWSER ?? 'chromium' });
test('demo flow', async ({ page }) => {
  await page.goto('http://127.0.0.1:' + PORT + '/');
  await test.step('fill name', async () => { await page.fill('#name', 'run-diff'); });
  await page.click('#load');
  await expect(page.locator('#out')).toContainText('loaded:');
  if ((process.env.FIXTURE_VARIANT ?? 'a') === 'b') await page.click('#extra');
});

// Deliberately expected-fail test: its trace records failed assertion steps.
test('failing check', async ({ page }) => {
  test.fail();
  await page.goto('http://127.0.0.1:' + PORT + '/');
  await expect(page.locator('#does-not-exist')).toBeVisible({ timeout: 1000 });
});
`;

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(WORK, 'demo.spec.ts'), SPEC);

for (const [variant, name] of [['a', 'baseline.zip'], ['b', 'candidate.zip']]) {
  const outDir = join(WORK, 'test-results');
  rmSync(outDir, { recursive: true, force: true });
  execFileSync(
    'npx',
    ['playwright', 'test', 'demo.spec.ts', '--reporter=list', '--output', outDir],
    {
      cwd: WORK,
      env: { ...process.env, FIXTURE_VARIANT: variant },
      stdio: 'inherit',
    },
  );
  const zip = join(outDir, 'demo-demo-flow', 'trace.zip');
  const failZip = join(outDir, 'demo-failing-check', 'trace.zip');
  if (!existsSync(zip)) throw new Error(`trace.zip not produced for variant ${variant}`);
  copyFileSync(zip, join(OUT, name));
  // failed-step trace is a separate artifact - keep it alongside the pair
  if (existsSync(failZip)) copyFileSync(failZip, join(OUT, `failing-${name}`));
}
rmSync(WORK, { recursive: true, force: true });
console.log(`test-runner fixtures written to ${OUT}`);
