import { useState } from 'react';
import { useStore } from '../state';
import { Card, DropZone } from '../components';
import { parseComparisonReport } from '@sanestly/contracts';

export function Landing() {
  const { before, after, loadFile, loadSample, compare, comparing, progress, viewReport, beforeRun, afterRun, setRunIndex } = useStore();
  const ready = before.status === 'ready' && after.status === 'ready';
  const [reportError, setReportError] = useState('');

  const openReport = async (f: File) => {
    try {
      viewReport(parseComparisonReport(JSON.parse(await f.text())));
      setReportError('');
    } catch (err) {
      setReportError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <section className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          Compare two Playwright runs
        </h1>
        <p className="mt-3 text-gray-600 dark:text-gray-400">
          Drop two trace archives - find added steps, network regressions, new console
          errors and visual changes. Everything runs in your browser; trace bytes are
          never uploaded.
        </p>
      </section>

      <Card className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <DropZone
              label="Baseline trace (before)"
              status={before.status}
              error={before.error}
              progress={before.progress}
              onFile={(f) => void loadFile('before', f)}
            />
            <RunPicker trace={before.trace} value={beforeRun} onChange={(i) => setRunIndex('before', i)} />
          </div>
          <div>
            <DropZone
              label="Candidate trace (after)"
              status={after.status}
              error={after.error}
              progress={after.progress}
              onFile={(f) => void loadFile('after', f)}
            />
            <RunPicker trace={after.trace} value={afterRun} onChange={(i) => setRunIndex('after', i)} />
          </div>
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => void compare()}
            disabled={!ready || comparing}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
          >
            {comparing ? `Comparing - ${progress ?? ''}` : 'Compare traces'}
          </button>
          <button
            onClick={() => void loadSample()}
            disabled={comparing}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-600"
          >
            Try sample traces
          </button>
          <label className="cursor-pointer rounded-md border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-600">
            Open saved report
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void openReport(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {reportError && <p className="text-center text-xs text-red-600 dark:text-red-400">{reportError}</p>}
      </Card>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ['1. Export traces', 'Record with playwright tracing (screenshots + snapshots on) and save the .zip for each run.'],
          ['2. Compare locally', 'The app aligns actions between runs, then diffs timing, network, console and screenshots.'],
          ['3. Share a report', 'Export a sanitized JSON / HTML / Markdown report - credentials and tokens are redacted.'],
        ].map(([t, d]) => (
          <Card key={t}>
            <h3 className="text-sm font-semibold">{t}</h3>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{d}</p>
          </Card>
        ))}
      </section>

      <Card>
        <h3 className="text-sm font-semibold">CLI</h3>
        <pre className="mt-2 overflow-x-auto rounded bg-gray-100 p-3 text-xs dark:bg-gray-800">
{`npx @sanestly/run-diff compare before.zip after.zip --format html,json,md --out ./diff-report
npx @sanestly/run-diff compare ./a.zip ./b.zip --fail-on high`}
        </pre>
      </Card>
    </div>
  );
}

/** Pick which logical run inside a multi-stream archive to compare. */
function RunPicker({
  trace,
  value,
  onChange,
}: {
  trace?: { runs: Array<{ id: string; label: string; actions: unknown[]; requests: unknown[] }> };
  value: number;
  onChange: (i: number) => void;
}) {
  if (!trace || trace.runs.length <= 1) return null;
  return (
    <label className="mt-2 block text-xs text-gray-600 dark:text-gray-400">
      Run in archive ({trace.runs.length} found):
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="ml-2 rounded border border-gray-300 bg-transparent px-2 py-1 dark:border-gray-600"
      >
        {trace.runs.map((r, i) => (
          <option key={r.id} value={i}>
            {r.label} - {r.actions.length} actions, {r.requests.length} requests
          </option>
        ))}
      </select>
    </label>
  );
}
