import { describe, expect, it } from 'vitest';
import type { NormalizedAction, TraceRun } from '@sanestly/contracts';
import { DEFAULT_COMPARISON_SETTINGS } from '@sanestly/contracts';
import { aggregateActionDurations, aggregateTimingFindings } from '../src/aggregate.js';
import { resetFindingCounter } from '../src/findings.js';

let n = 0;
function act(durationMs: number, key = 'Page.click'): NormalizedAction {
  n += 1;
  return { id: `a${n}`, label: key, apiName: key.split('.').pop(), startMs: 0, endMs: durationMs, status: 'ok' };
}

function run(durations: number[], key = 'Page.click'): TraceRun {
  return {
    id: `run${n}`,
    label: 'r',
    actions: durations.map((d) => act(d, key)),
    requests: [],
    consoleEvents: [],
    errors: [],
    screenshots: [],
    capabilities: { actions: 'available', requests: 'absent', screenshots: 'absent', assertions: 'absent' },
  };
}

describe('aggregateActionDurations', () => {
  it('computes honest median/p90/IQR with sample counts', () => {
    const runs = [run([100, 200]), run([110, 210]), run([120, 190]), run([105, 205])];
    const stats = aggregateActionDurations(runs);
    // Occurrence-0 group: [100,105,110,120] -> nearest-rank median 105
    // Occurrence-1 group: [190,200,205,210] -> nearest-rank median 200
    const s = [...stats.values()].find((x) => x.medianMs > 150)!;
    expect(s.count).toBe(4);
    expect(s.medianMs).toBe(200);
    expect(s.p90Ms).toBeUndefined(); // n<10 -> no p90 claim
    expect(s.iqrMs).toBeDefined();
    expect(s.minMs).toBeLessThanOrEqual(s.maxMs);
  });
});

describe('aggregateTimingFindings', () => {
  it('flags median regressions only when both sides have enough runs', () => {
    resetFindingCounter();
    const beforeRuns = [run([100]), run([100]), run([110])];
    const afterRuns = [run([400]), run([420]), run([390])];
    const findings = aggregateTimingFindings(beforeRuns, afterRuns, DEFAULT_COMPARISON_SETTINGS);
    expect(findings.length).toBe(1);
    expect(findings[0]!.ruleId).toBe('RD-TIM-002');
    expect(findings[0]!.title).toContain('median');
    expect(findings[0]!.details).toContain('not a formal significance test');
  });

  it('does not fire when a side has only one run', () => {
    resetFindingCounter();
    const findings = aggregateTimingFindings(
      [run([100])],
      [run([400]), run([420])],
      DEFAULT_COMPARISON_SETTINGS,
    );
    expect(findings.length).toBe(0);
  });

  it('does not fire below thresholds', () => {
    resetFindingCounter();
    const findings = aggregateTimingFindings(
      [run([100]), run([105])],
      [run([110]), run([115])],
      DEFAULT_COMPARISON_SETTINGS,
    );
    expect(findings.length).toBe(0);
  });

  it('warns on small samples (n<10) and reports p90 only at n>=10', () => {
    resetFindingCounter();
    const small = aggregateTimingFindings(
      [run([100]), run([100]), run([100])],
      [run([900]), run([900]), run([900])],
      DEFAULT_COMPARISON_SETTINGS,
    );
    expect(small[0]!.details).toContain('Small sample');
    expect(small[0]!.details).toContain('p90 not reported');

    resetFindingCounter();
    const enough = aggregateTimingFindings(
      Array.from({ length: 10 }, () => run([100])),
      Array.from({ length: 10 }, () => run([900])),
      DEFAULT_COMPARISON_SETTINGS,
    );
    expect(enough[0]!.details).not.toContain('Small sample');
    expect(enough[0]!.details).toContain('p90');
    expect(enough[0]!.details).not.toContain('p90 not reported');
  });

  it.each([1, 2, 3, 10, 30])('handles n=%i runs per side without errors', (count) => {
    resetFindingCounter();
    const before = Array.from({ length: count }, () => run([100]));
    const after = Array.from({ length: count }, () => run([800]));
    const findings = aggregateTimingFindings(before, after, DEFAULT_COMPARISON_SETTINGS);
    if (count < 2) expect(findings.length).toBe(0);
    else {
      expect(findings.length).toBe(1);
      expect(findings[0]!.title).toContain(`n=${count}`);
    }
  });

  it('handles asymmetric run counts across sides', () => {
    resetFindingCounter();
    const findings = aggregateTimingFindings(
      [run([100]), run([100])],
      Array.from({ length: 12 }, () => run([700])),
      DEFAULT_COMPARISON_SETTINGS,
    );
    expect(findings.length).toBe(1);
    expect(findings[0]!.title).toContain('n=12 vs n=2');
    expect(findings[0]!.details).toContain('Small sample');
  });

  it('skips actions with missing or invalid durations', () => {
    const bad: NormalizedAction = {
      id: 'bad1', label: 'Page.click', startMs: 500, endMs: 100, status: 'ok',
    };
    const noEnd: NormalizedAction = {
      id: 'bad2', label: 'Page.click', startMs: 0, status: 'ok',
    };
    const r: TraceRun = {
      id: 'r', label: 'r', actions: [bad, noEnd, act(100)], requests: [],
      consoleEvents: [], errors: [], screenshots: [],
      capabilities: { actions: 'available', requests: 'absent', screenshots: 'absent', assertions: 'absent' },
    };
    const stats = aggregateActionDurations([r, run([100])]);
    // bad endMs<startMs and missing endMs excluded; only the two 100ms survive
    const s = [...stats.values()][0]!;
    expect(s.count).toBe(2);
    expect(s.medianMs).toBe(100);
  });

  it('median is robust to an extreme outlier', () => {
    const stats = aggregateActionDurations([
      run([100]), run([110]), run([105]), run([108]), run([100000]),
    ]);
    const s = [...stats.values()][0]!;
    expect(s.medianMs).toBeLessThan(150);
    expect(s.maxMs).toBe(100000);
  });

  it('empty runs produce empty stats, not errors', () => {
    const stats = aggregateActionDurations([]);
    expect(stats.size).toBe(0);
    resetFindingCounter();
    expect(
      aggregateTimingFindings([], [], DEFAULT_COMPARISON_SETTINGS).length,
    ).toBe(0);
  });
});
