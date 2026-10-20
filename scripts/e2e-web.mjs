#!/usr/bin/env node
/**
 * Minimal E2E smoke: serves apps/web/dist and drives the demo path with
 * real Chromium. Requires `pnpm --filter @sanestly/web build` first.
 *
 * Covers E01/E02 basics: demo loads, sample comparison completes,
 * findings render, no JS errors.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';

const BROWSER_NAME = process.env.E2E_BROWSER ?? 'chromium';
const BROWSERS = { chromium, firefox, webkit };
const browserType = BROWSERS[BROWSER_NAME];
if (!browserType) {
  console.error(`unknown E2E_BROWSER "${BROWSER_NAME}" (expected: ${Object.keys(BROWSERS).join(', ')})`);
  process.exit(2);
}

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'dist');
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.zip': 'application/zip',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('apps/web/dist missing - run `pnpm --filter @sanestly/web build` first');
  process.exit(2);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let path = join(DIST, decodeURIComponent(url.pathname));
  if (
    !path.startsWith(DIST) ||
    !existsSync(path) ||
    statSync(path).isDirectory()
  ) {
    path = join(DIST, 'index.html');
  }
  try {
    const body = readFileSync(path);
    res.setHeader('content-type', MIME[extname(path)] ?? 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end();
  }
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await browserType.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

try {
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('text=Compare two Playwright runs', { timeout: 10000 });
  await page.click('text=Try sample traces');
  await page.waitForSelector('text=Findings', { timeout: 30000 });
  const dash = await page.textContent('main');
  if (!dash.includes('500')) throw new Error('expected 500-status finding on dashboard');
  await page.click('text=Actions');
  await page.waitForTimeout(400);
  const rows = await page.locator('tbody tr').count();
  if (rows < 5) throw new Error(`expected aligned action rows, got ${rows}`);
  await page.click('text=Network');
  await page.waitForTimeout(400);
  await page.click('text=Visual');
  await page.waitForTimeout(1200);
  const imgs = await page.locator('img').count();
  if (imgs === 0) throw new Error('no screenshots rendered in visual view');
  await page.click('text=Settings & Export');
  await page.waitForSelector('text=Export sanitized report', { timeout: 5000 });
  if (errors.length) throw new Error(`JS errors: ${errors.join(' | ')}`);
  console.log(`e2e-web: PASS [${BROWSER_NAME}] (landing, sample compare, dashboard, actions, network, visual, settings)`);
  process.exitCode = 0;
} catch (err) {
  console.error('e2e-web: FAIL', err.message);
  if (errors.length) console.error('  errors:', errors.join(' | '));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
