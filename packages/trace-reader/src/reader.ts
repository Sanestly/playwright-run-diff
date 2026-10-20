import type { NormalizedTrace, TraceRun } from '@sanestly/contracts';
import {
  normalizeTraceEvents,
  pickAdapter,
  type ParsedEventStream,
  type StackMap,
} from './adapters.js';
import { parseJsonLines } from './jsonl.js';
import type { ArchiveLimits } from './limits.js';
import { ArchiveSecurityError } from './limits.js';
import { probeArchive, type ArchiveProbe } from './probe.js';
import { openArchive } from './zip.js';

export interface ParsedArchive {
  trace: NormalizedTrace;
  probe: ArchiveProbe;
  adapterIds: string[];
  /**
   * Lazily returns raw bytes of a resource entry (e.g. "resources/<sha1>").
   * Bytes are held only in memory for the active session.
   */
  getResource(name: string): Uint8Array | undefined;
}

export interface ReadOptions {
  limits?: Partial<ArchiveLimits>;
  sourceLabel?: string;
}

export function readTraceArchive(
  data: Uint8Array,
  options: ReadOptions = {},
): ParsedArchive {
  const { entries, files } = openArchive(data, options.limits);
  const probe = probeArchive(entries);
  const warnings: string[] = [];
  const adapterIds: string[] = [];
  const meta = {
    browser: undefined as string | undefined,
    playwrightVersion: undefined as string | undefined,
    platform: undefined as string | undefined,
    wallTime: undefined as number | undefined,
    sdkLanguage: undefined as string | undefined,
    viewport: undefined as { width: number; height: number } | undefined,
  };

  if (probe.groups.length === 0) {
    throw new ArchiveSecurityError(
      'NO_TRACE_STREAMS',
      'Archive contains no *.trace streams; this does not look like a Playwright trace export.',
    );
  }

  const runs: TraceRun[] = [];

  for (const group of probe.groups) {
    // .stacks files are a single JSON object: {files: string[], stacks: [[callId, [[fileIdx,line,column,fn]...]]...]}
    const stacks: StackMap = new Map();
    for (const file of group.stackFiles) {
      const bytes = files[file];
      if (!bytes) continue;
      try {
        const doc = JSON.parse(new TextDecoder().decode(bytes)) as {
          files?: string[];
          stacks?: Array<[string, Array<[number, number, number, string?]>]>;
        };
        for (const [callId, frames] of doc.stacks ?? []) {
          const f = frames?.[0];
          if (!f) continue;
          stacks.set(callId, {
            file: doc.files?.[f[0]],
            line: f[1],
            column: f[2],
          });
        }
      } catch {
        warnings.push(`${file}: could not parse stacks file`);
      }
    }

    const streams: ParsedEventStream[] = [];
    for (const file of group.traceFiles) {
      const bytes = files[file];
      if (!bytes) {
        warnings.push(`${file}: listed in central directory but missing from archive body`);
        continue;
      }
      const parsed = parseJsonLines(bytes, options.limits);
      for (const err of parsed.errors) {
        warnings.push(`${file}:${err.lineIndex}: malformed JSONL line - ${err.message}`);
      }
      streams.push({ lines: parsed.lines, source: file });
    }
    for (const file of group.networkFiles) {
      const bytes = files[file];
      if (!bytes) continue;
      const parsed = parseJsonLines(bytes, options.limits);
      for (const err of parsed.errors) {
        warnings.push(`${file}:${err.lineIndex}: malformed JSONL line - ${err.message}`);
      }
      streams.push({ lines: parsed.lines, source: file });
    }
    if (streams.length === 0) {
      warnings.push(`group "${group.prefix}": no readable streams`);
      continue;
    }

    let confidence: string = 'unsupported';
    const timebase = {};
    const accs = streams.map((stream) => {
      const { adapter, confidence: c } = pickAdapter(stream);
      if (!adapterIds.includes(adapter.id)) adapterIds.push(adapter.id);
      if (c === 'supported' || (c === 'partial' && confidence !== 'supported')) confidence = c;
      return normalizeTraceEvents(stream, warnings, meta, stacks, timebase);
    });

    // Merge actions/console/errors from .trace streams with requests from
    // .network streams into a single logical run for this group.
    const merged: TraceRun = {
      id: `run:${group.prefix || 'trace'}`,
      label: group.prefix ? group.prefix.replace(/-$/, '') : 'trace',
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
    };
    for (const acc of accs) {
      const r = acc.run;
      merged.actions.push(...r.actions);
      merged.requests.push(...r.requests);
      merged.consoleEvents.push(...r.consoleEvents);
      merged.errors.push(...r.errors);
      merged.screenshots.push(...r.screenshots);
      for (const k of ['actions', 'requests', 'screenshots', 'assertions'] as const) {
        if (r.capabilities[k] === 'available') merged.capabilities[k] = 'available';
      }
      if (r.testId) merged.testId = merged.testId ?? r.testId;
    }
    merged.actions.sort((a, b) => a.startMs - b.startMs);
    merged.requests.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
    merged.consoleEvents.sort((a, b) => (a.timeMs ?? 0) - (b.timeMs ?? 0));
    merged.screenshots.sort((a, b) => (a.timeMs ?? 0) - (b.timeMs ?? 0));
    const starts = [
      ...merged.actions.map((a) => a.startMs),
      ...merged.requests.map((r) => r.startMs),
      ...merged.consoleEvents.map((c) => c.timeMs),
      ...merged.screenshots.map((s) => s.timeMs),
    ].filter((v): v is number => v !== undefined);
    const ends = [
      ...merged.actions.map((a) => a.endMs ?? a.startMs),
      ...merged.requests.map((r) => r.endMs ?? r.startMs),
      ...merged.consoleEvents.map((c) => c.timeMs),
      ...merged.screenshots.map((s) => s.timeMs),
    ].filter((v): v is number => v !== undefined);
    merged.startMs = starts.length ? Math.min(...starts) : undefined;
    merged.endMs = ends.length ? Math.max(...ends) : undefined;

    if (confidence === 'unsupported' && merged.actions.length === 0 && merged.requests.length === 0) {
      warnings.push(`group "${group.prefix}": format unsupported and no usable events found`);
    } else if (confidence === 'partial') {
      warnings.push(`group "${group.prefix}": parsed with tolerant fallback adapter; some events may be missing`);
    }
    runs.push(merged);
  }

  if (runs.length === 0) {
    throw new ArchiveSecurityError(
      'EMPTY_TRACE',
      'No usable trace events were found in this archive.',
    );
  }

  const totalEvents = runs.reduce(
    (n, r) => n + r.actions.length + r.requests.length + r.consoleEvents.length,
    0,
  );
  if (totalEvents === 0) {
    throw new ArchiveSecurityError(
      'EMPTY_TRACE',
      'Trace streams parsed but produced zero usable events; the format may be unsupported.',
    );
  }

  const trace: NormalizedTrace = {
    id: `trace:${options.sourceLabel ?? 'archive'}`,
    sourceLabel: options.sourceLabel ?? 'archive',
    recordedVersion: meta.playwrightVersion,
    browser: meta.browser,
    viewport: meta.viewport,
    timeOrigin: meta.wallTime !== undefined ? new Date(meta.wallTime).toISOString() : undefined,
    runs,
    warnings,
  };

  return {
    trace,
    probe,
    adapterIds,
    getResource(name) {
      return files[name];
    },
  };
}
