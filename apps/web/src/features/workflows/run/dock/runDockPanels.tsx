// ────────────────────────────────────────────────────────────────
// The run dock's own panels (D-27 run dock, board WorkflowRun): Inspector
// (the focused stage: output, files, tools, hooks, events, history), Usage
// (per-stage roll-up) and Widget (the focused stage's full-page widgets).
// Changes / Files / Terminal / Browser are the shared blocks' panels. Each
// panel is a memo `DockPanelProps` component reading `RunDockContext`, so a
// streamed token that re-renders the page reaches no panel (D-65).
// ────────────────────────────────────────────────────────────────

import { createContext, memo, useContext } from 'react';
import type { WorkflowRunWithStages } from '@generatorai/shared';
import type { DockPanelProps } from '@/blocks/dock/index.js';
import { WidgetHost } from '@/blocks/widgets/index.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { StageInspector } from '../inspector/StageInspector.js';
import { RunUsagePanel } from '../inspector/RunUsagePanel.js';
import type { StageView } from '../model/types.js';

export interface RunDockContextValue {
  runId: string | undefined;
  definitionId: string | undefined;
  run: WorkflowRunWithStages | undefined;
  /** The focused stage, with its own changed files once fetched (D-22). */
  stage: StageView | null;
  filesNote?: string | undefined;
  onFocusStage: (id: string) => void;
}

export const RunDockContext = createContext<RunDockContextValue | null>(null);

function useRunDock(): RunDockContextValue {
  const ctx = useContext(RunDockContext);
  if (!ctx) throw new Error('Run dock panels need a <RunDockContext.Provider>');
  return ctx;
}

export const RunInspectorDockPanel = memo(function RunInspectorDockPanel(_props: DockPanelProps) {
  const { stage, runId, definitionId, filesNote } = useRunDock();
  return <StageInspector stage={stage} runId={runId} definitionId={definitionId} filesNote={filesNote} />;
});

export const RunUsageDockPanel = memo(function RunUsageDockPanel(_props: DockPanelProps) {
  const { run, onFocusStage } = useRunDock();
  if (!run) return null;
  return <RunUsagePanel run={run} onFocusStage={onFocusStage} />;
});

export const RunWidgetDockPanel = memo(function RunWidgetDockPanel(_props: DockPanelProps) {
  const { stage } = useRunDock();
  if (!stage) return <EmptyState icon="widgets" title="Select a stage to see its widgets." />;
  return <WidgetHost sessionId={`stageRun:${stage.id}`} />;
});
