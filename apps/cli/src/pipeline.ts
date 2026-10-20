import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ComparisonReport, ComparisonSettings, TraceRun } from '@sanestly/contracts';
import { DEFAULT_COMPARISON_SETTINGS } from '@sanestly/contracts';
import { aggregateTimingFindings, compareRuns, diffRgba, type RgbaImage } from '@sanestly/analysis';
import {
  readTraceArchive,
  type ArchiveLimits,
  type ParsedArchive,
} from '@sanestly/trace-reader';
import { buildReport, reportToHtml, reportToJson, reportToMarkdown } from '@sanestly/report';
import { decodeImage } from './decode.js';

export interface CompareOptions {
  settings?: Partial<ComparisonSettings>;
  limits?: Partial<ArchiveLimits>;
  /** Pick which logical run index to use per side (default 0). */
  beforeRun?: number;
  afterRun?: number;
  /** Run pixel diffing of paired screenshots (default true). */
  visual?: boolean;
  createdAt?: string;
}

export interface CompareOutcome {
  report: ComparisonReport;
}

export function openTrace(path: string, limits?: Partial<ArchiveLimits>): ParsedArchive {
  const data = new Uint8Array(readFileSync(path));
  return readTraceArchive(data, { sourceLabel: basename(path), limits });
}

function pickRun(archive: ParsedArchive, index: number, side: string): TraceRun {
  const run = archive.trace.runs[index];
  if (!run) {
    throw new Error(
      `${side} archive has ${archive.trace.runs.length} run(s); requested index ${index} is out of range.`,
    );
  }
  return run;
}

function openTraces(pathSpec: string, limits?: Partial<ArchiveLimits>): ParsedArchive[] {
  // Comma-separated paths enable multi-run aggregate mode (spec P2.1):
  // "run-diff compare b1.zip,b2.zip,b3.zip c1.zip,c2.zip,c3.zip".
  return pathSpec
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => openTrace(p, limits));
}

export function runComparison(
  beforePath: string,
  afterPath: string,
  options: CompareOptions = {},
): CompareOutcome {
  const beforeArchives = openTraces(beforePath, options.limits);
  const afterArchives = openTraces(afterPath, options.limits);
  const before = beforeArchives[0]!;
  const after = afterArchives[0]!;
  const beforeRun = pickRun(before, options.beforeRun ?? 0, 'before');
  const afterRun = pickRun(after, options.afterRun ?? 0, 'after');

  const settings: ComparisonSettings = {
    ...DEFAULT_COMPARISON_SETTINGS,
    ...options.settings,
    timing: { ...DEFAULT_COMPARISON_SETTINGS.timing, ...options.settings?.timing },
    match: { ...DEFAULT_COMPARISON_SETTINGS.match, ...options.settings?.match },
    visuals: { ...DEFAULT_COMPARISON_SETTINGS.visuals, ...options.settings?.visuals },
    ignore: { ...DEFAULT_COMPARISON_SETTINGS.ignore, ...options.settings?.ignore },
  };

  const pixelDiffer =
    options.visual === false
      ? undefined
      : (pair: { before?: { resourcePath: string }; after?: { resourcePath: string } }) => {
          if (!pair.before || !pair.after) {
            return { comparable: false as const, reason: 'screenshot missing on one side' };
          }
          const bBytes = before.getResource(pair.before.resourcePath);
          const aBytes = after.getResource(pair.after.resourcePath);
          if (!bBytes || !aBytes) {
            return { comparable: false as const, reason: 'resource bytes not found in archive' };
          }
          const bi: RgbaImage | undefined = decodeImage(bBytes);
          const ai: RgbaImage | undefined = decodeImage(aBytes);
          if (!bi || !ai) {
            return { comparable: false as const, reason: 'image decode failed or unsupported format' };
          }
          return diffRgba(bi, ai, settings);
        };

  const result = compareRuns({ before: beforeRun, after: afterRun, settings, pixelDiffer });

  // Multi-run aggregate mode: when either side supplies more than one
  // archive, append median/p90 timing findings with honest sample counts.
  const beforeRuns = beforeArchives.map((a) => a.trace.runs[options.beforeRun ?? 0]).filter((r): r is TraceRun => !!r);
  const afterRuns = afterArchives.map((a) => a.trace.runs[options.afterRun ?? 0]).filter((r): r is TraceRun => !!r);
  if (beforeArchives.length > 1 || afterArchives.length > 1) {
    result.findings.push(...aggregateTimingFindings(beforeRuns, afterRuns, settings));
    result.summary['runs.before'] = beforeRuns.length;
    result.summary['runs.after'] = afterRuns.length;
    result.summary['aggregate.note'] =
      'timing stats use medians over repeated runs - not a formal significance test';
    result.limitations.push(
      `Aggregate mode: ${beforeRuns.length} baseline run(s), ${afterRuns.length} candidate run(s). ` +
        `Non-aggregate sections describe the first run of each side only.`,
    );
  }

  const report = buildReport({
    before: before.trace,
    after: after.trace,
    result,
    settings,
    createdAt: options.createdAt,
  });
  return { report };
}

export function writeReportFiles(
  report: ComparisonReport,
  formats: string[],
  outDir: string,
): string[] {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const format of formats) {
    switch (format) {
      case 'json': {
        const p = join(outDir, 'comparison-report.json');
        writeFileSync(p, reportToJson(report));
        written.push(p);
        break;
      }
      case 'md':
      case 'markdown': {
        const p = join(outDir, 'comparison-report.md');
        writeFileSync(p, reportToMarkdown(report));
        written.push(p);
        break;
      }
      case 'html': {
        const p = join(outDir, 'comparison-report.html');
        writeFileSync(p, reportToHtml(report));
        written.push(p);
        break;
      }
      default:
        throw new Error(`Unknown format "${format}". Supported: json, md, html.`);
    }
  }
  return written;
}
