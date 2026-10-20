import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readTraceArchive } from '../src/reader.js';

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'generated',
);

const has = existsSync(join(FIXTURES, 'sample-a', 'baseline.zip'));
const has160 = existsSync(join(FIXTURES, 'v1.60', 'baseline.zip'));
const hasTestRunner = existsSync(join(FIXTURES, 'test-runner', 'baseline.zip'));
const hasFirefox = existsSync(join(FIXTURES, 'firefox', 'sample-a', 'baseline.zip'));
const hasWebkit = existsSync(join(FIXTURES, 'webkit', 'sample-a', 'baseline.zip'));

describe.skipIf(!has)('real playwright fixtures (1.64.1 chromium)', () => {
  it('parses baseline archive into a normalized run', () => {
    const a = readTraceArchive(
      new Uint8Array(readFileSync(join(FIXTURES, 'sample-a', 'baseline.zip'))),
      { sourceLabel: 'baseline.zip' },
    );
    expect(a.trace.recordedVersion).toBe('1.64.1');
    expect(a.trace.browser).toBe('chromium');
    const run = a.trace.runs[0]!;
    expect(run.actions.length).toBeGreaterThanOrEqual(5);
    expect(run.requests.length).toBeGreaterThanOrEqual(3);
    expect(run.screenshots.length).toBeGreaterThan(0);
    expect(run.capabilities.actions).toBe('available');
    expect(run.capabilities.screenshots).toBe('available');
    // every action has sane monotonic timing
    for (const act of run.actions) {
      expect(act.startMs).toBeGreaterThanOrEqual(0);
      if (act.endMs !== undefined) expect(act.endMs).toBeGreaterThanOrEqual(act.startMs);
    }
  });

  it('serves lazy resource bytes for screenshots', () => {
    const a = readTraceArchive(
      new Uint8Array(readFileSync(join(FIXTURES, 'sample-a', 'baseline.zip'))),
      {},
    );
    const shot = a.trace.runs[0]!.screenshots[0]!;
    const bytes = a.getResource(shot.resourcePath);
    expect(bytes).toBeDefined();
    expect(bytes!.length).toBeGreaterThan(100);
  });

  it('keeps internal action logs out of the console stream', () => {
    const a = readTraceArchive(
      new Uint8Array(readFileSync(join(FIXTURES, 'sample-a', 'baseline.zip'))),
      {},
    );
    const run = a.trace.runs[0]!;
    // The real archive records exactly one browser console line ("page ready")
    // plus several internal action logs ("navigating to ...").
    expect(run.consoleEvents.length).toBeLessThan(4);
    expect(run.actions.some((act) => (act.logs?.length ?? 0) > 0)).toBe(true);
  });
});

describe.skipIf(!has160)('real playwright fixtures (1.60.0 chromium)', () => {
  it('parses a second Playwright version', () => {
    const a = readTraceArchive(
      new Uint8Array(readFileSync(join(FIXTURES, 'v1.60', 'baseline.zip'))),
      { sourceLabel: 'v160-baseline.zip' },
    );
    expect(a.trace.recordedVersion).toBe('1.60.0');
    expect(a.trace.browser).toBe('chromium');
    const run = a.trace.runs[0]!;
    expect(run.actions.length).toBeGreaterThanOrEqual(4);
    expect(run.requests.length).toBeGreaterThanOrEqual(2);
    // 1.60 stores screencast frames under resources/ rather than screencast/
    expect(run.screenshots.length).toBeGreaterThan(0);
    expect(run.capabilities.screenshots).toBe('available');
    for (const act of run.actions) {
      expect(act.startMs).toBeGreaterThanOrEqual(0);
      if (act.endMs !== undefined) expect(act.endMs).toBeGreaterThanOrEqual(act.startMs);
    }
  });
});

describe.skipIf(!hasTestRunner)('real playwright test-runner fixtures (1.64.1)', () => {
  it('exposes multi-stream test.trace plus context traces', () => {
    const a = readTraceArchive(
      new Uint8Array(readFileSync(join(FIXTURES, 'test-runner', 'baseline.zip'))),
      {},
    );
    expect(a.trace.recordedVersion).toBe('1.64.1');
    expect(a.trace.runs.length).toBeGreaterThanOrEqual(3);
    const testRun = a.trace.runs.find((r) => r.id === 'run:test')!;
    expect(testRun.actions.length).toBeGreaterThanOrEqual(10);
    // test steps, hooks and expect() calls come from the testRunner stream
    expect(testRun.capabilities.assertions).toBe('available');
    const ctxRun = a.trace.runs.find((r) => r.id === 'run:1-trace')!;
    expect(ctxRun.requests.length).toBeGreaterThanOrEqual(2);
    expect(ctxRun.screenshots.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasFirefox)('real playwright fixtures (1.64.1 firefox)', () => {
  it('parses firefox context.tracing archive', () => {
    const a = readTraceArchive(
      new Uint8Array(readFileSync(join(FIXTURES, 'firefox', 'sample-a', 'baseline.zip'))),
      {},
    );
    expect(a.trace.recordedVersion).toBe('1.64.1');
    expect(a.trace.browser).toBe('firefox');
    const run = a.trace.runs[0]!;
    expect(run.actions.length).toBeGreaterThanOrEqual(5);
    expect(run.requests.length).toBeGreaterThanOrEqual(3);
    expect(run.screenshots.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasWebkit)('real playwright fixtures (1.64.1 webkit)', () => {
  it('parses webkit context.tracing archive', () => {
    const a = readTraceArchive(
      new Uint8Array(readFileSync(join(FIXTURES, 'webkit', 'sample-a', 'baseline.zip'))),
      {},
    );
    expect(a.trace.recordedVersion).toBe('1.64.1');
    expect(a.trace.browser).toBe('webkit');
    const run = a.trace.runs[0]!;
    expect(run.actions.length).toBeGreaterThanOrEqual(5);
    expect(run.requests.length).toBeGreaterThanOrEqual(3);
    expect(run.screenshots.length).toBeGreaterThan(0);
  });
});

describe.skipIf(existsSync(join(FIXTURES, 'test-runner-firefox', 'baseline.zip')) === false)(
  'real test-runner fixtures (1.64.1 firefox + webkit)',
  () => {
    it.each(['test-runner-firefox', 'test-runner-webkit'])(
      'parses multi-stream %s archive and keeps context browser name',
      (dir) => {
        const zip = join(FIXTURES, dir, 'baseline.zip');
        if (!existsSync(zip)) return;
        const a = readTraceArchive(new Uint8Array(readFileSync(zip)), {});
        expect(a.trace.runs.length).toBeGreaterThanOrEqual(3);
        // archive-level browser must come from the context stream, not the
        // empty browserName in the testRunner stream
        expect(a.trace.browser).toBeTruthy();
        const testRun = a.trace.runs.find((r) => r.id === 'run:test')!;
        expect(testRun.capabilities.assertions).toBe('available');
      },
    );

    it('marks failed assertion steps as failed actions', () => {
      const zip = join(FIXTURES, 'test-runner', 'failing-baseline.zip');
      if (!existsSync(zip)) return;
      const a = readTraceArchive(new Uint8Array(readFileSync(zip)), {});
      const all = a.trace.runs.flatMap((r) => r.actions);
      expect(all.some((x) => x.status === 'failed')).toBe(true);
      const failed = all.find((x) => x.status === 'failed')!;
      expect(failed.label).toContain('toBeVisible');
    });
  },
);
