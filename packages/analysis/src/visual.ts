import pixelmatch from 'pixelmatch';
import type {
  ActionPair,
  ComparisonSettings,
  NormalizedAction,
  ScreenshotMeta,
  TraceRun,
} from '@sanestly/contracts';
import { makeFinding, RULE_IDS } from './findings.js';
import type { DiffFinding } from '@sanestly/contracts';

export interface ScreenshotPair {
  before?: ScreenshotMeta;
  after?: ScreenshotMeta;
  reason: string;
  actionPair?: ActionPair;
}

/**
 * Pair screenshots across runs: prefer screenshots attached to matched
 * action pairs; fall back to nearest-time pairing for detached frames.
 */
export function pairScreenshots(
  beforeRun: TraceRun,
  afterRun: TraceRun,
  pairs: ActionPair[],
): ScreenshotPair[] {
  const beforeByAction = new Map<string, ScreenshotMeta[]>();
  for (const s of beforeRun.screenshots) {
    if (!s.actionId) continue;
    const arr = beforeByAction.get(s.actionId) ?? [];
    arr.push(s);
    beforeByAction.set(s.actionId, arr);
  }
  const afterByAction = new Map<string, ScreenshotMeta[]>();
  for (const s of afterRun.screenshots) {
    if (!s.actionId) continue;
    const arr = afterByAction.get(s.actionId) ?? [];
    arr.push(s);
    afterByAction.set(s.actionId, arr);
  }

  const usedBefore = new Set<ScreenshotMeta>();
  const usedAfter = new Set<ScreenshotMeta>();
  const result: ScreenshotPair[] = [];

  for (const pair of pairs) {
    if (!pair.beforeId || !pair.afterId) continue;
    const bs = beforeByAction.get(pair.beforeId) ?? [];
    const as = afterByAction.get(pair.afterId) ?? [];
    const count = Math.max(bs.length, as.length);
    for (let i = 0; i < count; i++) {
      const b = bs[i];
      const a = as[i];
      if (b) usedBefore.add(b);
      if (a) usedAfter.add(a);
      if (b || a) {
        result.push({ before: b, after: a, reason: 'attached to matched actions', actionPair: pair });
      }
    }
  }

  // Nearest-time pairing for detached frames (e.g. screencast without action).
  const detachedB = beforeRun.screenshots.filter((s) => !usedBefore.has(s));
  const detachedA = afterRun.screenshots.filter((s) => !usedAfter.has(s));
  const poolA = [...detachedA];
  for (const b of detachedB) {
    if (b.timeMs === undefined || poolA.length === 0) {
      result.push({ before: b, reason: 'no candidate screenshot' });
      continue;
    }
    let bestIdx = 0;
    let bestDist = Infinity;
    poolA.forEach((a, idx) => {
      const d = Math.abs((a.timeMs ?? 0) - (b.timeMs ?? 0));
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    });
    const a = poolA.splice(bestIdx, 1)[0]!;
    result.push({ before: b, after: a, reason: 'nearest timestamp pairing' });
  }
  for (const a of poolA) {
    result.push({ after: a, reason: 'no baseline screenshot' });
  }
  return result;
}

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface PixelDiffResult {
  comparable: boolean;
  reason?: string;
  width?: number;
  height?: number;
  changedPixels?: number;
  changedRatio?: number;
  /** RGBA buffer of the diff visualization (red marks). */
  diffImage?: Uint8Array;
}

/**
 * Pixel-compare two decoded RGBA images. Unequal dimensions are reported
 * as incomparable rather than silently resized. Mask rectangles are
 * excluded by copying baseline pixels over candidate pixels in the mask.
 */
export function diffRgba(
  beforeImg: RgbaImage,
  afterImg: RgbaImage,
  settings: ComparisonSettings,
): PixelDiffResult {
  if (beforeImg.width !== afterImg.width || beforeImg.height !== afterImg.height) {
    return {
      comparable: false,
      reason:
        `incomparable dimensions: baseline ${beforeImg.width}x${beforeImg.height}, ` +
        `candidate ${afterImg.width}x${afterImg.height}`,
    };
  }
  const { width, height } = beforeImg;
  const a = new Uint8Array(beforeImg.data);
  const b = new Uint8Array(afterImg.data);

  for (const r of settings.visuals.maskRects) {
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(width, Math.ceil(r.x + r.width));
    const y1 = Math.min(height, Math.ceil(r.y + r.height));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = (y * width + x) * 4;
        b[idx] = a[idx]!;
        b[idx + 1] = a[idx + 1]!;
        b[idx + 2] = a[idx + 2]!;
        b[idx + 3] = a[idx + 3]!;
      }
    }
  }

  const diff = new Uint8Array(width * height * 4);
  const changedPixels = pixelmatch(a, b, diff, width, height, {
    threshold: 0.1,
    includeAA: false,
    alpha: 0.1,
  });
  const total = width * height;
  return {
    comparable: true,
    width,
    height,
    changedPixels,
    changedRatio: total > 0 ? changedPixels / total : 0,
    diffImage: diff,
  };
}

