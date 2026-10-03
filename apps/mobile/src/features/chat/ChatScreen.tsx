// Chat (Main, MChatRunning, MChatNoAgent; 04 §2.3; MD-18; M6-06): the `workspace` header — Back (`chat-back`), the
// breadcrumb "Chats › <project>", the title, the StatusLine ("Running 4:12 · Orchestrator"), the pane toggle with the
// changed-file count (`pane-toggle`) and the ⋯ / ⋮ menu (MDF-57) — over the transcript (MB-07, "↓ Latest" ML-26) and
// the composer (MB-01) with its dock (a gate card seeded from the server, the changes strip). The page lifts with the
// software keyboard frame by frame (`useKeyboardOverlap`), so the transcript shrinks rather than hiding under it.
// The chat claims the workspace pane (MB-42) with its tabs and bodies. Gates draw inline where the agent raised
// them (MB-15); risky ones are answered with the signed approval key (MD-31).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Image, Keyboard, Linking, Share, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';
import {
  ApiError,
  isArchived,
  resourcePaths,
  type AgentMode,
  type RewindScope,
} from '@generatorai/client-core';

import { ChangesStrip } from '../../blocks/ChangesPanel';
import { chatRowView, displayChatTitle, useChatRowActions } from '../../blocks/ChatRow';
import { Composer, type ComposerPane } from '../../blocks/Composer/Composer';
import { readAllAttachmentBytes } from '../../blocks/Composer/model/attachmentPickers';
import { ComposerCaptureContext } from '../../blocks/Composer/model/captureContext';
import type { ComposerSendPayload, WorkspacePrepState } from '../../blocks/Composer/model/types';
import { useComposerController, type ComposerController } from '../../blocks/Composer/useComposerController';
import { PermissionCard, PlanCard, QuestionCard, ResolvedGateRow, pendingGateFrom, permissionRisk } from '../../blocks/GateCard';
import { describeFork, describeRewind, forkedFromLabel, onRewindRequest, shouldRestorePrompt, useRewindSheet } from '../../blocks/RewindSheet';
import { chatHref, stepHref, turnHref, CHATS_HREF } from '../../blocks/shell/hrefs';
import { useBreadcrumb, useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { TranscriptView, chatToolCalls, type TranscriptActions } from '../../blocks/TranscriptView';
import { activityLabelFor, selectChatView } from '../../blocks/TranscriptView/model/selectChatView';
import { PaneTabBody, useChangesSummary, usePaneStore, usePaneToggle, useWorkspacePaneClaim, type MobilePaneTab, type PaneTabContext } from '../../blocks/WorkspacePane';
import { sendChatPrompt } from '../../services/api/sendChatPrompt';
import { useApi } from '../../services/api/useApi';
import { useCopyTranscriptMarkdown, useForkChat, useRewindChat } from '../../services/api/useChatBranching';
import { findModel, useModels } from '../../services/api/useModels';
import { useAuth } from '../../services/auth/AuthProvider';
import { bytesToBase64 } from '../../services/lib/base64';
import { mobileRoute } from '../../services/navigation/mobileRoutes';
import { restoredPromptFrom, type ChatRewoundEffect } from '../../services/stream/rewindEffects';
import { useStreamHealth } from '../../services/stream/streamHealth';
import { protectStream, useStreamStore } from '../../services/stream/streamStore';
import { useChatStream } from '../../services/stream/useChatStream';
import { useTurnCatchUp } from '../../services/stream/useTurnCatchUp';
import { useTwoPhaseStop } from '../../services/stream/useTwoPhaseStop';
import { Header, type HeaderAction } from '../../ui/native/router/Header';
import { useSheet } from '../../ui/native/Sheet';
import { confirm } from '../../ui/native/AlertDialog';
import { haptic } from '../../ui/platform/haptics';
import { useInsets } from '../../ui/platform/insets';
import { useKeyboardOverlap } from '../../ui/platform/keyboard';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Icon } from '../../ui/primitives/Icon';
import { Input } from '../../ui/primitives/Input';
import { Pressable } from '../../ui/primitives/Pressable';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { errorText } from '../../ui/lib/format';
import { chatHeaderStatus, chatMenu, lastTurnOutcome, lastUserPrompt, transcriptText, type ChatMenuId } from './model/chatHeader';
import {
  useAnswerChatQuestion,
  useArchiveChat,
  useCancelChat,
  useChat,
  useChatInteractions,
  useChatMessages,
  useChatPlans,
  useChatProject,
  useChatRefresh,
  useDecideChatPlan,
  useMarkChatRead,
  usePatchChat,
  usePrepareChatWorkspace,
  usePublishWorkflowDraft,
  type ChatPatch,
} from './queries';
import { useAnswerPermission } from './useAnswerPermission';
import { useFollowLive } from '../../services/live/useFollowLive';

