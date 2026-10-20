import { describe, expect, it } from 'vitest';
import type { NormalizedAction } from '@sanestly/contracts';
import { alignActions } from '../src/align.js';

let n = 0;
function act(over: Partial<NormalizedAction>): NormalizedAction {
  n += 1;
  return {
    id: over.id ?? `a${n}`,
    label: over.label ?? `act-${n}`,
    startMs: n * 10,
    endMs: n * 10 + 5,
    status: 'ok',
    ...over,
  };
}

describe('alignActions', () => {
  it('matches identical sequences with no diffs', () => {
    const before = [
      act({ label: 'Page.goto', apiName: 'goto', urlFingerprint: 'http://x/' }),
      act({ label: 'Page.click', apiName: 'click', locatorFingerprint: '#a' }),
    ];
    const after = [
      act({ label: 'Page.goto', apiName: 'goto', urlFingerprint: 'http://x/' }),
      act({ label: 'Page.click', apiName: 'click', locatorFingerprint: '#a' }),
    ];
    const r = alignActions(before, after);
    expect(r.addedIds).toEqual([]);
    expect(r.removedIds).toEqual([]);
    expect(r.pairs.every((p) => p.beforeId && p.afterId)).toBe(true);
  });

  it('flags an inserted action as added without cascading changes', () => {
    const mk = (extra: boolean) => {
      const list = [
        act({ label: 'Page.goto', apiName: 'goto', urlFingerprint: 'http://x/', locatorFingerprint: undefined }),
        act({ label: 'Page.click', apiName: 'click', locatorFingerprint: '#submit' }),
        ...(extra ? [act({ label: 'Page.click', apiName: 'click', locatorFingerprint: '#extra' })] : []),
        act({ label: 'Page.fill', apiName: 'fill', locatorFingerprint: '#name' }),
      ];
      return list;
    };
    const before = mk(false);
    const after = mk(true);
    const r = alignActions(before, after);
    expect(r.addedIds.length).toBe(1);
    expect(r.removedIds.length).toBe(0);
    const matched = r.pairs.filter((p) => p.beforeId && p.afterId);
    expect(matched.length).toBe(3);
  });

  it('flags a removed action', () => {
    const before = [
      act({ label: 'Page.click', apiName: 'click', locatorFingerprint: '#a' }),
      act({ label: 'Page.waitForTimeout', apiName: 'waitForTimeout' }),
      act({ label: 'Page.click', apiName: 'click', locatorFingerprint: '#b' }),
    ];
    const after = [
      act({ label: 'Page.click', apiName: 'click', locatorFingerprint: '#a' }),
      act({ label: 'Page.click', apiName: 'click', locatorFingerprint: '#b' }),
    ];
    const r = alignActions(before, after);
    expect(r.removedIds.length).toBe(1);
    expect(r.addedIds.length).toBe(0);
  });

  it('is deterministic', () => {
    const before = Array.from({ length: 40 }, (_, i) =>
      act({ label: `Page.op${i % 5}`, apiName: 'op', locatorFingerprint: `#l${i % 7}` }),
    );
    const after = [...before.slice(0, 20), act({ label: 'Page.opX', apiName: 'op', locatorFingerprint: '#new' }), ...before.slice(20)].map(
      (a, i) => ({ ...a, id: `b${i}` }),
    );
    const r1 = alignActions(before, after);
    const r2 = alignActions(before, after);
    expect(r1.pairs).toEqual(r2.pairs);
  });

  it('handles 1000+ actions without pathological cost', () => {
    const before = Array.from({ length: 1200 }, (_, i) =>
      act({ label: 'Page.click', apiName: 'click', locatorFingerprint: `#c${i}` }),
    );
    const after = Array.from({ length: 1200 }, (_, i) =>
      act({ label: 'Page.click', apiName: 'click', locatorFingerprint: `#c${i}`, id: `x${i}` }),
    );
    const t0 = Date.now();
    const r = alignActions(before, after);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(r.pairs.filter((p) => p.beforeId && p.afterId).length).toBe(1200);
  });

  it('manual override forces a pair', () => {
    const before = [act({ id: 'B1', label: 'a', apiName: 'x' })];
    const after = [act({ id: 'A1', label: 'zzz', apiName: 'y' })];
    const r = alignActions(before, after, {
      manualOverrides: [{ beforeId: 'B1', afterId: 'A1' }],
    });
    const p = r.pairs.find((p) => p.manualOverride);
    expect(p).toBeDefined();
    expect(p!.beforeId).toBe('B1');
    expect(p!.afterId).toBe('A1');
  });

  it('unpair frees BOTH sides: before becomes removed, after becomes added', () => {
    const before = [
      act({ id: 'B1', label: 'Page.click', apiName: 'click', locatorFingerprint: '#a' }),
      act({ id: 'B2', label: 'Page.fill', apiName: 'fill', locatorFingerprint: '#b' }),
    ];
    const after = [
      act({ id: 'A1', label: 'Page.click', apiName: 'click', locatorFingerprint: '#a' }),
      act({ id: 'A2', label: 'Page.fill', apiName: 'fill', locatorFingerprint: '#b' }),
    ];
    const r = alignActions(before, after, {
      manualOverrides: [{ beforeId: 'B1' }],
    });
    // B1 must be unmatched-removed; its former partner A1 must NOT vanish -
    // it resurfaces as an unmatched-added pair.
    expect(r.removedIds).toContain('B1');
    expect(r.addedIds).toContain('A1');
    const bPair = r.pairs.find((p) => p.beforeId === 'B1');
    const aPair = r.pairs.find((p) => p.afterId === 'A1');
    expect(bPair?.afterId).toBeUndefined();
    expect(aPair?.beforeId).toBeUndefined();
    expect(bPair?.manualOverride).toBe(true);
    // B2/A2 still paired.
    expect(r.pairs.some((p) => p.beforeId === 'B2' && p.afterId === 'A2')).toBe(true);
  });

  it('manual re-pair releases displaced partners as unmatched', () => {
    const before = [
      act({ id: 'B1', label: 'Page.click', apiName: 'click', locatorFingerprint: '#a' }),
      act({ id: 'B2', label: 'Page.fill', apiName: 'fill', locatorFingerprint: '#b' }),
    ];
    const after = [
      act({ id: 'A1', label: 'Page.click', apiName: 'click', locatorFingerprint: '#a' }),
      act({ id: 'A2', label: 'Page.fill', apiName: 'fill', locatorFingerprint: '#b' }),
    ];
    const r = alignActions(before, after, {
      manualOverrides: [{ beforeId: 'B1', afterId: 'A2' }],
    });
    expect(r.pairs.some((p) => p.beforeId === 'B1' && p.afterId === 'A2' && p.manualOverride)).toBe(true);
    expect(r.removedIds).toContain('B2');
    expect(r.addedIds).toContain('A1');
    // No action appears in two pairs.
    const ids = r.pairs.flatMap((p) => [p.beforeId, p.afterId].filter(Boolean) as string[]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('added/removed counts stay consistent after unpair (used by summary)', () => {
    const before = [act({ id: 'B1', label: 'Page.click', apiName: 'click', locatorFingerprint: '#a' })];
    const after = [act({ id: 'A1', label: 'Page.click', apiName: 'click', locatorFingerprint: '#a' })];
    const r = alignActions(before, after, { manualOverrides: [{ beforeId: 'B1' }] });
    expect(r.removedIds).toEqual(['B1']);
    expect(r.addedIds).toEqual(['A1']);
  });

  it('aligns long non-anchored sequences via banded DP', () => {
    // All identical keys -> no unique anchors -> one large DP segment.
    const before = Array.from({ length: 600 }, (_, i) =>
      act({ id: `b${i}`, label: 'Page.click', apiName: 'click' }),
    );
    const after = Array.from({ length: 600 }, (_, i) =>
      act({ id: `a${i}`, label: 'Page.click', apiName: 'click' }),
    );
    // Insert 20 extra actions in the middle.
    for (let k = 0; k < 20; k++) {
      after.splice(300, 0, act({ id: `x${k}`, label: 'Page.hover', apiName: 'hover' }));
    }
    const t0 = Date.now();
    const r = alignActions(before, after);
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(r.pairs.filter((p) => p.beforeId && p.afterId).length).toBe(600);
    expect(r.addedIds.length).toBe(20);
    expect(r.removedIds.length).toBe(0);
  });
});
