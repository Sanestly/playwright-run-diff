import type { ActionPair, NormalizedAction } from '@sanestly/contracts';
import { actionSimilarity } from './similarity.js';

export interface ManualOverride {
  beforeId?: string;
  afterId?: string;
}

export interface AlignOptions {
  /** Minimum confidence for an auto pair. Below this, items stay unmatched. */
  minimumConfidence: number;
  /** Gap penalty applied when skipping an action in either sequence. */
  gapPenalty: number;
  /** Score at/above which a unique pair becomes a hard anchor. */
  anchorConfidence: number;
  manualOverrides?: ManualOverride[];
}

export const DEFAULT_ALIGN_OPTIONS: AlignOptions = {
  minimumConfidence: 0.6,
  gapPenalty: 0.45,
  anchorConfidence: 0.9,
};

interface Anchor {
  i: number;
  j: number;
  score: number;
}

function anchorKey(a: NormalizedAction): string | undefined {
  // context.tracing traces have no apiName; the label (class.method or test
  // step title) is the best stable identity there.
  const kind = a.apiName ?? a.label ?? a.method;
  if (!kind) return undefined;
  const parts = [kind, a.locatorFingerprint ?? '', a.urlFingerprint ?? ''];
  if (!a.locatorFingerprint && !a.urlFingerprint && !a.source?.file) return undefined;
  if (a.source?.file) parts.push(`${a.source.file}:${a.source.line ?? 0}`);
  return parts.join('|');
}

/** Find unique, high-confidence anchor pairs that pin the alignment. */
function findAnchors(before: NormalizedAction[], after: NormalizedAction[]): Anchor[] {
  const keyCount = (list: NormalizedAction[]) => {
    const map = new Map<string, number>();
    for (const a of list) {
      const k = anchorKey(a);
      if (k) map.set(k, (map.get(k) ?? 0) + 1);
    }
    return map;
  };
  const cb = keyCount(before);
  const ca = keyCount(after);
  const afterByKey = new Map<string, number>();
  after.forEach((a, idx) => {
    const k = anchorKey(a);
    if (k && ca.get(k) === 1 && cb.get(k) === 1) afterByKey.set(k, idx);
  });

  const anchors: Anchor[] = [];
  before.forEach((a, i) => {
    const k = anchorKey(a);
    if (!k || cb.get(k) !== 1) return;
    const j = afterByKey.get(k);
    if (j === undefined) return;
    anchors.push({ i, j, score: 1 });
  });

  // Keep only monotonically increasing anchors (greedy: drop regressions).
  const mono: Anchor[] = [];
  let lastJ = -1;
  for (const a of anchors) {
    if (a.j > lastJ) {
      mono.push(a);
      lastJ = a.j;
    }
  }
  return mono;
}

interface AlignCell {
  kind: 'pair' | 'skip-before' | 'skip-after';
  i?: number;
  j?: number;
  score?: number;
}

/**
 * Global (Needleman-Wunsch style) alignment of a segment pair.
 * Deterministic: ties are broken toward 'pair', then 'skip-before'.
 *
 * For large segments the DP is banded around the diagonal: cells with
 * |r - c| > band are unreachable, which bounds memory to O(n * band)
 * instead of O(n * m). The band always covers |rows - cols| plus slack,
 * so the (rows, cols) endpoint is reachable. When even that band would
 * be too wide, a linear greedy fallback is used instead - this only
 * happens for pathological mostly-unmatched sequences.
 */
const MAX_BAND = 2048;
const MIN_BAND = 256;
const BAND_SLACK = 32;

