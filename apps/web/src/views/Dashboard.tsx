import { useState } from 'react';
import { useStore } from '../state';
import { Card, SeverityBadge, StatusPill } from '../components';
import type { Severity } from '@sanestly/contracts';

const SEV_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export function Dashboard() {
  const { report, result, before, after } = useStore();
  const [sevFilter, setSevFilter] = useState<Severity | 'all'>('all');
  const [showSuppressed, setShowSuppressed] = useState(false);

  if (!report || !result) {
    return <EmptyState text="No comparison yet - import two traces first." />;
  }

  const findings = report.findings.filter((f) => showSuppressed || !f.suppressed);
  const filtered = sevFilter === 'all' ? findings : findings.filter((f) => f.severity === sevFilter);
  const worst = SEV_ORDER.find((s) => findings.some((f) => f.severity === s));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <div className="text-xs text-gray-500">Baseline</div>
          <div className="mt-1 truncate text-sm font-medium" title={before.trace?.sourceLabel ?? before.fileName}>
            {before.trace?.sourceLabel ?? before.fileName}
          </div>
          <div className="text-xs text-gray-500">
            {before.trace?.browser ?? report.before.browser ?? '?'} - PW{' '}
            {before.trace?.recordedVersion ?? report.before.recordedVersion ?? '?'}
          </div>
        </Card>
        <Card>
          <div className="text-xs text-gray-500">Candidate</div>
          <div className="mt-1 truncate text-sm font-medium" title={after.trace?.sourceLabel ?? after.fileName}>
            {after.trace?.sourceLabel ?? after.fileName}
          </div>
          <div className="text-xs text-gray-500">
            {after.trace?.browser ?? report.after.browser ?? '?'} - PW{' '}
            {after.trace?.recordedVersion ?? report.after.recordedVersion ?? '?'}
          </div>
        </Card>
        <Card>
          <div className="text-xs text-gray-500">Duration</div>
          <div className="mt-1 text-sm font-medium">
            {fmtMs(report.summary['duration.beforeMs'])} {'->'} {fmtMs(report.summary['duration.afterMs'])}
          </div>
          <div className="text-xs text-gray-500">single recording - not statistical proof</div>
        </Card>
        <Card>
          <div className="text-xs text-gray-500">Findings</div>
          <div className="mt-1 text-sm font-medium">
            {report.summary['findings.total']} total
          </div>
          <div className="text-xs text-gray-500">worst: {worst ?? 'none'}</div>
        </Card>
      </div>

      {(before.trace?.warnings.length || after.trace?.warnings.length || report.limitations.length) ? (
        <Card className="border-amber-300 dark:border-amber-700">
          <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">Warnings & limitations</h3>
          <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-amber-800 dark:text-amber-200">
            {report.limitations.map((l, i) => <li key={`l${i}`}>{l}</li>)}
            {[...(before.trace?.warnings ?? []), ...(after.trace?.warnings ?? [])].slice(0, 8).map((w, i) => (
              <li key={`w${i}`}>{w}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-semibold">Findings</h3>
          <div className="flex gap-1" role="group" aria-label="Filter by severity">
            {(['all', ...SEV_ORDER] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSevFilter(s)}
                className={`rounded px-2 py-1 text-xs ${sevFilter === s ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'bg-gray-100 dark:bg-gray-800'}`}
              >
                {s}
              </button>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
            <input type="checkbox" checked={showSuppressed} onChange={(e) => setShowSuppressed(e.target.checked)} />
            show suppressed ({report.findings.filter((f) => f.suppressed).length})
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500 dark:border-gray-700">
                <th scope="col" className="py-2 pr-2">Severity</th>
                <th scope="col" className="py-2 pr-2">Status</th>
                <th scope="col" className="py-2 pr-2">Category</th>
                <th scope="col" className="py-2 pr-2">Finding</th>
                <th scope="col" className="py-2">Rule</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => (
                <tr
                  key={f.id}
                  className={`border-b border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50 ${f.suppressed ? 'opacity-50' : ''}`}
                >
                  <td className="py-2 pr-2"><SeverityBadge severity={f.severity} /></td>
                  <td className="py-2 pr-2"><StatusPill status={f.status} /></td>
                  <td className="py-2 pr-2">{f.category}</td>
                  <td className="max-w-md py-2 pr-2">
                    <div className="font-medium">{f.title}</div>
                    <div className="mt-0.5 text-gray-500">{f.details}</div>
                  </td>
                  <td className="py-2 font-mono text-gray-500">{f.ruleId}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-gray-500">No findings match the current filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function fmtMs(v: unknown): string {
  return typeof v === 'number' ? `${Math.round(v)} ms` : 'n/a';
}

export function EmptyState({ text }: { text: string }) {
  const { setView } = useStore();
  return (
    <div className="py-20 text-center">
      <p className="text-gray-500">{text}</p>
      <button onClick={() => setView('landing')} className="mt-3 rounded-md border border-gray-300 px-4 py-2 text-sm dark:border-gray-600">
        Go to import
      </button>
    </div>
  );
}
