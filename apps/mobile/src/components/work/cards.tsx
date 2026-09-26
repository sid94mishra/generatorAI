// ────────────────────────────────────────────────────────────────
// Work rows — run, workflow, automation and agent rows.
//
// Flat `ListItem` rows (design spec: lists are rows, not bordered cards).
// The leading avatar carries state; a trailing badge appears only for a
// non-default state. Every row takes an optional `accessory` (a trailing
// control such as an enable switch) and `separator` (hairline under it).
//
// The `*Card` names are kept so call sites do not churn.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { router } from 'expo-router';
import { Bot, Clock, Network, Play, Webhook, Workflow as WorkflowIcon } from 'lucide-react-native';
import type { AgentSummary, AutomationSummary, WorkflowRunSummary, WorkflowSummary } from '@generatorai/client-core';

import { relativeTime, runElapsed, formatDuration } from '../runs/formatTime';
import { isActive, needsAttention, statusLabel } from '../runs/statusStyle';
import { ListItem, TONE_COLOR_TOKEN } from '../ui/ListItem';
import type { Tone } from '../ui/primitives';
import { runRoute } from '../../navigation/routes';
import { newestRun, runTitle } from '../runs/runModel';
import { useTheme } from '../../theme/ThemeProvider';

export function runTone(status: string): Tone {
  if (needsAttention(status)) return status === 'failed' ? 'danger' : 'warning';
  if (isActive(status)) return 'info';
  if (status === 'completed') return 'success';
  return 'neutral';
}

/** Shared props for every work row. */
export interface WorkRowProps {
  /** Trailing control (e.g. an enable switch). Presses in it do not open the row. */
  accessory?: React.ReactNode;
  /** Hairline under the row. Default true. */
  separator?: boolean;
}

const TRIGGER_LABEL: Record<AutomationSummary['triggerType'], string> = {
  manual: 'Manual',
  schedule: 'Scheduled',
  webhook: 'Webhook',
};

export function RunCard({ run, accessory, separator }: { run: WorkflowRunSummary } & WorkRowProps): React.ReactElement {
  const { colors } = useTheme();
  const tone = runTone(run.status);
  const active = isActive(run.status);
  const blocked = needsAttention(run.status) && run.status !== 'failed';
  const elapsed = runElapsed(run, active ? null : run.updatedAt);
  const status = statusLabel(run.status);

  // One status signal: live states get the avatar dot and say so in the
  // subtitle; settled non-success states get a badge; success gets neither.
  const showBadge = !active && !blocked && tone !== 'success';
  const subtitle = run.error
    ? run.error
    : [active || blocked ? status : null, elapsed !== null ? `ran ${formatDuration(elapsed)}` : null]
        .filter(Boolean)
        .join(' · ') || status;

  return (
    <ListItem
      title={runTitle(run.name)}
      subtitle={subtitle}
      subtitleTone={run.error ? 'danger' : 'muted'}
      meta={relativeTime(run.updatedAt)}
      avatar={{
        icon: <Play size={17} color={colors[TONE_COLOR_TOKEN[tone]]} />,
        tone,
        indicator: active ? 'info' : blocked ? 'warning' : null,
      }}
      badge={showBadge ? { label: status, tone } : null}
      accessory={accessory}
      separator={separator}
      accessibilityLabel={`${runTitle(run.name, 'Run')}, ${status}`}
      onPress={() => router.push(runRoute(run.id) as never)}
    />
  );
}