function alignSegment(
  before: NormalizedAction[],
  after: NormalizedAction[],
  i0: number,
  i1: number,
  j0: number,
  j1: number,
  n: number,
  m: number,
  opts: AlignOptions,
): AlignCell[] {
  const rows = i1 - i0;
  const cols = j1 - j0;
  if (rows <= 0 && cols <= 0) return [];
  if (rows <= 0) return Array.from({ length: cols }, (_, c) => ({ kind: 'skip-after' as const, j: j0 + c }));
  if (cols <= 0) return Array.from({ length: rows }, (_, r) => ({ kind: 'skip-before' as const, i: i0 + r }));

  const skew = Math.abs(rows - cols);
  const band = Math.min(MAX_BAND, Math.max(MIN_BAND, skew + BAND_SLACK));
  if (skew + BAND_SLACK > MAX_BAND) {
    return alignSegmentGreedy(before, after, i0, i1, j0, j1, n, m, opts);
  }

  const NEG = -Infinity;
  const width = 2 * band + 1;
  const dp = new Float64Array((rows + 1) * width);
  const back = new Uint8Array((rows + 1) * width); // 0 none,1 pair,2 skipB,3 skipA
  const at = (r: number, c: number) => r * width + (c - r + band);
  const inBand = (r: number, c: number) => Math.abs(c - r) <= band;

  // No similarity cache: every banded cell is consulted exactly once during
  // the DP fill, so a Map cache only burns memory - it crashed on ~40k-action
  // traces by exceeding V8's maximum Map size.
  const sim = (r: number, c: number): number =>
    actionSimilarity(
      before[i0 + r]!,
      after[j0 + c]!,
      i0 + r,
      n,
      j0 + c,
      m,
      i0 + r > 0 ? before[i0 + r - 1] : undefined,
      j0 + c > 0 ? after[j0 + c - 1] : undefined,
    ).score;

  for (let r = 0; r <= rows; r++) {
    for (let c = Math.max(0, r - band); c <= Math.min(cols, r + band); c++) {
      if (r === 0 && c === 0) continue;
      let best = NEG;
      let move = 0;
      if (r > 0 && c > 0 && inBand(r - 1, c - 1)) {
        const s = sim(r - 1, c - 1);
        const pairScore = dp[at(r - 1, c - 1)]! + (s >= opts.minimumConfidence ? s : -opts.gapPenalty * 2 - s);
        if (pairScore > best) {
          best = pairScore;
          move = 1;
        }
      }
      if (r > 0 && inBand(r - 1, c)) {
        const v = dp[at(r - 1, c)]! - opts.gapPenalty;
        if (v > best) {
          best = v;
          move = 2;
        }
      }
      if (c > 0 && inBand(r, c - 1)) {
        const v = dp[at(r, c - 1)]! - opts.gapPenalty;
        if (v > best) {
          best = v;
          move = 3;
        }
      }
      dp[at(r, c)] = best;
      back[at(r, c)] = move;
    }
  }

  const cells: AlignCell[] = [];
  let r = rows;
  let c = cols;
  while (r > 0 || c > 0) {
    const move = back[at(r, c)];
    if (move === 1) {
      cells.push({ kind: 'pair', i: i0 + r - 1, j: j0 + c - 1, score: sim(r - 1, c - 1) });
      r--;
      c--;
    } else if (move === 3) {
      cells.push({ kind: 'skip-after', j: j0 + c - 1 });
      c--;
    } else {
      cells.push({ kind: 'skip-before', i: i0 + r - 1 });
      r--;
    }
  }
  cells.reverse();
  return cells;
}

/**
 * Linear fallback for pathological segment skews that even a maximum-width
 * band cannot cover. Greedily pairs the front elements when similar,
 * otherwise skips the side with the worse forward-looking best score.
 */
function alignSegmentGreedy(
  before: NormalizedAction[],
  after: NormalizedAction[],
  i0: number,
  i1: number,
  j0: number,
  j1: number,
  n: number,
  m: number,
  opts: AlignOptions,
): AlignCell[] {
  const cells: AlignCell[] = [];
  let i = i0;
  let j = j0;
  while (i < i1 || j < j1) {
    if (i >= i1) {
      cells.push({ kind: 'skip-after', j: j++ });
      continue;
    }
    if (j >= j1) {
      cells.push({ kind: 'skip-before', i: i++ });
      continue;
    }
    const s = actionSimilarity(
      before[i]!,
      after[j]!,
      i,
      n,
      j,
      m,
      i > 0 ? before[i - 1] : undefined,
      j > 0 ? after[j - 1] : undefined,
    ).score;
    if (s >= opts.minimumConfidence) {
      cells.push({ kind: 'pair', i: i++, j: j++, score: s });
      continue;
    }
    // Skip the side whose next element looks less promising: compare
    // sim(b[i+1], a[j]) vs sim(b[i], a[j+1]) where available.
    const sNextB = i + 1 < i1 ? actionSimilarity(before[i + 1]!, after[j]!, i + 1, n, j, m).score : -1;
    const sNextA = j + 1 < j1 ? actionSimilarity(before[i]!, after[j + 1]!, i, n, j + 1, m).score : -1;
    if (sNextB > sNextA) cells.push({ kind: 'skip-before', i: i++ });
    else cells.push({ kind: 'skip-after', j: j++ });
  }
  return cells;
}

