// The run's pane claim (MB-42 `scope: 'run'`; MG-28; M8-04): the run screen and a stage's chat claim the same pane —
// the run's own Output / Hooks / Variables (drawn here, focused on one stage) beside the workspace tabs every pane
// shows (PaneTabBody). Counts: the focused stage's files, its and the workflow's hooks, the run's inputs; Output
// carries the needs-you dot while a stage waits on a person.
import React, { useCallback, useMemo } from 'react';
import type { WorkflowGraph } from '@generatorai/workflow-spec';

import { runHref } from '../../blocks/shell/hrefs';
import { PaneTabBody, usePaneToggle, useWorkspacePaneClaim, type MobilePaneTab, type PaneTabContext } from '../../blocks/WorkspacePane';
import { HooksTab, OutputTab, VariablesTab, focusStage, type RunPaneData } from './components/RunPaneTabs';
import type { RunStage } from './model/runStages';

export interface RunPaneInput {
  runId: string;
  workflowId: string;
  title: string;
  workspaceId: string | null;
  stages: readonly RunStage[];
  graph: WorkflowGraph | undefined;
  variables: Record<string, unknown> | undefined;
  runOverrides?: RunPaneData['runOverrides'];
  stageOverrides?: RunPaneData['stageOverrides'];
  focusedId: string | null;
  onFocus: (id: string) => void;
  agentBusy: boolean;
  agentName?: string | null;
  scopes: readonly string[];
  live: boolean;
}

export function useRunPane(input: RunPaneInput): ReturnType<typeof usePaneToggle> {
  const { runId, workflowId, title, workspaceId, stages, graph, variables, runOverrides, stageOverrides, focusedId, onFocus, agentBusy, agentName = null, scopes, live } = input;
  const ctx = useMemo<PaneTabContext>(() => ({ workspaceId, chatId: null, agentBusy, agentName }), [workspaceId, agentBusy, agentName]);
  const data = useMemo<RunPaneData>(
    () => ({ runId, workflowId, workspaceId, stages, graph, variables: variables ?? {}, runOverrides: runOverrides ?? null, stageOverrides: stageOverrides ?? null, focusedId, onFocus }),
    [runId, workflowId, workspaceId, stages, graph, variables, runOverrides, stageOverrides, focusedId, onFocus],
  );
  const renderTab = useCallback(
    (type: MobilePaneTab, tab: { active: boolean }) => {
      switch (type) {
        case 'output':
          return <OutputTab data={data} />;
        case 'hooks':
          return <HooksTab data={data} />;
        case 'variables':
          return <VariablesTab data={data} />;
        default:
          return <PaneTabBody type={type} active={tab.active} ctx={ctx} />;
      }
    },
    [data, ctx],
  );
  const focused = stages.find((s) => s.id === focusedId) ?? focusStage(stages);
  const spec = graph?.stages.find((s) => s.key === focused?.stageKey);
  const hooks = (spec?.kind === 'agent' ? spec.hooks.length : 0) + (graph?.workflow.hooks.length ?? 0);
  const files = (focused?.artifactManifest ?? []).filter((f) => !/^unnamed\.[A-Za-z0-9]+$/.test(f.path)).length;
  const inputs = Object.keys(variables ?? {}).filter((k) => !k.startsWith('__')).length;
  const needsYou = stages.some((s) => s.status === 'awaiting_input');
  const run = useMemo(() => ({ files, hooks, variables: inputs, needsYou }), [files, hooks, inputs, needsYou]);
  useWorkspacePaneClaim({ kind: 'run', id: runId, title, path: runHref(workflowId, runId), workspaceId, chatId: null, scopes, live, renderTab, run });
  return usePaneToggle();
}
