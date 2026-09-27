// ────────────────────────────────────────────────────────────────
// Props every stage inspector takes (the dispatcher in BuilderInspector
// feeds them). `tab` is the last tab the user chose for this kind; it may
// be undefined or name a tab this stage does not have (a body-only tab),
// in which case the inspector shows its default tab.
// ────────────────────────────────────────────────────────────────

import type { StageSpec } from '@generatorai/workflow-spec';
import type { BuilderIssue, StageUpdate } from '@/stores/workflowBuilderStore.js';

export interface StageInspectorProps<S extends StageSpec = StageSpec> {
  stage: S;
  /** The stage's issues (client + server validation). */
  issues: readonly BuilderIssue[];
  onUpdate: (updates: StageUpdate) => void;
  tab: string | undefined;
  onTabChange: (tab: string) => void;
}

export type AgentStageSpec = Extract<StageSpec, { kind: 'agent' }>;
export type OtherStageSpec = Exclude<StageSpec, { kind: 'agent' }>;
