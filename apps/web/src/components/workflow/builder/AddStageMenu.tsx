// ────────────────────────────────────────────────────────────────
// AddStageMenu — the builder toolbar's searchable "Add stage" menu (P07
// WP-7.6): the stage kinds (agent, check, loop, map, sub-workflow, wait)
// and the stage templates (the spec's presets: a fix-review loop, a
// per-file migration, an approval-gated release, …), filtered as you type.
// A kind goes through the canvas's own add path; a template is spliced in
// with fresh keys when its own collide with the graph's.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { LayoutTemplate, Plus } from 'lucide-react';
import { EdgeSpecSchema, StageSpecSchema, type EdgeSpec, type StageKind, type StageSpec } from '@generatorai/workflow-spec';
import type { PresetFragment } from '@generatorai/workflow-spec/presets';
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  toast,
} from '@/components/ui/index.js';
import { stageKeyFor, useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { ADDABLE_KINDS, KIND_META } from './kindMeta.js';

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

/** A stage template as the menu uses it (a preset with its default parameters). */
interface TemplatePreset {
  name: string;
  title: string;
  description: string;
  build: () => PresetFragment;
}

interface AddStageMenuProps {
  /** Add one stage of a kind (the canvas's add path). */
  onAddKind: (kind: StageKind) => void;
  /** A template was added; `key` is its first top-level stage. */
  onAddedTemplate: (key: string) => void;
}

export function AddStageMenu({ onAddKind, onAddedTemplate }: AddStageMenuProps) {
  const [open, setOpen] = useState(false);
  // The templates load with the menu, not with the builder.
  const [presets, setPresets] = useState<readonly TemplatePreset[] | null>(null);
  useEffect(() => {
    if (!open || presets) return;
    let alive = true;
    void import('@generatorai/workflow-spec/presets').then(
      (m) => alive && setPresets(Object.values(m.PRESETS)),
      () => alive && setPresets([]),
    );
    return () => {
      alive = false;
    };
  }, [open, presets]);

  const addTemplate = (name: string) => {
    const preset = presets?.find((p) => p.name === name);
    if (!preset) return;
    const store = useWorkflowBuilderStore.getState();
    try {
      const { stages, edges } = spliceableFragment(preset.build(), new Set(store.nodes.map((n) => n.id)));
      const key = store.addFragment(stages, edges);
      if (key) onAddedTemplate(key);
    } catch (err) {
      toast.error(`Could not add ${preset.title}`, { description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" leftIcon={<Plus className="h-4 w-4" />} title="Add a stage or a stage template" aria-label="Add stage">
          Add stage
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[22rem] p-0">
        <Command
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
        >
          <CommandInput placeholder="Search stage kinds and templates…" aria-label="Search stages" />
          <CommandList className="max-h-[360px]">
            <CommandEmpty>Nothing matches.</CommandEmpty>
            <CommandGroup heading="Stage kinds">
              {ADDABLE_KINDS.map((kind) => {
                const { icon: Icon, label, hint } = KIND_META[kind];
                return (
                  <CommandItem
                    key={kind}
                    value={`kind:${kind}`}
                    keywords={[kind, label, hint]}
                    onSelect={() => {
                      setOpen(false);
                      onAddKind(kind);
                    }}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm">{label}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandGroup heading="Stage templates">
              {presets === null && (
                <p className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                  <Spinner size="sm" /> Loading templates…
                </p>
              )}
              {presets?.map((p) => (
                <CommandItem
                  key={p.name}
                  value={`template:${p.name}`}
                  keywords={[p.title, p.description, 'template']}
                  onSelect={() => {
                    setOpen(false);
                    addTemplate(p.name);
                  }}
                >
                  <LayoutTemplate className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-sm">{p.title}</p>
                    <p className="line-clamp-2 text-[11px] text-muted-foreground">{p.description}</p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
