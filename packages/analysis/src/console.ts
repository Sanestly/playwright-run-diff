import type {
  DiffFinding,
  NormalizedConsoleEvent,
  NormalizedError,
} from '@sanestly/contracts';
import { makeFinding, RULE_IDS } from './findings.js';

/**
 * Fingerprint a console/error message: normalize whitespace and strip
 * ephemeral numbers so reordered timestamps don't create fake groups.
 */
function fingerprint(text: string): string {
  return text
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\dZ]*/g, '<ts>')
    .replace(/\b\d{6,}\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

interface Group<T> {
  fp: string;
  level: string;
  sample: T;
  count: number;
}

function groupConsole(events: NormalizedConsoleEvent[]): Group<NormalizedConsoleEvent>[] {
  const map = new Map<string, Group<NormalizedConsoleEvent>>();
  for (const e of events) {
    const fp = `${e.level}|${fingerprint(e.text)}`;
    const g = map.get(fp);
    if (g) g.count++;
    else map.set(fp, { fp, level: e.level, sample: e, count: 1 });
  }
  return [...map.values()];
}

export function consoleFindings(
  before: NormalizedConsoleEvent[],
  after: NormalizedConsoleEvent[],
): DiffFinding[] {
  const findings: DiffFinding[] = [];
  const gb = new Map(groupConsole(before).map((g) => [g.fp, g]));
  const ga = new Map(groupConsole(after).map((g) => [g.fp, g]));

  for (const [fp, g] of [...ga.entries()].sort()) {
    const prev = gb.get(fp);
    if (!prev) {
      const isError = /error|warn/i.test(g.level);
      findings.push(
        makeFinding({
          category: 'console',
          severity: /error/i.test(g.level) ? 'medium' : 'low',
          status: 'added',
          title: `New console ${g.level}: ${g.sample.text.slice(0, 120)}`,
          details:
            `${g.count} occurrence(s) in the candidate run, none in baseline. ` +
            `Source: trace recorded console.`,
          evidence: [{ kind: 'console', run: 'after', id: g.sample.id, offsetMs: g.sample.timeMs }],
          confidence: isError ? 0.9 : 0.7,
          ruleId: RULE_IDS.consoleAdded,
        }),
      );
    } else if (g.count > prev.count) {
      findings.push(
        makeFinding({
          category: 'console',
          severity: 'low',
          status: 'changed',
          title: `Console ${g.level} count increased ${prev.count} -> ${g.count}`,
          details: g.sample.text.slice(0, 200),
          evidence: [{ kind: 'console', run: 'after', id: g.sample.id }],
          confidence: 0.6,
          ruleId: RULE_IDS.consoleAdded,
        }),
      );
    }
  }
  for (const [fp, g] of [...gb.entries()].sort()) {
    if (!ga.has(fp)) {
      findings.push(
        makeFinding({
          category: 'console',
          severity: 'info',
          status: 'removed',
          title: `Console ${g.level} no longer emitted`,
          details: g.sample.text.slice(0, 200),
          evidence: [{ kind: 'console', run: 'before', id: g.sample.id }],
          confidence: 0.6,
          ruleId: RULE_IDS.consoleRemoved,
        }),
      );
    }
  }
  return findings;
}

export function errorFindings(before: NormalizedError[], after: NormalizedError[]): DiffFinding[] {
  const findings: DiffFinding[] = [];
  const bfps = new Map<string, number>();
  for (const e of before) {
    const fp = fingerprint(e.message);
    bfps.set(fp, (bfps.get(fp) ?? 0) + 1);
  }
  const seen = new Set<string>();
  for (const e of after) {
    const fp = fingerprint(e.message);
    if (seen.has(fp)) continue;
    seen.add(fp);
    const prevCount = bfps.get(fp) ?? 0;
    if (prevCount === 0) {
      findings.push(
        makeFinding({
          category: 'error',
          severity: 'high',
          status: 'added',
          title: `New error: ${e.message.slice(0, 140)}`,
          details: `Recorded in candidate run (source: ${e.source ?? 'trace'}), absent in baseline.`,
          evidence: [{ kind: 'metadata', run: 'after', id: e.id }],
          confidence: 0.9,
          ruleId: RULE_IDS.errorAdded,
        }),
      );
    }
  }
  return findings;
}
