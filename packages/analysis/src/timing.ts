import type {
  ActionPair,
  ComparisonSettings,
  DiffFinding,
  NormalizedAction,
} from '@sanestly/contracts';
import { makeFinding, RULE_IDS } from './findings.js';

export interface TimingDelta {
  beforeId: string;
  afterId: string;
  beforeMs: number;
  afterMs: number;
  deltaMs: number;
  deltaRatio: number;
  regression: boolean;
}

function durationOf(a: NormalizedAction): number | undefined {
  if (a.endMs === undefined) return undefined;
  const d = a.endMs - a.startMs;
  return d >= 0 ? d : undefined;
}

/** Duration deltas for matched actions. No cross-run epoch comparison. */
export function timingDeltas(
  beforeActions: Map<string, NormalizedAction>,
  afterActions: Map<string, NormalizedAction>,
  pairs: ActionPair[],
  settings: ComparisonSettings,
): TimingDelta[] {
  const deltas: TimingDelta[] = [];
  for (const pair of pairs) {
    if (!pair.beforeId || !pair.afterId) continue;
    const a = beforeActions.get(pair.beforeId);
    const b = afterActions.get(pair.afterId);
    if (!a || !b) continue;
    const da = durationOf(a);
    const db = durationOf(b);
    if (da === undefined || db === undefined) continue;
    const deltaMs = db - da;
    const deltaRatio = da > 0 ? deltaMs / da : deltaMs > 0 ? Infinity : 0;
    // Small-baseline guard: ignore sub-10ms baselines unless absolute jump is huge.
    const baselineGuarded = da < 10 && deltaMs < settings.timing.minAbsoluteMs * 2;
    const regression =
      !baselineGuarded &&
      deltaMs >= settings.timing.minAbsoluteMs &&
      deltaRatio >= settings.timing.minRelativeIncrease;
    deltas.push({
      beforeId: a.id,
      afterId: b.id,
      beforeMs: da,
      afterMs: db,
      deltaMs,
      deltaRatio,
      regression,
    });
  }
  return deltas;
}

export function timingFindings(deltas: TimingDelta[], label: (id: string, side: 'before' | 'after') => string): DiffFinding[] {
  const findings: DiffFinding[] = [];
  const regressions = deltas
    .filter((d) => d.regression)
    .sort((a, b) => b.deltaMs - a.deltaMs);
  for (const d of regressions) {
    findings.push(
      makeFinding({
        category: 'timing',
        severity: d.deltaMs >= 1000 ? 'high' : d.deltaMs >= 300 ? 'medium' : 'low',
        status: 'changed',
        title: `Action "${label(d.afterId, 'after')}" slower by ${Math.round(d.deltaMs)} ms`,
        details:
          `Before: ${Math.round(d.beforeMs)} ms; after: ${Math.round(d.afterMs)} ms ` +
          `(${d.deltaRatio === Infinity ? 'new cost' : `+${Math.round(d.deltaRatio * 100)}%`}). ` +
          `A single recording is not statistical proof - repeat runs are recommended.`,
        evidence: [
          { kind: 'action', run: 'before', id: d.beforeId },
          { kind: 'action', run: 'after', id: d.afterId },
        ],
        confidence: 0.8,
        ruleId: RULE_IDS.timingRegression,
      }),
    );
  }
  return findings;
}
