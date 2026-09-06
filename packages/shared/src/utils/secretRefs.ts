// ────────────────────────────────────────────────────────────────
// secretRefs — the `${secret:<namespace>/<name>}` placeholder that an
//   application record stores INSTEAD of a credential value. The value
//   lives in the encrypted secrets vault (packages/secrets) and is
//   resolved only at execution time; API responses show SECRET_MASK.
//
// Shared (not core) because the web/CLI need to recognise a masked or
// referenced value to render "replace" affordances, and the Zod
// schemas need to accept the placeholder on round-trip updates.
// ────────────────────────────────────────────────────────────────

const PREFIX = '${secret:';
const SUFFIX = '}';

/** What a redacted credential looks like in an API response. */
export const SECRET_MASK = '••••';

/** `${secret:automation/abc/ds-env-TOKEN}` */
export function makeSecretRef(namespace: string, name: string): string {
  return `${PREFIX}${namespace}/${name}${SUFFIX}`;
}

export function isSecretRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX) && value.endsWith(SUFFIX) && value.length > PREFIX.length + 1;
}

/** Split a ref into vault coordinates, or null when it is not a ref. */
export function parseSecretRefValue(value: unknown): { namespace: string; name: string } | null {
  if (!isSecretRef(value)) return null;
  const inner = value.slice(PREFIX.length, -SUFFIX.length);
  const idx = inner.lastIndexOf('/');
  if (idx <= 0 || idx === inner.length - 1) return null;
  return { namespace: inner.slice(0, idx), name: inner.slice(idx + 1) };
}

/** Substrings that mark a header / env key as credential-bearing. */
const SENSITIVE_KEY_FRAGMENTS = [
  'token', 'secret', 'password', 'passwd', 'apikey', 'api_key', 'api-key',
  'authorization', 'auth', 'cookie', 'credential', 'private', 'signature',
  'session', 'bearer', 'access_key', 'accesskey', 'client_secret',
];

/**
 * True when a header / environment-variable name looks like it carries a
 * credential (`Authorization`, `X-Api-Key`, `JIRA_TOKEN`, `DB_PASSWORD`,
 * …). Names ending in `_KEY`/`-KEY` count too (`SONAR_KEY`) but a bare
 * `KEY`-less name like `PROJECT_KEY_PREFIX`… also matches — sealing a
 * non-secret costs nothing, leaking a secret does, so we err wide.
 */
export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  if (SENSITIVE_KEY_FRAGMENTS.some((frag) => k.includes(frag))) return true;
  return /(^|[_-])key$/.test(k) || /(^|[_-])key[_-]/.test(k);
}
