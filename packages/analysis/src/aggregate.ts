import type {
  ComparisonSettings,
  DiffFinding,
  NormalizedAction,
  TraceRun,
} from '@sanestly/contracts';
import { makeFinding, RULE_IDS } from './findings.js';

export interface ActionDurationStats {
  /** Cross-run identity key: action kind + locator/url fingerprint + occurrence index. */
  key: string;
  label: string;
  /** Number of runs this action was observed in. */
  count: number;
  medianMs: number;
  /** Only reported when count >= 10 (nearest-rank p90 is meaningless below that). */
  p90Ms?: number;
  iqrMs?: number;
  minMs: number;
  maxMs: number;
}

function durationOf(a: NormalizedAction): number | undefined {
  if (a.endMs === undefined) return undefined;
  const d = a.endMs - a.startMs;
  return d >= 0 ? d : undefined;
}

/** Identity key used to group "the same" action across repeated runs. */
function actionKey(a: NormalizedAction): string {
  return [a.apiName ?? a.label, a.locatorFingerprint ?? '', a.urlFingerprint ?? ''].join('|');
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function statsFor(key: string, label: string, durations: number[]): ActionDurationStats {
  const sorted = [...durations].sort((a, b) => a - b);
  const q1 = percentile(sorted, 25);
  const q3 = percentile(sorted, 75);
  return {
    key,
    label,
    count: sorted.length,
    medianMs: percentile(sorted, 50),
    p90Ms: sorted.length >= 10 ? percentile(sorted, 90) : undefined,
    iqrMs: sorted.length >= 4 ? q3 - q1 : undefined,
    minMs: sorted[0]!,
    maxMs: sorted[sorted.length - 1]!,
  };
}

/**
 * Group actions across repeated runs of the same test and compute honest
 * duration statistics per action: median, p90 (n>=10), IQR (n>=4), count.
 * Occurrence index disambiguates repeated identical actions.
 */
export function aggregateActionDurations(runs: TraceRun[]): Map<string, ActionDurationStats> {
  const samples = new Map<string, { label: string; durations: number[] }>();
  for (const run of runs) {
    const seen = new Map<string, number>();
    for (const a of run.actions) {
      const base = actionKey(a);
      const occ = seen.get(base) ?? 0;
      seen.set(base, occ + 1);
      const key = `${base}#${occ}`;
      const d = durationOf(a);
      if (d === undefined) continue;
      const s = samples.get(key) ?? { label: a.label, durations: [] };
      s.durations.push(d);
      samples.set(key, s);
    }
  }
  const out = new Map<string, ActionDurationStats>();
  for (const [key, s] of samples) out.set(key, statsFor(key, s.label, s.durations));
  return out;
}

/**
 * Timing findings from multi-run aggregates. Only emitted when BOTH sides
 * recorded the action in at least `minRuns` runs - a single recording is
 * never presented as statistical evidence.
 */
export function aggregateTimingFindings(
  beforeRuns: TraceRun[],
  afterRuns: TraceRun[],
  settings: ComparisonSettings,
  minRuns = 2,
): DiffFinding[] {
  const before = aggregateActionDurations(beforeRuns);
  const after = aggregateActionDurations(afterRuns);
  const findings: DiffFinding[] = [];

  const keys = [...after.keys()].sort();
  for (const key of keys) {
    const a = after.get(key)!;
    const b = before.get(key);
    if (!b || b.count < minRuns || a.count < minRuns) continue;
    const deltaMs = a.medianMs - b.medianMs;
    const ratio = b.medianMs > 0 ? deltaMs / b.medianMs : deltaMs > 0 ? Infinity : 0;
    if (deltaMs < settings.timing.minAbsoluteMs || ratio < settings.timing.minRelativeIncrease) {
      continue;
    }
    const p90Note =
      a.p90Ms !== undefined && b.p90Ms !== undefined
        ? ` p90 ${Math.round(b.p90Ms)} -> ${Math.round(a.p90Ms)} ms.`
        : ' p90 not reported (needs >=10 runs per side).';
    const iqrNote =
      a.iqrMs !== undefined && b.iqrMs !== undefined
        ? ` IQR before ${Math.round(b.iqrMs)} ms, after ${Math.round(a.iqrMs)} ms.`
        : '';
    const smallSampleNote =
      Math.min(a.count, b.count) < 10
        ? ' Small sample (<10 runs per side): treat as a directional signal, not a reliable regression.'
        : '';
    findings.push(
      makeFinding({
        category: 'timing',
        severity: deltaMs >= 1000 ? 'high' : deltaMs >= 300 ? 'medium' : 'low',
        status: 'changed',
        title: `Action "${a.label}" median slower by ${Math.round(deltaMs)} ms (n=${a.count} vs n=${b.count})`,
        details:
          `Median duration ${Math.round(b.medianMs)} -> ${Math.round(a.medianMs)} ms ` +
          `over ${b.count} baseline and ${a.count} candidate runs.${p90Note}${iqrNote}${smallSampleNote} ` +
          `Medians over repeated runs, not a formal significance test.`,
        evidence: [
          { kind: 'action', run: 'before', id: key },
          { kind: 'action', run: 'after', id: key },
        ],
        confidence: 0.85,
        ruleId: RULE_IDS.aggregateTimingRegression,
      }),
    );
  }
  return findings;
}
