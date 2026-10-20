import { Card } from '../components';

export function HelpView() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <h3 className="text-sm font-semibold">Supported input</h3>
        <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-gray-600 dark:text-gray-400">
          <li>Playwright trace <code>.zip</code> exports (<code>context.tracing.start/stop</code>, Playwright Test <code>trace: 'on'</code>).</li>
          <li>Chunked traces with multiple <code>*.trace</code>/<code>*.network</code>/<code>*.stacks</code> groups.</li>
          <li>Saved <code>comparison-report.json</code> files for schema validation.</li>
          <li>Limits: 150 MiB compressed per archive (configurable to 300 MiB), 600 MiB decompressed, 25k entries.</li>
        </ul>
      </Card>
      <Card>
        <h3 className="text-sm font-semibold">Privacy</h3>
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
          All parsing, matching and pixel diffing run inside your browser in a Web Worker. Trace
          bytes are never sent to any server. Hosting this page does require normal asset requests
          (JS/CSS) as with any website - but your trace data stays local. Exported reports are
          sanitized (credentials, tokens, cookies, raw URLs with secrets are redacted) and do not
          embed screenshots.
        </p>
      </Card>
      <Card>
        <h3 className="text-sm font-semibold">Compatibility & caveats</h3>
        <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-gray-600 dark:text-gray-400">
          <li>The Playwright trace format is internal and may change between versions; unsupported layouts are reported honestly instead of failing silently.</li>
          <li><code>browserContext.tracing</code> does not record test assertions - those show as "not recorded".</li>
          <li>A single recording is not statistical proof of a regression; repeat runs are recommended.</li>
          <li>Screenshots missing in one run are reported as unavailable, never as a pass.</li>
          <li>Third-party endpoints (analytics, ads) may be non-deterministic - use ignore URL patterns to suppress noise.</li>
        </ul>
      </Card>
      <Card>
        <h3 className="text-sm font-semibold">Troubleshooting</h3>
        <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-gray-600 dark:text-gray-400">
          <li><strong>"not a ZIP"</strong>: export the trace with <code>tracing.stop({'{ path: "trace.zip" }'})</code>, not the raw output directory.</li>
          <li><strong>No screenshots</strong>: enable <code>tracing.start({'{ screenshots: true }'})</code> or <code>trace: 'on'</code> in Playwright Test.</li>
          <li><strong>Oversized archive</strong>: trim the test scope, or split trace chunks; limits exist to protect browser memory.</li>
          <li><strong>Wrong action pairing</strong>: check the confidence column; improve by giving stable locators (test-ids).</li>
        </ul>
      </Card>
    </div>
  );
}
