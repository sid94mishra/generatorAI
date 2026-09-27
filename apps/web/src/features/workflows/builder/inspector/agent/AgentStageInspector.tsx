// ────────────────────────────────────────────────────────────────
// AgentStageInspector — the C-18 inspector of an agent stage
// (WorkflowStage* boards): Prompt · Session · Tools · Output · Policy ·
// Hooks, each with its count, and an error dot on a tab whose fields have
// errors (WorkflowValidate board). The stage's issues are listed at the top
// of the active tab; each control shows the issues of its own field.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import type { TabItem } from '@/ui/primitives/Tabs/Tabs.js';
import { StageIssueList } from '../../fields/FieldIssues.js';
import { StageInspectorShell, tabCount } from '../InspectorShell.js';
import type { AgentStageSpec, StageInspectorProps } from '../types.js';
import { AGENT_TABS, AGENT_TAB_LABELS, isAgentTab, tabsWithErrors, type AgentTab } from './agentTabs.js';
import { effectiveSession, enabledToolCount, useBoundAgent, useSessionCatalog } from './session/index.js';
import { HooksTab } from './tabs/HooksTab.js';
import { OutputTab } from './tabs/OutputTab.js';
import { PolicyTab } from './tabs/PolicyTab.js';
import { PromptTab } from './tabs/PromptTab.js';
import { SessionTab } from './tabs/SessionTab.js';
import { ToolsTab } from './tabs/ToolsTab.js';

/** Tools on for the stage session (skills + MCP servers + platform toggles). */
function useToolCount(stage: AgentStageSpec): number {
  const projectId = useWorkflowBuilderStore((s) => s.workflow.projectId ?? undefined);
  const workflowSession = useWorkflowBuilderStore((s) => s.workflow.session);
  const effective = useMemo(() => effectiveSession(stage.session, workflowSession), [stage.session, workflowSession]);
  const catalog = useSessionCatalog(projectId);
  const agent = useBoundAgent(effective.agentRef, projectId);
  return enabledToolCount({ session: stage.session, effective, scope: 'stage', catalog, agent });
}

export function AgentStageInspector({ stage, issues, onUpdate, tab, onTabChange }: StageInspectorProps<AgentStageSpec>) {
  const active: AgentTab = isAgentTab(tab) ? tab : 'prompt';
  const errorTabs = useMemo(() => tabsWithErrors(issues), [issues]);
  const toolCount = useToolCount(stage);

  const counts: Record<AgentTab, number | undefined> = {
    prompt: stage.prompts.length,
    session: undefined,
    tools: toolCount,
    output: stage.output.rules.length,
    policy: undefined,
    hooks: stage.hooks.length,
  };
  const tabs: TabItem[] = AGENT_TABS.map((t) => ({ value: t, label: AGENT_TAB_LABELS[t], count: tabCount(counts[t], errorTabs.has(t)) }));

  const props = { stage, onUpdate, issues };
  return (
    <StageInspectorShell stage={stage} tabs={tabs} tab={active} onTabChange={onTabChange}>
      <StageIssueList issues={issues} />
      {active === 'prompt' ? <PromptTab {...props} /> : null}
      {active === 'session' ? <SessionTab {...props} /> : null}
      {active === 'tools' ? <ToolsTab {...props} /> : null}
      {active === 'output' ? <OutputTab {...props} /> : null}
      {active === 'policy' ? <PolicyTab {...props} /> : null}
      {active === 'hooks' ? <HooksTab {...props} /> : null}
    </StageInspectorShell>
  );
}
