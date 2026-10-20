import type {
  ComparisonSettings,
  DiffFinding,
  NormalizedRequest,
} from '@sanestly/contracts';
import { makeFinding, RULE_IDS } from './findings.js';

export interface RequestPair {
  before?: NormalizedRequest;
  after?: NormalizedRequest;
  key: string;
}

/**
 * Group key for request alignment: method + normalized host/path + resource
 * type. Query ordering is already normalized at ingest. Occurrence index
 * disambiguates duplicate requests.
 */
export function requestKey(r: NormalizedRequest): string {
  let hostPath = r.normalizedUrl;
  try {
    const u = new URL(r.normalizedUrl);
    hostPath = `${u.host}${u.pathname}`;
  } catch {
    /* opaque */
  }
  return `${r.method}|${hostPath}|${r.resourceType ?? ''}`;
}

export function alignRequests(
  before: NormalizedRequest[],
  after: NormalizedRequest[],
  ignoreUrlPatterns: string[],
): { pairs: RequestPair[]; suppressed: number } {
  const ignored = ignoreUrlPatterns
    .map((p) => {
      try {
        return new RegExp(p);
      } catch {
        return undefined;
      }
    })
    .filter((r): r is RegExp => r !== undefined);

  const keep = (r: NormalizedRequest) => !ignored.some((re) => re.test(r.normalizedUrl));
  const beforeFiltered = before.filter(keep);
  const afterFiltered = after.filter(keep);
  const suppressed = before.length + after.length - beforeFiltered.length - afterFiltered.length;

  const beforeByKey = new Map<string, NormalizedRequest[]>();
  for (const r of beforeFiltered) {
    const k = requestKey(r);
    const arr = beforeByKey.get(k) ?? [];
    arr.push(r);
    beforeByKey.set(k, arr);
  }
  const afterByKey = new Map<string, NormalizedRequest[]>();
  for (const r of afterFiltered) {
    const k = requestKey(r);
    const arr = afterByKey.get(k) ?? [];
    arr.push(r);
    afterByKey.set(k, arr);
  }

  const pairs: RequestPair[] = [];
  const keys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);
  const sortedKeys = [...keys].sort();
  for (const key of sortedKeys) {
    const bs = beforeByKey.get(key) ?? [];
    const as = afterByKey.get(key) ?? [];
    // Occurrence-index alignment inside the same key.
    const count = Math.max(bs.length, as.length);
    for (let i = 0; i < count; i++) {
      pairs.push({ key, before: bs[i], after: as[i] });
    }
  }
  return { pairs, suppressed };
}

export function networkFindings(
  before: NormalizedRequest[],
  after: NormalizedRequest[],
  settings: ComparisonSettings,
): { findings: DiffFinding[]; pairs: RequestPair[]; suppressedCount: number } {
  const { pairs, suppressed } = alignRequests(before, after, settings.ignore.urlPatterns);
  const findings: DiffFinding[] = [];

  for (const pair of pairs) {
    const b = pair.before;
    const a = pair.after;
    if (b && !a) {
      findings.push(
        makeFinding({
          category: 'network',
          severity: 'medium',
          status: 'removed',
          title: `Request removed: ${b.method} ${b.normalizedUrl}`,
          details: 'This request was recorded in the baseline run but not in the candidate run.',
          evidence: [{ kind: 'request', run: 'before', id: b.id }],
          confidence: 0.9,
          ruleId: RULE_IDS.requestRemoved,
        }),
      );
      continue;
    }
    if (!b && a) {
      const isError = (a.status ?? 0) >= 500;
      findings.push(
        makeFinding({
          category: 'network',
          severity: isError ? 'high' : 'low',
          status: 'added',
          title: `New request: ${a.method} ${a.normalizedUrl}`,
          details: 'This request appears only in the candidate run.',
          evidence: [{ kind: 'request', run: 'after', id: a.id }],
          confidence: 0.9,
          ruleId: RULE_IDS.requestAdded,
        }),
      );
      continue;
    }
    if (!b || !a) continue;

    if (b.status !== undefined && a.status !== undefined && b.status !== a.status) {
      const introduced5xx = a.status >= 500 && b.status < 500;
      const introduced4xx = a.status >= 400 && a.status < 500 && b.status < 400;
      findings.push(
        makeFinding({
          category: 'network',
          severity: introduced5xx ? 'high' : introduced4xx ? 'medium' : 'low',
          status: 'changed',
          title: `Status changed ${b.status} -> ${a.status}: ${a.method} ${a.normalizedUrl}`,
          details: 'HTTP status differs between the two runs for the same aligned request.',
          evidence: [
            { kind: 'request', run: 'before', id: b.id },
            { kind: 'request', run: 'after', id: a.id },
          ],
          confidence: 0.95,
          ruleId: introduced5xx ? RULE_IDS.serverErrorIntroduced : RULE_IDS.statusChanged,
        }),
      );
    }
    if (!b.failureReason && a.failureReason) {
      findings.push(
        makeFinding({
          category: 'network',
          severity: 'high',
          status: 'changed',
          title: `Request now fails: ${a.method} ${a.normalizedUrl}`,
          details: `Candidate run recorded a network failure: ${a.failureReason}`,
          evidence: [
            { kind: 'request', run: 'before', id: b.id },
            { kind: 'request', run: 'after', id: a.id },
          ],
          confidence: 0.95,
          ruleId: RULE_IDS.requestFailed,
        }),
      );
    }
    const db = b.endMs !== undefined && b.startMs !== undefined ? b.endMs - b.startMs : undefined;
    const da = a.endMs !== undefined && a.startMs !== undefined ? a.endMs - a.startMs : undefined;
    if (db !== undefined && da !== undefined) {
      const delta = da - db;
      const ratio = db > 0 ? delta / db : 0;
      if (delta >= settings.timing.minAbsoluteMs && ratio >= settings.timing.minRelativeIncrease) {
        findings.push(
          makeFinding({
            category: 'network',
            severity: delta >= 1000 ? 'medium' : 'low',
            status: 'changed',
            title: `Request slower by ${Math.round(delta)} ms: ${a.method} ${a.normalizedUrl}`,
            details: `Baseline ${Math.round(db)} ms; candidate ${Math.round(da)} ms. Single-run observation only.`,
            evidence: [
              { kind: 'request', run: 'before', id: b.id },
              { kind: 'request', run: 'after', id: a.id },
            ],
            confidence: 0.7,
            ruleId: RULE_IDS.requestSlower,
          }),
        );
      }
    }
  }
  return { findings, pairs, suppressedCount: suppressed };
}
