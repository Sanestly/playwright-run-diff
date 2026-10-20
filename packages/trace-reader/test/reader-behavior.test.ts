import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { readTraceArchive } from '../src/reader.js';
import { ArchiveSecurityError } from '../src/limits.js';
import { normalizeUrl } from '../src/sanitize.js';

function zipOf(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) entries[k] = strToU8(v);
  return zipSync(entries);
}

const CONTEXT = JSON.stringify({ type: 'context-options', browserName: 'chromium', playwrightVersion: '9.9.9' });

describe('action logs vs console events', () => {
  it('attaches "log" records to the owning action, not the console stream', () => {
    const trace = [
      CONTEXT,
      JSON.stringify({ type: 'before', callId: 'a@1', startTime: 10, class: 'Frame', method: 'goto', params: { url: 'https://ex.test/' } }),
      JSON.stringify({ type: 'log', callId: 'a@1', time: 12, message: 'navigating to "https://ex.test/"' }),
      JSON.stringify({ type: 'console', messageType: 'log', text: 'real console message', time: 15 }),
      JSON.stringify({ type: 'after', callId: 'a@1', endTime: 40 }),
    ].join('\n');
    const parsed = readTraceArchive(zipOf({ 'trace.trace': trace }));
    const run = parsed.trace.runs[0]!;
    expect(run.consoleEvents).toHaveLength(1);
    expect(run.consoleEvents[0]!.text).toBe('real console message');
    expect(run.actions[0]!.logs).toEqual(['navigating to "https://ex.test/"']);
  });

  it('does not warn about known-but-uninterpreted event methods', () => {
    const trace = [
      CONTEXT,
      JSON.stringify({ type: 'event', time: 5, class: 'BrowserContext', method: 'page', params: { pageId: 'p1' } }),
      JSON.stringify({ type: 'before', callId: 'a@1', startTime: 10, class: 'Frame', method: 'goto', params: {} }),
      JSON.stringify({ type: 'after', callId: 'a@1', endTime: 40 }),
    ].join('\n');
    const parsed = readTraceArchive(zipOf({ 'trace.trace': trace }));
    expect(parsed.trace.warnings.filter((w) => w.includes('event:page'))).toHaveLength(0);
    expect(parsed.trace.warnings.filter((w) => w.includes('unhandled'))).toHaveLength(0);
  });

  it('still warns on genuinely unknown event methods', () => {
    const trace = [
      CONTEXT,
      JSON.stringify({ type: 'event', time: 5, method: 'totallyNewThing', params: {} }),
      JSON.stringify({ type: 'before', callId: 'a@1', startTime: 10, class: 'Frame', method: 'goto', params: {} }),
      JSON.stringify({ type: 'after', callId: 'a@1', endTime: 40 }),
    ].join('\n');
    const parsed = readTraceArchive(zipOf({ 'trace.trace': trace }));
    expect(parsed.trace.warnings.some((w) => w.includes('totallyNewThing'))).toBe(true);
  });
});

describe('failure modes', () => {
  it('rejects an archive with zero usable events', () => {
    const zip = zipOf({ 'trace.trace': 'GARBAGE\nMORE GARBAGE\n' });
    expect(() => readTraceArchive(zip)).toThrowError(ArchiveSecurityError);
  });

  it('redacts secrets inside malformed-line previews', () => {
    const secret = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const trace = [
      CONTEXT,
      `{"type":"before" BROKEN "token":"${secret}"}`,
      JSON.stringify({ type: 'before', callId: 'a@1', startTime: 10, class: 'Frame', method: 'goto', params: {} }),
      JSON.stringify({ type: 'after', callId: 'a@1', endTime: 40 }),
    ].join('\n');
    const parsed = readTraceArchive(zipOf({ 'trace.trace': trace }));
    const allWarnings = parsed.trace.warnings.join('\n');
    expect(allWarnings).not.toContain(secret);
  });
});

describe('url normalization', () => {
  it('drops userinfo credentials entirely', () => {
    const n = normalizeUrl('https://user:supersecret@host.test/path?ok=1');
    expect(n.normalizedUrl).not.toContain('supersecret');
    expect(n.normalizedUrl).not.toContain('user@');
  });
});
