#!/usr/bin/env node
/**
 * Generate REAL Playwright trace fixtures.
 *
 * Spins up a deterministic local HTTP server, drives it with Playwright
 * tracing enabled, and writes paired trace zips into fixtures/.
 *
 * Usage: node scripts/generate-fixtures.mjs
 * Requires: @playwright/test + `npx playwright install chromium`.
 */
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

// Point PW_MODULE at an alternative playwright/playwright-core installation
// to pin fixtures to a second producer version, e.g.
//   PW_MODULE=/path/to/node_modules/playwright-core/index.mjs node scripts/generate-fixtures.mjs
const { chromium, firefox, webkit } = await import(process.env.PW_MODULE ?? '@playwright/test');
const BROWSER_NAME = process.env.FIXTURE_BROWSER ?? 'chromium';
const BROWSERS = { chromium, firefox, webkit };
const browserType = BROWSERS[BROWSER_NAME];
if (!browserType) {
  console.error(`unknown FIXTURE_BROWSER "${BROWSER_NAME}"`);
  process.exit(2);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.FIXTURE_OUT ?? join(ROOT, 'fixtures', 'generated');

function makePng(colorA, colorB) {
  const png = new PNG({ width: 64, height: 64 });
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const idx = (y * 64 + x) * 4;
      const c = (x >> 3) % 2 === (y >> 3) % 2 ? colorA : colorB;
      png.data[idx] = c[0];
      png.data[idx + 1] = c[1];
      png.data[idx + 2] = c[2];
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

const IMG = makePng([60, 120, 200], [240, 240, 240]);
const IMG_ALT = makePng([200, 90, 60], [240, 240, 240]);

function pageHtml(variant) {
  const title = variant === 'b' ? 'Run Diff Demo - updated' : 'Run Diff Demo';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;padding:2rem}#out{margin-top:1rem;padding:1rem;border:1px solid #ccc}img{margin-top:1rem}</style>
</head><body>
<h1>${title}</h1>
<input id="name" placeholder="name"/>
<button id="load">Load data</button>
${variant === 'b' ? '<button id="extra">Extra action</button>' : ''}
<div id="out">idle</div>
<img src="/img.png" width="64"/>
<script>
document.getElementById('load').addEventListener('click', async () => {
  const r = await fetch('/api/data');
  const j = await r.json();
  document.getElementById('out').textContent = 'loaded:' + j.value;
});
const ex = document.getElementById('extra');
if (ex) ex.addEventListener('click', () => { document.getElementById('out').textContent = 'extra clicked'; });
console.log('page ready');
${variant === 'b' ? "console.error('demo page error in candidate');" : ''}
</script>
</body></html>`;
}

const FIXED_PORT = Number(process.env.FIXTURE_PORT ?? 49777);

function startServer(variant) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/') {
        res.setHeader('content-type', 'text/html');
        res.end(pageHtml(variant));
      } else if (url.pathname === '/api/data') {
        res.setHeader('content-type', 'application/json');
        if (variant === 'b') {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'boom' }));
        } else {
          res.end(JSON.stringify({ value: 42 }));
        }
      } else if (url.pathname === '/api/secure') {
        // Deliberately receives credential-looking query params so the
        // redaction pipeline can be proven against real traces.
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      } else if (url.pathname === '/api/slow') {
        setTimeout(() => {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        }, variant === 'b' ? 400 : 60);
      } else if (url.pathname === '/img.png') {
        res.setHeader('content-type', 'image/png');
        res.end(variant === 'b' ? IMG_ALT : IMG);
      } else {
        res.statusCode = 404;
        res.end('not found');
      }
    });
    // Fixed port keeps request URLs byte-identical across fixture runs so
    // network alignment can demonstrate real matches.
    server.once('error', reject);
    server.listen(FIXED_PORT, '127.0.0.1', () => resolve(server));
  });
}

async function record(variant, outZip) {
  const server = await startServer(variant);
  const port = server.address().port;
  const browser = await browserType.launch();
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.fill('#name', 'run-diff');
  await page.click('#load');
  await page.waitForTimeout(150);
  if (variant === 'b') await page.click('#extra');
  await page.evaluate(() => fetch('/api/slow').then((r) => r.json()));
  if (variant === 'b') {
    // Request with credential-looking query params - must never survive
    // into normalized output or exported reports.
    await page.evaluate(() =>
      fetch(
        '/api/secure?access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c&session=deadbeefcafe1234&name=public',
      ).then((r) => r.json()),
    );
  }
  await context.tracing.stop({ path: outZip });
  await browser.close();
  server.close();
}

async function recordIdentical(outZip) {
  const server = await startServer('a');
  const port = server.address().port;
  const browser = await browserType.launch();
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.fill('#name', 'run-diff');
  await page.click('#load');
  await page.waitForTimeout(80);
  await context.tracing.stop({ path: outZip });
  await browser.close();
  server.close();
}

const pwVersion = (await import(`${process.env.PW_MODULE ? dirname(process.env.PW_MODULE) : '@playwright/test'}/package.json`, { with: { type: 'json' } }).catch(() => null))
  ?.default?.version ?? 'unknown';

mkdirSync(join(OUT, 'sample-a'), { recursive: true });
mkdirSync(join(OUT, 'identical'), { recursive: true });

await record('a', join(OUT, 'sample-a', 'baseline.zip'));
await record('b', join(OUT, 'sample-a', 'candidate.zip'));
await recordIdentical(join(OUT, 'identical', 'baseline.zip'));
await recordIdentical(join(OUT, 'identical', 'candidate.zip'));

// When writing to a custom FIXTURE_OUT (e.g. per-browser/per-version runs),
// record provenance locally; the curated MANIFEST.json is updated by hand.
writeFileSync(
  join(OUT, '.provenance.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), playwrightVersion: pwVersion, browser: BROWSER_NAME }) + '\n',
);

console.log(`fixtures written to ${OUT} (playwright ${pwVersion}, ${BROWSER_NAME})`);
