import { useState } from 'react';
import { useStore } from '../state';
import { Card } from '../components';
import { reportToHtml, reportToJson, reportToMarkdown } from '@sanestly/report';
import { parseComparisonReport } from '@sanestly/contracts';

export function SettingsView() {
  const { report, settings, updateSettings, manualOverrides, compare, comparing, viewReport } =
    useStore();
  const [urlPatterns, setUrlPatterns] = useState(settings.ignore.urlPatterns.join('\n'));
  const [actionPatterns, setActionPatterns] = useState(settings.ignore.actionPatterns.join('\n'));
  const [importError, setImportError] = useState('');

  const importReport = async (f: File) => {
    try {
      const parsed = parseComparisonReport(JSON.parse(await f.text()));
      setImportError('');
      viewReport(parsed);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!report) {
    return (
      <Card className="mx-auto max-w-lg space-y-3">
        <h3 className="text-sm font-semibold">Open a saved report</h3>
        <p className="text-xs text-gray-500">
          Load a previously exported <code>comparison-report.json</code> - no trace archives needed.
        </p>
        <input
          type="file"
          accept=".json"
          className="text-xs"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importReport(f);
          }}
          aria-label="Import a comparison-report.json"
        />
        {importError && <p className="text-xs text-red-600 dark:text-red-400">{importError}</p>}
      </Card>
    );
  }

  const download = (name: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const applyPatterns = () => {
    updateSettings({
      ignore: {
        ...settings.ignore,
        urlPatterns: urlPatterns.split('\n').map((s) => s.trim()).filter(Boolean),
        actionPatterns: actionPatterns.split('\n').map((s) => s.trim()).filter(Boolean),
      },
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">Thresholds</h3>
        <label className="block text-xs">
          Timing regression: min absolute delta (ms)
          <input
            type="number"
            className="mt-1 w-full rounded border border-gray-300 bg-transparent px-2 py-1.5 dark:border-gray-600"
            value={settings.timing.minAbsoluteMs}
            onChange={(e) => updateSettings({ timing: { ...settings.timing, minAbsoluteMs: Number(e.target.value) } })}
          />
        </label>
        <label className="block text-xs">
          Timing regression: min relative increase (0.2 = +20%)
          <input
            type="number"
            step="0.05"
            className="mt-1 w-full rounded border border-gray-300 bg-transparent px-2 py-1.5 dark:border-gray-600"
            value={settings.timing.minRelativeIncrease}
            onChange={(e) => updateSettings({ timing: { ...settings.timing, minRelativeIncrease: Number(e.target.value) } })}
          />
        </label>
        <label className="block text-xs">
          Match minimum confidence (0..1)
          <input
            type="number"
            step="0.05"
            min={0}
            max={1}
            className="mt-1 w-full rounded border border-gray-300 bg-transparent px-2 py-1.5 dark:border-gray-600"
            value={settings.match.minimumConfidence}
            onChange={(e) => updateSettings({ match: { minimumConfidence: Number(e.target.value) } })}
          />
        </label>
        <label className="block text-xs">
          Visual: max pixel diff ratio (0.01 = 1%)
          <input
            type="number"
            step="0.005"
            className="mt-1 w-full rounded border border-gray-300 bg-transparent px-2 py-1.5 dark:border-gray-600"
            value={settings.visuals.maxPixelDiffRatio}
            onChange={(e) => updateSettings({ visuals: { ...settings.visuals, maxPixelDiffRatio: Number(e.target.value) } })}
          />
        </label>
        <label className="block text-xs">
          Ignore URL patterns (regex, one per line)
          <textarea
            className="mt-1 w-full rounded border border-gray-300 bg-transparent px-2 py-1.5 font-mono dark:border-gray-600"
            rows={3}
            value={urlPatterns}
            onChange={(e) => setUrlPatterns(e.target.value)}
          />
        </label>
        <label className="block text-xs">
          Ignore action patterns (regex, one per line)
          <textarea
            className="mt-1 w-full rounded border border-gray-300 bg-transparent px-2 py-1.5 font-mono dark:border-gray-600"
            rows={3}
            value={actionPatterns}
            onChange={(e) => setActionPatterns(e.target.value)}
          />
        </label>
        <div className="flex gap-2">
          <button onClick={applyPatterns} className="rounded border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-600">
            Apply ignore patterns
          </button>
          <button
            onClick={() => void compare()}
            disabled={comparing}
            className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
          >
            {comparing ? 'Re-running...' : 'Re-run comparison'}
          </button>
        </div>
        {manualOverrides.length > 0 && (
          <p className="text-xs text-gray-500">{manualOverrides.length} manual mapping override(s) active.</p>
        )}
      </Card>

      <div className="space-y-4">
        <Card className="space-y-3">
          <h3 className="text-sm font-semibold">Export sanitized report</h3>
          <p className="text-xs text-gray-500">
            Reports contain normalized metadata only - no raw URLs with tokens, headers, cookies,
            request bodies or screenshot binaries.
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => download('comparison-report.json', reportToJson(report), 'application/json')} className="rounded border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-600">
              JSON
            </button>
            <button onClick={() => download('comparison-report.md', reportToMarkdown(report), 'text/markdown')} className="rounded border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-600">
              Markdown
            </button>
            <button onClick={() => download('comparison-report.html', reportToHtml(report), 'text/html')} className="rounded border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-600">
              Self-contained HTML
            </button>
          </div>
        </Card>

        <Card className="space-y-3">
          <h3 className="text-sm font-semibold">Validate a saved report</h3>
          <input
            type="file"
            accept=".json"
            className="text-xs"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importReport(f);
            }}
            aria-label="Import a comparison-report.json"
          />
          {importError && <p className="text-xs text-red-600 dark:text-red-400">{importError}</p>}
        </Card>

        <Card>
          <h3 className="text-sm font-semibold">Equivalent CLI command</h3>
          <pre className="mt-2 overflow-x-auto rounded bg-gray-100 p-3 text-xs dark:bg-gray-800">
{`npx @sanestly/run-diff compare before.zip after.zip --format json,md,html --out ./diff-report`}
          </pre>
        </Card>
      </div>
    </div>
  );
}
