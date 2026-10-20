import { useMemo, useState } from 'react';
import { useStore } from '../state';
import { Card, StatusPill } from '../components';
import { EmptyState } from './Dashboard';
import { useVirtualRows } from '../virtual';
import type { NormalizedAction } from '@sanestly/contracts';

export function ActionsView() {
  const { result, before, after, addManualOverride, removeManualOverride, manualOverrides, compare, comparing } =
    useStore();
  const [filter, setFilter] = useState<'all' | 'added' | 'removed' | 'matched'>('all');
  const [selBefore, setSelBefore] = useState<string>();
  const [selAfter, setSelAfter] = useState<string>();

  const beforeById = useMemo(
    () => new Map((before.trace?.runs[0]?.actions ?? []).map((a) => [a.id, a])),
    [before.trace],
  );
  const afterById = useMemo(
    () => new Map((after.trace?.runs[0]?.actions ?? []).map((a) => [a.id, a])),
    [after.trace],
  );

  const rows = (result?.pairs ?? [])
    .map((p) => {
      const kind = p.beforeId && p.afterId ? 'matched' : p.beforeId ? 'removed' : 'added';
      return { pair: p, kind, before: p.beforeId ? beforeById.get(p.beforeId) : undefined, after: p.afterId ? afterById.get(p.afterId) : undefined };
    })
    .filter((r) => filter === 'all' || r.kind === filter || (filter === 'matched' && r.kind === 'matched'));

  const vw = useVirtualRows(rows.length);

  if (!result) return <EmptyState text="No comparison yet - import two traces first." />;

  const canPair = selBefore !== undefined && selAfter !== undefined;
  const hasTraces = before.trace !== undefined && after.trace !== undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter pairs">
        {(['all', 'matched', 'added', 'removed'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded px-3 py-1.5 text-xs font-medium ${filter === f ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'bg-gray-100 dark:bg-gray-800'}`}
          >
            {f}
          </button>
        ))}
        {hasTraces && canPair && (
          <button
            onClick={() => {
              addManualOverride({ beforeId: selBefore, afterId: selAfter });
              setSelBefore(undefined);
              setSelAfter(undefined);
              void compare();
            }}
            disabled={comparing}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            Pair selected actions
          </button>
        )}
        {hasTraces && manualOverrides.length > 0 && (
          <span className="text-xs text-gray-500">
            {manualOverrides.length} manual override(s) -{' '}
            {manualOverrides.map((o, i) => (
              <button
                key={i}
                className="ml-1 underline"
                onClick={() => {
                  removeManualOverride(o);
                  void compare();
                }}
                title={`remove override ${o.beforeId ?? '-'} -> ${o.afterId ?? '-'}`}
              >
                [x]
              </button>
            ))}
          </span>
        )}
        <span className="ml-auto text-xs text-gray-500">{rows.length} alignment rows</span>
      </div>

      <Card className="overflow-x-auto p-0">
        <div ref={vw.containerRef} onScroll={vw.onScroll} className="max-h-[70vh] overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800/50">
              <th scope="col" className="px-3 py-2"></th>
              <th scope="col" className="px-3 py-2">Baseline action</th>
              <th scope="col" className="px-3 py-2">Baseline ms</th>
              <th scope="col" className="px-3 py-2"></th>
              <th scope="col" className="px-3 py-2">Candidate action</th>
              <th scope="col" className="px-3 py-2">Candidate ms</th>
              <th scope="col" className="px-3 py-2">Conf.</th>
              <th scope="col" className="px-3 py-2">Why</th>
            </tr>
          </thead>
          <tbody>
            {vw.topPad > 0 && <tr aria-hidden="true"><td colSpan={8} style={{ height: vw.topPad, padding: 0, border: 0 }} /></tr>}
            {rows.slice(vw.start, vw.end).map(({ pair, before: b, after: a, kind }) => (
              <tr key={`${pair.beforeId ?? 'x'}-${pair.afterId ?? 'x'}`} className="border-b border-gray-100 dark:border-gray-800">
                <td className="px-3 py-1.5">
                  {kind === 'removed' && pair.beforeId && (
                    <input
                      type="radio"
                      name="sel-before"
                      aria-label={`select baseline ${b?.label}`}
                      checked={selBefore === pair.beforeId}
                      onChange={() => setSelBefore(pair.beforeId)}
                    />
                  )}
                  {kind === 'matched' && hasTraces && (
                    <button
                      className="text-gray-400 underline"
                      title="unpair this match"
                      disabled={comparing}
                      onClick={() => {
                        addManualOverride({ beforeId: pair.beforeId, afterId: undefined });
                        void compare();
                      }}
                    >
                      unpair
                    </button>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  {b ? <ActionCell a={b} /> : <span className="text-gray-400">-</span>}
                </td>
                <td className="px-3 py-1.5 tabular-nums text-gray-500">{dur(b)}</td>
                <td className="px-3 py-1.5"><StatusPill status={kind === 'matched' ? statusOf(b, a) : kind} /></td>
                <td className="px-3 py-1.5">
                  {a ? (
                    <span className="flex items-start gap-2">
                      {kind === 'added' && pair.afterId && (
                        <input
                          type="radio"
                          name="sel-after"
                          aria-label={`select candidate ${a.label}`}
                          checked={selAfter === pair.afterId}
                          onChange={() => setSelAfter(pair.afterId)}
                        />
                      )}
                      <ActionCell a={a} />
                    </span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </td>
                <td className="px-3 py-1.5 tabular-nums text-gray-500">{dur(a)}</td>
                <td className="px-3 py-1.5 tabular-nums">
                  {pair.confidence > 0 ? `${Math.round(pair.confidence * 100)}%` : '-'}
                </td>
                <td className="max-w-56 px-3 py-1.5 text-gray-500">
                  {pair.matchReason.join('; ')}
                  {pair.manualOverride ? ' (manual)' : ''}
                </td>
              </tr>
            ))}
            {vw.bottomPad > 0 && <tr aria-hidden="true"><td colSpan={8} style={{ height: vw.bottomPad, padding: 0, border: 0 }} /></tr>}
          </tbody>
        </table>
        </div>
      </Card>
    </div>
  );
}

function statusOf(b?: NormalizedAction, a?: NormalizedAction): string {
  if (!b || !a) return 'unmatched';
  if (b.status !== a.status || b.label !== a.label) return 'changed';
  return 'unchanged';
}

function dur(a?: NormalizedAction): string {
  if (!a || a.endMs === undefined) return '-';
  return `${Math.round(a.endMs - a.startMs)}`;
}

function ActionCell({ a }: { a: NormalizedAction }) {
  return (
    <div>
      <span className={`font-medium ${a.status === 'failed' ? 'text-red-600 dark:text-red-400' : ''}`}>{a.label}</span>
      {a.locatorFingerprint && <span className="ml-1 font-mono text-gray-400">{a.locatorFingerprint}</span>}
      {a.source?.file && (
        <div className="text-gray-400">
          {a.source.file.split('/').pop()}:{a.source.line}
        </div>
      )}
    </div>
  );
}
