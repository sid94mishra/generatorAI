// The inline control on an activity row — desktop's Stop / Cancel / Restart.
// A component (not a prop on the card) because each kind needs its own
// mutation hook, and only rows that offer an action should pay for one.

import React, { useState } from 'react';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@generatorai/client-core';

import { useApi } from '../../api/useApi';
import { useRunMutations } from '../../api/useRunControl';
import { useFeature } from '../runs/useFeature';
import { ConfirmSheet } from '../ui/ActionSheet';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { haptics } from '../ui/haptics';
import type { OperationActionDef } from './operationActions';

export function OperationAction({ action, name }: { action: OperationActionDef; name: string }): React.ReactElement | null {
  return action.kind === 'stop-chat' ? <StopChat chatId={action.id} /> : <RunAction action={action} name={name} />;
}

function StopChat({ chatId }: { chatId: string }): React.ReactElement {
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const stop = useMutation({
    mutationFn: () => api.chats.cancel(chatId),
    onSuccess: () => {
      haptics.commit();
      void queryClient.invalidateQueries({ queryKey: queryKeys.health() });
    },
    onError: () => {
      haptics.error();
      toast({ message: 'Could not stop that chat.', tone: 'error' });
    },
  });
  return (
    <Button
      label="Stop"
      variant="secondary"
      size="sm"
      loading={stop.isPending}
      disabled={stop.isPending}
      accessibilityLabel="Stop this chat's turn"
      onPress={() => stop.mutate()}
    />
  );
}

function RunAction({ action, name }: { action: OperationActionDef; name: string }): React.ReactElement | null {
  // Cancel is a run command; retry forks a new run (an invocation).
  const gate = useFeature(action.kind === 'cancel-run' ? 'runControl' : 'runStart');
  const { runAction } = useRunMutations(action.id);
  const [confirm, setConfirm] = useState(false);
  // Without the permission the row still opens the run, where the reason and
  // "Request access" live; a dead button here would only be noise.
  if (!gate.available) return null;

  const run = (): void => {
    runAction.mutate(action.kind === 'cancel-run' ? 'cancel' : 'retry', {
      onSuccess: ({ newRunId }) => {
        if (newRunId) router.push(`/runs/${newRunId}` as never);
      },
    });
  };

  return (
    <>
      <Button
        label={action.label}
        variant="secondary"
        size="sm"
        loading={runAction.isPending}
        disabled={runAction.isPending}
        accessibilityLabel={`${action.label} ${name}`}
        onPress={() => {
          if (action.confirm) {
            haptics.warn();
            setConfirm(true);
          } else run();
        }}
      />
      <ConfirmSheet
        visible={confirm}
        onClose={() => setConfirm(false)}
        title="Cancel this run?"
        message="Running stages stop and nothing after them starts. You can retry it later as a new run."
        confirmLabel="Cancel run"
        onConfirm={() => {
          setConfirm(false);
          run();
        }}
      />
    </>
  );
}
