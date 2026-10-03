// Run workflow (MWorkflowLaunch; `/workflows/[id]/run`, a route sheet, MD-21; footer actions, MD-85): the declared
// inputs (MB-36 VariableForm); the footer's filled action is Run for a published workflow or Test run for a draft
// (MD-22), Test run also offered beside Run when the published workflow has unpublished changes. A missing required
// input disables the filled action and says why; one idempotency key per intent (a double tap or a retry never
// starts two runs); success replaces the sheet with the new run (MD-80). The server's refusal (issues) shows in
// the sheet.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';

import { runHref, workflowHref } from '../../blocks/shell/hrefs';
import { VariableForm, buildVariables, firstMissing, initialDraft, parseVariables, type Draft } from '../../blocks/VariableForm';
import { useIdempotencyKey } from '../../services/api/useIdempotencyKey';
import { errorText } from '../../ui/lib/format';
import { RouteSheet } from '../../ui/native/Sheet';
import { haptic } from '../../ui/platform/haptics';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Icon } from '../../ui/primitives/Icon';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { invocationBody, issueLines, runActions } from './model/runSheetModel';
import { versionChip } from './model/workflowsModel';
import { useDefinitionVersions, useInvokeWorkflow, useWorkflow } from './queries';

type Href = Parameters<typeof router.replace>[0];

export default function RunSheet(): React.ReactElement {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const workflow = useWorkflow(id);
  const versions = useDefinitionVersions(id);
  const invoke = useInvokeWorkflow(id);
  const idempotency = useIdempotencyKey();
  const record = workflow.data;
  const graph = record?.graph;
  const defs = useMemo(() => parseVariables(graph?.workflow.variables), [graph]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const values = draft ?? initialDraft(defs);
  const [submitted, setSubmitted] = useState(false);
  const built = buildVariables(defs, values);
  const missing = firstMissing(defs, values);
  const actions = record ? runActions(record) : null;
  const chip = record ? versionChip(record, versions.data) : null;

  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(workflowHref(id) as Href);
  };
  const start = (test: boolean): void => {
    setSubmitted(true);
    if (!built.valid) return;
    invoke.mutate(
      { body: invocationBody(id, { variables: built.variables, test }), idempotencyKey: idempotency.get() },
      {
        onSettled: (_r, e) => idempotency.settle(e ?? undefined),
        onSuccess: (r) => {
          haptic('success');
          router.replace(runHref(id, r.runId) as Href);
        },
      },
    );
  };

  const issues = invoke.error ? issueLines(invoke.error) : [];
  const footer = actions ? (
    <View className="gap-2">
      <View className="flex-row gap-2">
        {actions.secondaryTest ? (
          <View className="flex-1">
            <Button label="Test run" size="lg" fullWidth disabled={invoke.isPending || Boolean(missing)} onPress={() => start(true)} testID="run-sheet-test" />
          </View>
        ) : null}
        <View className="flex-1">
          <Button
            label={actions.primary === 'test' ? 'Test run' : 'Run'}
            icon="play"
            variant="primary"
            size="lg"
            fullWidth
            loading={invoke.isPending}
            disabled={invoke.isPending || Boolean(missing)}
            {...(missing ? { disabledReason: `${missing} is required` } : {})}
            onPress={() => start(actions.primary === 'test')}
            testID="run-sheet-run"
          />
        </View>
      </View>
      <View className="flex-row items-center justify-center gap-1">
        <Icon concept="info" size={12} tone="fg-3" />
        <Text role="caption" tone="fg-3">
          {missing ? `${missing} is required.` : actions.primary === 'test' ? 'A draft runs its current graph as a test run.' : `Published workflows run ${chip?.suffix ?? 'the published version'}.`}
        </Text>
      </View>
    </View>
  ) : undefined;

  return (
    <RouteSheet
      title={actions?.primary === 'test' ? 'Test run' : 'Run workflow'}
      {...(graph ? { subtitle: `${graph.workflow.name}${chip?.suffix ? ` · ${chip.suffix}` : ''}` } : {})}
      onDismiss={close}
      scrollable
      dirty={draft !== null && !invoke.isSuccess}
      navigation={navigation as never}
      {...(footer ? { footer } : {})}
      testID="run-sheet"
    >
      <View className="gap-4 pb-4">
        {workflow.isLoading ? (
          <Skeleton preset="list" count={4} />
        ) : !record || !graph ? (
          <ErrorState title="Couldn't load this workflow" error={workflow.error} onRetry={() => void workflow.refetch()} />
        ) : (
          <>
            {invoke.isError ? <Callout tone="err" title="The run didn't start" body={issues.length ? issues.join('\n') : errorText(invoke.error)} /> : null}
            {defs.length ? (
              <VariableForm variables={defs} draft={values} onChange={(name, value) => setDraft({ ...values, [name]: value })} errors={submitted ? built.errors : {}} footer={`${defs.length} typed`} testIDPrefix="run-var" />
            ) : (
              <View className="flex-row items-center gap-2 px-4">
                <Icon concept="variable" size={14} tone="fg-3" />
                <Text role="footnote" tone="fg-3">
                  This workflow takes no inputs.
                </Text>
              </View>
            )}
          </>
        )}
      </View>
    </RouteSheet>
  );
}
