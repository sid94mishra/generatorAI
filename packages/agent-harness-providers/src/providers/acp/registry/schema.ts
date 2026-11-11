// ────────────────────────────────────────────────────────────────
// The ACP Registry index (docs/acp ACP-4): `registry.json` from
// github.com/agentclientprotocol/registry (FORMAT.md, agent.schema.json).
//
// Parsed TOLERANTLY: the index is third-party data that changes hourly, so one
// malformed agent is skipped (and reported) instead of failing the whole
// catalogue, unknown keys are ignored, and a distribution whose entries are
// partly invalid keeps the valid ones.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';

/** The platform keys of `distribution.binary` (FORMAT.md §Platform Targets). */
export const ACP_PLATFORM_KEYS = [
  'darwin-aarch64',
  'darwin-x86_64',
  'linux-aarch64',
  'linux-x86_64',
  'linux-aarch64-musl',
  'linux-x86_64-musl',
  'windows-aarch64',
  'windows-x86_64',
] as const;
export type AcpPlatformKey = (typeof ACP_PLATFORM_KEYS)[number];

const stringRecord = z.record(z.string()).catch({});
const stringArray = z.array(z.string()).catch([]);

const BinaryTarget = z.object({
  archive: z.string().url(),
  cmd: z.string().min(1),
  args: stringArray.optional(),
  env: stringRecord.optional(),
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional().catch(undefined),
});
export type AcpBinaryTarget = z.infer<typeof BinaryTarget>;

const PackageDistribution = z.object({
  package: z.string().min(1),
  args: stringArray.optional(),
  env: stringRecord.optional(),
});
export type AcpPackageDistribution = z.infer<typeof PackageDistribution>;

const AGENT_ID = /^[a-z][a-z0-9-]*$/;

const AgentBase = z.object({
  id: z.string().regex(AGENT_ID),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().catch(''),
  repository: z.string().optional().catch(undefined),
  website: z.string().optional().catch(undefined),
  authors: z.array(z.string()).optional().catch(undefined),
  license: z.string().optional().catch(undefined),
  license_url: z.string().optional().catch(undefined),
  icon: z.string().optional().catch(undefined),
});

export interface AcpRegistryAgent extends z.infer<typeof AgentBase> {
  distribution: {
    binary?: Partial<Record<AcpPlatformKey, AcpBinaryTarget>>;
    npx?: AcpPackageDistribution;
    uvx?: AcpPackageDistribution;
  };
}

export interface AcpRegistryIndex {
  version: string;
  agents: AcpRegistryAgent[];
}

export interface AcpRegistryParseResult {
  index: AcpRegistryIndex;
  /** One line per agent (or distribution entry) that was skipped. */
  skipped: string[];
}

/** Parse one distribution: each binary target and package entry on its own. */
function parseDistribution(raw: unknown, id: string, skipped: string[]): AcpRegistryAgent['distribution'] {
  const out: AcpRegistryAgent['distribution'] = {};
  if (!raw || typeof raw !== 'object') return out;
  const d = raw as Record<string, unknown>;
  if (d['binary'] && typeof d['binary'] === 'object') {
    const binary: Partial<Record<AcpPlatformKey, AcpBinaryTarget>> = {};
    for (const [key, target] of Object.entries(d['binary'] as Record<string, unknown>)) {
      if (!(ACP_PLATFORM_KEYS as readonly string[]).includes(key)) continue; // a future key: not ours to run
      const parsed = BinaryTarget.safeParse(target);
      if (parsed.success) binary[key as AcpPlatformKey] = parsed.data;
      else skipped.push(`${id}: binary target ${key} is malformed`);
    }
    if (Object.keys(binary).length > 0) out.binary = binary;
  }
  for (const kind of ['npx', 'uvx'] as const) {
    if (d[kind] === undefined) continue;
    const parsed = PackageDistribution.safeParse(d[kind]);
    if (parsed.success) out[kind] = parsed.data;
    else skipped.push(`${id}: ${kind} distribution is malformed`);
  }
  return out;
}

/** Parse a registry index body; never throws for a bad agent, only for a body that is not an index at all. */
export function parseAcpRegistry(raw: unknown): AcpRegistryParseResult {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { agents?: unknown }).agents)) {
    throw new Error('The ACP registry index has no "agents" list.');
  }
  const body = raw as { version?: unknown; agents: unknown[] };
  const skipped: string[] = [];
  const agents: AcpRegistryAgent[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of body.agents.entries()) {
    const base = AgentBase.safeParse(entry);
    if (!base.success) {
      const id = (entry as { id?: unknown } | null)?.id;
      skipped.push(`agent #${i}${typeof id === 'string' ? ` (${id})` : ''}: ${base.error.issues[0]?.message ?? 'invalid'}`);
      continue;
    }
    if (seen.has(base.data.id)) {
      skipped.push(`${base.data.id}: listed twice`);
      continue;
    }
    const distribution = parseDistribution((entry as { distribution?: unknown }).distribution, base.data.id, skipped);
    if (!distribution.binary && !distribution.npx && !distribution.uvx) {
      skipped.push(`${base.data.id}: no usable distribution`);
      continue;
    }
    seen.add(base.data.id);
    agents.push({ ...base.data, distribution });
  }
  return { index: { version: typeof body.version === 'string' ? body.version : '1.0.0', agents }, skipped };
}
