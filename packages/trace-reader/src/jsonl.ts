import { resolveLimits, type ArchiveLimits } from './limits.js';
import { redactText } from './sanitize.js';

export interface JsonlLine {
  lineIndex: number;
  value: unknown;
}

export interface JsonlParseResult {
  lines: JsonlLine[];
  errors: Array<{ lineIndex: number; message: string; preview: string }>;
}

const decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * Parse JSON Lines defensively: malformed lines are isolated and reported
 * with their index instead of aborting the whole stream. Lines exceeding
 * the configured cap are reported and skipped.
 */
export function parseJsonLines(
  data: Uint8Array,
  limitOverrides?: Partial<ArchiveLimits>,
): JsonlParseResult {
  const limits = resolveLimits(limitOverrides);
  const text = decoder.decode(data);
  const rawLines = text.split('\n');
  const lines: JsonlLine[] = [];
  const errors: JsonlParseResult['errors'] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i] ?? '';
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    if (raw.length > limits.maxJsonlLineBytes) {
      errors.push({
        lineIndex: i,
        message: `Line exceeds ${limits.maxJsonlLineBytes} byte limit`,
        // Previews may end up in exported report warnings - redact first.
        preview: redactText(raw).slice(0, 160),
      });
      continue;
    }
    try {
      lines.push({ lineIndex: i, value: JSON.parse(trimmed) });
    } catch (err) {
      errors.push({
        lineIndex: i,
        message: err instanceof Error ? err.message : String(err),
        preview: redactText(trimmed).slice(0, 160),
      });
    }
  }
  return { lines, errors };
}
