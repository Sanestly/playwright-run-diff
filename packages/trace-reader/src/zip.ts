import { unzipSync, type Unzipped } from 'fflate';
import {
  ArchiveSecurityError,
  resolveLimits,
  type ArchiveLimits,
} from './limits.js';

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const ZIP_EOCD_MAGIC = [0x50, 0x4b, 0x05, 0x06];

export interface ArchiveEntryInfo {
  name: string;
  compressedSize: number;
  originalSize: number;
}

export interface SafeArchive {
  entries: ArchiveEntryInfo[];
  files: Unzipped;
}

function hasMagic(data: Uint8Array, magic: number[], offset = 0): boolean {
  if (data.length < offset + magic.length) return false;
  return magic.every((b, i) => data[offset + i] === b);
}

/**
 * Locates the End Of Central Directory record to confirm this is a real ZIP,
 * and detects split/multi-disk archives (disk numbers must both be 0).
 */
function assertValidCentralDirectory(data: Uint8Array): void {
  if (!hasMagic(data, ZIP_MAGIC)) {
    throw new ArchiveSecurityError(
      'NOT_A_ZIP',
      'File does not start with a ZIP local file header. Only .zip archives produced by Playwright tracing are supported.',
    );
  }
  // Scan backwards for EOCD (it may be followed by a comment up to 64 KiB).
  const minEocd = 22;
  let eocdOffset = -1;
  const scanStart = Math.max(0, data.length - minEocd - 0xffff);
  for (let i = data.length - minEocd; i >= scanStart; i--) {
    if (hasMagic(data, ZIP_EOCD_MAGIC, i)) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new ArchiveSecurityError(
      'BAD_CENTRAL_DIRECTORY',
      'ZIP end-of-central-directory record not found; the archive is truncated or corrupt.',
    );
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const diskNo = view.getUint16(eocdOffset + 4, true);
  const cdDisk = view.getUint16(eocdOffset + 6, true);
  if (diskNo !== 0 || cdDisk !== 0) {
    throw new ArchiveSecurityError(
      'SPLIT_ZIP',
      'Multi-disk / split ZIP archives are not supported.',
    );
  }
}

export function isUnsafeEntryName(name: string): boolean {
  if (name.length === 0) return true;
  if (name.includes('\0')) return true;
  if (name.startsWith('/') || name.startsWith('\\')) return true;
  // Drive-letter paths like C:\ or C:/
  if (/^[a-zA-Z]:[\\/]/.test(name)) return true;
  const segments = name.split(/[\\/]+/);
  if (segments.some((s) => s === '..')) return true;
  return false;
}

export function normalizeEntryName(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

/**
 * Validate and decompress a ZIP archive defensively.
 *
 * Checks performed before/while inflating:
 * - ZIP magic + central directory presence, split-archive rejection
 * - compressed-size cap
 * - entry name safety (zip-slip, absolute, drive paths, NUL)
 * - duplicate normalized-name collisions
 * - entry count and aggregate uncompressed size caps
 * - aggregate compression ratio cap (zip-bomb heuristic)
 *
 * Encrypted entries cannot be fully detected via fflate; files that fail to
 * inflate surface as corrupt errors rather than silent truncation.
 */
export function openArchive(
  data: Uint8Array,
  limitOverrides?: Partial<ArchiveLimits>,
): SafeArchive {
  const limits = resolveLimits(limitOverrides);

  if (data.byteLength > limits.maxCompressedBytes) {
    throw new ArchiveSecurityError(
      'TOO_LARGE_COMPRESSED',
      `Archive is ${(data.byteLength / 1024 / 1024).toFixed(1)} MiB compressed, ` +
        `exceeding the ${(limits.maxCompressedBytes / 1024 / 1024).toFixed(0)} MiB limit.`,
    );
  }

  assertValidCentralDirectory(data);

  const entries: ArchiveEntryInfo[] = [];
  const seenNames = new Set<string>();
  let totalUncompressed = 0;
  let totalCompressed = 0;

  let files: Unzipped;
  try {
    files = unzipSync(data, {
      filter: (file) => {
        const name = normalizeEntryName(file.name);
        if (isUnsafeEntryName(name)) {
          throw new ArchiveSecurityError(
            'UNSAFE_PATH',
            `Archive entry "${file.name.slice(0, 120)}" has an unsafe path (zip-slip, absolute or drive path).`,
          );
        }
        if (seenNames.has(name)) {
          throw new ArchiveSecurityError(
            'DUPLICATE_ENTRY',
            `Duplicate archive entry after normalization: "${name.slice(0, 120)}".`,
          );
        }
        seenNames.add(name);
        if (seenNames.size > limits.maxEntries) {
          throw new ArchiveSecurityError(
            'TOO_MANY_ENTRIES',
            `Archive has more than ${limits.maxEntries} entries.`,
          );
        }
        totalUncompressed += file.originalSize;
        totalCompressed += file.size;
        if (totalUncompressed > limits.maxUncompressedBytes) {
          throw new ArchiveSecurityError(
            'TOO_LARGE_UNCOMPRESSED',
            `Archive would decompress beyond the ${(limits.maxUncompressedBytes / 1024 / 1024).toFixed(0)} MiB cap.`,
          );
        }
        if (totalCompressed > 0 && totalUncompressed / totalCompressed > limits.maxCompressionRatio) {
          throw new ArchiveSecurityError(
            'COMPRESSION_BOMB',
            'Archive compression ratio is implausibly high; refusing to decompress a possible zip bomb.',
          );
        }
        entries.push({ name, compressedSize: file.size, originalSize: file.originalSize });
        return true;
      },
    });
  } catch (err) {
    if (err instanceof ArchiveSecurityError) throw err;
    throw new ArchiveSecurityError(
      'CORRUPT_ZIP',
      `Failed to read ZIP archive: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { entries, files };
}
