// Automation (MAutomationDetail, MAutomationWebhook; `/automations/[id]`): breadcrumb "Automations"; Edit and ⋯
// (Duplicate, Delete…); the Enabled switch with "Schedule · <project> · created …" and the live state; Run now (the one
// primary) and Run with dataset…; MB-40 strip over 30 days (executions, success, avg duration — each only when
// present) + the next run; Configuration rows (trigger + cron + zone / missed / overlap, workflows, permission,
// dataset, variables, retry — each opens the wizard on its page); webhook credentials for a webhook automation;
// Executions (status word, trigger source · progress, start) → the execution sheet.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { AutomationExecution } from '@generatorai/shared';

import { useAttentionLists } from '../../blocks/AttentionList';
import { AUTOMATIONS_HREF } from '../../blocks/shell/hrefs';
import { useBreadcrumb, useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { automationStatItems, useStatsSummary } from '../../blocks/StatsCards';
import { checkFeature } from '../../services/auth/featureGate';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { EntityRow } from '../../ui/layout/EntityRow';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { Screen } from '../../ui/layout/Screen';
import { StatStrip } from '../../ui/layout/StatStrip';
import { errorText, formatRelativeShort } from '../../ui/lib/format';
import type { MenuEntry } from '../../ui/native/Menu/Menu.types';
import { Header } from '../../ui/native/router/Header';
import { Switch } from '../../ui/native/Switch';
import { Button } from '../../ui/primitives/Button';
import { StatusBadge } from '../../ui/primitives/StatusBadge';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { WebhookCredentials } from './components/WebhookCredentials';
import { executionTime, nextRunLabel, sortExecutions, triggeredByLabel } from './model';
import { DEFAULT_RETRY, PERMISSION_LABEL, TRIGGER_LABEL, datasetLine, executionProgress, executionStatus, retryLine, triggerLine, type AutomationMenuId } from './model/automationsModel';
import { scheduleSummary } from './model/scheduleModel';
import { useAutomation, useAutomationWrites, useProjectsList, useWorkflowNames } from './queries';
import { executionHref, useAutomationActions } from './useAutomationActions';

type Href = Parameters<typeof router.push>[0];
const EXECUTIONS_SHOWN = 10;
const clock = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function AutomationDetailScreen(): React.ReactElement {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const onBack = useHeaderBack();
  const breadcrumb = useBreadcrumb(useMemo(() => [{ label: 'Automations', href: AUTOMATIONS_HREF }], []));
  const scopes = useGrantedScopes();
  const canEdit = scopes.includes('write:workflows');
  const canRun = checkFeature('runStart', scopes).available;
  const automation = useAutomation(id);
  const a = automation.data;
  const writes = useAutomationWrites();
  const act = useAutomationActions();
  const projects = useProjectsList();
  const { byId } = useWorkflowNames();
  const { needsYou, running } = useAttentionLists();
  // The 30-day window is fixed when the screen opens (a refetch keeps its cache key).
  const [range] = useState(() => ({ from: new Date(Date.now() - 30 * 86_400_000).toISOString(), to: new Date().toISOString(), automationId: id }));
  const stats = useStatsSummary(range, { enabled: Boolean(id) });

  const executions = useMemo(() => sortExecutions((a?.executions ?? []) as never[]) as unknown as AutomationExecution[], [a?.executions]);
  const executionIds = new Set(executions.map((e) => e.id));
  const mine = (i: { entity: string; entityId: string }): boolean => i.entity === 'automation_execution' && executionIds.has(i.entityId);
  const live = needsYou.some(mine) ? 'needs_you' : running.some(mine) ? 'running' : null;
  const projectName = a?.projectId ? ((projects.data ?? []).find((p) => p.id === a.projectId)?.name ?? 'Project') : 'All projects';
  const workflows = (a?.workflowIds ?? []).map((w) => byId.get(w));
  const edit = (page: number): void => {
    if (canEdit) router.push(`/automations/${encodeURIComponent(id)}/edit?page=${page}` as Href);
  };
  const menu: MenuEntry[] = canEdit
    ? [
        { id: 'duplicate', label: 'Duplicate', icon: 'copy' },
        { type: 'separator' },
        { id: 'delete', label: 'Delete…', icon: 'trash', destructive: true },
      ]
    : [];
  const header = (
    <Header
      role="detail"
      title={a?.name ?? 'Automation'}
      breadcrumb={breadcrumb}
      onBack={onBack}
      actions={[
        ...(canEdit && a ? [{ id: 'edit', icon: 'edit' as const, label: 'Edit', onPress: () => edit(0) }] : []),
        ...(menu.length && a ? [{ id: 'more', icon: 'more' as const, label: 'More', menu, onMenuSelect: (mid: string) => act(mid as AutomationMenuId, a) }] : []),
      ]}
    />
  );
  const state = automation.isLoading ? { kind: 'loading' as const } : automation.isError || !a ? { kind: 'error' as const, error: automation.error, onRetry: () => void automation.refetch(), title: "Couldn't load this automation" } : { kind: 'ready' as const };
  const statItems = stats.data ? automationStatItems(stats.data) : [];
  const next = a?.enabled ? nextRunLabel(a.nextRunAt as unknown as string) : null;

  return (
    <Screen header={header} state={state} onRefresh={async () => void (await automation.refetch())} testID="automation-detail">
      {a ? (
        <View className="gap-5 pb-8 pt-2">
          <View className="gap-3 px-4">
            <View className="flex-row items-center gap-3">
              <Switch value={a.enabled} onValueChange={(v) => writes.setEnabled(a.id, v).catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }))} label="Enabled" disabled={!canEdit} testID="automation-enabled" />
              <View className="flex-1">
                <Text role="subhead" weight={600}>
                  {a.enabled ? 'Enabled' : 'Disabled'}
                </Text>
                <Text role="footnote" tone="fg-3" numberOfLines={1}>
                  {[TRIGGER_LABEL[a.triggerType], projectName, `created ${formatRelativeShort(String(a.createdAt))} ago`].join(' · ')}
                </Text>
              </View>
              {live ? <StatusBadge state={live} size="sm" /> : null}
            </View>
            {canRun ? (
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Button label="Run now" icon="play" variant="primary" fullWidth onPress={() => act('run', a)} testID="automation-run" />
                </View>
                <View className="flex-1">
                  <Button label="Run with dataset…" icon="database" fullWidth onPress={() => act('run-dataset', a)} testID="automation-run-dataset" />
                </View>
              </View>
            ) : null}
          </View>
          {statItems.length || next ? (
            <View className="px-4">
              <StatStrip variant="strip" items={[...statItems.map((s) => (s.id === 'runs' ? { ...s, label: 'Executions · 30d' } : s)), ...(next ? [{ id: 'next', value: next.replace(/^Next run in /, '').split(' · ')[0] ?? '', label: 'Next run' }] : [])]} testID="automation-stats" />
            </View>
          ) : null}
          <ListSection title="Configuration">
            <ListRow kind="navigation" icon="clock" title="Trigger" value={a.triggerType === 'schedule' ? scheduleSummary(a.cronExpression) : triggerLine(a)} subtitle={a.triggerType === 'schedule' ? [a.cronExpression, a.timezone, `missed: ${a.missedRunPolicy === 'run_once' ? 'run once' : 'skip'}`, `overlap: ${a.overlapPolicy ?? 'skip'}`].filter(Boolean).join(' · ') : undefined} onPress={() => edit(1)} />
            <ListRow kind="navigation" icon="workflows" title="Workflow" value={workflows.map((w) => w?.name).filter(Boolean).join(', ') || `${a.workflowIds.length}`} {...(workflows[0]?.stageCount ? { subtitle: `${workflows[0].stageCount} stages` } : {})} onPress={() => edit(2)} />
            <ListRow kind="navigation" icon="shield" title="Permission" value={PERMISSION_LABEL[a.permissionMode]} subtitle="Every run uses this mode" onPress={() => edit(2)} />
            <ListRow kind="navigation" icon="database" title="Dataset" value={`${datasetLine(a)} · concurrency ${a.maxConcurrency}`} {...(a.dataSchema?.fields.length ? { subtitle: `${a.dataSchema.fields.map((f) => `${f.name}: ${f.type}`).join(', ')} · on error ${a.onError}` } : {})} onPress={() => edit(3)} />
            <ListRow kind="navigation" icon="variable" title="Variables" value={`${Object.keys(a.variables ?? {}).length} base variables`} {...(Object.keys(a.variables ?? {}).length ? { subtitle: Object.entries(a.variables).map(([k, v]) => `${k}=${String(v)}`).join(' · ') } : {})} onPress={() => edit(4)} />
            <ListRow kind="navigation" icon="retry" title="Retry" value={a.retryPolicy ? `Up to ${a.retryPolicy.maxAttempts} attempts` : 'No retries'} {...(a.retryPolicy ? { subtitle: retryLine(a.retryPolicy ?? DEFAULT_RETRY) } : {})} onPress={() => edit(4)} />
          </ListSection>
          {a.triggerType === 'webhook' ? <WebhookCredentials automationId={a.id} fields={a.dataSchema?.fields ?? []} canEdit={canEdit} /> : null}
          <ListSection title="Executions" count={executions.length}>
            {executions.length === 0 ? <ListRow kind="info" title="Never run" subtitle="Run it now, or wait for its trigger." /> : null}
            {executions.slice(0, EXECUTIONS_SHOWN).map((e) => {
              const s = executionStatus(e.status);
              const t = executionTime(e as never);
              return (
                <EntityRow
                  key={e.id}
                  title={s.label}
                  leading={{ status: s.state }}
                  meta={[triggeredByLabel(e.triggeredBy), ...(executionProgress(e) ? [executionProgress(e)!] : []), ...(e.error ? [e.error] : [])]}
                  trailing={t ? <Text role="monoSm" tone="fg-3">{clock.format(new Date(t))}</Text> : undefined}
                  onPress={() => router.push(executionHref(a.id, e.id) as Href)}
                  testID={`automation-execution-${e.id}`}
                />
              );
            })}
          </ListSection>
        </View>
      ) : null}
    </Screen>
  );
}
