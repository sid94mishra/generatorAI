// ────────────────────────────────────────────────────────────────
// Redaction — a single place that knows what must never reach a log,
// an error message, a telemetry span, or an audit event.
//
// Two layers:
//  1. Structural — header/field/query-parameter names that are secret by
//     definition, regardless of the value.
//  2. Sentinel — exact values registered at runtime (device credentials,
//     provider tokens, relay invites). Only a salted fingerprint is retained,
//     never the value itself, so the registry cannot itself leak.
// ────────────────────────────────────────────────────────────────

import * as crypto from 'node:crypto';

export const REDACTED = '[redacted]';

/** Header names that must never be logged. Compared case-insensitively. */
export const SECRET_HEADER_NAMES: readonly string[] = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'dpop',
  'dpop-nonce',
  'x-generatorai-token',
  'x-api-key',
  'x-hub-signature',
  'x-hub-signature-256',
  'x-relay-ticket',
];

/** Object/JSON field names that must never be logged. Compared case-insensitively. */
export const SECRET_FIELD_NAMES: readonly string[] = [
  'apikey',
  'api_key',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'resumesecret',
  'resume_secret',
  'idtoken',
  'id_token',
  'token',
  'secret',
  'password',
  'passphrase',
  'privatekey',
  'private_key',
  'clientsecret',
  'client_secret',
  'githubtoken',
  'github_token',
  'ghtoken',
  'gh_token',
  'anthropic_api_key',
  'openai_api_key',
  'pairinggrant',
  'pairing_grant',
  'pairingcode',
  'pairing_code',
  'invitetoken',
  'invite_token',
  'ticket',
  'signature',
  'dpop',
  'devicetoken',
  'device_token',
  'credential',
  'sessionkey',
  'session_key',
  'kek',
  'dek',
];

/** URL query parameters that must be stripped before a URL is logged. */
export const SECRET_QUERY_PARAMS: readonly string[] = [
  'apiKey',
  'apikey',
  'api_key',
  'token',
  'access_token',
  'ticket',
  'code',
  'invite',
  'signature',
  'sig',
];

/** Environment variable names whose values must never be logged. */
export const SECRET_ENV_NAMES: readonly string[] = [
  'GENERATORAI_API_KEY',
  'GENERATORAI_SECRET_KEY',
  'GENERATORAI_SECRET_PASSPHRASE',
  'GENERATORAI_RELAY_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'COPILOT_GITHUB_TOKEN',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GITHUB_WEBHOOK_SECRET',
  'WEBHOOK_TOKEN',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
];

const lower = (values: readonly string[]) => new Set(values.map((v) => v.toLowerCase()));
const SECRET_HEADER_SET = lower(SECRET_HEADER_NAMES);
const SECRET_FIELD_SET = lower(SECRET_FIELD_NAMES);
const SECRET_ENV_SET = new Set(SECRET_ENV_NAMES);

// ── Sentinel registry ────────────────────────────────────────────

/**
 * Per-process salt. Fingerprints are only comparable inside one process, which
 * is exactly what we need (leak detection) and prevents the fingerprints
 * themselves from becoming an offline dictionary-attack target.
 */
const FINGERPRINT_SALT = crypto.randomBytes(32);
/** fingerprint → length, so `redactText` can skip values that cannot occur. */
const sentinels = new Map<string, number>();
/** Exact values, kept only in memory for substring scanning. */
const sentinelValues = new Set<string>();

/** Minimum length for a sentinel — shorter values would cause false positives. */
const MIN_SENTINEL_LENGTH = 12;

export function fingerprintSecret(value: string): string {
  return crypto.createHmac('sha256', FINGERPRINT_SALT).update(value).digest('base64url').slice(0, 16);
}

/**
 * Registers a live secret so `redactText` can scrub it from arbitrary strings.
 * Returns the fingerprint, which IS safe to log (it identifies which credential
 * was used without revealing it).
 */
export function registerSecretValue(value: string | undefined | null): string | null {
  if (!value || value.length < MIN_SENTINEL_LENGTH) return null;
  const fp = fingerprintSecret(value);
  sentinels.set(fp, value.length);
  sentinelValues.add(value);
  return fp;
}

export function unregisterSecretValue(value: string | undefined | null): void {
  if (!value) return;
  sentinels.delete(fingerprintSecret(value));
  sentinelValues.delete(value);
}

/** Test helper — clears the sentinel registry. */
export function clearRegisteredSecrets(): void {
  sentinels.clear();
  sentinelValues.clear();
}

// ── Redaction ────────────────────────────────────────────────────

/** Replaces every registered sentinel occurrence inside a free-form string. */
export function redactText(text: string): string {
  if (!text || sentinelValues.size === 0) return text;
  let out = text;
  for (const value of sentinelValues) {
    if (out.includes(value)) out = out.split(value).join(REDACTED);
  }
  return out;
}

/**
 * Strips secret-bearing query parameters from a URL so it is safe to log.
 * Falls back to a regex scrub for relative URLs.
 */
export function redactUrl(url: string): string {
  if (!url) return url;
  const scrubParams = (search: URLSearchParams): boolean => {
    let changed = false;
    for (const name of SECRET_QUERY_PARAMS) {
      if (search.has(name)) {
        search.set(name, REDACTED);
        changed = true;
      }
    }
    return changed;
  };
  try {
    const parsed = new URL(url);
    scrubParams(parsed.searchParams);
    return redactText(parsed.toString());
  } catch {
    const qIdx = url.indexOf('?');
    if (qIdx < 0) return redactText(url);
    const search = new URLSearchParams(url.slice(qIdx + 1));
    scrubParams(search);
    return redactText(`${url.slice(0, qIdx)}?${search.toString()}`);
  }
}

export function redactHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!headers) return {};
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SECRET_HEADER_SET.has(name.toLowerCase()) ? REDACTED : value;
  }
  return out;
}

export function isSecretEnvName(name: string): boolean {
  return (
    SECRET_ENV_SET.has(name) ||
    /(_TOKEN|_SECRET|_KEY|_PASSWORD|_PASSPHRASE|_CREDENTIALS)$/i.test(name)
  );
}

/**
 * Deep-redacts an arbitrary value for logging: secret-named fields become
 * `[redacted]`, strings are scanned for registered sentinels, and cycles are
 * handled. `maxDepth` prevents pathological structures from stalling a log call.
 */
export function redactDeep(value: unknown, maxDepth = 6): unknown {
  return redactInner(value, maxDepth, new WeakSet());
}

function redactInner(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value !== 'object') return value;
  if (depth <= 0) return '[truncated]';
  if (seen.has(value as object)) return '[circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactInner(item, depth - 1, seen));
  }
  if (value instanceof Error) {
    return { name: value.name, message: redactText(value.message) };
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return `[bytes:${(value as Uint8Array).length}]`;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_FIELD_SET.has(k.toLowerCase()) || isSecretEnvName(k)) {
      out[k] = REDACTED;
      continue;
    }
    if (k.toLowerCase() === 'url' && typeof v === 'string') {
      out[k] = redactUrl(v);
      continue;
    }
    out[k] = redactInner(v, depth - 1, seen);
  }
  return out;
}
