// ────────────────────────────────────────────────────────────────
// GeneratorAI's own OpenCode configuration layer.
//
// Automatic compaction (`compaction.auto` / `compaction.buffer`) and skill
// directories (`skills`) are configuration in OpenCode 2, not session state.
// The server this provider starts is pointed at a file GeneratorAI owns
// (`OPENCODE_CONFIG`, an explicit layer above the user's global config and
// below a project's own `opencode.json`, cli `server-process.ts` →
// core `config/discovery.ts`), and the server watches that file
// (`config/watch.ts`), so a changed setting applies without a restart.
// The user's own config files are never written.
// ────────────────────────────────────────────────────────────────

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AutoCompactSetting } from '@generatorai/core';

export interface ManagedConfig {
  autoCompact?: AutoCompactSetting;
  skillDirectories: string[];
}

/** The `compaction` block for the app's setting; undefined leaves OpenCode's default (auto on, 15 % buffer). */
export function compactionConfig(setting: AutoCompactSetting | undefined): { auto: boolean; buffer?: string } | undefined {
  if (!setting) return undefined;
  if (!setting.enabled) return { auto: false };
  if (setting.thresholdPct == null) return { auto: true };
  // `buffer` is the share kept FREE: compacting at P % full keeps (100 − P) % free.
  const pct = Math.min(99, Math.max(1, 100 - setting.thresholdPct));
  return { auto: true, buffer: `${pct}%` };
}

export function renderConfig(cfg: ManagedConfig): string {
  const compaction = compactionConfig(cfg.autoCompact);
  const doc: Record<string, unknown> = {
    $schema: 'https://opencode.ai/config.json',
    ...(compaction ? { compaction } : {}),
    ...(cfg.skillDirectories.length ? { skills: [...cfg.skillDirectories].sort() } : {}),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** Write atomically, so the server's watcher never reads half a file. Returns whether the content changed. */
export function writeConfig(file: string, content: string, previous: string | null): boolean {
  if (content === previous) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, file);
  return true;
}

/**
 * The context-fill point OpenCode compacts at, for the gauge: the window minus the buffer kept free
 * (default 15 %, at least 16K — docs `compaction.mdx`). Undefined when automatic compaction is off.
 */
export function compactionThreshold(contextWindow: number | undefined, setting: AutoCompactSetting | undefined): number | undefined {
  if (!contextWindow || contextWindow <= 0) return undefined;
  if (setting && !setting.enabled) return undefined;
  if (setting?.thresholdPct != null) return Math.round((contextWindow * setting.thresholdPct) / 100);
  return Math.round(contextWindow - Math.max(contextWindow * 0.15, 16_000));
}