/** How many messages are fetched at a time. */
const PAGE_SIZE = 120;

const closePane = (): void => usePaneStore.getState().setOpen(false);
const HEADER_TEST_IDS = { back: 'chat-back' } as const;

const STARTERS = ['Explain how this project is structured', 'Find and fix a failing test', 'Review my uncommitted changes'] as const;

function StarterPrompts({ onPick, disabled }: { onPick: (text: string) => void; disabled: boolean }): React.ReactElement {
  return (
    <View className="flex-1 justify-end gap-3 px-4 pb-4">
      <Text role="headline" accessibilityRole="header">
        What should the agent do?
      </Text>
      <Text role="footnote" tone="fg-2">
        Type a request, / for actions, @ to mention a file.
      </Text>
      <View className="items-start gap-2 pt-1">
        {STARTERS.map((text) => (
          <Button key={text} label={text} size="sm" accessibilityLabel={`Start with: ${text}`} disabled={disabled} onPress={() => onPick(text)} />
        ))}
      </View>
    </View>
  );
}

/** Rename (the header menu): the name field and one Save in the sheet. */
function RenameChat({ initial, onSave }: { initial: string; onSave: (name: string) => void }): React.ReactElement {
  const [name, setName] = useState(initial);
  const trimmed = name.trim();
  return (
    <View className="gap-4 px-4 pb-4">
      <Input label="Name" value={name} onChangeText={setName} presentation="standalone" autoFocus returnKeyType="done" onSubmitEditing={() => trimmed && onSave(trimmed)} testID="rename-chat-input" />
      <Button label="Save" variant="primary" size="lg" fullWidth disabled={!trimmed || trimmed === initial.trim()} onPress={() => onSave(trimmed)} testID="rename-chat-save" />
    </View>
  );
}

