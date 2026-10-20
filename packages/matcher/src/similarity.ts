import type { NormalizedAction } from '@sanestly/contracts';

/**
 * Weighted feature similarity, per product spec:
 * action type 0.30, locator 0.25, URL 0.15, neighbor context 0.15,
 * source 0.10, relative position 0.05.
 */
export const FEATURE_WEIGHTS = {
  actionType: 0.3,
  locator: 0.25,
  url: 0.15,
  neighbor: 0.15,
  source: 0.1,
  position: 0.05,
} as const;

export interface SimilarityResult {
  score: number;
  reasons: string[];
}

function actionTypeScore(a: NormalizedAction, b: NormalizedAction): number {
  const ak = a.apiName ?? a.method ?? a.label;
  const bk = b.apiName ?? b.method ?? b.label;
  if (ak === bk) return 1;
  if (a.label === b.label) return 0.6;
  return 0;
}

function locatorScore(a: NormalizedAction, b: NormalizedAction): number {
  const la = a.locatorFingerprint;
  const lb = b.locatorFingerprint;
  if (la === undefined && lb === undefined) return 0.5; // neutral: no data
  if (la === lb) return 1;
  if (!la || !lb) return 0.1;
  // Shared prefix heuristic for near-identical selectors.
  let i = 0;
  while (i < la.length && i < lb.length && la[i] === lb[i]) i++;
  const overlap = i / Math.max(la.length, lb.length);
  return overlap > 0.6 ? 0.6 : 0;
}

function urlScore(a: NormalizedAction, b: NormalizedAction): number {
  const ua = a.urlFingerprint;
  const ub = b.urlFingerprint;
  if (ua === undefined && ub === undefined) return 0.5;
  if (ua === ub) return 1;
  if (!ua || !ub) return 0.1;
  try {
    const pa = new URL(ua);
    const pb = new URL(ub);
    if (pa.host === pb.host) return 0.5;
  } catch {
    /* normalizedUrl may be opaque; treat as mismatch */
  }
  return 0;
}

function sourceScore(a: NormalizedAction, b: NormalizedAction): number {
  const sa = a.source;
  const sb = b.source;
  if (!sa?.file && !sb?.file) return 0.5;
  if (sa?.file && sb?.file) {
    if (sa.file === sb.file && sa.line === sb.line) return 1;
    if (sa.file === sb.file) return 0.7;
    return 0;
  }
  return 0.2;
}

function positionScore(i: number, n: number, j: number, m: number): number {
  if (n <= 1 || m <= 1) return 1;
  const pa = i / (n - 1);
  const pb = j / (m - 1);
  return Math.max(0, 1 - Math.abs(pa - pb) * 2);
}

export function actionSimilarity(
  a: NormalizedAction,
  b: NormalizedAction,
  i: number,
  n: number,
  j: number,
  m: number,
  prevA?: NormalizedAction,
  prevB?: NormalizedAction,
): SimilarityResult {
  const t = actionTypeScore(a, b);
  const l = locatorScore(a, b);
  const u = urlScore(a, b);
  const s = sourceScore(a, b);
  const p = positionScore(i, n, j, m);

  // Neighbor context is corroborating evidence only: a matching neighbor
  // boosts confidence, a mismatching one weakens it slightly but must not
  // veto the pair (the first action after an inserted block legitimately
  // has a different predecessor in the candidate run).
  let neighbor = 0.5;
  if (prevA && prevB) {
    neighbor = prevA.label === prevB.label ? 1 : 0.4;
  }

  const score =
    t * FEATURE_WEIGHTS.actionType +
    l * FEATURE_WEIGHTS.locator +
    u * FEATURE_WEIGHTS.url +
    neighbor * FEATURE_WEIGHTS.neighbor +
    s * FEATURE_WEIGHTS.source +
    p * FEATURE_WEIGHTS.position;

  const reasons: string[] = [];
  if (t === 1) reasons.push('same action type');
  if (l === 1) reasons.push('same locator');
  if (u === 1) reasons.push('same URL');
  if (s === 1) reasons.push('same source location');
  if (neighbor === 1) reasons.push('matching neighbor context');
  if (score < 0.4) reasons.push('weak feature overlap');

  return { score, reasons };
}
