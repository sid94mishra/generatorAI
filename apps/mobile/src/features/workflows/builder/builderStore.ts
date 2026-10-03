// The builder's working copy (M8-05/06/07; MD-85: sheets inside the builder edit this draft and its Save commits
// them): one draft per workflow — the record it was opened from (its revision is Save's `expectedRevision`), the
// edited graph, undo / redo stacks, the selected stage and the List / Graph view. Every builder route (the list,
// the stage editor, workflow settings, the loop and add-stage sheets) reads and edits the same draft.
import { create } from 'zustand';
import type { ValidationIssue, WorkflowDefinitionRecord, WorkflowGraph } from '@generatorai/workflow-spec';

const HISTORY = 50;

export interface BuilderDraft {
  base: WorkflowDefinitionRecord;
  graph: WorkflowGraph;
  past: WorkflowGraph[];
  future: WorkflowGraph[];
  selected: string | null;
  view: 'list' | 'graph';
  /** The last validation of this draft (the cards' error counts, the Validate sheet). */
  validation: { issues: ValidationIssue[]; at: number; graph: WorkflowGraph } | null;
}

interface BuilderState {
  drafts: Record<string, BuilderDraft>;
  /** Start editing (or keep the draft already open for this record's revision). */
  open: (record: WorkflowDefinitionRecord) => void;
  /** Replace the base after a save / conflict reload, keeping (or dropping) the edits. */
  rebase: (record: WorkflowDefinitionRecord, keepEdits: boolean) => void;
  edit: (id: string, change: (graph: WorkflowGraph) => WorkflowGraph) => void;
  undo: (id: string) => void;
  redo: (id: string) => void;
  select: (id: string, key: string | null) => void;
  setView: (id: string, view: 'list' | 'graph') => void;
  setValidation: (id: string, issues: ValidationIssue[]) => void;
  close: (id: string) => void;
}

export const useBuilderStore = create<BuilderState>((set, get) => ({
  drafts: {},
  open: (record) => {
    const current = get().drafts[record.id];
    if (current && current.base.revision === record.revision) return;
    set((s) => ({ drafts: { ...s.drafts, [record.id]: { base: record, graph: record.graph, past: [], future: [], selected: null, view: 'list', validation: null } } }));
  },
  rebase: (record, keepEdits) =>
    set((s) => {
      const d = s.drafts[record.id];
      const graph = keepEdits && d ? d.graph : record.graph;
      return { drafts: { ...s.drafts, [record.id]: { base: record, graph, past: keepEdits && d ? d.past : [], future: [], selected: d?.selected ?? null, view: d?.view ?? 'list', validation: d?.validation ?? null } } };
    }),
  edit: (id, change) =>
    set((s) => {
      const d = s.drafts[id];
      if (!d) return s;
      const graph = change(d.graph);
      if (graph === d.graph) return s;
      return { drafts: { ...s.drafts, [id]: { ...d, graph, past: [...d.past, d.graph].slice(-HISTORY), future: [] } } };
    }),
  undo: (id) =>
    set((s) => {
      const d = s.drafts[id];
      const prev = d?.past[d.past.length - 1];
      if (!d || !prev) return s;
      return { drafts: { ...s.drafts, [id]: { ...d, graph: prev, past: d.past.slice(0, -1), future: [d.graph, ...d.future] } } };
    }),
  redo: (id) =>
    set((s) => {
      const d = s.drafts[id];
      const next = d?.future[0];
      if (!d || !next) return s;
      return { drafts: { ...s.drafts, [id]: { ...d, graph: next, past: [...d.past, d.graph], future: d.future.slice(1) } } };
    }),
  select: (id, key) => set((s) => (s.drafts[id] ? { drafts: { ...s.drafts, [id]: { ...s.drafts[id]!, selected: key } } } : s)),
  setView: (id, view) => set((s) => (s.drafts[id] ? { drafts: { ...s.drafts, [id]: { ...s.drafts[id]!, view } } } : s)),
  setValidation: (id, issues) => set((s) => (s.drafts[id] ? { drafts: { ...s.drafts, [id]: { ...s.drafts[id]!, validation: { issues, at: Date.now(), graph: s.drafts[id]!.graph } } } } : s)),
  close: (id) =>
    set((s) => {
      const drafts = { ...s.drafts };
      delete drafts[id];
      return { drafts };
    }),
}));

/** The draft's graph differs from what was loaded. */
export function isDirty(draft: BuilderDraft | undefined): boolean {
  return Boolean(draft && draft.graph !== draft.base.graph && JSON.stringify(draft.graph) !== JSON.stringify(draft.base.graph));
}

/** The draft's last validation is of its current graph (Publish and Run are blocked by fresh errors only). */
export function freshErrors(draft: BuilderDraft | undefined): boolean {
  return Boolean(draft?.validation && draft.validation.graph === draft.graph && draft.validation.issues.some((i) => i.severity === 'error'));
}

/** How many edits the draft carries (the header's change count). */
export function changeCount(draft: BuilderDraft | undefined): number {
  return draft && isDirty(draft) ? Math.max(1, draft.past.length) : 0;
}
