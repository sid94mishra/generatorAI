// ────────────────────────────────────────────────────────────────
// useChatWorkspace — the chat record and what it is working on: model /
// effort / context tier (synced from the record, persisted on change), the
// mounts that name changed files, workspace preparation, the chat's live
// event stream and its registration in the chat store.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentMode } from '@generatorai/shared';
import { useChat, useHarnessConfig, useUpdateChat } from '@/hooks/queries.js';
import { useModels } from '@/hooks/harnessQueries.js';
import { useChatSessionConnection } from '@/hooks/chatSessionQueries.js';
import { usePrepareChatWorkspace, useWorkspaceInfo } from '@/hooks/sourceQueries.js';
import { usePageTitle } from '@/hooks/usePageTitle.js';
import { useChatStore } from '@/stores/chatStore.js';
import { useEditorTarget } from '@/stores/editorTargetStore.js';
import type { PathRoot } from '@/blocks/changes/changePaths.js';

export function useChatWorkspace(chatId: string | undefined) {
  const { data: chat, isLoading: chatLoading, error: chatError } = useChat(chatId);
  usePageTitle(chat?.name);
  const sessionId = chat?.sessionId;

  // The chat's MODEL decides the provider (a `sonnet` chat runs on the Claude
  // agent even when the server's primary harness is Copilot), so the label
  // follows the model's provider and only falls back to the server default.
  // The empty state used to name Copilot unconditionally, which is wrong for
  // a self-hosted install running another harness.
  const { data: harnessConfig } = useHarnessConfig();
  const { data: catalogModels } = useModels();
  const chatModelProvider = chat?.model
    ? catalogModels?.find((m) => m.id === chat.model)?.provider
    : undefined;
  const harnessProvider: string | null = chatModelProvider || harnessConfig?.harness?.type || null;

  const updateChatMutation = useUpdateChat(chatId ?? '');

  // Starts empty rather than at a hardcoded id: the composer resolves an empty
  // selection to the first model the account actually has, whereas a stale
  // literal matches nothing in the live catalog and hides every model-derived
  // control.
  const [selectedModel, setSelectedModel] = useState<string>(chat?.model ?? '');
  const [reasoningEffort, setReasoningEffort] = useState<string | undefined>(chat?.harnessConfig?.reasoningEffort);
  const [contextTier, setContextTier] = useState<string | undefined>(chat?.harnessConfig?.contextTier);
  const [gitRepositories, setGitRepositories] = useState<Array<{ url: string; branch: string; alias: string }>>([]);
  const [selectedCodebaseIds, setSelectedCodebaseIds] = useState<string[]>(chat?.codebaseIds ?? []);

  // Workspace preparation — the composer's Send is held back while mounts are
  // still being created, and the error state offers the two ways out.
  const prepareWorkspace = usePrepareChatWorkspace(chatId);

  // The chat's mounts — the authority for naming a changed file (which mount
  // it belongs to, and what the chat calls that mount). Falls back to the
  // legacy local-folder list for chats created before mounts existed.
  const { data: workspaceInfo } = useWorkspaceInfo(chat?.workspaceId);
  const workspaceMounts = workspaceInfo?.mounts;

  // The top bar's "Open in editor" opens the chat's PRIMARY mount — the
  // directory the agent has as its cwd — not the workspace scratch root,
  // which is where state files live and nothing the user wants to edit.
  const primaryMountPath = useMemo(() => {
    const live = (workspaceMounts ?? []).filter((m) => m.status !== 'removed');
    const sorted = [...live].sort((a, b) => a.position - b.position);
    return sorted[0]?.path ?? workspaceInfo?.workingDirectory;
  }, [workspaceMounts, workspaceInfo?.workingDirectory]);
  useEditorTarget(primaryMountPath, chat?.name ?? 'Chat');
  const legacyFolders = chat?.gitRepositories;
  const pathRoots = useMemo<PathRoot[]>(() => {
    const mounts = (workspaceMounts ?? []).filter((m) => m.status !== 'removed');
    if (mounts.length > 0) return mounts.map((m) => ({ alias: m.alias, path: m.path }));
    return (legacyFolders ?? []).map((r) => r.url).filter((u): u is string => !!u);
  }, [workspaceMounts, legacyFolders]);

  // Sync model and codebaseIds from the loaded chat entity.
  useEffect(() => {
    if (chat?.model) {
      setSelectedModel(chat.model);
    }
    if (chat?.harnessConfig?.reasoningEffort) {
      setReasoningEffort(chat.harnessConfig.reasoningEffort);
    }
    if (chat?.harnessConfig?.contextTier) {
      setContextTier(chat.harnessConfig.contextTier);
    }
    if (chat?.codebaseIds !== undefined) {
      setSelectedCodebaseIds(chat.codebaseIds);
    }
    if (chat?.gitRepositories?.length) {
      setGitRepositories(chat.gitRepositories.map((r) => ({ url: r.url, branch: '', alias: r.alias })));
    }
  }, [chat?.model, chat?.harnessConfig?.reasoningEffort, chat?.harnessConfig?.contextTier, chat?.codebaseIds, chat?.gitRepositories]);

  // The chat entity is authoritative until the user picks something else.
  // `selectedModel` is only synced in an effect, and React runs the composer's
  // effects before this page's, so reading it directly would hand the
  // composer an empty selection for one commit — long enough for its catalog
  // fallback to fire and persist the wrong model over the chat's own.
  const effectiveModel = selectedModel || chat?.model || '';

  // E-4: a model is sent with its provider. Without it the server — rightly — never lets a model name alone move an
  // established conversation to another provider, so picking Sonnet in a Codex chat showed "Sonnet 5.5" while the
  // next turn kept running on Codex.
  const changeModel = useCallback((model: string) => {
    if (!chat) return;
    setSelectedModel(model);
    const provider = catalogModels?.find((m) => m.id === model)?.provider;
    const cfg = chat.harnessConfig ?? {};
    updateChatMutation.mutate({
      model,
      ...(provider
        ? { harnessConfig: { ...cfg, harnessType: provider as NonNullable<typeof cfg.harnessType>, ...(cfg.model ? { model } : {}) } }
        : {}),
    });
  }, [chat, catalogModels, updateChatMutation]);

  // Effort and tier persist into harnessConfig, merged with what is there.
  const changeReasoningEffort = useCallback((effort: string) => {
    setReasoningEffort(effort);
    updateChatMutation.mutate({
      harnessConfig: { ...(chat?.harnessConfig ?? {}), reasoningEffort: effort },
    });
  }, [updateChatMutation, chat?.harnessConfig]);

  const changeContextTier = useCallback((tier: string) => {
    setContextTier(tier);
    updateChatMutation.mutate({
      harnessConfig: { ...(chat?.harnessConfig ?? {}), contextTier: tier },
    });
  }, [updateChatMutation, chat?.harnessConfig]);

  /** Persist the chat's sticky default agent mode (the composer's picker). */
  const persistAgentMode = useCallback(
    (mode: AgentMode) => {
      if (chatId) updateChatMutation.mutate({ defaultAgentMode: mode });
    },
    [chatId, updateChatMutation],
  );

  useChatSessionConnection(chatId, sessionId);

  // Register the chat entity in the chat store cache (re-runs on data updates).
  useEffect(() => {
    if (chat && sessionId) {
      useChatStore.getState().registerChat(chat.id, sessionId, chat);
    }
  }, [chat, sessionId]);

  useEffect(() => {
    if (chatId) {
      useChatStore.getState().setActiveChatId(chatId);
    }
    return () => {
      useChatStore.getState().setActiveChatId(null);
    };
  }, [chatId]);

  return {
    chat,
    chatLoading,
    chatError,
    sessionId,
    harnessProvider,
    effectiveModel,
    changeModel,
    reasoningEffort,
    changeReasoningEffort,
    contextTier,
    changeContextTier,
    gitRepositories,
    selectedCodebaseIds,
    persistAgentMode,
    retryWorkspacePrep: () => prepareWorkspace.mutate(),
    workspacePrepRetrying: prepareWorkspace.isPending,
    pathRoots,
  };
}
