// ────────────────────────────────────────────────────────────────
// Provider visibility (D-131): which agent providers this server serves.
//
// Every supported provider has a stability (`HARNESS_PROVIDER_STABILITY` in
// @generatorai/shared). Stable providers are served by default; experimental
// ones are hidden until revealed — by an admin in Settings › Model providers
// (`PUT /api/harness/visibility`, persisted to `<dataDir>/provider-visibility.json`)
// or by the operator's environment (`GENERATORAI_EXPERIMENTAL_PROVIDERS=opencode,acp`,
// or `all`). An env reveal cannot be switched off from a client.
//
// The hidden set is handed to `HarnessRegistry.setHiddenTypes`, which keeps a
// hidden provider out of every status/model list, never probes it and refuses
// to bring it up — so web, desktop, mobile and the CLI all see the same thing
// and none can select it.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { writeFileAtomicRestricted } from '@generatorai/shared/node';
import {
  HARNESS_PROVIDER_IDS,
  HARNESS_PROVIDER_STABILITY,
  harnessProviderLabel,
  type HarnessProviderId,
  type HarnessProviderVisibility,
} from '@generatorai/shared';

const STATE_FILE = 'provider-visibility.json';

/** Comma-separated provider ids (or `all`) the operator reveals regardless of the setting. */
export const EXPERIMENTAL_PROVIDERS_ENV = 'GENERATORAI_EXPERIMENTAL_PROVIDERS';

/** An admin's explicit choices; a provider not named here follows its stability default. */
export interface ProviderVisibilitySettings {
  visible: Partial<Record<HarnessProviderId, boolean>>;
}

export function isHarnessProviderId(value: string): value is HarnessProviderId {
  return (HARNESS_PROVIDER_IDS as readonly string[]).includes(value);
}

/** The providers the environment reveals: `opencode,acp`, `all`, or nothing. Unknown ids are ignored. */
export function parseRevealEnv(raw: string | undefined): Set<HarnessProviderId> {
  const items = (raw ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (items.includes('all')) return new Set(HARNESS_PROVIDER_IDS);
  return new Set(items.filter(isHarnessProviderId));
}

/** Keep only well-formed entries: a known provider id with a boolean. */
export function normalizeProviderVisibility(raw: unknown): ProviderVisibilitySettings {
  const visible: ProviderVisibilitySettings['visible'] = {};
  const entries = (raw as { visible?: Record<string, unknown> } | null)?.visible ?? {};
  for (const [id, value] of Object.entries(entries)) {
    if (isHarnessProviderId(id) && typeof value === 'boolean') visible[id] = value;
  }
  return { visible };
}

/** Every supported provider with whether it is served and why. */
export function resolveProviderVisibility(
  settings: ProviderVisibilitySettings,
  revealed: ReadonlySet<HarnessProviderId>,
): HarnessProviderVisibility[] {
  return HARNESS_PROVIDER_IDS.map((type) => {
    const stability = HARNESS_PROVIDER_STABILITY[type];
    const base = { type, label: harnessProviderLabel(type), stability };
    if (revealed.has(type)) return { ...base, visible: true, source: 'env' as const };
    const chosen = settings.visible[type];
    if (chosen !== undefined) return { ...base, visible: chosen, source: 'setting' as const };
    return { ...base, visible: stability === 'stable', source: 'default' as const };
  });
}

export async function readProviderVisibility(dataDir: string): Promise<ProviderVisibilitySettings> {
  try {
    return normalizeProviderVisibility(JSON.parse(await fs.readFile(path.join(dataDir, STATE_FILE), 'utf8')));
  } catch {
    return { visible: {} };
  }
}

/** The visibility the running server applies (read at boot, changed by the PUT route). */
export class ProviderVisibilityStore {
  private constructor(
    private readonly dataDir: string,
    private settings: ProviderVisibilitySettings,
    private readonly revealed: ReadonlySet<HarnessProviderId>,
    private readonly onChange: (hidden: HarnessProviderId[]) => void,
  ) {
    onChange(this.hidden());
  }

  static async load(
    dataDir: string,
    env: NodeJS.ProcessEnv,
    onChange: (hidden: HarnessProviderId[]) => void,
  ): Promise<ProviderVisibilityStore> {
    return new ProviderVisibilityStore(dataDir, await readProviderVisibility(dataDir), parseRevealEnv(env[EXPERIMENTAL_PROVIDERS_ENV]), onChange);
  }

  list(): HarnessProviderVisibility[] {
    return resolveProviderVisibility(this.settings, this.revealed);
  }

  hidden(): HarnessProviderId[] {
    return this.list().filter((p) => !p.visible).map((p) => p.type as HarnessProviderId);
  }

  /** Apply an admin's change (`null` returns a provider to its default), persist it, re-apply the hidden set. */
  async update(patch: Record<string, boolean | null>): Promise<HarnessProviderVisibility[]> {
    const visible = { ...this.settings.visible };
    for (const [id, value] of Object.entries(patch)) {
      if (!isHarnessProviderId(id)) continue;
      if (value === null) delete visible[id];
      else visible[id] = value;
    }
    const next = normalizeProviderVisibility({ visible });
    await fs.mkdir(this.dataDir, { recursive: true });
    writeFileAtomicRestricted(path.join(this.dataDir, STATE_FILE), `${JSON.stringify({ ...next, updatedAt: Date.now() }, null, 2)}\n`);
    this.settings = next;
    this.onChange(this.hidden());
    return this.list();
  }
}
