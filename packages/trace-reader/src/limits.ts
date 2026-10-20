/**
 * Hard limits for archive ingestion. Defaults follow the product spec;
 * callers may lower them but not silently exceed the absolute ceilings.
 */
export interface ArchiveLimits {
  /** Compressed size cap per archive, bytes. Default 150 MiB, max 300 MiB. */
  maxCompressedBytes: number;
  /** Aggregate uncompressed cap across all entries, bytes. */
  maxUncompressedBytes: number;
  /** Maximum number of ZIP entries. */
  maxEntries: number;
  /** Maximum size of a single JSONL line, bytes. */
  maxJsonlLineBytes: number;
  /** Reject archives whose aggregate compression ratio exceeds this. */
  maxCompressionRatio: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxCompressedBytes: 150 * 1024 * 1024,
  maxUncompressedBytes: 600 * 1024 * 1024,
  maxEntries: 25_000,
  maxJsonlLineBytes: 20 * 1024 * 1024,
  maxCompressionRatio: 100,
};

export const ABSOLUTE_MAX_COMPRESSED_BYTES = 300 * 1024 * 1024;

export function resolveLimits(overrides?: Partial<ArchiveLimits>): ArchiveLimits {
  const merged = { ...DEFAULT_ARCHIVE_LIMITS, ...overrides };
  if (merged.maxCompressedBytes > ABSOLUTE_MAX_COMPRESSED_BYTES) {
    merged.maxCompressedBytes = ABSOLUTE_MAX_COMPRESSED_BYTES;
  }
  return merged;
}

export class ArchiveSecurityError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ArchiveSecurityError';
    this.code = code;
  }
}
