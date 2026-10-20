import type {
  Availability,
  NormalizedAction,
  TraceCapabilities,
  TraceRun,
} from '@sanestly/contracts';
import type { ArchiveProbe } from './probe.js';
import type { JsonlLine } from './jsonl.js';
import {
  fingerprintLocator,
  normalizeUrl,
  redactText,
} from './sanitize.js';

export type ParseConfidence = 'supported' | 'partial' | 'unsupported';

export interface ParsedEventStream {
  lines: JsonlLine[];
  source: string;
}

export interface TraceFormatAdapter {
  id: string;
  /** Human label, e.g. "Playwright >=1.40 trace format". */
  label: string;
  canParse(events: ParsedEventStream): ParseConfidence;
}

interface MutableAction extends NormalizedAction {
  pending?: boolean;
}

interface RunAccumulator {
  run: TraceRun;
  actionByCallId: Map<string, MutableAction>;
  requestIndex: number;
  consoleIndex: number;
  errorIndex: number;
  unknownTypes: Set<string>;
}

interface TraceMetadata {
  browser?: string;
  playwrightVersion?: string;
  platform?: string;
  wallTime?: number;
  sdkLanguage?: string;
  viewport?: { width: number; height: number };
}

export type StackMap = Map<string, { file?: string; line?: number; column?: number }>;

/**
 * Event methods Playwright emits on "event" records that we understand as
 * present-but-uninterpreted. Anything not listed still produces a warning.
 */
const KNOWN_EVENT_METHODS = new Set([
  'page',
  'pageError',
  'console',
  'downloadStarted',
  'download',
  'dialog',
  'request',
  'response',
  'requestFinished',
  'requestFailed',
  'requestAborted',
  'requestRedirected',
  'navigation',
  'frameAttached',
  'frameDetached',
  'frameNavigated',
  'workerCreated',
  'workerDestroyed',
  'screencastFrame',
  'media',
  'fileChooser',
  'contextClosed',
]);

function toRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function errorMessage(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  const rec = toRecord(v);
  if (!rec) return undefined;
  const inner = toRecord(rec.error) ?? rec;
  return str(inner.message) ?? str(inner.name);
}

function selectorFromParams(params: unknown): string | undefined {
  const rec = toRecord(params);
  if (!rec) return undefined;
  return str(rec.selector) ?? str(rec.selectorString) ?? str(rec.locator);
}

function urlFromParams(params: unknown): string | undefined {
  const rec = toRecord(params);
  if (!rec) return undefined;
  return str(rec.url);
}

/**
 * Tolerant normalizer for the Playwright trace event stream. Handles the
 * documented-ish event shapes (before/after/console/event/log/resource-snapshot/
 * screencast-frame/frame-snapshot/context-options) while recording unknown
 * types as warnings instead of dropping them silently.
 */
/** Shared monotonic origin across all streams of one trace group. */
export interface Timebase {
  first?: number;
}

