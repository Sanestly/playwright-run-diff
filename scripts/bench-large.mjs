#!/usr/bin/env node
/**
 * Large-archive performance benchmark.
 *
 * Builds synthetic-but-format-faithful trace archives at several sizes,
 * then measures ZIP validation, parse, and compare time plus peak RSS.
 * Synthetic load fixtures exercise the real code path; they complement
 * (not replace) the real recorded fixtures used for correctness tests.
 *
 * Usage: node --expose-gc scripts/bench-large.mjs
 */
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { zipSync, strToU8 } from 'fflate';
import { readTraceArchive } from '../packages/trace-reader/dist/index.js';
import { compareRuns } from '../packages/analysis/dist/index.js';
import { DEFAULT_COMPARISON_SETTINGS } from '../packages/contracts/dist/index.js';

function fmtMs(t) { return `${(t).toFixed(0)}ms`; }
function fmtMb(b) { return `${(b / 1048576).toFixed(1)}MiB`; }

function mem() {
  globalThis.gc?.();
  return process.memoryUsage().rss;
}

/** Build a trace zip with `actions` actions and `shotBytes`-sized pseudo-JPEG frames. */
function buildTrace({ actions, shots, shotBytes, variant }) {
  const traceLines = [];
  traceLines.push(JSON.stringify({
    version: 10, type: 'context-options', origin: 'library', browserName: 'chromium',
    playwrightVersion: '1.64.1', platform: 'darwin', wallTime: 1792340000000,
    monotonicTime: 100, sdkLanguage: 'javascript', options: { viewport: { width: 800, height: 600 } },
  }));
  for (let i = 0; i < actions; i++) {
    const t = 200 + i * 12;
    const variantExtra = variant === 'b' && i % 997 === 0 ? '_extra' : '';
    traceLines.push(JSON.stringify({
      type: 'before', callId: `c${i}`, startTime: t, class: 'Frame',
      method: i % 3 === 0 ? 'click' : i % 3 === 1 ? 'fill' : 'goto',
      params: { selector: `#el-${i % 50}${variantExtra}` },
    }));
    traceLines.push(JSON.stringify({
      type: 'after', callId: `c${i}`, endTime: t + (i % 7) + (variant === 'b' && i % 5 === 0 ? 8 : 0),
    }));
  }
  for (let i = 0; i < shots; i++) {
    traceLines.push(JSON.stringify({
      type: 'screencast-frame', file: `screencast/f${i}.jpeg`,
      width: 800, height: 600, timestamp: 300 + i * 400,
    }));
  }
  traceLines.push(JSON.stringify({ type: 'console', messageType: 'log', text: 'bench ready', time: 400 }));

  const netLines = [];
  const reqs = Math.floor(actions / 4);
  for (let i = 0; i < reqs; i++) {
    netLines.push(JSON.stringify({
      type: 'resource-snapshot', snapshot: {
        pageref: 'page@1', _monotonicTime: 250 + i * 40,
        request: { url: `http://127.0.0.1:8000/api/${i % 20}`, method: 'GET', headers: [] },
        response: { status: variant === 'b' && i % 97 === 0 ? 500 : 200, _timing: {}, headers: [] },
        _resourceType: 'fetch',
      },
    }));
  }

  const files = {
    'trace.trace': strToU8(traceLines.join('\n')),
    'trace.network': strToU8(netLines.join('\n')),
  };
  // pseudo-JPEG payloads - random bytes are incompressible like real images
  for (let i = 0; i < shots; i++) {
    files[`screencast/f${i}.jpeg`] = randomBytes(shotBytes);
  }
  return zipSync(files, { level: 6 });
}

function bench(label, zip, opts) {
  const m0 = mem();
  const t0 = performance.now();
  const parsed = readTraceArchive(zip, opts);
  const t1 = performance.now();
  const m1 = mem();
  return { parsed, parseMs: t1 - t0, rssDeltaMb: m1 - m0, zipBytes: zip.length };
}

const SIZES = [
  { name: 'small', actions: 2000, shots: 50, shotBytes: 80 * 1024 },
  { name: 'medium', actions: 12000, shots: 200, shotBytes: 200 * 1024 },
  { name: 'large', actions: 40000, shots: 450, shotBytes: 250 * 1024 },
];

console.log('node', process.version, 'platform', process.platform, 'arch', process.arch);
const results = [];

for (const s of SIZES) {
  const before = buildTrace({ ...s, variant: 'a' });
  const after = buildTrace({ ...s, variant: 'b' });
  const sizeBytes = (before.length + after.length) / 2;
  console.log(`\n=== ${s.name}: ~${fmtMb(sizeBytes)} compressed per side (${s.actions} actions, ${s.shots} shots)`);

  const pa = bench('before', before, {});
  const pb = bench('after', after, {});
  console.log(`  parse+normalize: ${fmtMs(pa.parseMs)}/${fmtMs(pb.parseMs)}  rss +${fmtMb(Math.max(pa.rssDeltaMb, pb.rssDeltaMb))}`);

  const m0 = mem();
  const t0 = performance.now();
  const report = compareRuns({
    before: pa.parsed.trace.runs[0],
    after: pb.parsed.trace.runs[0],
    settings: DEFAULT_COMPARISON_SETTINGS,
    // pseudo-JPEG payloads are random bytes - decode would fail anyway;
    // pixel-diff timing is covered by real fixtures in e2e/unit tests.
    pixelDiffer: () => ({ comparable: false, reason: 'bench: decode skipped' }),
  });
  const t1 = performance.now();
  const m1 = mem();
  console.log(`  compare (no pixel decode): ${fmtMs(t1 - t0)}  rss +${fmtMb(m1 - m0)}  findings: ${report.findings.length}`);
  results.push({ name: s.name, sizeMb: sizeBytes / 1048576, parseMs: Math.max(pa.parseMs, pb.parseMs), compareMs: t1 - t0 });
}

// oversized archive must be rejected BEFORE decompressing the payload
const huge = buildTrace({ actions: 1000, shots: 20, shotBytes: 20 * 1024 * 1024, variant: 'a' });
console.log(`\n=== oversized: ${fmtMb(huge.length)} compressed`);
try {
  readTraceArchive(huge, {});
  console.log('  ERROR: oversized archive accepted');
} catch (e) {
  console.log(`  rejected as expected: [${e.code}] ${e.message.slice(0, 80)}`);
}

// malformed JSONL inside a valid archive
const corrupt = zipSync({
  'trace.trace': strToU8(
    '{"version":10,"type":"context-options","browserName":"chromium","playwrightVersion":"1.64.1"}\n' +
    '{broken json !!!!\n' +
    '{"type":"before","callId":"x1","startTime":100,"class":"Frame","method":"click","params":{"selector":"#a"}}\n' +
    '{"type":"after","callId":"x1","endTime":120}\n',
  ),
});
const pc = readTraceArchive(corrupt, {});
console.log(`\ncorrupt-line archive: warnings=${pc.trace.warnings.length} actions=${pc.trace.runs[0].actions.length}`);

console.log('\nsummary:', JSON.stringify(results, null, 1));