export function visualFindings(
  pairs: ScreenshotPair[],
  results: PixelDiffResult[],
  settings: ComparisonSettings,
): DiffFinding[] {
  const findings: DiffFinding[] = [];
  pairs.forEach((pair, idx) => {
    const res = results[idx];
    if (!res) return;
    if (!pair.before || !pair.after) {
      findings.push(
        makeFinding({
          category: 'visual',
          severity: 'info',
          status: pair.before ? 'removed' : 'added',
          title: pair.before ? 'Screenshot missing in candidate run' : 'New screenshot in candidate run',
          details: `Pairing reason: ${pair.reason}. Missing screenshots are never treated as a pass.`,
          evidence: [
            ...(pair.before
              ? [{ kind: 'resource' as const, run: 'before' as const, id: pair.before.resourcePath }]
              : []),
            ...(pair.after
              ? [{ kind: 'resource' as const, run: 'after' as const, id: pair.after.resourcePath }]
              : []),
          ],
          confidence: 0.8,
          ruleId: RULE_IDS.visualMissing,
        }),
      );
      return;
    }
    if (!res.comparable) {
      findings.push(
        makeFinding({
          category: 'visual',
          severity: 'info',
          status: 'unmatched',
          title: 'Screenshots not comparable',
          details: res.reason ?? 'unknown reason',
          evidence: [
            { kind: 'resource', run: 'before', id: pair.before.resourcePath },
            { kind: 'resource', run: 'after', id: pair.after.resourcePath },
          ],
          confidence: 1,
          ruleId: RULE_IDS.visualMissing,
        }),
      );
      return;
    }
    if ((res.changedRatio ?? 0) > settings.visuals.maxPixelDiffRatio) {
      const ratio = res.changedRatio ?? 0;
      findings.push(
        makeFinding({
          category: 'visual',
          // >10% is almost certainly a real change; >2% is likely real;
          // below that, JPEG screencast noise between identical runs can
          // reach ~1.6%, so the diff is reported but only as info.
          severity: ratio > 0.1 ? 'high' : ratio > 0.02 ? 'medium' : 'info',
          status: 'changed',
          title: `Screenshot differs: ${(100 * ratio).toFixed(2)}% of pixels`,
          details:
            `${res.changedPixels} of ${res.width! * res.height!} pixels changed ` +
            `(pairing: ${pair.reason}). Masked regions were excluded.` +
            (ratio <= 0.02
              ? ' Diffs under ~2% may be screencast compression noise, not a real regression.'
              : ''),
          evidence: [
            { kind: 'resource', run: 'before', id: pair.before.resourcePath },
            { kind: 'resource', run: 'after', id: pair.after.resourcePath },
          ],
          confidence: 0.85,
          ruleId: RULE_IDS.visualDiff,
        }),
      );
    }
  });
  return findings;
}

export function actionStatusFindings(
  beforeActions: Map<string, NormalizedAction>,
  afterActions: Map<string, NormalizedAction>,
  pairs: ActionPair[],
): DiffFinding[] {
  const findings: DiffFinding[] = [];
  for (const pair of pairs) {
    if (pair.beforeId && !pair.afterId) {
      const a = beforeActions.get(pair.beforeId);
      findings.push(
        makeFinding({
          category: 'action',
          severity: 'medium',
          status: 'removed',
          title: `Action removed: ${a?.label ?? pair.beforeId}`,
          details: pair.matchReason.join('; ') || 'Not found in the candidate run.',
          evidence: [{ kind: 'action', run: 'before', id: pair.beforeId }],
          confidence: Math.max(pair.confidence, 0.7),
          ruleId: RULE_IDS.actionRemoved,
        }),
      );
    } else if (!pair.beforeId && pair.afterId) {
      const b = afterActions.get(pair.afterId);
      findings.push(
        makeFinding({
          category: 'action',
          severity: 'medium',
          status: 'added',
          title: `Action added: ${b?.label ?? pair.afterId}`,
          details: pair.matchReason.join('; ') || 'Not present in the baseline run.',
          evidence: [{ kind: 'action', run: 'after', id: pair.afterId }],
          confidence: Math.max(pair.confidence, 0.7),
          ruleId: RULE_IDS.actionAdded,
        }),
      );
    } else if (pair.beforeId && pair.afterId) {
      const a = beforeActions.get(pair.beforeId);
      const b = afterActions.get(pair.afterId);
      if (a && b && a.status !== 'failed' && b.status === 'failed') {
        findings.push(
          makeFinding({
            category: 'action',
            severity: 'critical',
            status: 'changed',
            title: `Action now fails: ${b.label}`,
            details: b.errorSummary
              ? `Error: ${b.errorSummary}`
              : 'The action succeeded in baseline and failed in the candidate run.',
            evidence: [
              { kind: 'action', run: 'before', id: a.id },
              { kind: 'action', run: 'after', id: b.id },
            ],
            confidence: 0.95,
            ruleId: RULE_IDS.actionFailed,
          }),
        );
      }
    }
  }
  return findings;
}
