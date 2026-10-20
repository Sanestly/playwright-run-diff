/**
 * Normalized output contracts for Sanestly Playwright Run Diff.
 *
 * These interfaces describe OUR normalized model, not Playwright's wire format.
 * Schema version: 1.0
 */

export type Availability = 'available' | 'absent' | 'unsupported' | 'corrupt';

export type DiffStatus = 'added' | 'removed' | 'changed' | 'unchanged' | 'unmatched';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type FindingCategory =
  | 'action'
  | 'timing'
  | 'network'
  | 'console'
  | 'error'
  | 'visual'
  | 'structure';

export type RunSide = 'before' | 'after';

export interface EvidenceRef {
  kind: 'action' | 'request' | 'frame' | 'resource' | 'console' | 'metadata';
  run: RunSide;
  id: string;
  offsetMs?: number;
}

export interface ActionSource {
  file?: string;
  line?: number;
  column?: number;
}

export type ActionStatus = 'ok' | 'failed' | 'unknown';

export interface NormalizedAction {
  id: string;
  testId?: string;
  pageId?: string;
  frameId?: string;
  parentId?: string;
  label: string;
  apiName?: string;
  method?: string;
  locatorFingerprint?: string;
  urlFingerprint?: string;
  source?: ActionSource;
  startMs: number;
  endMs?: number;
  status: ActionStatus;
  errorSummary?: string;
  screenshotRefs?: string[];
  /**
   * Playwright internal action log lines ("waiting for selector ...").
   * These are NOT browser console events and must not feed console diffs.
   */
  logs?: string[];
}

export interface NormalizedRequest {
  id: string;
  pageId?: string;
  method: string;
  normalizedUrl: string;
  rawUrlAvailable: boolean;
  status?: number;
  resourceType?: string;
  startMs?: number;
  endMs?: number;
  failureReason?: string;
  transferBytes?: number;
}

export interface NormalizedConsoleEvent {
  id: string;
  level: string;
  timeMs?: number;
  text: string;
}

export interface NormalizedError {
  id: string;
  message: string;
  source?: string;
}

export interface TraceCapabilities {
  actions: Availability;
  requests: Availability;
  screenshots: Availability;
  assertions: Availability;
}

export interface NormalizedTrace {
  id: string;
  sourceLabel: string;
  recordedVersion?: string;
  browser?: string;
  viewport?: { width: number; height: number };
  timeOrigin?: string;
  /** Logical runs inside this archive (e.g. individual tests / trace chunks). */
  runs: TraceRun[];
  warnings: string[];
}

export interface TraceRun {
  id: string;
  label: string;
  testId?: string;
  actions: NormalizedAction[];
  requests: NormalizedRequest[];
  consoleEvents: NormalizedConsoleEvent[];
  errors: NormalizedError[];
  screenshots: ScreenshotMeta[];
  capabilities: TraceCapabilities;
  startMs?: number;
  endMs?: number;
}

export interface ScreenshotMeta {
  /** Resource path inside the archive (resources/<sha1>). Never a remote URL. */
  resourcePath: string;
  actionId?: string;
  timeMs?: number;
  width?: number;
  height?: number;
}

export interface ActionPair {
  beforeId?: string;
  afterId?: string;
  /** 0..1 */
  confidence: number;
  matchReason: string[];
  manualOverride?: boolean;
}

export interface DiffFinding {
  id: string;
  category: FindingCategory;
  severity: Severity;
  status: DiffStatus;
  title: string;
  details: string;
  evidence: EvidenceRef[];
  confidence: number;
  ruleId: string;
  suppressed?: boolean;
}

export interface ComparisonSettings {
  timing: { minAbsoluteMs: number; minRelativeIncrease: number };
  match: { minimumConfidence: number };
  visuals: {
    maxPixelDiffRatio: number;
    maskRects: Array<{ x: number; y: number; width: number; height: number }>;
  };
  ignore: { urlPatterns: string[]; actionPatterns: string[]; responseHeaders: string[] };
}

export type TraceSummary = Omit<
  NormalizedTrace,
  'runs'
> & { runCount: number };

export interface ComparisonReport {
  schemaVersion: '1.0';
  createdAt: string;
  toolVersion: string;
  before: TraceSummary;
  after: TraceSummary;
  pairs: ActionPair[];
  findings: DiffFinding[];
  summary: Record<string, number | string | boolean | null>;
  settings: ComparisonSettings;
  limitations: string[];
}

export const DEFAULT_COMPARISON_SETTINGS: ComparisonSettings = {
  timing: { minAbsoluteMs: 100, minRelativeIncrease: 0.2 },
  match: { minimumConfidence: 0.6 },
  visuals: { maxPixelDiffRatio: 0.01, maskRects: [] },
  ignore: { urlPatterns: [], actionPatterns: [], responseHeaders: [] },
};

export const REPORT_SCHEMA_VERSION = '1.0' as const;
