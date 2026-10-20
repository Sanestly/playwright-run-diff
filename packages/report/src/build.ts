import type {
  ComparisonReport,
  ComparisonSettings,
  NormalizedTrace,
  TraceSummary,
} from '@sanestly/contracts';
import { REPORT_SCHEMA_VERSION } from '@sanestly/contracts';
import type { CompareResult } from '@sanestly/analysis';

export const TOOL_VERSION = '0.9.0-beta.1';

function summarize(trace: NormalizedTrace): TraceSummary {
  return {
    id: trace.id,
    sourceLabel: trace.sourceLabel,
    recordedVersion: trace.recordedVersion,
    browser: trace.browser,
    viewport: trace.viewport,
    timeOrigin: trace.timeOrigin,
    warnings: trace.warnings,
    runCount: trace.runs.length,
  };
}

/**
 * Assemble a deterministic ComparisonReport. `createdAt` is injectable so
 * golden fixtures can produce byte-identical output.
 */
export function buildReport(input: {
  before: NormalizedTrace;
  after: NormalizedTrace;
  result: CompareResult;
  settings: ComparisonSettings;
  createdAt?: string;
  toolVersion?: string;
}): ComparisonReport {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    createdAt: input.createdAt ?? new Date().toISOString(),
    toolVersion: input.toolVersion ?? TOOL_VERSION,
    before: summarize(input.before),
    after: summarize(input.after),
    pairs: input.result.pairs,
    findings: input.result.findings,
    summary: input.result.summary,
    settings: input.settings,
    limitations: input.result.limitations,
  };
}
