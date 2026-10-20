import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runComparison } from '../src/pipeline.js';
import { parseComparisonReport } from '@sanestly/contracts';
import { reportToJson } from '@sanestly/report';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIX = join(ROOT, 'fixtures', 'generated');
const BASE = join(FIX, 'sample-a', 'baseline.zip');
const CAND = join(FIX, 'sample-a', 'candidate.zip');
const SAME_B = join(FIX, 'identical', 'baseline.zip');
const SAME_A = join(FIX, 'identical', 'candidate.zip');
const BIN = join(ROOT, 'apps', 'cli', 'dist', 'bin.js');

const has = existsSync(BASE) && existsSync(CAND);

describe.skipIf(!has)('golden fixtures (playwright 1.64.1 chromium)', () => {
  it('sample-a produces expected finding classes', () => {
    const { report } = runComparison(BASE, CAND);
    const rules = new Set(report.findings.map((f) => f.ruleId));
    expect(rules.has('RD-ACT-001')).toBe(true); // extra click added
    expect(rules.has('RD-NET-004')).toBe(true); // 200 -> 500
    expect(rules.has('RD-CON-001')).toBe(true); // new console error
    const net = report.findings.find((f) => f.ruleId === 'RD-NET-004');
    expect(net!.severity).toBe('high');
    expect(net!.title).toContain('200 -> 500');
  });

  it('report JSON round-trips through schema validation', () => {
    const { report } = runComparison(BASE, CAND, { createdAt: '2026-01-01T00:00:00Z' });
    const parsed = parseComparisonReport(JSON.parse(reportToJson(report)));
    expect(parsed.findings.length).toBe(report.findings.length);
  });

  it('is deterministic for identical inputs', () => {
    const r1 = runComparison(BASE, CAND, { createdAt: '2026-01-01T00:00:00Z' });
    const r2 = runComparison(BASE, CAND, { createdAt: '2026-01-01T00:00:00Z' });
    expect(reportToJson(r1.report)).toBe(reportToJson(r2.report));
  });

  it('equivalent runs produce no critical/high diffs', () => {
    const { report } = runComparison(SAME_B, SAME_A);
    const bad = report.findings.filter(
      (f) => (f.severity === 'critical' || f.severity === 'high') && !f.suppressed,
    );
    expect(bad).toEqual([]);
  });

  it('CLI compare exits 1 on --fail-on high, 0 on none', () => {
    let code = 0;
    try {
      execFileSync('node', [BIN, 'compare', BASE, CAND, '--fail-on', 'high', '--out', '/tmp/rd-golden-out'], {
        stdio: 'pipe',
      });
    } catch (e) {
      code = (e as { status: number }).status;
    }
    expect(code).toBe(1);

    code = 0;
    try {
      execFileSync('node', [BIN, 'compare', SAME_B, SAME_A, '--fail-on', 'high', '--out', '/tmp/rd-golden-out2'], {
        stdio: 'pipe',
      });
    } catch (e) {
      code = (e as { status: number }).status;
    }
    expect(code).toBe(0);
  });

  it('secrets in URLs do not leak into the report (E14)', () => {
    const { report } = runComparison(BASE, CAND);
    const json = reportToJson(report);
    expect(json).not.toContain('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
    expect(json).not.toContain('deadbeefcafe1234');
    expect(json).toContain('access_token=*');
    expect(json).toContain('session=*');
    expect(json).toContain('name=public');
  });

  it('CLI rejects a non-zip with exit code 2', () => {
    let code = 0;
    try {
      execFileSync('node', [BIN, 'inspect', join(ROOT, 'package.json')], { stdio: 'pipe' });
    } catch (e) {
      code = (e as { status: number }).status;
    }
    expect(code).toBe(2);
  });
});