export interface AlignResult {
  pairs: ActionPair[];
  /** Before actions left unmatched (removed). */
  removedIds: string[];
  /** After actions left unmatched (added). */
  addedIds: string[];
  /** Ids present on both sides but reordered relative to neighbors. */
  movedIds: string[];
  warnings: string[];
}

/**
 * Align two action sequences. Hierarchical: unique anchors pin the
 * alignment, segments between anchors are solved with bounded DP.
 * Same input always produces the same output.
 */
export function alignActions(
  before: NormalizedAction[],
  after: NormalizedAction[],
  options: Partial<AlignOptions> = {},
): AlignResult {
  const opts: AlignOptions = { ...DEFAULT_ALIGN_OPTIONS, ...options };
  const warnings: string[] = [];
  const n = before.length;
  const m = after.length;
  const pairs: ActionPair[] = [];
  const removedIds: string[] = [];
  const addedIds: string[] = [];

  if (n === 0 || m === 0) {
    for (const a of before) {
      removedIds.push(a.id);
      pairs.push({ beforeId: a.id, confidence: 0, matchReason: ['no after actions'] });
    }
    for (const a of after) {
      addedIds.push(a.id);
      pairs.push({ afterId: a.id, confidence: 0, matchReason: ['no before actions'] });
    }
    return { pairs, removedIds, addedIds, movedIds: [], warnings };
  }

  const anchors = findAnchors(before, after);
  const boundaries: Anchor[] = [
    { i: -1, j: -1, score: 0 },
    ...anchors,
    { i: n, j: m, score: 0 },
  ];

  const matchedBefore = new Set<number>();
  const matchedAfter = new Set<number>();
  const pairOrder: Array<{ i: number; j: number }> = [];

  for (let k = 0; k < boundaries.length - 1; k++) {
    const lo = boundaries[k]!;
    const hi = boundaries[k + 1]!;
    const cells = alignSegment(
      before,
      after,
      lo.i + 1,
      hi.i,
      lo.j + 1,
      hi.j,
      n,
      m,
      opts,
    );
    for (const cell of cells) {
      if (cell.kind === 'pair' && cell.i !== undefined && cell.j !== undefined) {
        const a = before[cell.i]!;
        const b = after[cell.j]!;
        const sim = actionSimilarity(
          a,
          b,
          cell.i,
          n,
          cell.j,
          m,
          cell.i > 0 ? before[cell.i - 1] : undefined,
          cell.j > 0 ? after[cell.j - 1] : undefined,
        );
        if (sim.score >= opts.minimumConfidence) {
          matchedBefore.add(cell.i);
          matchedAfter.add(cell.j);
          pairOrder.push({ i: cell.i, j: cell.j });
          pairs.push({
            beforeId: a.id,
            afterId: b.id,
            confidence: Math.round(sim.score * 1000) / 1000,
            matchReason: sim.reasons.length ? sim.reasons : ['aligned by sequence'],
          });
        } else {
          // Forced pairing below threshold is rejected: both sides unmatched.
          removedIds.push(a.id);
          addedIds.push(b.id);
          pairs.push({ beforeId: a.id, confidence: Math.round(sim.score * 1000) / 1000, matchReason: ['below minimum confidence'] });
          pairs.push({ afterId: b.id, confidence: Math.round(sim.score * 1000) / 1000, matchReason: ['below minimum confidence'] });
        }
      } else if (cell.kind === 'skip-before' && cell.i !== undefined) {
        const a = before[cell.i]!;
        matchedBefore.add(cell.i);
        removedIds.push(a.id);
        pairs.push({ beforeId: a.id, confidence: 0, matchReason: ['removed in after run'] });
      } else if (cell.kind === 'skip-after' && cell.j !== undefined) {
        const b = after[cell.j]!;
        matchedAfter.add(cell.j);
        addedIds.push(b.id);
        pairs.push({ afterId: b.id, confidence: 0, matchReason: ['added in after run'] });
      }
    }
    if (hi.i >= 0 && hi.i < n && hi.j >= 0 && hi.j < m) {
      matchedBefore.add(hi.i);
      matchedAfter.add(hi.j);
      pairOrder.push({ i: hi.i, j: hi.j });
      pairs.push({
        beforeId: before[hi.i]!.id,
        afterId: after[hi.j]!.id,
        confidence: 1,
        matchReason: ['unique anchor match'],
      });
    }
  }

  // Anything unreachable (should not happen) is marked unmatched.
  before.forEach((a, i) => {
    if (!matchedBefore.has(i)) {
      removedIds.push(a.id);
      pairs.push({ beforeId: a.id, confidence: 0, matchReason: ['unmatched'] });
    }
  });
  after.forEach((b, j) => {
    if (!matchedAfter.has(j)) {
      addedIds.push(b.id);
      pairs.push({ afterId: b.id, confidence: 0, matchReason: ['unmatched'] });
    }
  });

  // Detect reordered pairs: a matched pair whose predecessors disagree.
  const movedIds: string[] = [];
  for (let k = 1; k < pairOrder.length; k++) {
    const prev = pairOrder[k - 1]!;
    const cur = pairOrder[k]!;
    if (cur.i <= prev.i || cur.j <= prev.j) {
      movedIds.push(after[cur.j]!.id);
    }
  }

  // Apply manual overrides: explicit pairs win; unpair entries remove links.
  // The freed partner of a removed pair becomes unmatched on its own side.
  if (opts.manualOverrides?.length) {
    applyOverrides(pairs, opts.manualOverrides, before, after);
    // Single-sided entries are the source of truth for added/removed -
    // recompute so counts stay consistent after overrides.
    removedIds.length = 0;
    addedIds.length = 0;
    for (const p of pairs) {
      if (p.beforeId && !p.afterId) removedIds.push(p.beforeId);
      else if (!p.beforeId && p.afterId) addedIds.push(p.afterId);
    }
  }

  return { pairs, removedIds, addedIds, movedIds, warnings };
}

