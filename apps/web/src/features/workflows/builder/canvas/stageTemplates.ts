// ────────────────────────────────────────────────────────────────
// stageTemplates — the "Templates" group of the Add stage palette (P07
// WP-7.6): the spec's presets (a fix-review loop, a per-file migration, an
// approval-gated release, …), loaded with the palette rather than with the
// builder, and spliced into the graph with fresh keys where theirs collide.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { EdgeSpecSchema, StageSpecSchema, type EdgeSpec, type StageSpec } from '@generatorai/workflow-spec';
import type { PresetFragment } from '@generatorai/workflow-spec/presets';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { stageKeyFor, useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';

const STAGE_REF = /\b(stages|loops|maps)\.([a-z][a-z0-9_]*)\b/g;

/** Every string in `value` with `stages.<old>` (and loops., maps.) references renamed. */
function renameRefs(value: unknown, rename: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(STAGE_REF, (m, root: string, key: string) => (rename.has(key) ? `${root}.${rename.get(key)}` : m));
  }
  if (Array.isArray(value)) return value.map((v) => renameRefs(v, rename));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, renameRefs(v, rename)]));
  }
  return value;
}

/**
 * A preset's stages and edges, parsed, with every key the graph already
 * uses renamed (and the references to it: parents, context sources, the
 * wrap-up stage, edges and `stages.<key>` paths in text).
 */
export function spliceableFragment(fragment: PresetFragment, taken: ReadonlySet<string>): { stages: StageSpec[]; edges: EdgeSpec[] } {
  const used = new Set(taken);
  const rename = new Map<string, string>();
  for (const s of fragment.stages) {
    if (!used.has(s.key)) {
      used.add(s.key);
      continue;
    }
    const next = stageKeyFor(s.key, used);
    used.add(next);
    rename.set(s.key, next);
  }
  const key = (k: string) => rename.get(k) ?? k;
  const stages = fragment.stages.map((raw) => {
    const s = renameRefs(raw, rename) as Record<string, unknown>;
    const out: Record<string, unknown> = { ...s, key: key(raw.key) };
    if (typeof s['parentKey'] === 'string') out['parentKey'] = key(s['parentKey']);
    const context = s['context'] as { from?: string[] } | undefined;
    if (context?.from) out['context'] = { ...context, from: context.from.map(key) };
    const loop = s['loop'] as { wrapUp?: { stage: string } } | undefined;
    if (loop?.wrapUp) out['loop'] = { ...loop, wrapUp: { ...loop.wrapUp, stage: key(loop.wrapUp.stage) } };
    return StageSpecSchema.parse(out);
  });
  const edges = fragment.edges.map((e) =>
    EdgeSpecSchema.parse({ ...(renameRefs(e, rename) as Record<string, unknown>), from: key(e.from), to: key(e.to) }),
  );
  return { stages, edges };
}

/** A stage template as the palette uses it (a preset with its default parameters). */
export interface StagePreset {
  name: string;
  title: string;
  description: string;
  build: () => PresetFragment;
}

/**
 * The presets, loaded the first time `enabled` turns true (`null` until
 * then), and `addTemplate(name)`: splices one in and returns the key of its
 * first top-level stage (`null` when nothing was added; errors are toasted).
 */
export function useStageTemplates(enabled: boolean): {
  templates: readonly StagePreset[] | null;
  addTemplate: (name: string) => string | null;
} {
  const [templates, setTemplates] = useState<readonly StagePreset[] | null>(null);
  useEffect(() => {
    if (!enabled || templates) return;
    let alive = true;
    void import('@generatorai/workflow-spec/presets').then(
      (m) => alive && setTemplates(Object.values(m.PRESETS)),
      () => alive && setTemplates([]),
    );
    return () => {
      alive = false;
    };
  }, [enabled, templates]);

  const addTemplate = useCallback(
    (name: string): string | null => {
      const preset = templates?.find((p) => p.name === name);
      if (!preset) return null;
      const store = useWorkflowBuilderStore.getState();
      try {
        const { stages, edges } = spliceableFragment(preset.build(), new Set(store.nodes.map((n) => n.id)));
        return store.addFragment(stages, edges);
      } catch (err) {
        toast.error(`Could not add ${preset.title}`, { description: err instanceof Error ? err.message : String(err) });
        return null;
      }
    },
    [templates],
  );

  return { templates, addTemplate };
}
