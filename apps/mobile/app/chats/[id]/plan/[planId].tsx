// ────────────────────────────────────────────────────────────────
// /chats/[id]/plan/[planId] — a plan, read-only, with its decision.
//
// The full plan body (`GET …/plans/:planId/content`) as markdown, and — only
// while the plan is awaiting review — Approve / Request changes using the
// same `toPlanDecision` mapping the chat screen posts. "Request changes"
// asks for a note first; the server relays `feedback` to the agent.
//
// The plan's own `actions` list is the source of truth for what is offered
// (a server may offer autopilot, or only exit); the two buttons here are
// the two decisions every plan supports.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@generatorai/client-core';

import { useApi } from '../../../../src/api/useApi';
import { Markdown } from '../../../../src/components/markdown/Markdown';
import { useGateDecision } from '../../../../src/components/home/useGateDecision';
import { RouteSheet } from '../../../../src/navigation/RouteSheet';
import { chatRoute } from '../../../../src/navigation/routes';
import { Button } from '../../../../src/components/ui/Button';
import { Field } from '../../../../src/components/ui/Form';
import { Badge, Card } from '../../../../src/components/ui/primitives';
import { ErrorState, LoadingState } from '../../../../src/components/ui/States';

export default function PlanScreen(): React.ReactElement {
  const { id: chatId, planId } = useLocalSearchParams<{ id: string; planId: string }>();
  const api = useApi();
  const decide = useGateDecision();
  const [feedback, setFeedback] = useState('');
  const [askingChanges, setAskingChanges] = useState(false);
  const [pending, setPending] = useState<'approve' | 'changes' | null>(null);

  const plans = useQuery({
    queryKey: queryKeys.chatPlans(chatId!),
    queryFn: () => api.chats.plans(chatId!),
    enabled: Boolean(chatId),
  });

  const content = useQuery({
    queryKey: [...queryKeys.chatPlans(chatId!), planId, 'content'] as const,
    queryFn: () => api.chats.planContent(chatId!, planId!),
    enabled: Boolean(chatId && planId),
  });

  const plan = useMemo(() => plans.data?.find((p) => p.planId === planId), [plans.data, planId]);
  const awaiting = plan?.status === 'awaiting_review';

  const openChat = () => router.replace(chatRoute(chatId!) as never);

  const submit = async (action: 'approve' | 'changes'): Promise<void> => {
    if (!chatId || !planId || pending) return;
    setPending(action);
    try {
      await decide.plan(
        chatId,
        planId,
        action === 'approve' ? 'approve' : 'request_changes',
        action === 'changes' ? feedback : undefined,
      );
      openChat();
    } catch {
      // The hook already toasted; the sheet stays so the user can retry.
    } finally {
      setPending(null);
    }
  };

  return (
    <RouteSheet
      title={plan?.title ?? 'Plan'}
      {...(plan ? { subtitle: `Revision ${plan.revision} · ${plan.status.replace(/_/g, ' ')}` } : {})}
      fallback={chatId ? (chatRoute(chatId) as never) : '/(tabs)'}
    >
      {!chatId || !planId ? (
        <ErrorState title="Nothing to show" message="This link does not name a chat and a plan." />
      ) : content.isLoading || plans.isLoading ? (
        <LoadingState label="Loading the plan" />
      ) : content.isError ? (
        <ErrorState message="Could not load the plan." onRetry={() => void content.refetch()} />
      ) : (
        <>
          {plan?.summary ? (
            <Card className="gap-2 p-3.5">
              <Badge label="Summary" tone="primary" />
              <Text className="text-sm leading-relaxed text-foreground">{plan.summary}</Text>
            </Card>
          ) : null}

          <Card className="p-3.5">
            <Markdown content={content.data?.content ?? '_The plan is empty._'} />
          </Card>

          {awaiting ? (
            <View className="gap-3">
              {askingChanges ? (
                <Field
                  label="What should change?"
                  hint="Sent to the agent with your decision."
                  multiline
                  value={feedback}
                  onChangeText={setFeedback}
                  placeholder="e.g. Keep the migration but drop the feature flag."
                  autoFocus
                />
              ) : null}
              <View className="flex-row gap-2">
                <Button
                  label={askingChanges ? 'Send changes' : 'Request changes'}
                  variant={askingChanges ? 'danger' : 'secondary'}
                  size="lg"
                  grow
                  loading={pending === 'changes'}
                  disabled={pending !== null || (askingChanges && feedback.trim().length === 0)}
                  onPress={() => {
                    if (!askingChanges) {
                      setAskingChanges(true);
                      return;
                    }
                    void submit('changes');
                  }}
                />
                <Button
                  label="Approve"
                  variant="primary"
                  size="lg"
                  grow
                  loading={pending === 'approve'}
                  disabled={pending !== null}
                  onPress={() => void submit('approve')}
                />
              </View>
              {askingChanges ? (
                <Button
                  label="Never mind"
                  variant="ghost"
                  size="sm"
                  haptic="tap"
                  onPress={() => {
                    setAskingChanges(false);
                    setFeedback('');
                  }}
                />
              ) : null}
            </View>
          ) : (
            <Text className="px-1 text-xs leading-relaxed text-muted-foreground">
              This plan is not waiting for a decision{plan ? ` (${plan.status.replace(/_/g, ' ')})` : ''}.
            </Text>
          )}

          <Button label="Open the chat" variant="ghost" size="sm" onPress={openChat} haptic="tap" />
        </>
      )}
    </RouteSheet>
  );
}
