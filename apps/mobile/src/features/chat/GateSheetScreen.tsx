// MB-50 ApprovalSheet for a chat gate (`/chats/[id]/gate/[interactionId]`, MRunApproval; MD-21): the one approval
// surface a push, Home's Needs you or a link opens. The pending interaction is loaded from the server and drawn
// with the chat's own GateCard (permission / question / plan); a risky permission signs with the approval key
// ("Face ID required" under the actions, MD-31). Success: `success` haptic after the server confirms and the sheet
// closes — no toast (MD-26). Answered elsewhere: "Already handled" and "Open the chat".
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';

import { PermissionCard, PlanCard, QuestionCard, gateFromPayload, permissionRisk, type Gate } from '../../blocks/GateCard';
import { displayChatTitle } from '../../blocks/ChatRow';
import { chatHref } from '../../blocks/shell/hrefs';
import { RouteSheet } from '../../ui/native/Sheet';
import { haptic } from '../../ui/platform/haptics';
import { Button } from '../../ui/primitives/Button';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { useAnswerChatQuestion, useChat, useChatInteractions, useDecideChatPlan } from './queries';
import { useAnswerPermission } from './useAnswerPermission';

type Href = Parameters<typeof router.replace>[0];

export default function GateSheetScreen(): React.ReactElement {
  const { id, interactionId } = useLocalSearchParams<{ id: string; interactionId: string }>();
  const chatId = id ?? '';
  const navigation = useNavigation();
  const chat = useChat(chatId, { enabled: Boolean(chatId) });
  const streamKey = chat.data?.sessionId ?? chatId;
  const interactions = useChatInteractions(chatId, { enabled: Boolean(chatId), refetchInterval: 15_000 });
  const { answer, signer } = useAnswerPermission(chatId, streamKey);
  const answerQuestion = useAnswerChatQuestion(chatId, streamKey);
  const decidePlan = useDecideChatPlan(chatId, {});

  const gate = useMemo<Gate | null>(() => {
    const row = interactions.data?.find((i) => i.interactionId === interactionId);
    if (!row || row.status !== 'pending') return null;
    return gateFromPayload(row.interactionId, row.kind, row.payload ?? {});
  }, [interactions.data, interactionId]);

  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(chatHref(chatId) as Href);
  };
  const openChat = (): void => router.replace(chatHref(chatId) as Href);
  const done = (): void => {
    haptic('success');
    close();
  };

  let body: React.ReactNode;
  if (!chatId || !interactionId) {
    body = <ErrorState title="Nothing to show" error={new Error('This link does not name a chat and a gate.')} />;
  } else if (interactions.isLoading) {
    body = <Skeleton preset="card" />;
  } else if (interactions.isError) {
    body = <ErrorState title="Couldn't load this request" error={interactions.error} onRetry={() => void interactions.refetch()} />;
  } else if (!gate || gate.kind === 'unknown') {
    body = (
      <EmptyState
        icon={gate?.kind === 'unknown' ? 'chats' : 'status-succeeded'}
        title={gate?.kind === 'unknown' ? 'Open the chat to answer' : 'Already handled'}
        description={gate?.kind === 'unknown' ? 'This request can only be answered in the chat.' : 'It was answered on another device, or the agent moved on.'}
        action={{ label: 'Open the chat', onPress: openChat }}
      />
    );
  } else if (gate.kind === 'permission') {
    const block = gate.block;
    body = (
      <PermissionCard
        block={block}
        onDecide={async (behavior, message) => {
          await answer(block, behavior, message);
          close();
        }}
        {...(permissionRisk(block) === 'risky'
          ? { approval: { risky: true, readiness: signer.readiness, noun: signer.noun, onRegister: signer.register, registering: signer.registering } }
          : {})}
      />
    );
  } else if (gate.kind === 'question') {
    const block = gate.block;
    body = (
      <QuestionCard
        block={block}
        onSubmit={async (answers, freeform) => {
          await answerQuestion.mutateAsync({ interactionId: block.interactionId, answers, ...(freeform ? { freeformResponse: freeform } : {}) });
          done();
        }}
      />
    );
  } else {
    const plan = gate.plan;
    body = (
      <PlanCard
        plan={{ ...plan, actions: plan.actions ?? [] }}
        onOpenPlan={() => router.replace({ pathname: '/chats/[id]', params: { id: chatId, dock: 'plan' } })}
        onDecide={async (action, feedback) => {
          await decidePlan.mutateAsync({ planId: plan.planId, action, ...(feedback ? { feedback } : {}) });
          done();
        }}
      />
    );
  }

  return (
    <RouteSheet title="Needs you" subtitle={displayChatTitle(chat.data?.name)} onDismiss={close} navigation={navigation as never} testID="gate-sheet">
      <View className="gap-3 px-4">
        {body}
        {gate && gate.kind !== 'unknown' ? <Button label="Open the chat instead" variant="ghost" size="sm" onPress={openChat} /> : null}
        <Text role="footnote" tone="fg-3">
          Decisions here are the same as in the chat. If another device answers first, this closes as already handled.
        </Text>
      </View>
    </RouteSheet>
  );
}
