import type { ComparisonReport, Severity } from '@sanestly/contracts';

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export function reportToMarkdown(report: ComparisonReport): string {
  const lines: string[] = [];
  lines.push('# Playwright Run Diff Report');
  lines.push('');
  lines.push(`- Schema: ${report.schemaVersion} | Tool: run-diff ${report.toolVersion}`);
  lines.push(`- Generated: ${report.createdAt}`);
  lines.push(`- Before: \`${report.before.sourceLabel}\` (${report.before.browser ?? 'unknown browser'}, Playwright ${report.before.recordedVersion ?? 'unknown'})`);
  lines.push(`- After: \`${report.after.sourceLabel}\` (${report.after.browser ?? 'unknown browser'}, Playwright ${report.after.recordedVersion ?? 'unknown'})`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  for (const [k, v] of Object.entries(report.summary).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`| ${k} | ${v === null ? 'n/a' : String(v)} |`);
  }
  lines.push('');

  if (report.limitations.length) {
    lines.push('## Limitations');
    lines.push('');
    for (const l of report.limitations) lines.push(`- ${l}`);
    lines.push('');
  }

  const active = report.findings.filter((f) => !f.suppressed);
  const suppressed = report.findings.filter((f) => f.suppressed);

  lines.push(`## Findings (${active.length})`);
  lines.push('');
  if (active.length === 0) {
    lines.push('No behavioral differences detected within configured thresholds.');
    lines.push('');
  } else {
    for (const sev of SEVERITY_ORDER) {
      const group = active.filter((f) => f.severity === sev);
      if (group.length === 0) continue;
      lines.push(`### ${sev.toUpperCase()}`);
      lines.push('');
      for (const f of group) {
        lines.push(`- **[${f.ruleId}] ${f.title}**`);
        lines.push(`  - status: ${f.status}, category: ${f.category}, confidence: ${f.confidence}`);
        lines.push(`  - ${f.details}`);
        if (f.evidence.length) {
          const ev = f.evidence.map((e) => `${e.run}:${e.kind}:${e.id}`).join(', ');
          lines.push(`  - evidence: ${ev}`);
        }
      }
      lines.push('');
    }
  }

  if (suppressed.length) {
    lines.push(`## Suppressed findings (${suppressed.length})`);
    lines.push('');
    for (const f of suppressed) {
      lines.push(`- [${f.ruleId}] ${f.title} (suppressed by ignore patterns)`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
