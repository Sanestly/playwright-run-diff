import { describe, expect, it } from 'vitest';
import { parseComparisonReport, type ComparisonReport } from '@sanestly/contracts';
import { buildReport } from '../src/build.js';
import { reportToHtml } from '../src/html.js';
import { reportToJson } from '../src/json.js';
import { reportToMarkdown } from '../src/markdown.js';

function fakeReport(): ComparisonReport {
  return buildReport({
    before: {
      id: 't1',
      sourceLabel: 'before.zip',
      runs: [],
      warnings: [],
    },
    after: { id: 't2', sourceLabel: 'after.zip', runs: [], warnings: [] },
    result: {
      pairs: [{ beforeId: 'a', afterId: 'b', confidence: 0.9, matchReason: ['same action type'] }],
      findings: [
        {
          id: 'F-0001',
          category: 'network',
          severity: 'high',
          status: 'changed',
          title: 'Status changed 200 -> 500',
          details: 'detail <script>alert(1)</script>',
          evidence: [{ kind: 'request', run: 'after', id: 'r2' }],
          confidence: 0.95,
          ruleId: 'RD-NET-004',
        },
      ],
      timingDeltas: [],
      requestPairs: [],
      screenshotPairs: [],
      limitations: ['screenshots not recorded'],
      summary: { 'findings.total': 1 },
    },
    settings: {
      timing: { minAbsoluteMs: 100, minRelativeIncrease: 0.2 },
      match: { minimumConfidence: 0.6 },
      visuals: { maxPixelDiffRatio: 0.01, maskRects: [] },
      ignore: { urlPatterns: [], actionPatterns: [], responseHeaders: [] },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
  });
}

describe('report', () => {
  it('produces schema-valid deterministic JSON', () => {
    const r = fakeReport();
    const j1 = reportToJson(r);
    const j2 = reportToJson(r);
    expect(j1).toBe(j2);
    expect(() => parseComparisonReport(JSON.parse(j1))).not.toThrow();
  });

  it('rejects future major schema versions', () => {
    const r = fakeReport();
    const mutated = { ...JSON.parse(reportToJson(r)), schemaVersion: '2.0' };
    expect(() => parseComparisonReport(mutated)).toThrow(/Unsupported report schemaVersion/);
  });

  it('html export escapes untrusted content and ships no remote refs', () => {
    const html = reportToHtml(fakeReport());
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/src="http/);
    expect(html).not.toMatch(/href="http/);
  });

  it('markdown export contains findings', () => {
    const md = reportToMarkdown(fakeReport());
    expect(md).toContain('RD-NET-004');
    expect(md).toContain('Status changed');
  });
});
