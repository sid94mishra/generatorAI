// ────────────────────────────────────────────────────────────────
// ghCli — import the token the `gh` CLI already holds
// ────────────────────────────────────────────────────────────────

import type { IScmProcessRunner } from './ports.js';

/**
 * `gh auth token` for the given host. Returns the token, or null when the CLI
 * is missing, not signed in, or printed nothing. The value is never logged.
 *
 * Cross-platform: the runner resolves `gh` on PATH on every OS; `cwd`
 * defaults to the process working directory.
 */
export async function ghCliToken(
  processRunner: IScmProcessRunner,
  host?: string,
  cwd?: string,
): Promise<string | null> {
  const args = ['auth', 'token'];
  const normalized = normalizeGhHost(host);
  if (normalized) args.push('--hostname', normalized);
  try {
    const res = await processRunner.run('gh', args, {
      cwd: cwd ?? process.cwd(),
      timeout: 10_000,
    });
    if (res.exitCode !== 0) return null;
    const token = res.stdout.trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/** `https://ghe.acme.com/api/v3/` → `ghe.acme.com`; github.com (or unset) → undefined. */
function normalizeGhHost(host?: string): string | undefined {
  if (!host) return undefined;
  const trimmed = host.trim();
  if (!trimmed) return undefined;
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const hostname = withoutScheme.split('/')[0]?.replace(/\/+$/, '') ?? '';
  if (!hostname) return undefined;
  if (/^(www\.)?github\.com$/i.test(hostname)) return undefined;
  return hostname;
}
