// ────────────────────────────────────────────────────────────────
// Which strings may be handed to git as a REMOTE (mobile MG-11).
//
// `git ls-remote <url>` runs transport helpers, and two of them execute or
// read things on the server: `ext::<command>` runs an arbitrary command and
// `file://` / a bare path reads the server's own disk. A URL typed into a
// phone must only ever reach the network transports.
// ────────────────────────────────────────────────────────────────

const SCHEME_URL = /^(https?|ssh|git):\/\/[^\s/]+(\/\S*)?$/i;
/** scp-like `user@host:path` / `host:path`; a single-letter "host" is a Windows drive. */
const SCP_URL = /^(?:[A-Za-z0-9._~-]+@)?([A-Za-z0-9.-]{2,}):(?!\/\/)(\S+)$/;

export function isRemoteGitUrl(raw: string): boolean {
  const url = raw.trim();
  if (!url || url.length > 2048 || url.startsWith('-') || url.includes('::')) return false;
  if (SCHEME_URL.test(url)) return true;
  return SCP_URL.test(url);
}
