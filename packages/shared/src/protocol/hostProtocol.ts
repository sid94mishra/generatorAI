/**
 * Host protocol versioning — APPLICATION-REVIEW-2026-09 plan item 43.
 *
 * The four out-of-process hosts (agent-host, pty-host, browser-host, cua-host)
 * are loaded from gitignored `dist/` directories that are built separately from
 * the server. Until now none of their IPC protocols carried a version, so a
 * stale dist — one built before a wire change — did not fail at startup; it
 * answered with the wrong shape and the mismatch surfaced later as a missing
 * field, a timed-out request, or a silently dropped notification.
 *
 * Every host now sends a `hello` frame as its FIRST IPC message, before the
 * `__ready__` pong. The gateway-side client checks it when the ready signal
 * arrives and refuses to start on a mismatch, with a message that names the
 * exact rebuild command. A host that sends no hello at all is an older dist
 * and is treated as protocol version 0 — the same loud failure.
 *
 * Bump the version for a host whenever its request or response union changes
 * incompatibly. Both sides import the constant from here, so the server and a
 * freshly built host always agree; only a STALE host can disagree.
 */

export const HOST_PROTOCOL_VERSIONS = {
  'agent-host': 1,
  'pty-host': 1,
  'browser-host': 1,
  'cua-host': 1,
} as const;

export type HostName = keyof typeof HOST_PROTOCOL_VERSIONS;

/**
 * First frame a host sends on its IPC channel. `type` (not `kind`) so it sits
 * in the same discriminated union as every other frame of every host protocol.
 */
export interface HostHelloFrame {
  type: 'hello';
  host: HostName;
  protocolVersion: number;
  /**
   * Build identity of the host dist: `GENERATORAI_BUILD_STAMP` when set (a CI
   * or packager can stamp a git hash into both server and hosts), otherwise
   * the nearest `package.json` version. Advisory only — see `assertHostHello`.
   */
  buildStamp: string;
}

const HOST_NAMES: ReadonlySet<string> = new Set(Object.keys(HOST_PROTOCOL_VERSIONS));

export function isHostHelloFrame(msg: unknown): msg is HostHelloFrame {
  if (typeof msg !== 'object' || msg === null) return false;
  const r = msg as Record<string, unknown>;
  return (
    r['type'] === 'hello' &&
    typeof r['host'] === 'string' &&
    HOST_NAMES.has(r['host']) &&
    typeof r['protocolVersion'] === 'number' &&
    typeof r['buildStamp'] === 'string'
  );
}

/** Env var a packager sets on both the server and its hosts so stamps compare exactly. */
export const BUILD_STAMP_ENV = 'GENERATORAI_BUILD_STAMP';

function rebuildHint(host: HostName): string {
  return `rebuild apps/${host} (pnpm --filter @generatorai/${host} build)`;
}

/**
 * Validate the hello a host sent against what this server was built for.
 *
 * Throws on a protocol-version or host-name mismatch — including the
 * "no hello at all" case, which is what every dist built before versioning
 * looks like. Returns a warning string (and does NOT throw) when only the build
 * stamp differs: in a dev checkout the server and a host legitimately carry
 * different package versions or none, and the protocol version is the thing
 * that actually governs wire compatibility.
 */
export function assertHostHello(
  expectedHost: HostName,
  expectedVersion: number,
  expectedBuildStamp: string,
  frame: unknown,
): string | undefined {
  if (!isHostHelloFrame(frame)) {
    throw new Error(
      `${expectedHost} protocol mismatch: server expects v${expectedVersion}, host dist is v0 ` +
        `(it sent no hello frame, so it predates protocol versioning) — ${rebuildHint(expectedHost)}`,
    );
  }
  if (frame.host !== expectedHost) {
    throw new Error(
      `${expectedHost} protocol mismatch: the process at the ${expectedHost} entry point identifies ` +
        `itself as "${frame.host}" — check the host entry path, or ${rebuildHint(expectedHost)}`,
    );
  }
  if (frame.protocolVersion !== expectedVersion) {
    throw new Error(
      `${expectedHost} protocol mismatch: server expects v${expectedVersion}, host dist is ` +
        `v${frame.protocolVersion} — ${rebuildHint(expectedHost)}`,
    );
  }
  if (frame.buildStamp !== expectedBuildStamp) {
    return (
      `${expectedHost} build stamp differs from the server's (host "${frame.buildStamp}", ` +
      `server "${expectedBuildStamp}"); protocol v${expectedVersion} matches so continuing. ` +
      `Set ${BUILD_STAMP_ENV} identically on both, or rebuild both from the same checkout, to silence this.`
    );
  }
  return undefined;
}