function applyOverrides(
  pairs: ActionPair[],
  overrides: ManualOverride[],
  before: NormalizedAction[],
  after: NormalizedAction[],
): void {
  const beforeById = new Map(before.map((a) => [a.id, a]));
  const afterById = new Map(after.map((a) => [a.id, a]));
  const hasPair = (id: string) =>
    pairs.some((p) => p.beforeId === id || p.afterId === id);

  for (const ov of overrides) {
    if (ov.beforeId && !beforeById.has(ov.beforeId)) continue;
    if (ov.afterId && !afterById.has(ov.afterId)) continue;

    // Remove every pair referencing either side (latest override wins,
    // including over earlier manual pairs). Freed partners become
    // unmatched singles so they still surface as added/removed.
    const freed: string[] = [];
    for (let k = pairs.length - 1; k >= 0; k--) {
      const p = pairs[k]!;
      const touches =
        (ov.beforeId !== undefined && p.beforeId === ov.beforeId) ||
        (ov.afterId !== undefined && p.afterId === ov.afterId);
      if (!touches) continue;
      if (p.beforeId !== undefined && p.beforeId !== ov.beforeId) freed.push(p.beforeId);
      if (p.afterId !== undefined && p.afterId !== ov.afterId) freed.push(p.afterId);
      pairs.splice(k, 1);
    }

    if (ov.beforeId && ov.afterId) {
      pairs.push({
        beforeId: ov.beforeId,
        afterId: ov.afterId,
        confidence: 1,
        matchReason: ['manual override'],
        manualOverride: true,
      });
    } else {
      pairs.push({
        beforeId: ov.beforeId,
        afterId: ov.afterId,
        confidence: 0,
        matchReason: ['manual unpair'],
        manualOverride: true,
      });
    }
    for (const id of freed) {
      if (hasPair(id)) continue;
      if (beforeById.has(id)) {
        pairs.push({ beforeId: id, confidence: 0, matchReason: ['unmatched after manual override'] });
      } else {
        pairs.push({ afterId: id, confidence: 0, matchReason: ['unmatched after manual override'] });
      }
    }
  }
}
