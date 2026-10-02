// Execution (MAutomationExecution; `/automations/[id]/executions/[executionId]`, a route sheet, MD-21): the status
// with how long it has waited or run, one progress segment per iteration, the trigger source · start · "2 of 3
// finalized", permission · dataset; Iterations — the row's variables (mono), its run (status word) which closes this
// sheet and opens the run, and "Review" when that run needs you (closes this sheet, then presents the approval — never
// two sheets, MD-62). Cancel execution… while it is active. Not rendered (no API, MD-27): aggregated changes, event log.
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { resolveStatus, type AutomationExecutionRun } from '@generatorai/shared';

import { useAttentionLists, useOpenAttentionItem } from '../../blocks/AttentionList';
import { runHref } from '../../blocks/shell/hrefs';
import { ListSection } from '../../ui/layout/ListSection';
import { errorText, formatElapsed } from '../../ui/lib/format';
import { confirm } from '../../ui/native/AlertDialog';
import { RouteSheet } from '../../ui/native/Sheet';
import { Button } from '../../ui/primitives/Button';
import { Card } from '../../ui/primitives/Card';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Pressable } from '../../ui/primitives/Pressable';
import { ProgressSegments } from '../../ui/primitives/ProgressSegments';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { StatusBadge } from '../../ui/primitives/StatusBadge';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { isExecutionActive, toMs, triggeredByLabel } from './model';
import { PERMISSION_LABEL, datasetLine, executionProgress, executionStatus } from './model/automationsModel';
import { useAutomation, useAutomationWrites, useExecution } from './queries';

type Href = Parameters<typeof router.push>[0];

/** A clock for a running execution's duration; idle once it ends. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}
const clock = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function variablesLine(run: AutomationExecutionRun): string {
  if (run.iterationLabel) return run.iterationLabel;
  const vars = run.iterationVariables ?? {};
  return Object.entries(vars).map(([k, v]) => `${k} = ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ') || `Iteration ${run.iterationIndex + 1}`;
}

export default function ExecutionScreen(): React.ReactElement {
  const { id = '', executionId = '' } = useLocalSearchParams<{ id: string; executionId: string }>();
  const navigation = useNavigation();
  const execution = useExecution(id, executionId);
  const automation = useAutomation(id);
  const writes = useAutomationWrites();
  const { needsYou } = useAttentionLists();
  const openItem = useOpenAttentionItem();
  const e = execution.data;
  const a = automation.data;
  const close = (): void => {
    if (router.canGoBack()) router.back();
  };
  const runs = useMemo(() => [...(e?.runs ?? [])].sort((x, y) => x.iterationIndex - y.iterationIndex), [e?.runs]);
  const status = e ? executionStatus(e.status) : null;
  const started = e ? (toMs(e.startedAt as unknown as string) ?? toMs(e.createdAt as unknown as string)) : null;
  const ended = e ? toMs(e.completedAt as unknown as string) : null;
  const now = useNow(Boolean(e && isExecutionActive(e.status)));
  const duration = started ? formatElapsed((ended ?? now) - started) : null;
  const waiting = runs.some((r) => needsYou.some((i) => i.entity === 'workflow_run' && i.entityId === r.workflowRunId));

  const cancel = (): void =>
    void confirm({ title: 'Cancel this execution?', message: 'Iterations still running are cancelled; finished ones keep their results.', confirmLabel: 'Cancel execution' }).then((ok) => {
      if (ok) writes.cancelExecution(id, executionId).catch((err: unknown) => toast({ kind: 'error', message: errorText(err) }));
    });

  let body: React.ReactNode;
  if (execution.isLoading) body = <Skeleton preset="card" />;
  else if (execution.isError || !e) body = <ErrorState title="Couldn't load this execution" error={execution.error} onRetry={() => void execution.refetch()} />;
  else
    body = (
      <View className="gap-4">
        <Card radius="group">
          <View className="gap-2">
            <View className="flex-row items-center gap-2">
              <StatusBadge state={waiting ? 'needs_you' : status!.state} label={waiting ? undefined : status!.label} size="sm" />
              <View className="flex-1" />
              {duration ? (
                <Text role="monoSm" tone="fg-2">
                  {duration}
                </Text>
              ) : null}
            </View>
            {runs.length ? (
              <ProgressSegments segments={runs.map((r) => ({ state: (resolveStatus('automationRunItem', r.status)?.state ?? 'queued'), label: variablesLine(r) }))} />
            ) : null}
            <Text role="footnote" tone="fg-2">
              {[triggeredByLabel(e.triggeredBy), started ? `started ${clock.format(new Date(started))}` : null, executionProgress(e)].filter(Boolean).join(' · ')}
            </Text>
            {a ? (
              <Text role="footnote" tone="fg-3">
                {[PERMISSION_LABEL[a.permissionMode], `Dataset ${datasetLine(a)}`, `concurrency ${a.maxConcurrency}`].join(' · ')}
              </Text>
            ) : null}
            {e.error ? (
              <Text role="footnote" tone="err">
                {e.error}
              </Text>
            ) : null}
          </View>
        </Card>
        <ListSection title="Iterations" count={runs.length} footer={runs.length ? 'One run per dataset row.' : 'No runs started yet.'}>
          {runs.map((r) => {
            const s = resolveStatus('automationRunItem', r.status);
            const item = needsYou.find((i) => i.entity === 'workflow_run' && i.entityId === r.workflowRunId);
            const open = (): void => {
              if (!r.workflowRunId) return;
              close();
              router.push(runHref(r.workflowDefinitionId, r.workflowRunId) as Href);
            };
            return (
              <Pressable key={r.id} onPress={open} disabled={!r.workflowRunId} accessibilityRole="button" accessibilityLabel={`Iteration ${r.iterationIndex + 1}, ${variablesLine(r)}, ${item ? 'needs you' : (s?.label ?? r.status)}`} className="min-h-row-2 flex-row items-center gap-3 px-4 py-3">
                <Text role="monoSm" tone="fg-3">
                  {String(r.iterationIndex + 1)}
                </Text>
                <View className="flex-1 gap-1">
                  <Text role="mono" numberOfLines={1}>
                    {variablesLine(r)}
                  </Text>
                  <StatusBadge state={item ? 'needs_you' : (s?.state ?? 'queued')} {...(item ? {} : s ? { label: s.label } : {})} size="sm" {...(r.attemptCount && r.attemptCount > 1 ? { detail: `attempt ${r.attemptCount}` } : {})} />
                </View>
                {item ? (
                  <Button
                    label="Review"
                    size="sm"
                    variant="primary"
                    onPress={() => {
                      close();
                      openItem(item);
                    }}
                    testID={`execution-review-${r.id}`}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </ListSection>
      </View>
    );

  return (
    <RouteSheet
      title={status ? `Execution · ${status.label}` : 'Execution'}
      {...(a ? { subtitle: a.name } : {})}
      onDismiss={close}
      scrollable
      navigation={navigation as never}
      {...(e && isExecutionActive(e.status) ? { footer: <Button label="Cancel execution" icon="x" variant="destructive" size="lg" fullWidth onPress={cancel} testID="execution-cancel" /> } : {})}
      testID="automation-execution"
    >
      {body}
    </RouteSheet>
  );
}
