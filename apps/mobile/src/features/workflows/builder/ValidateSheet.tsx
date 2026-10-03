// Validation results (`/workflows/[id]/edit/validate`; MWorkflowValidate; MB-37): validates the builder draft when it
// opens (and on "Check again"); "Go to" selects the stage in the list and closes. Quick fixes need MG-33.
import React, { useEffect } from 'react';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';

import { ValidationList } from '../../../blocks/ValidationList';
import { RouteSheet } from '../../../ui/native/Sheet';
import { useBuilderStore } from './builderStore';
import { useBuilderDraft, useValidateDraft } from './useBuilderDraft';

const close = (): void => {
  if (router.canGoBack()) router.back();
};

export default function ValidateSheet(): React.ReactElement {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const { draft } = useBuilderDraft(id);
  const { validate, loading, error } = useValidateDraft(id);
  const ready = Boolean(draft);
  useEffect(() => {
    if (ready) void validate();
    // Validate once when the draft is there; "Check again" re-runs it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  const stages = draft?.graph.stages ?? [];
  return (
    <RouteSheet title="Validation" onDismiss={close} scrollable navigation={navigation as never} testID="validate-sheet">
      <ValidationList
        issues={draft?.validation?.issues ?? null}
        loading={loading || !ready}
        checkedAt={draft?.validation?.at ?? null}
        stageKeys={stages.map((s) => s.key)}
        stageName={(key) => stages.find((s) => s.key === key)?.name ?? key}
        onRecheck={() => void validate()}
        onGoTo={(key) => {
          const store = useBuilderStore.getState();
          store.select(id, key);
          store.setView(id, 'list');
          close();
        }}
        error={error}
      />
    </RouteSheet>
  );
}
