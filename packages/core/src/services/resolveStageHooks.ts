// ────────────────────────────────────────────────────────────────
// resolveStageHooks — merge stage-level hooks from all sources
//
// Stage hooks can come from three sources:
//   1. Per-stage hooks (StageDefinition.hooks)
//   2. HooksFile stage overrides (HooksFileConfig.stages[stageName])
//   3. HooksFile wildcard (HooksFileConfig.stages['*'])
//
// Merge strategy: union all, deduplicate by hook id, sort by priority.
// Per-stage hooks take precedence over hooksFile overrides,
// which take precedence over wildcard hooks.
// ────────────────────────────────────────────────────────────────

import type { HookDefinition, HooksFileConfig } from '@generatorai/shared';

/**
 * Resolve the effective hooks for a stage by merging:
 *   1. stageHooks — hooks defined directly on the StageDefinition
 *   2. hooksFile.stages[stageName] — per-stage overrides from the hooks file
 *   3. hooksFile.stages['*'] — wildcard overrides from the hooks file
 *
 * Deduplication is by hook id — if the same id appears in multiple sources,
 * the highest-priority source wins (stageHooks > named > wildcard).
 */
export function resolveStageHooks(
  stageHooks: HookDefinition[] | undefined,
  stageName: string,
  hooksFile: HooksFileConfig | undefined,
): HookDefinition[] {
  const seen = new Set<string>();
  const result: HookDefinition[] = [];

  // Source 1: direct stage hooks (highest priority)
  if (stageHooks) {
    for (const h of stageHooks) {
      if (!seen.has(h.id)) {
        seen.add(h.id);
        result.push(h);
      }
    }
  }

  // Source 2: hooksFile per-stage overrides
  if (hooksFile?.stages?.[stageName]) {
    for (const h of hooksFile.stages[stageName]!) {
      if (!seen.has(h.id)) {
        seen.add(h.id);
        result.push(h);
      }
    }
  }

  // Source 3: hooksFile wildcard
  if (hooksFile?.stages?.['*']) {
    for (const h of hooksFile.stages['*']!) {
      if (!seen.has(h.id)) {
        seen.add(h.id);
        result.push(h);
      }
    }
  }

  // Sort by priority (ascending, lower = earlier)
  return result.sort((a, b) => a.priority - b.priority);
}