export default function ChatScreen(): React.ReactElement {
  const { id, plan: planParam } = useLocalSearchParams<{ id: string; plan?: string }>();
  useFollowLive('chat', id);
  const chatId = id ?? '';
  const navigation = useNavigation();
  const auth = useAuth();
  const api = useApi();
  const sheet = useSheet();
  const presentRewind = useRewindSheet();
  const onBack = useHeaderBack();
  const insets = useInsets();
  const keyboard = useKeyboardOverlap();
  const refresh = useChatRefresh(chatId);
  const scopes = useMemo<readonly string[]>(() => (auth.state.status === 'authenticated' ? auth.state.scopes : []), [auth.state]);

  const chat = useChat(chatId);
  useMarkChatRead(chatId);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const messages = useChatMessages(chatId, limit);
  const models = useModels();
  const plans = useChatPlans(chatId);

  // The composer controller, reachable from callbacks declared above it (a rewind restores its prompt as the draft).
  const composerRef = useRef<ComposerController | null>(null);
  // Rewinds started here, so the stream echo does not announce them twice (`turnId:scope`).
  const selfRewound = useRef(new Set<string>());
  const onChatRewound = useCallback((effect: ChatRewoundEffect) => {
    const prompt = restoredPromptFrom(effect);
    if (prompt) composerRef.current?.setDraft(prompt);
    if (selfRewound.current.delete(`${effect.turnId}:${effect.scope}`)) return;
    toast({ kind: 'background', message: 'This chat was rewound on another device.' });
  }, []);

  // A turn already running when the chat opened is replayed from the event log before the stream subscribes.
  const catchUp = useTurnCatchUp(
    chatId,
    { data: messages.data, settled: !messages.isPending },
    useStreamStore((s) => s.streams[chat.data?.sessionId ?? chatId]?.serverTurnId ?? null),
  );
  useChatStream({ chatId, sessionId: chat.data?.sessionId, enabled: catchUp.ready, catchUpEvents: catchUp.events, afterSequence: catchUp.afterSequence, onChatRewound });

  const workspaceId = chat.data?.workspaceId ?? null;
  const archived = chat.data ? isArchived(chat.data) : false;
  const mode: AgentMode = chat.data?.defaultAgentMode ?? 'auto';
  const projectId = chat.data?.projectId ?? null;
  const project = useChatProject(projectId);
  const changes = useChangesSummary(workspaceId);

  // The stream is keyed by session id (a chat that never ran has none); pinned while on screen.
  const streamKey = chat.data?.sessionId ?? chatId;
  useEffect(() => protectStream(streamKey), [streamKey]);
  // Structural view of the stream (§7.2): a token landing does not re-render this screen.
  const view = useStreamStore(useShallow((s) => selectChatView(s.streams[streamKey])));
  const applyEffects = useStreamStore((s) => s.applyEffects);
  const isStreaming = view.isLive;

  // When the turn went live on this screen: the StatusLine's and the working strip's clock.
  const [live, setLive] = useState<{ turn: number | null; since: string | null }>({ turn: null, since: null });
  const liveTurn = isStreaming ? view.turnId : null;
  if (live.turn !== liveTurn) setLive({ turn: liveTurn, since: liveTurn === null ? null : new Date().toISOString() });
  const liveSince = live.since;

  const cancel = useCancelChat(chatId);
  const stop = useTwoPhaseStop({ isLive: isStreaming, onCancel: (options) => cancel.mutate(options) });
  const streamConnection = useStreamHealth((s) => s.connection);
  const streamTrouble = isStreaming && (streamConnection === 'reconnecting' || streamConnection === 'offline');

  const title = displayChatTitle(chat.data?.name);
  const projectName = project.data?.name ?? null;
  const crumbInput = useMemo(
    () => [{ label: 'Chats', href: CHATS_HREF }, ...(projectId && projectName ? [{ label: projectName, href: `/projects/${encodeURIComponent(projectId)}` }] : [])],
    [projectId, projectName],
  );
  const crumbs = useBreadcrumb(crumbInput);

  // ── Sending ──────────────────────────────────────────────────
  // Optimistic like web: the bubble and the working row appear on this frame. A send the server never accepted
  // clears the stream (the controller has put the text back in the composer; MD-154).
  const sendPrompt = useCallback(
    async (payload: ComposerSendPayload) => {
      const text = payload.text.trim();
      applyEffects([{ op: 'startPending', key: streamKey, userMessage: text }]);
      try {
        const files = await readAllAttachmentBytes(payload.attachments);
        await sendChatPrompt(auth.fetch, chatId, { message: text, mode: payload.mode ?? mode }, files);
        void refresh.messages();
      } catch (err) {
        useStreamStore.getState().clear(streamKey);
        const gated = err instanceof ApiError && err.status === 409;
        haptic('error');
        toast({ kind: 'error', message: gated ? 'The agent is still busy or waiting on a decision. Try again when it is done.' : 'Could not send that. Your text has been restored.' });
        throw err;
      }
    },
    [auth.fetch, chatId, mode, streamKey, applyEffects, refresh],
  );

  const prepareWorkspace = usePrepareChatWorkspace(chatId, {
    onError: () => {
      haptic('error');
      toast({ kind: 'error', message: 'Could not restart workspace preparation.' });
    },
  });
  const patchChat = usePatchChat(chatId, {
    onError: () => {
      haptic('error');
      toast({ kind: 'error', message: 'That change did not stick. Try again.' });
    },
  });
  const archive = useArchiveChat(chatId, {
    onError: () => {
      haptic('error');
      toast({ kind: 'error', message: 'Could not change this chat.' });
    },
  });
  // Archive answers with Undo (MD-26) through the row actions every chat list shares.
  const rowActions = useChatRowActions({ onOpen: () => undefined });

  // ── History: rewind, fork, copy ──────────────────────────────
  const rewind = useRewindChat(chatId, workspaceId);
  const fork = useForkChat(chatId, workspaceId);
  const copyTranscript = useCopyTranscriptMarkdown(chatId);

  const runRewind = useCallback(
    async (target: { turnId: string; prompt: string }, scope: RewindScope) => {
      const key = `${target.turnId}:${scope}`;
      selfRewound.current.add(key);
      try {
        const result = await rewind.mutateAsync({ turnId: target.turnId, scope });
        // The dropped turn is still in this device's blocks until the broadcast lands.
        if (scope !== 'code') useStreamStore.getState().clear(streamKey);
        if (shouldRestorePrompt(result.scope, result.prompt)) composerRef.current?.setDraft(result.prompt);
        haptic('success');
        AccessibilityInfo.announceForAccessibility?.(describeRewind(result));
      } catch (error) {
        selfRewound.current.delete(key);
        haptic('error');
        const busy = error instanceof ApiError && error.status === 409;
        toast({ kind: 'error', message: busy ? 'The agent is still working on this chat. Stop the turn, then rewind.' : 'Could not rewind this chat. Nothing was changed.' });
      }
    },
    [rewind, streamKey],
  );
  const openRewind = useCallback(
    (target: { turnId: string; prompt: string }) => {
      Keyboard.dismiss();
      presentRewind({ availability: { streaming: isStreaming, archived }, preview: target.prompt, onChoose: (scope) => void runRewind(target, scope) });
    },
    [presentRewind, isStreaming, archived, runRewind],
  );

  const runFork = useCallback(
    async (turnId?: string) => {
      try {
        const result = await fork.mutateAsync(turnId ? { turnId } : {});
        haptic('success');
        AccessibilityInfo.announceForAccessibility?.(describeFork(result.chat.name, result.conversation));
        router.push(chatHref(result.chat.id) as never);
      } catch (error) {
        haptic('error');
        const busy = error instanceof ApiError && error.status === 409;
        toast({ kind: 'error', message: busy ? 'The agent is still working on this chat. Stop the turn, then fork.' : 'Could not fork this chat.' });
      }
    },
    [fork],
  );

  // The WHOLE chat as markdown (not the paged messages, which would truncate a long chat).
  const runCopyTranscript = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(await copyTranscript());
      haptic('success');
      AccessibilityInfo.announceForAccessibility?.('Transcript copied');
    } catch {
      haptic('error');
      toast({ kind: 'error', message: 'Could not copy the transcript.' });
    }
  }, [copyTranscript]);

  const forkedFromChatId = chat.data?.forkedFromChatId ?? null;
  const parentChat = useChat(forkedFromChatId ?? '', { enabled: Boolean(forkedFromChatId), staleTime: 60_000 });

  // ── Gates ────────────────────────────────────────────────────
  // The stream is the primary source; a gate already pending on mount (cold load, a push, Home) is seeded from the
  // server's interaction list and rebuilt into the block shape the cards take.
  const interactions = useChatInteractions(chatId);
  const seededGate = useMemo(() => pendingGateFrom(interactions.data), [interactions.data]);
  const gateBlock = view.gateBlock;
  const blockingPermission = gateBlock?.type === 'permission' ? gateBlock : !gateBlock && seededGate?.kind === 'permission' ? seededGate.block : null;
  const blockingQuestion = gateBlock?.type === 'question' ? gateBlock : !gateBlock && seededGate?.kind === 'question' ? seededGate.block : null;
  const blockingPlan = plans.data?.find((p) => p.status === 'awaiting_review') ?? (plans.data === undefined && seededGate?.kind === 'plan' ? seededGate.plan : undefined);
  const blocked = Boolean(blockingPermission || blockingPlan || blockingQuestion);
  const { answer: answerPermission, signer } = useAnswerPermission(chatId, streamKey);
  const decidePlan = useDecideChatPlan(chatId, {
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        toast({ kind: 'background', message: 'This plan is no longer waiting for review.' });
        return;
      }
      haptic('error');
      toast({ kind: 'error', message: 'Could not send that decision. Try again.' });
    },
  });
  const answerQuestion = useAnswerChatQuestion(chatId, streamKey);

  // ── Pane ─────────────────────────────────────────────────────
  const [planId, setPlanId] = useState<string | null>(typeof planParam === 'string' ? planParam : null);
  const openTab = useCallback((tab: MobilePaneTab) => {
    Keyboard.dismiss();
    usePaneStore.getState().openTab(tab);
  }, []);
  const openPlan = useCallback(
    (next: string) => {
      setPlanId(next);
      openTab('plan');
    },
    [openTab],
  );
  const onOpenPane = useCallback(
    (pane: ComposerPane) => {
      openTab(pane);
    },
    [openTab],
  );

  // ── Composer ─────────────────────────────────────────────────
  const composer = useComposerController({
    chatId,
    scopes,
    workspaceId,
    projectId,
    onSend: sendPrompt,
    // Only the archive disables the controller: an open gate disables Send but "Cancel and send" still calls send().
    disabled: archived,
    onOpenPane,
    messages: messages.data,
    // "Send to chat" from the Terminal / Browser tab brings the composer forward.
    onCaptured: closePane,
  });
  useEffect(() => {
    composerRef.current = composer;
  });

  // "Cancel and send" (MD-03): deny the permission (or cancel the turn holding a question / plan), then send.
  const [gateBusy, setGateBusy] = useState(false);
  const cancelGateAndSend = useCallback(async () => {
    if (gateBusy) return;
    setGateBusy(true);
    try {
      if (blockingPermission) await answerPermission(blockingPermission, 'deny', 'Cancelled by the user to send a new message.');
      else {
        await cancel.mutateAsync({ force: false, budgetSeconds: 0 });
        refresh.decisions();
      }
      await composer.send();
    } catch {
      /* the mutation's own error path has already said why */
    } finally {
      setGateBusy(false);
    }
  }, [gateBusy, blockingPermission, answerPermission, cancel, refresh, composer]);
  const gate = useMemo(
    () =>
      blocked && !archived
        ? {
            label: blockingPermission ? 'Waiting for your permission decision' : blockingQuestion ? 'The agent asked a question' : 'A plan is waiting for your review',
            busy: gateBusy,
            onCancelAndSend: () => void cancelGateAndSend(),
          }
        : null,
    [blocked, archived, blockingPermission, blockingQuestion, gateBusy, cancelGateAndSend],
  );

  // The bound agent and workspace preparation, when the server sends them.
  const extras = chat.data as
    | { agentSnapshot?: { driving?: { ref: string; name: string; role?: 'agent' | 'orchestrator' } | null }; workspacePrep?: WorkspacePrepState; summary?: { model?: { label?: string } } }
    | undefined;
  const boundAgent = useMemo<{ name: string; role?: 'agent' | 'orchestrator' } | null>(() => {
    const driving = extras?.agentSnapshot?.driving;
    if (driving) return { name: driving.name, ...(driving.role ? { role: driving.role } : {}) };
    const ref = chat.data?.agentRef;
    return ref ? { name: ref.split(':').pop() ?? ref } : null;
  }, [extras?.agentSnapshot?.driving, chat.data?.agentRef]);
  const prep = extras?.workspacePrep;
  const workspacePrep = useMemo(
    () => (prep && prep.status !== 'ready' ? { ...prep, onRetry: () => prepareWorkspace.mutate(), retrying: prepareWorkspace.isPending } : null),
    [prep, prepareWorkspace],
  );
  const modelLabel = extras?.summary?.model?.label ?? findModel(models.data, chat.data?.model ?? null)?.name ?? (chat.data?.model && chat.data.model !== 'default' ? chat.data.model : null);

  // ── Gate cards (MB-15) ───────────────────────────────────────
  const planInStream = useMemo(
    () => Boolean(blockingPlan && useStreamStore.getState().streams[streamKey]?.blocks.some((b) => b.type === 'plan' && b.planId === blockingPlan.planId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `view.signature` stands in for the live blocks array.
    [blockingPlan, streamKey, view.signature],
  );
  const renderPermission = useCallback(
    (block: NonNullable<typeof blockingPermission>) => (
      <PermissionCard
        block={block}
        onDecide={(behavior, message) => answerPermission(block, behavior, message)}
        {...(permissionRisk(block) === 'risky'
          ? { approval: { risky: true, readiness: signer.readiness, noun: signer.noun, onRegister: signer.register, registering: signer.registering, error: signer.error } }
          : {})}
      />
    ),
    [answerPermission, signer],
  );
  const renderQuestion = useCallback(
    (block: NonNullable<typeof blockingQuestion>) => (
      <QuestionCard
        block={block}
        onSubmit={async (answers, freeform) => {
          await answerQuestion.mutateAsync({ interactionId: block.interactionId, answers, ...(freeform ? { freeformResponse: freeform } : {}) });
          haptic('success');
        }}
      />
    ),
    [answerQuestion],
  );
  const renderPlan = useCallback(
    (plan: NonNullable<typeof blockingPlan>) => (
      <PlanCard
        plan={{ ...plan, actions: plan.actions ?? [] }}
        onOpenPlan={() => openPlan(plan.planId)}
        onDecide={async (action, feedback) => {
          await decidePlan.mutateAsync({ planId: plan.planId, action, ...(feedback ? { feedback } : {}) });
          haptic('success');
        }}
      />
    ),
    [openPlan, decidePlan],
  );
  const renderGate = useCallback<NonNullable<TranscriptActions['renderGate']>>(
    (segment) => {
      if (segment.type === 'permission') {
        return segment.permission.status === 'pending' && blockingPermission?.interactionId === segment.permission.interactionId ? renderPermission(segment.permission) : <ResolvedGateRow block={segment.permission} />;
      }
      if (segment.type === 'question') {
        return segment.question.status === 'pending' && blockingQuestion?.interactionId === segment.question.interactionId ? renderQuestion(segment.question) : <ResolvedGateRow block={segment.question} />;
      }
      return segment.plan.status === 'awaiting_review' && blockingPlan?.planId === segment.plan.planId ? renderPlan(blockingPlan) : <ResolvedGateRow block={segment.plan} />;
    },
    [blockingPermission, blockingQuestion, blockingPlan, renderPermission, renderQuestion, renderPlan],
  );
  // The pending gate the transcript does not hold (seeded from the interaction list) draws above the composer.
  const dockGate =
    !view.gateBlock && blockingPermission
      ? renderPermission(blockingPermission)
      : !view.gateBlock && blockingQuestion
        ? renderQuestion(blockingQuestion)
        : blockingPlan && !planInStream
          ? renderPlan(blockingPlan)
          : null;

  // ── Transcript actions (MB-07) ───────────────────────────────
  const openImage = useCallback(
    async (image: { relativePath: string; label: string }) => {
      if (!workspaceId) return;
      try {
        const response = await auth.fetch(resourcePaths.browserFile(workspaceId, image.relativePath));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const ext = image.label.split('.').pop()?.toLowerCase() ?? 'png';
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
        const uri = `data:${mime};base64,${bytesToBase64(new Uint8Array(await response.arrayBuffer()))}`;
        sheet.present(
          <View className="px-4 pb-4">
            <Image source={{ uri }} resizeMode="contain" accessibilityLabel={image.label} className="aspect-square w-full rounded-card bg-sunken" />
          </View>,
          { title: image.label, detents: ['large'] },
        );
      } catch {
        toast({ kind: 'error', message: 'Could not load that screenshot.' });
      }
    },
    [auth, workspaceId, sheet],
  );
  const publishDraft = usePublishWorkflowDraft().mutateAsync;
  const canPublishDrafts = scopes.includes('write:workflows');
  const transcriptActions = useMemo<TranscriptActions>(
    () => ({
      agent: boundAgent,
      model: modelLabel,
      onOpenStep: (callId) => router.push(stepHref(chatId, callId) as never),
      onOpenChat: (next) => router.push(chatHref(next) as never),
      onOpenTasks: () => openTab('tasks'),
      onOpenHref: (href) => {
        const path = mobileRoute(href);
        if (path) router.push(path as never);
      },
      onOpenLink: (href) => {
        if (/^generatorai:/i.test(href)) void Linking.openURL(href).catch(() => undefined);
        else void WebBrowser.openBrowserAsync(href).catch(() => undefined);
      },
      ...(workspaceId ? { onOpenImage: (image: { relativePath: string; label: string }) => void openImage(image) } : {}),
      onRewind: (turnId, prompt) => openRewind({ turnId, prompt }),
      onForkFrom: (turnId) => void runFork(turnId),
      onCopyTranscript: () => void runCopyTranscript(),
      ...(canPublishDrafts
        ? {
            onPublishDraft: async (workflowId: string) => {
              try {
                await publishDraft(workflowId);
                haptic('success');
              } catch (e) {
                toast({ kind: 'error', message: errorText(e) });
                throw e;
              }
            },
          }
        : {}),
      renderGate,
    }),
    [boundAgent, modelLabel, chatId, workspaceId, openImage, openRewind, runFork, runCopyTranscript, renderGate, openTab, canPublishDrafts, publishDraft],
  );

  // ── Pane claim (MB-42) ───────────────────────────────────────
  const paneShown = usePaneStore((s) => s.open && s.claim?.scope.kind === 'chat' && s.claim.scope.id === chatId);
  const captures = composer.captures;
  // The shell commands the agent ran (the Terminal tab's read-only "Agent commands").
  const messageRows = messages.data;
  const agentCalls = useMemo(
    () => chatToolCalls(messageRows ?? [], useStreamStore.getState().streams[streamKey]?.blocks),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `view.signature` stands in for the live blocks array.
    [messageRows, streamKey, view.signature],
  );
  // "Rewind to here" from the pane's checkpoint scrubber.
  useEffect(() => onRewindRequest(chatId, openRewind), [chatId, openRewind]);
  const paneContext = useMemo<PaneTabContext>(
    () => ({
      workspaceId,
      chatId,
      agentBusy: isStreaming,
      agentName: boundAgent?.name ?? null,
      agentCalls,
      planId,
      onPlanDecided: closePane,
    }),
    [workspaceId, chatId, isStreaming, boundAgent?.name, agentCalls, planId],
  );
  // The pane renders in the shell, outside this screen's tree: its bodies get the composer's capture actions here.
  const renderTab = useCallback(
    (type: MobilePaneTab, ctx: { active: boolean }) => (
      <ComposerCaptureContext.Provider value={captures}>
        <PaneTabBody type={type} active={ctx.active} ctx={paneContext} />
      </ComposerCaptureContext.Provider>
    ),
    [captures, paneContext],
  );
  useWorkspacePaneClaim({
    kind: 'chat',
    id: chatId || undefined,
    title,
    path: chatHref(chatId),
    workspaceId,
    chatId,
    scopes,
    orchestrator: chat.data?.orchestratorMode === true || boundAgent?.role === 'orchestrator',
    live: paneShown,
    renderTab,
  });
  const paneToggle = usePaneToggle();
  // iOS edge swipe pops the chat only when the pane is not over it (the pane's own drag closes it first).
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !paneShown });
  }, [navigation, paneShown]);

  // ── Header ───────────────────────────────────────────────────
  const messageList = messages.data;
  const lastPrompt = useMemo(() => lastUserPrompt(messageList ?? []), [messageList]);
  const lastTurn = useMemo(() => lastTurnOutcome(messageList ?? []), [messageList]);
  const streamStatus = view.status;
  const stopped = view.cancelRequested;
  const statusDetail = boundAgent?.name ?? modelLabel;
  const status = useMemo(
    () => chatHeaderStatus({ archived, gatePending: blocked, streamStatus, stopped, lastTurn, detail: statusDetail, liveSince }),
    [archived, blocked, streamStatus, stopped, lastTurn, statusDetail, liveSince],
  );
  const hasMessages = (messages.data?.length ?? 0) > 0;
  const forking = fork.isPending;
  const canRewind = lastPrompt !== null;
  const menu = useMemo(() => chatMenu({ archived, hasMessages, streaming: isStreaming, canRewind, forking }), [archived, hasMessages, isStreaming, canRewind, forking]);
  const rowView = useMemo(
    () => chatRowView({ id: chatId, title: title, status: null, archived, lastActivityAt: '', tags: [] }),
    [chatId, title, archived],
  );
  const onMenu = useCallback(
    (itemId: string) => {
      Keyboard.dismiss();
      switch (itemId as ChatMenuId) {
        case 'rename':
          sheet.present(
            <RenameChat
              initial={chat.data?.name ?? ''}
              onSave={(name) => {
                sheet.dismiss();
                patchChat.mutate({ name } as ChatPatch);
              }}
            />,
            { title: 'Rename chat', detents: ['content'] },
          );
          return;
        case 'copy-transcript':
          void runCopyTranscript();
          return;
        case 'share':
          void Share.share({ message: transcriptText(messages.data ?? [], title) }).catch(() => toast({ kind: 'error', message: 'Could not open the share sheet.' }));
          return;
        case 'fork':
          void runFork();
          return;
        case 'rewind':
          if (lastPrompt) openRewind(lastPrompt);
          return;
        case 'open-pane':
          usePaneStore.getState().setOpen(true);
          return;
        case 'archive':
          rowActions('archive', rowView);
          return;
        case 'unarchive':
          archive.mutate('active');
          return;
        case 'delete':
          void confirm({
            title: `Delete “${title}”?`,
            message: 'The transcript and everything the agent produced in it are removed. This cannot be undone.',
            confirmLabel: 'Delete',
            icon: 'trash',
          }).then(async (yes) => {
            if (!yes) return;
            try {
              await api.chats.remove(chatId);
              router.replace(CHATS_HREF as never);
            } catch {
              haptic('error');
              toast({ kind: 'error', message: "Couldn't delete that chat." });
            }
          });
          return;
      }
    },
    [sheet, chat.data?.name, patchChat, runCopyTranscript, messages.data, title, runFork, lastPrompt, openRewind, rowActions, rowView, archive, api, chatId],
  );

  // Everything the header gets is stable across renders that change nothing it shows (MD-162).
  const headerActions = useMemo<HeaderAction[]>(() => [{ id: 'chat-menu', icon: 'more', label: 'Chat actions', menu, onMenuSelect: onMenu }], [menu, onMenu]);
  const paneOpen = paneToggle.open;
  const paneCount = paneToggle.count;
  const paneAttention = paneToggle.attention;
  const togglePane = paneToggle.onPress;
  const headerPaneToggle = useMemo(
    () => ({
      open: paneOpen,
      count: paneCount,
      attention: paneAttention,
      onPress: () => {
        Keyboard.dismiss();
        togglePane();
      },
    }),
    [paneOpen, paneCount, paneAttention, togglePane],
  );

  // The page lifts with the keyboard: the larger of its overlap and the bottom inset, never their sum.
  const dockStyle = useAnimatedStyle(() => ({ paddingBottom: Math.max(keyboard.value, insets.bottom) }), [insets.bottom]);
  const hasMore = (messages.data?.length ?? 0) >= limit;

  if (messages.isError) {
    return (
      <View className="flex-1 bg-surface">
        <Header role="workspace" title={title} breadcrumb={crumbs} onBack={onBack} testIDs={HEADER_TEST_IDS} />
        <View className="flex-1 justify-center">
          <ErrorState title="Couldn't load this chat" error={messages.error} onRetry={() => void messages.refetch()} />
        </View>
      </View>
    );
  }

  return (
    <ComposerCaptureContext.Provider value={composer.captures}>
      <View className="flex-1 bg-surface">
        <Header
          role="workspace"
          title={title}
          breadcrumb={crumbs}
          {...(status ? { status } : {})}
          onBack={onBack}
          testIDs={HEADER_TEST_IDS}
          paneToggle={headerPaneToggle}
          actions={headerActions}
        />
        <Animated.View className="flex-1" style={dockStyle}>
          {forkedFromChatId ? (
            <Pressable
              testID="fork-provenance"
              accessibilityRole="link"
              accessibilityLabel={`${forkedFromLabel(parentChat.data?.name)}. Open the original chat`}
              onPress={() => router.push(chatHref(forkedFromChatId) as never)}
              frame="none"
              className="min-h-row flex-row items-center gap-2 bg-sunken px-4 py-2"
            >
              <Icon concept="branch" size={14} tone="fg-3" />
              <Text role="footnote" tone="fg-2" numberOfLines={1} className="flex-1">
                {forkedFromLabel(parentChat.data?.name)}
              </Text>
            </Pressable>
          ) : null}
          {archived ? <Callout tone="info" form="banner" title="This chat is archived. Choose Move to active in the chat menu to continue." /> : null}
          {streamTrouble ? (
            <Callout
              tone="warn"
              form="banner"
              title={streamConnection === 'offline' ? 'Offline — the reply keeps running on your computer and appears when you reconnect.' : 'Reconnecting — the reply will pick up where it left off.'}
            />
          ) : null}
          {messages.isLoading ? (
            <View accessibilityLabel="Loading conversation" className="flex-1 justify-end px-4 pb-4">
              <Skeleton preset="transcript" />
            </View>
          ) : (
            <TranscriptView
              chatId={chatId}
              streamKey={streamKey}
              messages={messages.data}
              hasMore={hasMore}
              loadingMore={messages.isFetching}
              onLoadMore={() => setLimit((n) => n + PAGE_SIZE)}
              actions={transcriptActions}
              blocked={blocked}
              empty={
                <StarterPrompts
                  disabled={archived}
                  onPick={(text) => {
                    haptic('selection');
                    composer.props.onDraftChange(text);
                  }}
                />
              }
            />
          )}
          <Composer
            {...composer.props}
            dock={
              <>
                {isStreaming ? null : <ChangesStrip summary={changes.data} onReview={() => openTab('changes')} />}
                {dockGate ? <View className="px-3 pt-2">{dockGate}</View> : null}
              </>
            }
            onStop={stop.press}
            stopState={stop}
            isStreaming={isStreaming}
            // The server refuses a prompt while a gate is open or a turn runs, and an archived chat takes none.
            disabled={blocked || archived}
            disabledReason={archived ? 'This chat is archived.' : undefined}
            gate={gate}
            agent={boundAgent}
            modelLabel={modelLabel}
            onModelPress={() => {
              Keyboard.dismiss();
              router.push(turnHref(chatId) as never);
            }}
            working={isStreaming ? { label: activityLabelFor(view) } : null}
            workspacePrep={workspacePrep}
            onRequestScope={() => router.push('/scope-request' as never)}
          />
        </Animated.View>
      </View>
    </ComposerCaptureContext.Provider>
  );
}
