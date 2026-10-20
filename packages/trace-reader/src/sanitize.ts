/**
 * Redaction helpers. Trace data is untrusted and may contain credentials,
 * tokens and PII. Everything rendered or exported goes through these
 * helpers unless explicitly disabled by the user.
 */

const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'access_token',
  'id_token',
  'refresh_token',
  'auth',
  'authorization',
  'api_key',
  'apikey',
  'api-key',
  'key',
  'secret',
  'password',
  'passwd',
  'pwd',
  'signature',
  'sig',
  'session',
  'sessionid',
  'session_id',
  'jwt',
  'code',
  'client_secret',
  'private_key',
]);

const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g;
const LONG_TOKEN_RE = /\b[0-9a-f]{32,}\b/gi;
const AUTH_HEADER_RE = /(authorization|proxy-authorization)(\s*[:=]\s*)(bearer|basic|token)?\s*[^\s,;"']+/gi;
const COOKIE_RE = /(cookie|set-cookie)(\s*[:=]\s*)[^\n]+/gi;

export interface NormalizedUrlResult {
  /** Host + path + redacted/sorted query. Safe to display. */
  normalizedUrl: string;
  /** True when parsing produced a real URL; false means raw/opaque. */
  rawUrlAvailable: boolean;
  host?: string;
  path?: string;
}

function looksSensitiveValue(value: string): boolean {
  if (JWT_RE.test(value)) return true;
  JWT_RE.lastIndex = 0;
  if (/^[0-9a-f]{32,}$/i.test(value)) return true;
  return false;
}

export function normalizeUrl(rawUrl: string): NormalizedUrlResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    // Opaque or relative URL: never echo the raw string verbatim, it may
    // contain credentials. Keep a structural fingerprint only.
    return {
      normalizedUrl: rawUrl.replace(/[^/\\?&=\w.:-]/g, '*').slice(0, 200),
      rawUrlAvailable: false,
    };
  }
  const params: string[] = [];
  const keys = [...url.searchParams.keys()].sort();
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const value = url.searchParams.get(key) ?? '';
    const sensitive = SENSITIVE_QUERY_KEYS.has(key.toLowerCase()) || looksSensitiveValue(value);
    params.push(`${key}=${sensitive ? '*' : value}`);
  }
  const port = url.port ? `:${url.port}` : '';
  const query = params.length ? `?${params.join('&')}` : '';
  return {
    normalizedUrl: `${url.protocol}//${url.hostname.toLowerCase()}${port}${url.pathname}${query}`,
    rawUrlAvailable: true,
    host: url.hostname.toLowerCase(),
    path: url.pathname,
  };
}

/** Redact credentials and tokens from arbitrary trace text. */
export function redactText(text: string): string {
  let out = text;
  out = out.replace(AUTH_HEADER_RE, (_m, k: string, sep: string) => `${k}${sep}[REDACTED]`);
  out = out.replace(COOKIE_RE, (_m, k: string, sep: string) => `${k}${sep}[REDACTED]`);
  out = out.replace(JWT_RE, '[REDACTED-JWT]');
  out = out.replace(LONG_TOKEN_RE, '[REDACTED-TOKEN]');
  return out.slice(0, 4000);
}

/**
 * Fingerprint a Playwright selector/locator by shape: strip dynamic ids,
 * numbers and generated classes so "the same" element matches across runs.
 */
export function fingerprintLocator(locator: string | undefined): string | undefined {
  if (!locator) return undefined;
  let s = locator;
  s = s.replace(/#\w*[\w-]*\d[\w-]*/g, '#<id>');
  s = s.replace(/\b\d{5,}\b/g, '<n>');
  s = s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>');
  s = s.replace(/[0-9a-f]{16,}/gi, '<hash>');
  s = s.replace(/\s+/g, ' ').trim();
  return s.slice(0, 300);
}
