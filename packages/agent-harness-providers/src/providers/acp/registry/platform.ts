// ────────────────────────────────────────────────────────────────
// Which registry distribution runs on this machine (docs/acp ACP-6).
//
// Platform key: `{darwin|linux|windows}-{aarch64|x86_64}`, plus `-musl` on a
// musl Linux (Alpine). FORMAT.md: on musl pick the `-musl` target and, when
// there is none, treat the binary as unavailable (a glibc build does not run
// there); on glibc prefer the unsuffixed target. musl is detected the way
// `detect-libc` does: Node's diagnostic report carries `glibcVersionRuntime`
// on glibc only.
//
// Choice: a binary for this platform first, then npx; uvx is not supported yet
// (shown, not installable — Zed skips it too).
// ────────────────────────────────────────────────────────────────

import type { AcpBinaryTarget, AcpPackageDistribution, AcpPlatformKey, AcpRegistryAgent } from './schema.js';

/** Whether this Linux runs musl libc. `glibcVersionRuntime` is injectable for tests. */
export function isMuslLinux(
  platform: NodeJS.Platform = process.platform,
  glibcVersionRuntime: string | undefined | null = readGlibcVersion(),
): boolean {
  return platform === 'linux' && !glibcVersionRuntime;
}

function readGlibcVersion(): string | undefined {
  try {
    const report = process.report?.getReport?.() as { header?: { glibcVersionRuntime?: string } } | undefined;
    return report?.header?.glibcVersionRuntime;
  } catch {
    return undefined;
  }
}

/** The registry platform key of this machine, or null for an OS/arch the registry has no key for. */
export function acpPlatformKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  musl: boolean = isMuslLinux(platform),
): AcpPlatformKey | null {
  const os = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : platform === 'win32' ? 'windows' : null;
  const cpu = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : null;
  if (!os || !cpu) return null;
  return `${os}-${cpu}${os === 'linux' && musl ? '-musl' : ''}` as AcpPlatformKey;
}

/** The binary target for `key`: the exact key; a glibc Linux may fall back to a (static) musl build, never the reverse. */
export function binaryTargetFor(
  agent: Pick<AcpRegistryAgent, 'distribution'>,
  key: AcpPlatformKey | null,
): { key: AcpPlatformKey; target: AcpBinaryTarget } | null {
  const binary = agent.distribution.binary;
  if (!binary || !key) return null;
  const exact = binary[key];
  if (exact) return { key, target: exact };
  if (key.startsWith('linux-') && !key.endsWith('-musl')) {
    const muslKey = `${key}-musl` as AcpPlatformKey;
    const musl = binary[muslKey];
    if (musl) return { key: muslKey, target: musl };
  }
  return null;
}

export type AcpDistributionChoice =
  | { kind: 'binary'; key: AcpPlatformKey; target: AcpBinaryTarget }
  | { kind: 'npx'; dist: AcpPackageDistribution }
  | { kind: null; reason: string };

/** Every distribution kind the registry lists for an agent. */
export function offeredDistributions(agent: Pick<AcpRegistryAgent, 'distribution'>): Array<'binary' | 'npx' | 'uvx'> {
  const d = agent.distribution;
  return [...(d.binary ? (['binary'] as const) : []), ...(d.npx ? (['npx'] as const) : []), ...(d.uvx ? (['uvx'] as const) : [])];
}

/** What would be installed here: a binary for this platform, else npx, else nothing (with the reason). */
export function pickDistribution(agent: Pick<AcpRegistryAgent, 'distribution'>, key: AcpPlatformKey | null): AcpDistributionChoice {
  const binary = binaryTargetFor(agent, key);
  if (binary) return { kind: 'binary', ...binary };
  if (agent.distribution.npx) return { kind: 'npx', dist: agent.distribution.npx };
  if (agent.distribution.uvx) {
    return { kind: null, reason: 'Needs uv (Python), which is not supported yet.' };
  }
  if (!key) return { kind: null, reason: `No ACP agent builds exist for ${process.platform}/${process.arch}.` };
  if (key.endsWith('-musl')) return { kind: null, reason: `No build for musl Linux (${key}).` };
  return { kind: null, reason: `No build for this platform (${key}).` };
}
