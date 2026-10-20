import { useState } from 'react';
import { useStore } from '../state';
import { Card, StatusPill } from '../components';
import { EmptyState } from './Dashboard';
import { useVirtualRows } from '../virtual';
import type { RequestPair } from '@sanestly/analysis';

export function NetworkView() {
  const { result } = useStore();
  const [domainFilter, setDomainFilter] = useState('');
  const [onlyChanges, setOnlyChanges] = useState(true);

  const pairs: RequestPair[] = (result?.requestPairs ?? []).filter((p) => {
    const url = (p.before ?? p.after)?.normalizedUrl ?? '';
    if (domainFilter && !url.includes(domainFilter)) return false;
    if (!onlyChanges) return true;
    const changed =
      !p.before ||
      !p.after ||
      p.before.status !== p.after.status ||
      Boolean(!p.before.failureReason && p.after.failureReason);
    const latencyDelta =
      p.before && p.after && p.before.endMs !== undefined && p.after.endMs !== undefined &&
      p.before.startMs !== undefined && p.after.startMs !== undefined
        ? Math.abs(p.after.endMs - p.after.startMs - (p.before.endMs - p.before.startMs)) >= 100
        : false;
    return changed || latencyDelta;
  });

  const vw = useVirtualRows(pairs.length);

  if (!result) return <EmptyState text="No comparison yet - import two traces first." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
          placeholder="Filter by URL contains..."
          className="rounded border border-gray-300 bg-transparent px-3 py-1.5 text-xs dark:border-gray-600"
          aria-label="Filter requests"
        />
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
          <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />
          changes only
        </label>
        <span className="ml-auto text-xs text-gray-500">{pairs.length} request pairs</span>
      </div>
      <Card className="overflow-x-auto p-0">
        <div ref={vw.containerRef} onScroll={vw.onScroll} className="max-h-[70vh] overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800/50">
              <th scope="col" className="px-3 py-2">Status</th>
              <th scope="col" className="px-3 py-2">Method</th>
              <th scope="col" className="px-3 py-2">URL (sanitized)</th>
              <th scope="col" className="px-3 py-2">Type</th>
              <th scope="col" className="px-3 py-2">Before</th>
              <th scope="col" className="px-3 py-2">After</th>
              <th scope="col" className="px-3 py-2">Latency</th>
            </tr>
          </thead>
          <tbody>
            {vw.topPad > 0 && <tr aria-hidden="true"><td colSpan={7} style={{ height: vw.topPad, padding: 0, border: 0 }} /></tr>}
            {pairs.slice(vw.start, vw.end).map((p, i) => {
              const r = p.before ?? p.after!;
              const status = !p.before ? 'added' : !p.after ? 'removed' : p.before.status !== p.after.status ? 'changed' : 'unchanged';
              const latB = lat(p.before);
              const latA = lat(p.after);
              const delta = latB !== undefined && latA !== undefined ? latA - latB : undefined;
              return (
                <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="px-3 py-1.5"><StatusPill status={status} /></td>
                  <td className="px-3 py-1.5 font-mono">{r.method}</td>
                  <td className="max-w-md truncate px-3 py-1.5" title={r.normalizedUrl}>{r.normalizedUrl}</td>
                  <td className="px-3 py-1.5 text-gray-500">{r.resourceType ?? '-'}</td>
                  <td className="px-3 py-1.5 tabular-nums">{p.before?.status ?? '-'}{p.before?.failureReason ? ' (fail)' : ''}</td>
                  <td className={`px-3 py-1.5 tabular-nums ${(p.after?.status ?? 0) >= 400 ? 'font-semibold text-red-600 dark:text-red-400' : ''}`}>
                    {p.after?.status ?? '-'}{p.after?.failureReason ? ' (fail)' : ''}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-gray-500">
                    {delta !== undefined ? `${delta > 0 ? '+' : ''}${Math.round(delta)} ms` : '-'}
                  </td>
                </tr>
              );
            })}
            {pairs.length === 0 && (
              <tr><td colSpan={7} className="py-6 text-center text-gray-500">No request differences.</td></tr>
            )}
            {vw.bottomPad > 0 && <tr aria-hidden="true"><td colSpan={7} style={{ height: vw.bottomPad, padding: 0, border: 0 }} /></tr>}
          </tbody>
        </table>
        </div>
      </Card>
    </div>
  );
}

function lat(r: { startMs?: number; endMs?: number } | undefined): number | undefined {
  if (!r || r.startMs === undefined || r.endMs === undefined) return undefined;
  return r.endMs - r.startMs;
}
