import type {
  ActionPair,
  ComparisonSettings,
  DiffFinding,
  NormalizedAction,
  TraceRun,
} from '@sanestly/contracts';
import { DEFAULT_COMPARISON_SETTINGS } from '@sanestly/contracts';
import { alignActions } from '@sanestly/matcher';
import type { ManualOverride } from '@sanestly/matcher';
import { consoleFindings, errorFindings } from './console.js';
import { resetFindingCounter } from './findings.js';
import { networkFindings, type RequestPair } from './network.js';
import { timingDeltas, timingFindings, type TimingDelta } from './timing.js';
import {
  actionStatusFindings,
  pairScreenshots,
  visualFindings,
  type PixelDiffResult,
  type ScreenshotPair,
} from './visual.js';

export interface CompareInput {
  before: TraceRun;
  after: TraceRun;
  settings?: Partial<ComparisonSettings>;
  manualOverrides?: ManualOverride[];
  /**
   * Optional pre-computed pixel diffs for the screenshot pairs returned by
   * pairScreenshots, in the same order. When omitted, visual findings only
   * cover availability/missing cases.
   */
  pixelDiffs?: PixelDiffResult[];
  /**
   * Alternative to pixelDiffs: a callback invoked per screenshot pair after
   * action alignment. Lets callers decode images lazily without running the
   * matcher twice.
   */
  pixelDiffer?: (pair: ScreenshotPair) => PixelDiffResult;
}

export interface CompareResult {
  pairs: ActionPair[];
  findings: DiffFinding[];
  timingDeltas: TimingDelta[];
  requestPairs: RequestPair[];
  screenshotPairs: ScreenshotPair[];
  limitations: string[];
  summary: Record<string, number | string | boolean | null>;
}

function toMap(actions: NormalizedAction[]): Map<string, NormalizedAction> {
  return new Map(actions.map((a) => [a.id, a]));
}

function compilePatterns(patterns: string[]): RegExp[] {
  return patterns
    .map((p) => {
      try {
        return new RegExp(p, 'i');
      } catch {
        return undefined;
      }
    })
    .filter((r): r is RegExp => r !== undefined);
}

export function compareRuns(input: CompareInput): CompareResult {
  const settings: ComparisonSettings = {
    ...DEFAULT_COMPARISON_SETTINGS,
    ...input.settings,
    timing: { ...DEFAULT_COMPARISON_SETTINGS.timing, ...input.settings?.timing },
    match: { ...DEFAULT_COMPARISON_SETTINGS.match, ...input.settings?.match },
    visuals: { ...DEFAULT_COMPARISON_SETTINGS.visuals, ...input.settings?.visuals },
    ignore: { ...DEFAULT_COMPARISON_SETTINGS.ignore, ...input.settings?.ignore },
  };
  resetFindingCounter();
  const limitations: string[] = [];

  const { before, after } = input;
  if (before.capabilities.actions !== 'available' || after.capabilities.actions !== 'available') {
    limitations.push('One or both runs contain no recorded actions; action-level diff unavailable.');
  }
  if (before.capabilities.screenshots !== 'available' || after.capabilities.screenshots !== 'available') {
    limitations.push('Screenshots not recorded in one or both traces; visual diff is not available.');
  }
  if (before.capabilities.requests !== 'available' || after.capabilities.requests !== 'available') {
    limitations.push('Network trace missing in one or both runs; request diff is not available.');
  }
  if (before.capabilities.assertions !== 'available') {
    limitations.push('Assertions not recorded (browserContext.tracing does not capture assertions).');
  }

  const alignment = alignActions(before.actions, after.actions, {
    minimumConfidence: settings.match.minimumConfidence,
    manualOverrides: input.manualOverrides,
  });
  limitations.push(...alignment.warnings);

  const beforeMap = toMap(before.actions);
  const afterMap = toMap(after.actions);
  const labelFor = (id: string, side: 'before' | 'after') =>
    (side === 'before' ? beforeMap : afterMap).get(id)?.label ?? id;

  const deltas = timingDeltas(beforeMap, afterMap, alignment.pairs, settings);
  const net = networkFindings(before.requests, after.requests, settings);
  if (net.suppressedCount > 0) {
    limitations.push(`${net.suppressedCount} request(s) suppressed by ignore.urlPatterns.`);
  }
  const shotPairs = pairScreenshots(before, after, alignment.pairs);
  const effectivePixelDiffs: PixelDiffResult[] = input.pixelDiffer
    ? shotPairs.map(input.pixelDiffer)
    : input.pixelDiffs
    ? input.pixelDiffs
    : shotPairs.map((p) => {
        if (!p.before || !p.after) {
          return { comparable: false, reason: 'screenshot missing on one side' };
        }
        return { comparable: false, reason: 'pixel comparison not executed' };
      });

  const ignoreAction = compilePatterns(settings.ignore.actionPatterns);
  const suppressedByPattern = (f: DiffFinding): boolean => {
    if (f.category !== 'action' && f.category !== 'timing') return false;
    return f.evidence.some((e) => {
      if (e.kind !== 'action') return false;
      const label = labelFor(e.id, e.run);
      return ignoreAction.some((re) => re.test(label));
    });
  };

  const findings: DiffFinding[] = [
    ...actionStatusFindings(beforeMap, afterMap, alignment.pairs),
    ...timingFindings(deltas, labelFor),
    ...net.findings,
    ...consoleFindings(before.consoleEvents, after.consoleEvents),
    ...errorFindings(before.errors, after.errors),
    ...visualFindings(shotPairs, effectivePixelDiffs, settings),
  ];

  for (const f of findings) {
    if (suppressedByPattern(f)) f.suppressed = true;
  }

  const countBy = (status: string) => findings.filter((f) => f.status === status).length;
  const matchedCount = alignment.pairs.filter((p) => p.beforeId && p.afterId).length;
  const beforeDuration =
    before.endMs !== undefined && before.startMs !== undefined ? before.endMs - before.startMs : null;
  const afterDuration =
    after.endMs !== undefined && after.startMs !== undefined ? after.endMs - after.startMs : null;

  const summary: Record<string, number | string | boolean | null> = {
    'actions.matched': matchedCount,
    'actions.added': alignment.addedIds.length,
    'actions.removed': alignment.removedIds.length,
    'actions.reordered': alignment.movedIds.length,
    'requests.before': before.requests.length,
    'requests.after': after.requests.length,
    'console.before': before.consoleEvents.length,
    'console.after': after.consoleEvents.length,
    'findings.total': findings.length,
    'findings.added': countBy('added'),
    'findings.removed': countBy('removed'),
    'findings.changed': countBy('changed'),
    'findings.critical': findings.filter((f) => f.severity === 'critical').length,
    'findings.high': findings.filter((f) => f.severity === 'high').length,
    'duration.beforeMs': beforeDuration !== null ? Math.round(beforeDuration) : null,
    'duration.afterMs': afterDuration !== null ? Math.round(afterDuration) : null,
    'duration.note': 'single recording - not statistical proof of regression',
  };

  return {
    pairs: alignment.pairs,
    findings,
    timingDeltas: deltas,
    requestPairs: net.pairs,
    screenshotPairs: shotPairs,
    limitations,
    summary,
  };
}
