import type { ComparisonReport } from '@sanestly/contracts';

/**
 * Deterministic JSON: object keys are sorted recursively so identical
 * inputs produce byte-identical output (stable for golden assertions).
 */
export function stableStringify(value: unknown, indent = 2): string {
  return JSON.stringify(sortKeys(value), null, indent) + '\n';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export function reportToJson(report: ComparisonReport): string {
  return stableStringify(report);
}
