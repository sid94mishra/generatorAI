// ────────────────────────────────────────────────────────────────
// WaitDecisionCard — an approval wait (P05 §4.3), or a decision of a
// sub-workflow child mirrored into its parent (P05 §4.2).
//
// The ApprovalCard's visual language: the question, the wait's form (plain
// fields for text, numbers, choices and yes/no; a JSON field otherwise),
// Approve and Reject. Both are the `approve` run command (outcome approved
// or rejected, the form as `data`), sent to THIS run: the server routes a
// mirrored decision to the child run that owns it and validates the form.
// An event wait shows its key and, with a callback, where CI posts it.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@generatorai/client-core';

import { useAdminApi } from '../../api/useAdminApi';
import { haptics } from '../ui/haptics';
import { Button } from '../ui/Button';
import { Field } from '../ui/Form';
import { Chip } from '../ui/Chip';
import { useCardEntering } from '../common/enterMotion';
import { formFields } from './loopModel';

export interface WaitDecision {
  /** The run whose commands route answers it (the parent for a mirrored decision). */
  runId: string;
  instanceId: string;
  name: string;
  /** "via release › security" for a mirrored decision. */
  via?: string;
  type: 'approval' | 'event' | 'completion_review';
  prompt: string | null;
  form: Record<string, unknown> | null;
  eventKey?: string | null;
  callbackUrl?: string | null;
}

export function WaitDecisionCard({ decision, canDecide }: { decision: WaitDecision; canDecide: boolean }): React.ReactElement {
  const entering = useCardEntering();
  const admin = useAdminApi();
  const queryClient = useQueryClient();
  const fields = useMemo(() => formFields(decision.form), [decision.form]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [json, setJson] = useState('{}');

  const send = useMutation({
    mutationFn: (body: { outcome: 'approved' | 'rejected'; data?: Record<string, unknown> }) =>
      admin.runs.command(decision.runId, { command: 'approve', instanceId: decision.instanceId, ...body }),
    onSuccess: () => haptics.commit(),
    onError: (err) => {
      haptics.error();
      Alert.alert('Could not send the decision', err instanceof Error ? err.message : String(err));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.run(decision.runId) }),
  });

  const data = (): { ok: true; value: Record<string, unknown> | undefined } | { ok: false; error: string } => {
    if (!decision.form) return { ok: true, value: undefined };
    if (fields === null) {
      try {
        const parsed: unknown = JSON.parse(json || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'The form is a JSON object' };
        return { ok: true, value: parsed as Record<string, unknown> };
      } catch (err) {
        return { ok: false, error: `Not valid JSON: ${(err as Error).message}` };
      }
    }
    const missing = fields.find((f) => f.required && (values[f.name] === undefined || values[f.name] === ''));
    if (missing) return { ok: false, error: `${missing.name} is required` };
    return { ok: true, value: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== '')) };
  };
  const form = data();

  return (
    <Animated.View entering={entering} className="gap-3 rounded-3xl border border-warning bg-warning-muted p-4">
      <View className="gap-1">
        <Text className="text-sm font-semibold text-warning">
          {decision.type === 'event' ? 'Waiting for an event' : 'Needs your decision'}
        </Text>
        <Text className="text-md font-semibold text-foreground">{decision.name}</Text>
        {decision.via ? <Text className="text-sm text-muted-foreground">via {decision.via}</Text> : null}
      </View>
      {decision.prompt ? <Text className="text-sm leading-relaxed text-foreground">{decision.prompt}</Text> : null}

      {decision.type === 'event' ? (
        <View className="gap-1">
          <Text className="font-mono text-sm text-foreground">{decision.eventKey ?? ''}</Text>
          {decision.callbackUrl ? (
            <Text selectable className="font-mono text-xs text-muted-foreground">
              {decision.callbackUrl}
            </Text>
          ) : null}
          <Text className="text-xs text-muted-foreground">An external system delivers it (the callback URL), or send deliver_event from the CLI.</Text>
        </View>
      ) : (
        <>
          {decision.form && fields === null ? (
            <Field label="Form (JSON)" value={json} onChangeText={setJson} multiline autoCapitalize="none" />
          ) : null}
          {(fields ?? []).map((f) =>
            f.options ? (
              <View key={f.name} className="gap-1.5">
                <Text className="text-sm font-medium text-foreground">
                  {f.name}
                  {f.required ? ' *' : ''}
                </Text>
                <View className="flex-row flex-wrap gap-1.5">
                  {f.options.map((o) => (
                    <Chip
                      key={o}
                      label={o}
                      size="sm"
                      tone="tab"
                      selected={values[f.name] === o}
                      onPress={() => setValues((v) => ({ ...v, [f.name]: o }))}
                    />
                  ))}
                </View>
              </View>
            ) : f.type === 'boolean' ? (
              <View key={f.name} className="flex-row items-center justify-between">
                <Text className="text-sm font-medium text-foreground">{f.name}</Text>
                <Switch value={values[f.name] === true} onValueChange={(on) => setValues((v) => ({ ...v, [f.name]: on }))} />
              </View>
            ) : (
              <Field
                key={f.name}
                label={`${f.name}${f.required ? ' *' : ''}`}
                value={values[f.name] === undefined ? '' : String(values[f.name])}
                keyboardType={f.type === 'number' ? 'numeric' : 'default'}
                onChangeText={(text) =>
                  setValues((v) => ({ ...v, [f.name]: f.type === 'number' ? (text === '' ? undefined : Number(text)) : text }))
                }
              />
            ),
          )}
          {!form.ok ? <Text className="text-sm text-danger">{form.error}</Text> : null}
          <View className="gap-2">
            <Button
              label="Approve"
              full
              haptic="commit"
              loading={send.isPending}
              disabled={!canDecide || send.isPending || !form.ok}
              onPress={() => form.ok && send.mutate({ outcome: 'approved', ...(form.value ? { data: form.value } : {}) })}
            />
            <Button
              label="Reject"
              variant="secondary"
              full
              disabled={!canDecide || send.isPending}
              onPress={() => send.mutate({ outcome: 'rejected' })}
            />
          </View>
        </>
      )}
    </Animated.View>
  );
}
