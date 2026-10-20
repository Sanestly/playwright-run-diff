import { describe, expect, it } from 'vitest';
import type { NormalizedAction, TraceRun } from '@sanestly/contracts';
import { compareRuns } from '../src/compare.js';
import { diffRgba } from '../src/visual.js';

function action(id: string, over: Partial<NormalizedAction> = {}): NormalizedAction {
  return { id, label: id, startMs: 0, endMs: 10, status: 'ok', ...over };
}

function run(over: Partial<TraceRun>): TraceRun {
  return {
    id: 'r',
    label: 'r',
    actions: [],
    requests: [],
    consoleEvents: [],
    errors: [],
    screenshots: [],
    capabilities: { actions: 'available', requests: 'absent', screenshots: 'absent', assertions: 'absent' },
    ...over,
  };
}

describe('compareRuns', () => {
  it('identical runs produce no behavioral findings', () => {
    const actions = [action('a', { apiName: 'click', locatorFingerprint: '#x' })];
    const r = compareRuns({ before: run({ actions }), after: run({ actions: actions.map((a) => ({ ...a, id: 'a2' })) }) });
    const behavioral = r.findings.filter((f) => f.status !== 'unmatched' && f.category !== 'visual');
    expect(behavioral.filter((f) => f.severity !== 'info')).toEqual([]);
  });

  it('flags timing regression only past both thresholds', () => {
    const before = run({ actions: [action('a', { endMs: 100 })] });
    const after = run({ actions: [action('b', { endMs: 250 })] });
    const r = compareRuns({ before, after, settings: { timing: { minAbsoluteMs: 100, minRelativeIncrease: 0.2 }, match: { minimumConfidence: 0.3 }, visuals: { maxPixelDiffRatio: 0.01, maskRects: [] }, ignore: { urlPatterns: [], actionPatterns: [], responseHeaders: [] } } });
    expect(r.findings.some((f) => f.ruleId === 'RD-TIM-001')).toBe(true);
  });

  it('small deltas below threshold do not flag', () => {
    const before = run({ actions: [action('a', { endMs: 100 })] });
    const after = run({ actions: [action('b', { endMs: 110 })] });
    const r = compareRuns({ before, after, settings: { timing: { minAbsoluteMs: 100, minRelativeIncrease: 0.2 }, match: { minimumConfidence: 0.3 }, visuals: { maxPixelDiffRatio: 0.01, maskRects: [] }, ignore: { urlPatterns: [], actionPatterns: [], responseHeaders: [] } } });
    expect(r.findings.some((f) => f.ruleId === 'RD-TIM-001')).toBe(false);
  });

  it('flags 200 -> 500 status change as high', () => {
    const req = (id: string, status: number) => ({
      id,
      method: 'GET',
      normalizedUrl: 'http://x/api',
      rawUrlAvailable: true,
      status,
      startMs: 0,
      endMs: 10,
    });
    const r = compareRuns({
      before: run({ requests: [req('r1', 200)], capabilities: { actions: 'absent', requests: 'available', screenshots: 'absent', assertions: 'absent' } }),
      after: run({ requests: [req('r2', 500)], capabilities: { actions: 'absent', requests: 'available', screenshots: 'absent', assertions: 'absent' } }),
    });
    const f = r.findings.find((f) => f.ruleId === 'RD-NET-004');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('high');
  });
});

describe('diffRgba', () => {
  it('reports incomparable dimensions instead of resizing', () => {
    const a = { width: 2, height: 2, data: new Uint8Array(16) };
    const b = { width: 4, height: 4, data: new Uint8Array(64) };
    const r = diffRgba(a, b, {
      timing: { minAbsoluteMs: 0, minRelativeIncrease: 0 },
      match: { minimumConfidence: 0 },
      visuals: { maxPixelDiffRatio: 0.01, maskRects: [] },
      ignore: { urlPatterns: [], actionPatterns: [], responseHeaders: [] },
    });
    expect(r.comparable).toBe(false);
    expect(r.reason).toMatch(/incomparable dimensions/);
  });

  it('counts changed pixels on equal-size images', () => {
    const mk = (v: number) => ({ width: 2, height: 2, data: new Uint8Array(16).fill(v) });
    const r = diffRgba(mk(0), mk(255), {
      timing: { minAbsoluteMs: 0, minRelativeIncrease: 0 },
      match: { minimumConfidence: 0 },
      visuals: { maxPixelDiffRatio: 0.01, maskRects: [] },
      ignore: { urlPatterns: [], actionPatterns: [], responseHeaders: [] },
    });
    expect(r.comparable).toBe(true);
    expect(r.changedRatio).toBe(1);
  });
});
