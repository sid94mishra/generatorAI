// ────────────────────────────────────────────────────────────────
// BuilderInspector — what the builder's C-18 inspector shows:
//   a stage selected  → that kind's inspector (agent: Prompt · Session ·
//                        Tools · Output · Policy · Hooks; loop/map/check/
//                        sub-workflow/wait: their own tabs)
//   an edge selected  → the edge inspector
//   nothing selected  → the workflow's settings (General · Project ·
//                        Variables · Hooks · Tags · Budget)
// The chosen tab is remembered per kind, so moving between two agent
// stages stays on the same tab.
// ────────────────────────────────────────────────────────────────

import { useCallback, useMemo, useState } from 'react';
import type { StageKind } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore, type StageUpdate } from '@/stores/workflowBuilderStore.js';
import { AgentStageInspector } from './agent/AgentStageInspector.js';
import { EdgeInspector } from './agent/EdgeInspector.js';
import { KindStageInspector } from './kinds/KindStageInspector.js';
import { WorkflowSettingsInspector } from '../settings/WorkflowSettingsInspector.js';
import type { SettingsTab } from './InspectorShell.js';
import type { OtherStageSpec } from './types.js';

export interface BuilderInspectorProps {
  settingsTab: SettingsTab;
  onSettingsTabChange: (tab: SettingsTab) => void;
}

export function BuilderInspector({ settingsTab, onSettingsTabChange }: BuilderInspectorProps) {
  const selectedNodeId = useWorkflowBuilderStore((s) => s.selectedNodeId);
  const selectedEdgeId = useWorkflowBuilderStore((s) => s.selectedEdgeId);
  const stage = useWorkflowBuilderStore((s) => s.nodes.find((n) => n.id === s.selectedNodeId)?.data.stage);
  const allIssues = useWorkflowBuilderStore((s) => s.issues);
  const updateStage = useWorkflowBuilderStore((s) => s.updateStage);
  const [tabs, setTabs] = useState<Partial<Record<StageKind, string>>>({});

  const stageIssues = useMemo(() => (stage ? allIssues.filter((i) => i.stageKey === stage.key) : []), [allIssues, stage]);
  const onUpdate = useCallback(
    (updates: StageUpdate) => {
      if (selectedNodeId) updateStage(selectedNodeId, updates);
    },
    [selectedNodeId, updateStage],
  );

  if (!stage && selectedEdgeId) return <EdgeInspector key={selectedEdgeId} edgeId={selectedEdgeId} />;
  if (!stage) return <WorkflowSettingsInspector tab={settingsTab} onTabChange={onSettingsTabChange} />;

  const kind = stage.kind;
  const tab = tabs[kind];
  const onTabChange = (next: string) => setTabs((t) => ({ ...t, [kind]: next }));
  // Keyed by stage so local drafts (key, JSON, names) reset on selection.
  return stage.kind === 'agent' ? (
    <AgentStageInspector key={stage.key} stage={stage} issues={stageIssues} onUpdate={onUpdate} tab={tab} onTabChange={onTabChange} />
  ) : (
    <KindStageInspector
      key={stage.key}
      stage={stage as OtherStageSpec}
      issues={stageIssues}
      onUpdate={onUpdate}
      tab={tab}
      onTabChange={onTabChange}
    />
  );
}
