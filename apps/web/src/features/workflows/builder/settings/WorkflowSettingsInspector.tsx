// ────────────────────────────────────────────────────────────────
// WorkflowSettingsInspector — what the builder's inspector shows with
// nothing selected (WorkflowSettingsPanel board):
//
//   eyebrow   "Workflow settings · Select a stage to edit it"
//   title     the workflow's name
//   subtitle  "6 stages · Published v7 · payments-service"
//   tabs      General · Project · Variables · Hooks · Tags · Budget, a count
//             per tab and a dot on a tab whose fields have errors
//
// Off the General tab, a "Default session" row summarises the workflow
// session and jumps to it.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import type { BuilderIssue } from '@/stores/workflowBuilderStore.js';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { useProjects } from '@/hooks/projectQueries.js';
import { useDefinitionVersions } from '@/hooks/workflowQueries.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import type { TabItem } from '@/ui/primitives/Tabs/Tabs.js';
import { Inspector } from '@/ui/patterns/Inspector/Inspector.js';
import { tabCount, useBuilderInspector, type SettingsTab } from '../inspector/InspectorShell.js';
import { BudgetTab } from './BudgetTab.js';
import { GeneralTab } from './GeneralTab.js';
import { HooksTab } from './HooksTab.js';
import { ProjectTab } from './ProjectTab.js';
import { TagsTab } from './TagsTab.js';
import { VariablesTab } from './VariablesTab.js';

export interface WorkflowSettingsInspectorProps {
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

/** The workflow-level JSON pointers each tab edits (for its error dot). */
const TAB_PATHS: Record<SettingsTab, readonly string[]> = {
  general: ['/workflow/name', '/workflow/description', '/workflow/session'],
  project: ['/workflow/projectId', '/workflow/lifecycle'],
  variables: ['/workflow/variables'],
  hooks: ['/workflow/hooks'],
  tags: ['/workflow/tags'],
  budget: ['/workflow/budget', '/workflow/maxParallel'],
};

function tabHasError(issues: readonly BuilderIssue[], tab: SettingsTab): boolean {
  return issues.some((i) => i.severity === 'error' && TAB_PATHS[tab].some((p) => i.path === p || i.path.startsWith(`${p}/`)));
}

const PERMISSION_SHORT: Record<string, string> = {
  default: 'Ask before tools',
  acceptEdits: 'Accept edits',
  plan: 'Plan only',
  bypassPermissions: 'Full access',
};

export function WorkflowSettingsInspector({ tab, onTabChange }: WorkflowSettingsInspectorProps) {
  const { close } = useBuilderInspector();
  const name = useWorkflowBuilderStore((s) => s.workflow.name);
  const stageCount = useWorkflowBuilderStore((s) => s.nodes.length);
  const variableCount = useWorkflowBuilderStore((s) => s.workflow.variables.length);
  const hookCount = useWorkflowBuilderStore((s) => s.workflow.hooks.length);
  const tagCount = useWorkflowBuilderStore((s) => s.workflow.tags.length);
  const projectId = useWorkflowBuilderStore((s) => s.workflow.projectId ?? null);
  const session = useWorkflowBuilderStore((s) => s.workflow.session);
  const issues = useWorkflowBuilderStore((s) => s.issues);
  const definitionId = useWorkflowBuilderStore((s) => s.definitionId);
  const status = useWorkflowBuilderStore((s) => s.status);
  const currentVersionId = useWorkflowBuilderStore((s) => s.currentVersionId);

  const { data: projects } = useProjects();
  const { data: versions } = useDefinitionVersions(definitionId ?? undefined, { enabled: !!currentVersionId });
  const liveVersion = versions?.find((v) => v.id === currentVersionId)?.version;
  const projectName = projectId ? projects?.find((p) => p.id === projectId)?.name : undefined;

  const state =
    status === 'published' || currentVersionId ? (liveVersion != null ? `Published v${liveVersion}` : 'Published') : 'Draft';
  const subtitle = [`${stageCount} ${stageCount === 1 ? 'stage' : 'stages'}`, state, projectName].filter(Boolean).join(' · ');

  const tabs: TabItem[] = [
    { value: 'general', label: 'General', count: tabCount(undefined, tabHasError(issues, 'general')) },
    { value: 'project', label: 'Project', count: tabCount(undefined, tabHasError(issues, 'project')) },
    { value: 'variables', label: 'Variables', count: tabCount(variableCount, tabHasError(issues, 'variables')) },
    { value: 'hooks', label: 'Hooks', count: tabCount(hookCount, tabHasError(issues, 'hooks')) },
    { value: 'tags', label: 'Tags', count: tabCount(tagCount, tabHasError(issues, 'tags')) },
    { value: 'budget', label: 'Budget', count: tabCount(undefined, tabHasError(issues, 'budget')) },
  ];

  const sessionSummary = [session.model ?? 'Default model', session.permissionMode ? PERMISSION_SHORT[session.permissionMode] : undefined]
    .filter(Boolean)
    .join(' · ');

  let body: ReactNode;
  switch (tab) {
    case 'project':
      body = <ProjectTab />;
      break;
    case 'variables':
      body = <VariablesTab />;
      break;
    case 'hooks':
      body = <HooksTab />;
      break;
    case 'tags':
      body = <TagsTab />;
      break;
    case 'budget':
      body = <BudgetTab />;
      break;
    default:
      body = <GeneralTab />;
  }

  return (
    <Inspector
      title={name || 'Untitled workflow'}
      label="Workflow settings"
      eyebrow={
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <Icon concept="settings" size={12} />
          <span>Workflow settings</span>
          <span className="ml-auto truncate">Select a stage to edit it</span>
        </span>
      }
      subtitle={subtitle}
      actions={<IconButton icon="x" size="sm" label="Close inspector" onClick={close} />}
      tabs={{ items: tabs, value: tab, onValueChange: (next) => onTabChange(next as SettingsTab) }}
    >
      {tab !== 'general' ? (
        <Button
          variant="secondary"
          fullWidth
          icon="agents"
          trailingIcon="chevron-right"
          onClick={() => onTabChange('general')}
          className="justify-start"
          title="Edit the workflow session on the General tab"
        >
          <span className="text-fg-3">Default session</span>
          <span className="min-w-0 flex-1 truncate text-left">{sessionSummary}</span>
        </Button>
      ) : null}
      {body}
    </Inspector>
  );
}
