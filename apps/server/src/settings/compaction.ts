// ────────────────────────────────────────────────────────────────
// Auto-compaction settings (docs/compaction §3.6): whether the agent
// providers compact a conversation on their own when its context window
// fills up, and at how full.
//
// One setting for every provider; each adapter maps it onto its own knob
// (Claude CLAUDE_AUTOCOMPACT_PCT_OVERRIDE / autoCompactEnabled, Codex
// model_auto_compact_token_limit, Copilot infiniteSessions, …) when a
// conversation is created or resumed — so a change applies to each chat
// from its next message. Persisted next to the database
// (`<dataDir>/compaction.json`).
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { writeFileAtomicRestricted } from '@generatorai/shared/node';
import type { AutoCompactSetting } from '@generatorai/core';

const STATE_FILE = 'compaction.json';

/** The lowest and highest fill a user can pick (below this a provider would compact after every few turns). */
export const MIN_COMPACT_THRESHOLD_PCT = 20;
export const MAX_COMPACT_THRESHOLD_PCT = 95;

export interface CompactionSettings {
  /** The providers compact on their own when the context window fills up. */
  autoCompact: boolean;
  /** At how full (percent); null = each provider's own threshold. */
  thresholdPct: number | null;
}

export const COMPACTION_DEFAULTS: CompactionSettings = { autoCompact: true, thresholdPct: null };

export function normalizeCompactionSettings(raw: Partial<CompactionSettings> | null | undefined): CompactionSettings {
  const autoCompact = typeof raw?.autoCompact === 'boolean' ? raw.autoCompact : COMPACTION_DEFAULTS.autoCompact;
  const t = raw?.thresholdPct;
  const thresholdPct =
    typeof t === 'number' && Number.isFinite(t)
      ? Math.min(MAX_COMPACT_THRESHOLD_PCT, Math.max(MIN_COMPACT_THRESHOLD_PCT, Math.round(t)))
      : null;
  return { autoCompact, thresholdPct };
}

/** What a conversation is created with: nothing when it is the providers' own default. */
export function autoCompactFor(settings: CompactionSettings): AutoCompactSetting | undefined {
  if (!settings.autoCompact) return { enabled: false };
  return settings.thresholdPct != null ? { enabled: true, thresholdPct: settings.thresholdPct } : undefined;
}

export async function readCompactionSettings(dataDir: string): Promise<CompactionSettings> {
  try {
    return normalizeCompactionSettings(JSON.parse(await fs.readFile(path.join(dataDir, STATE_FILE), 'utf8')) as Partial<CompactionSettings>);
  } catch {
    return { ...COMPACTION_DEFAULTS };
  }
}

/** The settings the running server holds (read at boot, replaced by the PUT route). */
export class CompactionSettingsStore {
  private constructor(
    private readonly dataDir: string,
    private current: CompactionSettings,
  ) {}

  static async load(dataDir: string): Promise<CompactionSettingsStore> {
    return new CompactionSettingsStore(dataDir, await readCompactionSettings(dataDir));
  }

  get(): CompactionSettings {
    return this.current;
  }

  async update(patch: Partial<CompactionSettings>): Promise<CompactionSettings> {
    const next = normalizeCompactionSettings({ ...this.current, ...patch });
    await fs.mkdir(this.dataDir, { recursive: true });
    writeFileAtomicRestricted(path.join(this.dataDir, STATE_FILE), `${JSON.stringify({ ...next, updatedAt: Date.now() }, null, 2)}\n`);
    this.current = next;
    return next;
  }
}