export function normalizeTraceEvents(
  stream: ParsedEventStream,
  warnings: string[],
  meta: TraceMetadata,
  stacks?: StackMap,
  timebase: Timebase = {},
): RunAccumulator {
  const acc: RunAccumulator = {
    run: {
      id: stream.source,
      label: stream.source,
      actions: [],
      requests: [],
      consoleEvents: [],
      errors: [],
      screenshots: [],
      capabilities: {
        actions: 'absent',
        requests: 'absent',
        screenshots: 'absent',
        assertions: 'absent',
      },
    },
    actionByCallId: new Map(),
    requestIndex: 0,
    consoleIndex: 0,
    errorIndex: 0,
    unknownTypes: new Set(),
  };

  /** All observed monotonic-time fields across schema variants. */
  const relativeMs = (event: Record<string, unknown>): number | undefined => {
    const mono =
      num(event.monotonicTime) ??
      num(event.startTime) ??
      num(event.endTime) ??
      num(event.timestamp) ??
      num(event.time);
    if (mono === undefined) return undefined;
    if (timebase.first === undefined) timebase.first = mono;
    return mono - timebase.first;
  };

  const rawTime = (event: Record<string, unknown>): number | undefined =>
    num(event.monotonicTime) ??
    num(event.startTime) ??
    num(event.endTime) ??
    num(event.timestamp) ??
    num(event.time);

  for (const { value, lineIndex } of stream.lines) {
    const event = toRecord(value);
    if (!event) {
      warnings.push(`${stream.source}:${lineIndex}: non-object event ignored`);
      continue;
    }
    const type = str(event.type) ?? 'unknown';

    switch (type) {
      case 'context-options': {
        // A stream with empty browserName (e.g. testRunner test.trace) must
        // not overwrite a browser already learned from a context stream.
        meta.browser = str(event.browserName) || meta.browser;
        meta.playwrightVersion =
          str(event.playwrightVersion) ?? str(event.version) ?? meta.playwrightVersion;
        meta.platform = str(event.platform) ?? meta.platform;
        meta.sdkLanguage = str(event.sdkLanguage) ?? meta.sdkLanguage;
        meta.wallTime = num(event.wallTime) ?? meta.wallTime;
        const vp = toRecord(toRecord(event.options)?.viewport);
        if (vp && num(vp.width) && num(vp.height)) {
          meta.viewport = { width: num(vp.width)!, height: num(vp.height)! };
        }
        break;
      }
      case 'before':
      case 'step':
      case 'action': {
        if (type === 'action' && event.callId === undefined && event.metadata === undefined) {
          // Some versions emit "action" as a completed record instead of a
          // start marker. Treat it as a full action when it has timing.
        }
        const callId = str(event.callId) ?? str(event.stepId) ?? `line-${lineIndex}`;
        const apiName = str(event.apiName);
        const cls = str(event.class);
        const method = str(event.method);
        const params = event.params;
        const startMs = relativeMs(event) ?? 0;
        const existing = acc.actionByCallId.get(callId);
        const label =
          str(event.title) ??
          apiName ??
          ([cls, method].filter(Boolean).join('.') || 'action');
        const urlParam = urlFromParams(params);
        const selector = selectorFromParams(params);
        const action: MutableAction = existing ?? {
          id: `${stream.source}#${callId}`,
          label,
          apiName,
          method,
          startMs,
          status: 'unknown',
          pending: true,
        };
        if (!existing) {
          acc.actionByCallId.set(callId, action);
          acc.run.actions.push(action);
        }
        const testId = str(event.testId) ?? str(event.test_id);
        if (testId) {
          action.testId = testId;
          acc.run.testId = acc.run.testId ?? testId;
        }
        action.pageId = str(event.pageId) ?? action.pageId;
        action.frameId = str(event.frameId) ?? action.frameId;
        action.parentId = str(event.parentId) ?? str(event.stepId) ?? action.parentId;
        if (urlParam) action.urlFingerprint = normalizeUrl(urlParam).normalizedUrl;
        if (selector) action.locatorFingerprint = fingerprintLocator(selector);
        const stack = event.stack ?? event.location;
        const stackArr = Array.isArray(stack) ? stack : stack ? [stack] : [];
        const firstFrame = toRecord(stackArr[0]);
        const stackSrc = firstFrame
          ? {
              file: str(firstFrame.file),
              line: num(firstFrame.line),
              column: num(firstFrame.column),
            }
          : stacks?.get(callId);
        if (stackSrc && (stackSrc.file || stackSrc.line !== undefined)) {
          action.source = stackSrc;
        }
        if (type === 'action' && (event.endTime !== undefined || event.monotonicTime !== undefined)) {
          const end = rawTime(event);
          if (end !== undefined && timebase.first !== undefined) {
            action.endMs = end - timebase.first;
          }
          action.status = event.error ? 'failed' : 'ok';
          action.pending = false;
        }
        acc.run.capabilities.actions = 'available';
        if (
          apiName === 'expect' ||
          cls === 'expect' ||
          method === 'expect' ||
          str(event.stepType) === 'expect'
        ) {
          acc.run.capabilities.assertions = 'available';
        }
        break;
      }
      case 'input':
        break;
      case 'after': {
        const callId = str(event.callId) ?? str(event.stepId);
        if (!callId) break;
        const action = acc.actionByCallId.get(callId);
        if (!action) {
          warnings.push(`${stream.source}:${lineIndex}: "after" without matching "before" (${callId})`);
          break;
        }
        const mono = rawTime(event);
        if (mono !== undefined && timebase.first !== undefined) {
          action.endMs = mono - timebase.first;
        }
        const err = errorMessage(event.error);
        if (err) {
          action.status = 'failed';
          action.errorSummary = redactText(err).slice(0, 500);
          acc.run.capabilities.assertions =
            action.apiName === 'expect' ? 'available' : acc.run.capabilities.assertions;
        } else {
          action.status = 'ok';
        }
        const attachments = event.attachments;
        if (Array.isArray(attachments)) {
          for (const att of attachments) {
            const a = toRecord(att);
            if (!a) continue;
            const sha1 = str(a.sha1) ?? str(a.path);
            const contentType = str(a.contentType) ?? '';
            if (sha1 && /image\//.test(contentType)) {
              const ref = `resources/${sha1}`;
              action.screenshotRefs = action.screenshotRefs ?? [];
              action.screenshotRefs.push(ref);
              acc.run.screenshots.push({
                resourcePath: ref,
                actionId: action.id,
                timeMs: action.endMs ?? action.startMs,
              });
              acc.run.capabilities.screenshots = 'available';
            }
          }
        }
        action.pending = false;
        break;
      }
      case 'console': {
        const text = str(event.text) ?? '';
        acc.run.consoleEvents.push({
          id: `${stream.source}#console-${acc.consoleIndex++}`,
          level: str(event.messageType) ?? str(event.type2) ?? 'log',
          timeMs: relativeMs(event),
          text: redactText(text),
        });
        break;
      }
      case 'event': {
        const method = str(event.method);
        const params = toRecord(event.params);
        if (method === 'console') {
          const msg = toRecord(params?.message);
          acc.run.consoleEvents.push({
            id: `${stream.source}#console-${acc.consoleIndex++}`,
            level: str(msg?.type) ?? 'log',
            timeMs: relativeMs(event),
            text: redactText(str(msg?.text) ?? ''),
          });
        } else if (method === 'pageError' || method === 'pageerror') {
          const err = toRecord(params?.error);
          acc.run.errors.push({
            id: `${stream.source}#error-${acc.errorIndex++}`,
            message: redactText(str(err?.message) ?? str(err?.name) ?? 'page error'),
            source: 'pageError',
          });
        } else if (method && KNOWN_EVENT_METHODS.has(method)) {
          // Recorded but intentionally not interpreted (page lifecycle,
          // downloads, dialogs, navigation, media, etc.).
        } else {
          acc.unknownTypes.add(`event:${method ?? 'unknown'}`);
        }
        break;
      }
      case 'log': {
        // Playwright internal action log ("waiting for selector ...").
        // Attach to the owning action - these are NOT browser console events.
        const message = str(event.message);
        if (message) {
          const callId = str(event.callId);
          const action = callId ? acc.actionByCallId.get(callId) : undefined;
          if (action) {
            action.logs = action.logs ?? [];
            action.logs.push(redactText(message));
          }
        }
        break;
      }
      case 'error': {
        acc.run.errors.push({
          id: `${stream.source}#error-${acc.errorIndex++}`,
          message: redactText(errorMessage(event.error) ?? str(event.message) ?? 'error'),
          source: 'trace',
        });
        break;
      }
      case 'resource-snapshot': {
        const snap = toRecord(event.snapshot);
        if (!snap) break;
        const req = toRecord(snap.request);
        const res = toRecord(snap.response);
        const url = str(req?.url) ?? '';
        const norm = url ? normalizeUrl(url) : { normalizedUrl: '(unknown)', rawUrlAvailable: false };
        const timings = toRecord(snap.timings) ?? toRecord(snap.timing);
        const startMono = num(snap._monotonicTime) ?? rawTime(event);
        let startMs: number | undefined;
        let endMs: number | undefined;
        if (startMono !== undefined) {
          if (timebase.first === undefined) timebase.first = startMono;
          startMs = startMono - timebase.first;
          // HAR-style duration: snapshot.time is the total ms; timings
          // blocks carry send/wait/receive in some versions.
          let durationMs = num(snap.time) ?? num(snap.responseEnd);
          if (durationMs === undefined && timings) {
            const send = num(timings.send) ?? 0;
            const wait = num(timings.wait) ?? 0;
            const receive = num(timings.receive) ?? 0;
            if (send + wait + receive > 0) durationMs = send + wait + receive;
          }
          if (durationMs !== undefined && durationMs >= 0 && durationMs <= 600_000) {
            endMs = startMs + durationMs;
          }
        }
        const failText =
          str(snap._failureText) ??
          str(toRecord(snap._failure)?.errorMessage) ??
          str(res?._failureText);
        acc.run.requests.push({
          id: `${stream.source}#req-${acc.requestIndex++}`,
          pageId: str(snap.pageId) ?? str(snap.pageref) ?? str(event.pageId),
          method: str(req?.method) ?? 'GET',
          normalizedUrl: norm.normalizedUrl,
          rawUrlAvailable: norm.rawUrlAvailable,
          status: num(res?.status),
          resourceType: str(snap._resourceType) ?? str(snap.resourceType) ?? str(event.resourceType),
          startMs,
          endMs,
          failureReason: failText ? redactText(failText).slice(0, 300) : undefined,
          transferBytes:
            num(res?._transferSize) ??
            num(toRecord(snap._sizes)?.transferSize) ??
            num(snap.transferSize),
        });
        acc.run.capabilities.requests = 'available';
        break;
      }
      case 'screencast-frame': {
        // Modern traces store frames as files under screencast/, older ones
        // reference resources/<sha1>.
        const file = str(event.file);
        const sha1 = str(event.sha1);
        const path = file ?? (sha1 ? `resources/${sha1}` : undefined);
        if (path) {
          acc.run.screenshots.push({
            resourcePath: path,
            timeMs: relativeMs(event),
            width: num(event.width),
            height: num(event.height),
          });
          acc.run.capabilities.screenshots = 'available';
        }
        break;
      }
      case 'frame-snapshot':
        break;
      default:
        acc.unknownTypes.add(type);
    }
  }

  for (const t of acc.unknownTypes) {
    warnings.push(`${stream.source}: unhandled event type "${t}" (recorded, not interpreted)`);
  }

  // Close actions that never saw an "after" event.
  for (const action of acc.run.actions) {
    if ((action as MutableAction).pending) {
      action.status = action.status === 'unknown' ? 'unknown' : action.status;
      warnings.push(`${stream.source}: action "${action.label}" has no completion event`);
    }
    delete (action as MutableAction).pending;
  }

  return acc;
}

