import * as jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import type { RgbaImage } from '@sanestly/analysis';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function hasMagic(data: Uint8Array, magic: number[]): boolean {
  if (data.length < magic.length) return false;
  return magic.every((b, i) => data[i] === b);
}

/**
 * Decode PNG/JPEG bytes to RGBA for pixel comparison. Returns undefined
 * for unsupported or corrupt payloads - callers must not treat that as a
 * visual pass.
 */
export function decodeImage(bytes: Uint8Array): RgbaImage | undefined {
  try {
    if (hasMagic(bytes, PNG_MAGIC)) {
      const png = PNG.sync.read(Buffer.from(bytes));
      return { width: png.width, height: png.height, data: png.data };
    }
    if (hasMagic(bytes, JPEG_MAGIC)) {
      const decoded = jpeg.decode(Buffer.from(bytes), { maxMemoryUsageInMB: 512, formatAsRGBA: true });
      if (!decoded || decoded.width <= 0 || decoded.height <= 0) return undefined;
      return { width: decoded.width, height: decoded.height, data: decoded.data };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
