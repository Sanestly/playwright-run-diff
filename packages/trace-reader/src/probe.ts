import type { ArchiveEntryInfo } from './zip.js';
import { normalizeEntryName } from './zip.js';

/**
 * A logical group of trace files inside the archive. Playwright can emit
 * chunked traces (e.g. "trace.trace", "0-trace.trace", "1-trace.trace")
 * sharing a resources/ directory. The probe discovers groups by the file
 * prefix preceding ".trace" without assuming a fixed layout.
 */
export interface TraceGroup {
  /** Prefix shared by .trace/.network/.stacks, e.g. "" or "0-". */
  prefix: string;
  traceFiles: string[];
  networkFiles: string[];
  stackFiles: string[];
}

export interface ArchiveProbe {
  groups: TraceGroup[];
  resources: string[];
  otherFiles: string[];
  /** Best-effort detected producer, e.g. playwright version if metadata exists. */
  detectedVersion?: string;
}

const TRACE_RE = /(^|\/)([^/]*)\.trace$/;
const NETWORK_RE = /(^|\/)([^/]*)\.network$/;
const STACKS_RE = /(^|\/)([^/]*)\.stacks$/;

function prefixOf(name: string, re: RegExp): { dir: string; prefix: string } | null {
  const m = re.exec(name);
  if (!m) return null;
  const lastSlash = name.lastIndexOf('/');
  const dirPart = lastSlash >= 0 ? name.slice(0, lastSlash + 1) : '';
  return { dir: dirPart, prefix: m[2] ?? '' };
}

export function probeArchive(entries: ArchiveEntryInfo[]): ArchiveProbe {
  const groupMap = new Map<string, TraceGroup>();
  const resources: string[] = [];
  const otherFiles: string[] = [];

  const groupFor = (dir: string, prefix: string): TraceGroup => {
    const key = `${dir}|${prefix}`;
    let g = groupMap.get(key);
    if (!g) {
      g = { prefix: `${dir}${prefix}`, traceFiles: [], networkFiles: [], stackFiles: [] };
      groupMap.set(key, g);
    }
    return g;
  };

  for (const entry of entries) {
    const name = normalizeEntryName(entry.name);
    if (name.endsWith('/')) continue;
    const base = name.slice(name.lastIndexOf('/') + 1);
    const dir = name.slice(0, name.length - base.length);

    const t = TRACE_RE.exec(name);
    if (t) {
      const p = prefixOf(name, TRACE_RE);
      groupFor(dir, p?.prefix ?? '').traceFiles.push(name);
      continue;
    }
    const n = NETWORK_RE.exec(name);
    if (n) {
      const p = prefixOf(name, NETWORK_RE);
      groupFor(dir, p?.prefix ?? '').networkFiles.push(name);
      continue;
    }
    const s = STACKS_RE.exec(name);
    if (s) {
      const p = prefixOf(name, STACKS_RE);
      groupFor(dir, p?.prefix ?? '').stackFiles.push(name);
      continue;
    }
    if (name.startsWith('resources/') || /(^|\/)resources\//.test(name)) {
      resources.push(name);
      continue;
    }
    otherFiles.push(name);
  }

  for (const g of groupMap.values()) {
    g.traceFiles.sort();
    g.networkFiles.sort();
    g.stackFiles.sort();
  }
  resources.sort();
  otherFiles.sort();

  const groups = [...groupMap.values()].sort((a, b) => a.prefix.localeCompare(b.prefix));
  return { groups, resources, otherFiles };
}
