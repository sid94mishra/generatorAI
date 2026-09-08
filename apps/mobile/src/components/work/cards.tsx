// ────────────────────────────────────────────────────────────────
// Work rows — run, workflow, automation and agent cards.
//
// Moved out of the Work screen so the same rows can be rendered by the
// Home queue, the workflow detail and the Projects › Agents segment
// without three copies drifting.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Bot, Clock, Play, Webhook, Workflow as WorkflowIcon } from 'lucide-react-native';
import type { AgentSummary, AutomationSummary, WorkflowRunSummary, WorkflowSummary } from '@generatorai/client-core';

import { relativeTime, runElapsed, formatDuration } from '../runs/formatTime';
import { isActive, needsAttention, statusLabel } from '../runs/statusStyle';
import { Badge, Card, StatusDot, type Tone } from '../ui/primitives';
import { Touchable } from '../ui/Touchable';
import { runRoute } from '../../navigation/routes';
import { useTheme } from '../../theme/ThemeProvider';

export function runTone(status: string): Tone {
  if (needsAttention(status)) return status === 'failed' ? 'danger' : 'warning';
  if (isActive(status)) return 'info';
  if (status === 'completed') return 'success';
  return 'neutral';
}

export function RunCard({ run }: { run: WorkflowRunSummary }): React.ReactElement {
  const tone = runTone(run.status);
  const elapsed = runElapsed(run, isActive(run.status) ? null : run.updatedAt);

  return (
    <Touchable
      accessibilityLabel={`${run.name ?? 'Run'}, ${statusLabel(run.status)}`}
      haptic="tap"
      scale="large"
      onPress={() => router.push(runRoute(run.id) as never)}
    >
      <Card className={`gap-2 p-3.5 ${needsAttention(run.status) ? 'border-warning' : ''}`}>
        <View className="flex-row items-center gap-2">
          <StatusDot tone={tone} label={null} />
          <Text numberOfLines={1} className="flex-1 text-md font-medium text-foreground">
            {run.name ?? 'Workflow run'}
          </Text>
          <Badge label={statusLabel(run.status)} tone={tone} />
        </View>
        <Text numberOfLines={1} className="text-xs text-muted-foreground">
          {relativeTime(run.updatedAt)}
          {elapsed !== null ? ` · ran ${formatDuration(elapsed)}` : ''}
        </Text>
        {run.error ? (
          <Text numberOfLines={2} className="text-xs text-danger">
            {run.error}
          </Text>
        ) : null}
      </Card>
    </Touchable>
  );
}

export function WorkflowCard({
  workflow,
  runs,
}: {
  workflow: WorkflowSummary;
  runs: WorkflowRunSummary[];
}): React.ReactElement {
  const { colors } = useTheme();
  const mine = runs.filter((r) => r.workflowDefinitionId === workflow.id);
  const latest = mine[0];

  return (
    <Touchable
      accessibilityLabel={workflow.name}
      haptic="tap"
      scale="large"
      onPress={() => router.push(`/workflows/${workflow.id}`)}
    >
      <Card className="flex-row items-center gap-3 p-3.5">
        <View className="h-9 w-9 items-center justify-center rounded-2xl bg-subtle">
          <WorkflowIcon size={16} color={colors['muted-foreground']} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text numberOfLines={1} className="text-md font-medium text-foreground">
            {workflow.name}
          </Text>
          <Text numberOfLines={1} className="text-xs text-muted-foreground">
            {mine.length} run{mine.length === 1 ? '' : 's'}
            {latest ? ` · last ${relativeTime(latest.updatedAt)}` : ''}
          </Text>
        </View>
        {latest ? (
          <StatusDot tone={runTone(latest.status)} label={`Last run ${statusLabel(latest.status)}`} />
        ) : null}
      </Card>
    </Touchable>
  );
}

export function AutomationCard({ automation }: { automation: AutomationSummary }): React.ReactElement {
  const { colors } = useTheme();
  const TriggerIcon =
    automation.triggerType === 'schedule' ? Clock : automation.triggerType === 'webhook' ? Webhook : Play;

  return (
    <Touchable
      accessibilityLabel={automation.name}
      haptic="tap"
      scale="large"
      onPress={() => router.push(`/automations/${automation.id}`)}
    >
      <Card className="flex-row items-center gap-3 p-3.5">
        <View className="h-9 w-9 items-center justify-center rounded-2xl bg-subtle">
          <TriggerIcon size={16} color={colors['muted-foreground']} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text numberOfLines={1} className="text-md font-medium text-foreground">
            {automation.name}
          </Text>
          <Text numberOfLines={1} className="text-xs text-muted-foreground">
            {automation.triggerType}
            {automation.lastRunAt ? ` · last ran ${relativeTime(automation.lastRunAt)}` : ' · never run'}
          </Text>
        </View>
        <Badge label={automation.enabled ? 'On' : 'Off'} tone={automation.enabled ? 'success' : 'neutral'} />
      </Card>
    </Touchable>
  );
}

export function AgentCard({ agent, onPress }: { agent: AgentSummary; onPress: () => void }): React.ReactElement {
  const { colors } = useTheme();
  return (
    <Touchable
      accessibilityLabel={`${agent.name}, ${agent.scope} ${agent.role}${agent.enabled ? '' : ', disabled'}`}
      accessibilityHint={agent.description || undefined}
      haptic="tap"
      scale="large"
      onPress={onPress}
    >
      <Card className="flex-row items-center gap-3 p-3.5">
        <View className="h-9 w-9 items-center justify-center rounded-2xl bg-subtle">
          <Bot size={16} color={agent.enabled ? colors.primary : colors['muted-foreground']} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text numberOfLines={1} className="text-md font-medium text-foreground">
            {agent.name}
          </Text>
          <Text numberOfLines={2} className="text-xs text-muted-foreground">
            {agent.description || `${agent.scope} · ${agent.role}`}
          </Text>
        </View>
        <Badge
          label={agent.role === 'orchestrator' ? 'Orchestrator' : agent.scope}
          tone={agent.role === 'orchestrator' ? 'primary' : 'neutral'}
        />
      </Card>
    </Touchable>
  );
}
