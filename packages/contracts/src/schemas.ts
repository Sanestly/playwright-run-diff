import { z } from 'zod';

export const availabilitySchema = z.enum(['available', 'absent', 'unsupported', 'corrupt']);

export const diffStatusSchema = z.enum([
  'added',
  'removed',
  'changed',
  'unchanged',
  'unmatched',
]);

export const severitySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);

export const findingCategorySchema = z.enum([
  'action',
  'timing',
  'network',
  'console',
  'error',
  'visual',
  'structure',
]);

export const evidenceRefSchema = z.object({
  kind: z.enum(['action', 'request', 'frame', 'resource', 'console', 'metadata']),
  run: z.enum(['before', 'after']),
  id: z.string(),
  offsetMs: z.number().optional(),
});

export const actionPairSchema = z.object({
  beforeId: z.string().optional(),
  afterId: z.string().optional(),
  confidence: z.number().min(0).max(1),
  matchReason: z.array(z.string()),
  manualOverride: z.boolean().optional(),
});

export const diffFindingSchema = z.object({
  id: z.string(),
  category: findingCategorySchema,
  severity: severitySchema,
  status: diffStatusSchema,
  title: z.string(),
  details: z.string(),
  evidence: z.array(evidenceRefSchema),
  confidence: z.number().min(0).max(1),
  ruleId: z.string(),
  suppressed: z.boolean().optional(),
});

export const comparisonSettingsSchema = z.object({
  timing: z.object({
    minAbsoluteMs: z.number().nonnegative(),
    minRelativeIncrease: z.number().nonnegative(),
  }),
  match: z.object({ minimumConfidence: z.number().min(0).max(1) }),
  visuals: z.object({
    maxPixelDiffRatio: z.number().min(0).max(1),
    maskRects: z.array(
      z.object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      }),
    ),
  }),
  ignore: z.object({
    urlPatterns: z.array(z.string()),
    actionPatterns: z.array(z.string()),
    responseHeaders: z.array(z.string()),
  }),
});

export const traceSummarySchema = z.object({
  id: z.string(),
  sourceLabel: z.string(),
  recordedVersion: z.string().optional(),
  browser: z.string().optional(),
  viewport: z.object({ width: z.number(), height: z.number() }).optional(),
  timeOrigin: z.string().optional(),
  warnings: z.array(z.string()),
  runCount: z.number().int().nonnegative(),
});

export const comparisonReportSchema = z.object({
  schemaVersion: z.literal('1.0'),
  createdAt: z.string(),
  toolVersion: z.string(),
  before: traceSummarySchema,
  after: traceSummarySchema,
  pairs: z.array(actionPairSchema),
  findings: z.array(diffFindingSchema),
  summary: z.record(z.union([z.number(), z.string(), z.boolean(), z.null()])),
  settings: comparisonSettingsSchema,
  limitations: z.array(z.string()),
});

export type ComparisonReportDto = z.infer<typeof comparisonReportSchema>;

/**
 * Parse a report JSON payload. Throws a descriptive error when the major
 * schema version is unsupported so callers can show a migration message.
 */
export function parseComparisonReport(data: unknown): ComparisonReportDto {
  if (typeof data === 'object' && data !== null) {
    const version = (data as Record<string, unknown>).schemaVersion;
    if (typeof version === 'string' && version.split('.')[0] !== '1') {
      throw new Error(
        `Unsupported report schemaVersion "${version}". This tool supports schemaVersion "1.x". ` +
          `The report was likely produced by a newer version of run-diff; please upgrade.`,
      );
    }
  }
  const result = comparisonReportSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid comparison report: ${result.error.message}`);
  }
  return result.data;
}
