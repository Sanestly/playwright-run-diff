/// <reference lib="webworker" />
/**
 * Comparison worker: ZIP parsing, normalization, matching and pixel diffs
 * all run off the main thread. Trace bytes never leave this process.
 */
import type { ComparisonSettings } from '@sanestly/contracts';
import { DEFAULT_COMPARISON_SETTINGS } from '@sanestly/contracts';
import { compareRuns, diffRgba, type CompareResult, type PixelDiffResult, type RgbaImage } from '@sanestly/analysis';
import { readTraceArchive, type ParsedArchive } from '@sanestly/trace-reader';
import { buildReport } from '@sanestly/report';
import type { ManualOverride } from '@sanestly/matcher';

export interface ParseRequest {
  type: 'parse';
  jobId: number;
  side: 'before' | 'after';
  bytes: ArrayBuffer;
  label: string;
}

export interface CompareRequest {
  type: 'compare';
  jobId: number;
  beforeRun: number;
  afterRun: number;
  settings?: Partial<ComparisonSettings>;
  manualOverrides?: ManualOverride[];
}

export interface ResourceRequest {
  type: 'resource';
  jobId: number;
  side: 'before' | 'after';
  path: string;
}

export interface CancelRequest {
  type: 'cancel';
  jobId?: number;
  side?: 'before' | 'after';
}

export type WorkerRequest = ParseRequest | CompareRequest | ResourceRequest | CancelRequest;

const archives = new Map<string, ParsedArchive>();

function post(msg: Record<string, unknown>, transfer?: Transferable[]): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);
}

function progress(jobId: number, phase: string): void {
  post({ type: 'progress', jobId, phase });
}

function fullSettings(partial?: Partial<ComparisonSettings>): ComparisonSettings {
  return {
    timing: { ...DEFAULT_COMPARISON_SETTINGS.timing, ...partial?.timing },
    match: { ...DEFAULT_COMPARISON_SETTINGS.match, ...partial?.match },
    visuals: { ...DEFAULT_COMPARISON_SETTINGS.visuals, ...partial?.visuals },
    ignore: { ...DEFAULT_COMPARISON_SETTINGS.ignore, ...partial?.ignore },
  };
}

async function decodeToRgba(bytes: Uint8Array): Promise<RgbaImage | undefined> {
  try {
    const buf = bytes.slice().buffer as ArrayBuffer;
    const bmp = await createImageBitmap(new Blob([buf]));
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, bmp.width, bmp.height);
    bmp.close();
    return { width: data.width, height: data.height, data: data.data };
  } catch {
    return undefined;
  }
}

async function handleCompare(req: CompareRequest): Promise<void> {
  const before = archives.get('before');
  const after = archives.get('after');
  if (!before || !after) {
    post({ type: 'error', jobId: req.jobId, message: 'Both archives must be loaded before comparing.' });
    return;
  }
  const beforeRun = before.trace.runs[req.beforeRun];
  const afterRun = after.trace.runs[req.afterRun];
  if (!beforeRun || !afterRun) {
    post({ type: 'error', jobId: req.jobId, message: 'Selected run index out of range.' });
    return;
  }
  progress(req.jobId, 'aligning actions');
  const first = compareRuns({
    before: beforeRun,
    after: afterRun,
    settings: req.settings,
    manualOverrides: req.manualOverrides,
  });

  progress(req.jobId, 'diffing screenshots');
  const pixelDiffs: PixelDiffResult[] = [];
  for (const pair of first.screenshotPairs) {
    if (!pair.before || !pair.after) {
      pixelDiffs.push({ comparable: false, reason: 'screenshot missing on one side' });
      continue;
    }
    const bBytes = before.getResource(pair.before.resourcePath);
    const aBytes = after.getResource(pair.after.resourcePath);
    if (!bBytes || !aBytes) {
      pixelDiffs.push({ comparable: false, reason: 'resource bytes not found in archive' });
      continue;
    }
    const [bi, ai] = await Promise.all([decodeToRgba(bBytes), decodeToRgba(aBytes)]);
    if (!bi || !ai) {
      pixelDiffs.push({ comparable: false, reason: 'image decode failed or unsupported' });
      continue;
    }
    pixelDiffs.push(diffRgba(bi, ai, fullSettings(req.settings)));
  }

  progress(req.jobId, 'building report');
  const result: CompareResult = compareRuns({
    before: beforeRun,
    after: afterRun,
    settings: req.settings,
    manualOverrides: req.manualOverrides,
    pixelDiffs,
  });
  const report = buildReport({
    before: before.trace,
    after: after.trace,
    result,
    settings: fullSettings(req.settings),
  });
  // diffImage buffers can be large - transfer (zero-copy) instead of cloning.
  const transfers: Transferable[] = [];
  for (const d of pixelDiffs) {
    if (d.diffImage) transfers.push(d.diffImage.buffer as ArrayBuffer);
  }
  post({ type: 'result', jobId: req.jobId, report, result, pixelDiffs }, transfers);
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    switch (req.type) {
      case 'parse': {
        progress(req.jobId, 'validating archive');
        const parsed = readTraceArchive(new Uint8Array(req.bytes), { sourceLabel: req.label });
        archives.set(req.side, parsed);
        progress(req.jobId, 'normalizing events');
        post({ type: 'parsed', jobId: req.jobId, side: req.side, trace: parsed.trace });
        break;
      }
      case 'compare':
        await handleCompare(req);
        break;
      case 'resource': {
        const archive = archives.get(req.side);
        const bytes = archive?.getResource(req.path);
        if (bytes) {
          const copy = bytes.slice();
          post(
            { type: 'resource', jobId: req.jobId, side: req.side, path: req.path, bytes: copy.buffer },
            [copy.buffer],
          );
        } else {
          post({ type: 'resource', jobId: req.jobId, side: req.side, path: req.path, bytes: null });
        }
        break;
      }
      case 'cancel':
        if (req.side) archives.delete(req.side);
        else archives.clear();
        post({ type: 'cancelled', jobId: 0 });
        break;
    }
  } catch (err) {
    post({
      type: 'error',
      jobId: 'jobId' in req ? req.jobId : 0,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