/** Built-in adapters. `modern` targets the current chunked trace layout;
 * `generic` is the tolerant fallback for older/unknown layouts. */
export const TRACE_ADAPTERS: TraceFormatAdapter[] = [
  {
    id: 'playwright-modern',
    label: 'Playwright >=1.38 trace format',
    canParse(stream) {
      let sawContext = false;
      let sawAction = false;
      for (const { value } of stream.lines.slice(0, 50)) {
        const e = toRecord(value);
        if (!e) continue;
        if (e.type === 'context-options') sawContext = true;
        if (e.type === 'before' || e.type === 'action' || e.type === 'after') sawAction = true;
      }
      if (sawContext && sawAction) return 'supported';
      if (sawAction) return 'partial';
      return 'unsupported';
    },
  },
  {
    id: 'playwright-generic',
    label: 'Generic Playwright trace (tolerant)',
    canParse(stream) {
      for (const { value } of stream.lines.slice(0, 50)) {
        const e = toRecord(value);
        if (e && typeof e.type === 'string') return 'partial';
      }
      return 'unsupported';
    },
  },
];

export function pickAdapter(
  stream: ParsedEventStream,
): { adapter: TraceFormatAdapter; confidence: ParseConfidence } {
  for (const adapter of TRACE_ADAPTERS) {
    const confidence = adapter.canParse(stream);
    if (confidence === 'supported') return { adapter, confidence };
  }
  for (const adapter of TRACE_ADAPTERS) {
    const confidence = adapter.canParse(stream);
    if (confidence === 'partial') return { adapter, confidence };
  }
  return { adapter: TRACE_ADAPTERS[TRACE_ADAPTERS.length - 1]!, confidence: 'unsupported' };
}

export type { ArchiveProbe, TraceCapabilities, Availability };
