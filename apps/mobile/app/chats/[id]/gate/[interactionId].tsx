// ────────────────────────────────────────────────────────────────
// /chats/[id]/gate/[interactionId] — ONE pending gate, as a sheet.
//
// This is the route a push notification carries for "the agent needs you":
// tapping it opens exactly this card, not the whole transcript. The card
// components are the chat screen's own (`PermissionCard`, `QuestionCard`,
// `PlanCard`); the data comes from `GET /api/chats/:id/interactions`,
// whose pending rows carry the payload the gate was opened with.
//
// Decision endpoints (same as the chat screen):
//   permission  POST /api/chats/:id/interactions/:iid/permission   409 = already handled
//   question    POST /api/chats/:id/interactions/:iid/respond
//   plan        POST /api/chats/:id/plans/:planId/decision
//
// If the interaction is no longer pending — answered from the desktop, or
// expired — the sheet says "Already handled" and offers the chat.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react-native';
import { queryKeys } from '@generatorai/client-core';

import { useApi } from '../../../../src/api/useApi';
import { gateFromPayload, type Gate } from '../../../../src/components/chat/gateFromInteraction';
import { PermissionCard } from '../../../../src/components/chat/PermissionCard';
import { PlanCard } from '../../../../src/components/chat/PlanCard';
import { QuestionCard } from '../../../../src/components/chat/QuestionCard';
import { useGateDecision } from '../../../../src/components/home/useGateDecision';
import { RouteSheet } from '../../../../src/navigation/RouteSheet';
import { chatRoute, planRoute } from '../../../../src/navigation/routes';
import { Button } from '../../../../src/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '../../../../src/components/ui/States';
import { useTheme } from '../../../../src/theme/ThemeProvider';

export default function GateScreen(): React.ReactElement {
  const { id: chatId, interactionId } = useLocalSearchParams<{ id: string; interactionId: string }>();
  const api = useApi();
  const { colors } = useTheme();
  const decide = useGateDecision();

  const chat = useQuery({
    queryKey: queryKeys.chat(chatId!),
    queryFn: () => api.chats.get(chatId!),
    enabled: Boolean(chatId),
  });

  const interactions = useQuery({
    queryKey: queryKeys.chatInteractions(chatId!),
    queryFn: () => api.chats.interactions(chatId!),
    enabled: Boolean(chatId),
    refetchInterval: 15_000,
  });

  const gate = useMemo<Gate | null>(() => {
    if (!interactions.data || !interactionId) return null;
    const row = interactions.data.find((i) => i.interactionId === interactionId);
    if (!row || row.status !== 'pending') return null;
    return gateFromPayload(row.interactionId, row.kind, row.payload ?? {});
  }, [interactions.data, interactionId]);

  const openChat = () => router.replace(chatRoute(chatId!) as never);
  const chatName = chat.data?.name;

  let body: React.ReactNode;
  if (!chatId || !interactionId) {
    body = <ErrorState title="Nothing to show" message="This link does not name a chat and a gate." />;
  } else if (interactions.isLoading) {
    body = <LoadingState label="Checking with the server" />;
  } else if (interactions.isError) {
    body = (
      <ErrorState message="Could not load this gate." onRetry={() => void interactions.refetch()} />
    );
  } else if (!gate || gate.kind === 'unknown') {
    body = (
      <>
        <EmptyState
          title={gate?.kind === 'unknown' ? 'Open the chat to answer' : 'Already handled'}
          message={
            gate?.kind === 'unknown'
              ? 'This server asked something this version of the app cannot render here. The chat can.'
              : 'This was answered from another device, or the agent moved on. Nothing else is needed from you here.'
          }
          icon={<CheckCircle2 size={24} color={colors.success} />}
        />
        <Button label="Open the chat" full onPress={openChat} haptic="tap" />
      </>
    );
  } else if (gate.kind === 'permission') {
    body = (
      <View className="-mx-3">
        <PermissionCard
          block={gate.block}
          onDecide={async (behavior) => {
            await decide.permission(chatId, interactionId, behavior);
            openChat();
          }}
        />
      </View>
    );
  } else if (gate.kind === 'question') {
    body = (
      <View className="-mx-3">
        <QuestionCard
          block={gate.block}
          onSubmit={async (answers, freeform) => {
            await decide.answer(chatId, interactionId, answers, freeform);
            openChat();
          }}
        />
      </View>
    );
  } else {
    const plan = gate.plan;
    body = (
      <View className="-mx-3">
        <PlanCard
          plan={plan}
          onOpenPlan={() => router.push(planRoute(chatId, plan.planId) as never)}
          onDecide={async (action) => {
            await decide.plan(chatId, plan.planId, action);
            openChat();
          }}
        />
      </View>
    );
  }

  return (
    <RouteSheet
      title="Waiting for you"
      {...(chatName ? { subtitle: chatName } : {})}
      fallback={chatId ? (chatRoute(chatId) as never) : '/(tabs)'}
    >
      {body}
      {gate && gate.kind !== 'unknown' ? (
        <Button label="Open the chat instead" variant="ghost" size="sm" onPress={openChat} haptic="tap" />
      ) : null}
      <Text className="px-1 text-xs leading-relaxed text-muted-foreground">
        Decisions made here are the same as in the chat. If another device answers first, this
        closes as already handled.
      </Text>
    </RouteSheet>
  );
}
