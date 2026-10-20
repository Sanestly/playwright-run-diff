import type { ComparisonReport } from '@sanestly/contracts';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#b3261e',
  high: '#d92d20',
  medium: '#b54708',
  low: '#175cd3',
  info: '#475467',
};

/**
 * Self-contained, sanitized HTML report: no remote resources, no scripts,
 * strict-escaped content. Safe to share.
 */
export function reportToHtml(report: ComparisonReport): string {
  const rows = report.findings
    .filter((f) => !f.suppressed)
    .map((f) => {
      const ev = f.evidence.map((e) => `${e.run}:${e.kind}:${e.id}`).join(', ');
      return `<tr>
<td><span class="sev" style="background:${SEVERITY_COLOR[f.severity] ?? '#475467'}">${esc(f.severity)}</span></td>
<td>${esc(f.status)}</td>
<td>${esc(f.category)}</td>
<td><strong>${esc(f.title)}</strong><br/><span class="muted">${esc(f.details)}</span><br/><span class="muted">${esc(f.ruleId)} | confidence ${f.confidence}</span></td>
<td class="muted">${esc(ev)}</td>
</tr>`;
    })
    .join('\n');

  const summaryRows = Object.entries(report.summary)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v === null ? 'n/a' : esc(String(v))}</td></tr>`)
    .join('\n');

  const limitations = report.limitations.map((l) => `<li>${esc(l)}</li>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"/>
<title>Playwright Run Diff Report</title>
<style>
body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:2rem auto;max-width:1100px;padding:0 1rem;color:#1d2939;background:#fff}
h1{font-size:1.4rem} h2{font-size:1.1rem;margin-top:2rem}
table{border-collapse:collapse;width:100%;font-size:.85rem}
td,th{border-bottom:1px solid #eaecf0;padding:.5rem .6rem;text-align:left;vertical-align:top}
.sev{color:#fff;border-radius:4px;padding:.1rem .45rem;font-size:.75rem;text-transform:uppercase}
.muted{color:#667085;font-size:.8rem}
.meta{display:flex;gap:2rem;flex-wrap:wrap;background:#f9fafb;border:1px solid #eaecf0;border-radius:8px;padding:1rem;margin:1rem 0}
.meta div{font-size:.85rem}
code{background:#f2f4f7;padding:.1rem .3rem;border-radius:4px}
</style>
</head>
<body>
<h1>Playwright Run Diff Report</h1>
<div class="meta">
<div><strong>Before</strong><br/><code>${esc(report.before.sourceLabel)}</code><br/><span class="muted">${esc(report.before.browser ?? 'unknown browser')} - Playwright ${esc(report.before.recordedVersion ?? 'unknown')}</span></div>
<div><strong>After</strong><br/><code>${esc(report.after.sourceLabel)}</code><br/><span class="muted">${esc(report.after.browser ?? 'unknown browser')} - Playwright ${esc(report.after.recordedVersion ?? 'unknown')}</span></div>
<div><strong>Generated</strong><br/>${esc(report.createdAt)}<br/><span class="muted">run-diff ${esc(report.toolVersion)} - schema ${esc(report.schemaVersion)}</span></div>
</div>
<p class="muted">Generated locally by Sanestly Playwright Run Diff. Trace bytes were not uploaded. Report content is sanitized; screenshots are not embedded by default.</p>
<h2>Summary</h2>
<table><tbody>${summaryRows}</tbody></table>
${limitations ? `<h2>Limitations</h2><ul>${limitations}</ul>` : ''}
<h2>Findings</h2>
<table>
<thead><tr><th>Severity</th><th>Status</th><th>Category</th><th>Finding</th><th>Evidence</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5">No behavioral differences detected within configured thresholds.</td></tr>'}</tbody>
</table>
</body>
</html>
`;
}
