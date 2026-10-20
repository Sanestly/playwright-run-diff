#!/usr/bin/env node
/**
 * Capture real screenshots of the production build for docs/README/OG.
 * Also performs quick a11y checks (tab order, aria-live, labels).
 * Requires `pnpm --filter @sanestly/web build` first.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'apps', 'web', 'dist');
const OUT = join(ROOT, 'docs', 'media');
mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.zip': 'application/zip', '.png': 'image/png', '.json': 'application/json',
};
const server = createServer((req, res) => {
  let p = join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(DIST) || !existsSync(p) || statSync(p).isDirectory()) p = join(DIST, 'index.html');
  try {
    res.setHeader('content-type', MIME[extname(p)] ?? 'application/octet-stream');
    res.end(readFileSync(p));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const issues = [];

await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForSelector('text=Compare two Playwright runs');

// --- a11y probes ---
const ariaLive = await page.locator('[aria-live]').count();
if (ariaLive === 0) issues.push('no aria-live region for progress announcements');
const skiplink = await page.locator('a[href="#main"], [class*="skip"]').count();
const dropzones = await page.locator('[role="button"][aria-label]').count();
console.log('a11y probes: aria-live regions:', ariaLive, '| skip link:', skiplink, '| labelled drop zones:', dropzones);

// tab order: first few focusable elements should be meaningful
const tabOrder = [];
for (let i = 0; i < 8; i++) {
  await page.keyboard.press('Tab');
  const info = await page.evaluate(() => {
    /* global document */
    const el = document.activeElement;
    return el ? `${el.tagName.toLowerCase()}[${el.getAttribute('role') ?? ''}] ${(el.textContent ?? '').slice(0, 40).trim()}` : 'none';
  });
  tabOrder.push(info);
}
console.log('tab order:', JSON.stringify(tabOrder, null, 1));

await page.screenshot({ path: join(OUT, 'landing.png') });

// --- run the sample comparison and capture each view ---
await page.click('text=Try sample traces');
await page.waitForSelector('text=Findings', { timeout: 30000 });
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, 'dashboard.png') });

await page.click('text=Actions');
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, 'actions.png') });

await page.click('text=Network');
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, 'network.png') });

await page.click('text=Visual');
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, 'visual.png') });

await page.click('text=Settings & Export');
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, 'export.png') });

// dark theme check
const themeBtn = page.locator('button', { hasText: /theme|dark|light/i });
if (await themeBtn.count()) {
  await themeBtn.first().click();
  await page.click('text=Dashboard');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, 'dashboard-dark.png') });
  await themeBtn.first().click();
}

// mobile layout check
await page.setViewportSize({ width: 390, height: 844 });
await page.click('text=Dashboard');
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, 'mobile.png') });

const overflows = await page.evaluate(() => {
  /* global window */
  return document.documentElement.scrollWidth > window.innerWidth + 4;
});
if (overflows) issues.push('horizontal overflow at 390px viewport');

// OG/social preview image: framed landing+hero composite
await page.setViewportSize({ width: 1200, height: 630 });
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForSelector('text=Compare two Playwright runs');
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, 'og-preview.png') });

// short demo GIF: capture frames while re-running the flow
await page.setViewportSize({ width: 1100, height: 700 });
const framesDir = join(OUT, 'demo-frames');
mkdirSync(framesDir, { recursive: true });
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForSelector('text=Compare two Playwright runs');
let f = 0;
const snap = async () => { await page.screenshot({ path: join(framesDir, `f${String(f++).padStart(2, '0')}.png`) }); };
await snap(); await snap();
await page.click('text=Try sample traces');
await snap();
await page.waitForSelector('text=Findings', { timeout: 30000 });
await snap();
await page.click('text=Visual');
await page.waitForTimeout(1200);
await snap(); await snap();
await page.click('text=Actions');
await page.waitForTimeout(400);
await snap();
console.log('demo frames:', f);

console.log('a11y issues found:', issues.length ? issues : 'none (automated checks)');
console.log('assets written to', OUT);

await browser.close();
server.close();
