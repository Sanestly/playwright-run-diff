import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { ArchiveSecurityError, isUnsafeEntryName, openArchive } from '../src/zip.js';
import { probeArchive } from '../src/probe.js';
import { parseJsonLines } from '../src/jsonl.js';
import { fingerprintLocator, normalizeUrl, redactText } from '../src/sanitize.js';

function makeZip(entries: Record<string, string>): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(entries)) files[k] = strToU8(v);
  return zipSync(files);
}

describe('zip security', () => {
  it('rejects non-zip input', () => {
    expect(() => openArchive(strToU8('not a zip at all'))).toThrow(ArchiveSecurityError);
  });

  it('rejects zip-slip paths', () => {
    const zip = zipSync({ '../evil.txt': strToU8('x') });
    expect(() => openArchive(zip)).toThrowError(/unsafe path/i);
  });

  it('flags unsafe names', () => {
    expect(isUnsafeEntryName('../x')).toBe(true);
    expect(isUnsafeEntryName('/abs')).toBe(true);
    expect(isUnsafeEntryName('C:/win')).toBe(true);
    expect(isUnsafeEntryName('a/../../b')).toBe(true);
    expect(isUnsafeEntryName('ok/path.txt')).toBe(false);
  });

  it('opens a normal archive', () => {
    const zip = makeZip({ 'trace.trace': '{"type":"context-options"}\n' });
    const { entries } = openArchive(zip);
    expect(entries.map((e) => e.name)).toContain('trace.trace');
  });
});

describe('probe', () => {
  it('groups chunked traces by prefix', () => {
    const probe = probeArchive([
      { name: 'trace.trace', compressedSize: 1, originalSize: 1 },
      { name: 'trace.network', compressedSize: 1, originalSize: 1 },
      { name: 'trace.stacks', compressedSize: 1, originalSize: 1 },
      { name: '0-trace.trace', compressedSize: 1, originalSize: 1 },
      { name: '0-trace.network', compressedSize: 1, originalSize: 1 },
      { name: 'resources/abc.png', compressedSize: 1, originalSize: 1 },
      { name: 'screencast/f1.jpeg', compressedSize: 1, originalSize: 1 },
    ]);
    expect(probe.groups.length).toBe(2);
    expect(probe.groups[0]!.traceFiles).toEqual(['0-trace.trace']);
    expect(probe.groups[1]!.networkFiles).toEqual(['trace.network']);
    expect(probe.resources).toEqual(['resources/abc.png']);
  });
});

describe('jsonl', () => {
  it('isolates malformed lines with line indexes', () => {
    const res = parseJsonLines(strToU8('{"a":1}\nNOTJSON\n{"b":2}\n'));
    expect(res.lines.length).toBe(2);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]!.lineIndex).toBe(1);
  });
});

describe('sanitize', () => {
  it('redacts sensitive query values but keeps keys', () => {
    const n = normalizeUrl('https://ex.com/p?token=abc123&ok=1');
    expect(n.normalizedUrl).toContain('token=*');
    expect(n.normalizedUrl).toContain('ok=1');
  });

  it('redacts authorization headers and JWTs in text', () => {
    expect(redactText('Authorization: Bearer secret123')).toContain('[REDACTED]');
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(redactText(`token ${jwt}`)).toContain('[REDACTED-JWT]');
  });

  it('fingerprints selectors with dynamic ids', () => {
    expect(fingerprintLocator('#user-12345 > .btn')).toBe('#<id> > .btn');
    expect(fingerprintLocator('#stable')).toBe('#stable');
  });
});