export function WorkflowCard({
  workflow,
  runs,
  accessory,
  separator,
}: {
  workflow: WorkflowSummary;
  runs: WorkflowRunSummary[];
} & WorkRowProps): React.ReactElement {
  const { colors } = useTheme();
  const mine = runs.filter((r) => r.workflowDefinitionId === workflow.id);
  const latest = newestRun(mine);
  const latestTone = latest ? runTone(latest.status) : 'neutral';
  const latestActive = latest ? isActive(latest.status) : false;

  const runsText = `${mine.length} run${mine.length === 1 ? '' : 's'}`;
  return (
    <ListItem
      title={workflow.name}
      subtitle={workflow.description ? `${runsText} · ${workflow.description}` : runsText}
      meta={latest ? relativeTime(latest.updatedAt) : null}
      avatar={{
        icon: <WorkflowIcon size={17} color={colors['muted-foreground']} />,
        tone: 'neutral',
        indicator: latestActive ? 'info' : latestTone === 'warning' ? 'warning' : null,
      }}
      badge={
        latestTone === 'danger'
          ? { label: 'Last run failed', tone: 'danger' }
          : workflow.status === 'draft'
            ? { label: 'Draft', tone: 'neutral' }
            : null
      }
      accessory={accessory}
      separator={separator}
      accessibilityLabel={
        latest ? `${workflow.name}, ${runsText}, last run ${statusLabel(latest.status)}` : `${workflow.name}, ${runsText}`
      }
      onPress={() => router.push(`/workflows/${workflow.id}`)}
    />
  );
}

export function AutomationCard({
  automation,
  accessory,
  separator,
}: { automation: AutomationSummary } & WorkRowProps): React.ReactElement {
  const { colors } = useTheme();
  const TriggerIcon =
    automation.triggerType === 'schedule' ? Clock : automation.triggerType === 'webhook' ? Webhook : Play;
  const trigger = TRIGGER_LABEL[automation.triggerType] ?? automation.triggerType;

  return (
    <ListItem
      title={automation.name}
      subtitle={`${trigger} · ${automation.lastRunAt ? `last ran ${relativeTime(automation.lastRunAt)}` : 'never run'}`}
      avatar={{
        icon: <TriggerIcon size={17} color={colors['muted-foreground']} />,
        tone: 'neutral',
      }}
      // "On" is the default state and says nothing; only "Off" earns a badge.
      badge={automation.enabled ? null : { label: 'Off', tone: 'neutral' }}
      accessory={accessory}
      separator={separator}
      accessibilityLabel={`${automation.name}, ${trigger}, ${automation.enabled ? 'on' : 'off'}`}
      onPress={() => router.push(`/automations/${automation.id}`)}
    />
  );
}

const SCOPE_LABEL: Record<AgentSummary['scope'], string> = {
  system: 'Built-in',
  global: 'Global',
  project: 'Project',
};

/** A human label for an agent's scope — also the section label when a list groups by scope. */
export function agentScopeLabel(scope: AgentSummary['scope']): string {
  return SCOPE_LABEL[scope] ?? scope;
}

export function AgentCard({
  agent,
  onPress,
  accessory,
  separator,
  showScope = true,
}: {
  agent: AgentSummary;
  onPress: () => void;
  /** Omit the scope from the subtitle when the list is already grouped by it. */
  showScope?: boolean;
} & WorkRowProps): React.ReactElement {
  const { colors } = useTheme();
  const orchestrator = agent.role === 'orchestrator';
  const Icon = orchestrator ? Network : Bot;
  const facts = [showScope ? agentScopeLabel(agent.scope) : null, agent.description || null].filter(Boolean).join(' · ');

  return (
    <ListItem
      title={agent.name}
      subtitle={facts || agent.slug}
      titleBadge={orchestrator ? { label: 'Orchestrator' } : null}
      avatar={{ icon: <Icon size={17} color={colors['muted-foreground']} />, tone: 'neutral' }}
      badge={agent.enabled ? null : { label: 'Disabled', tone: 'neutral' }}
      accessory={accessory}
      separator={separator}
      accessibilityLabel={`${agent.name}, ${agent.scope} ${agent.role}${agent.enabled ? '' : ', disabled'}`}
      {...(agent.description ? { accessibilityHint: agent.description } : {})}
      onPress={onPress}
    />
  );
}
