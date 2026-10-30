// Send to agent (MX-09, MShortcuts; `/share`, a route sheet at the large detent; 06 §7.7, MD-190): what was shared
// (file name, type and size; a link; text), Existing chat / New chat, the recent chats with their status (glyph +
// word) or the agent and project a new chat starts with, an optional note, the server it goes to, and Send — the
// one filled button. Nothing is sent before Send; a sent share opens its chat. The shared content comes from the
// share intake (services/native/shareIntent), never from the link that opened this sheet.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useNavigation } from 'expo-router';
import { newIdempotencyKey } from '@generatorai/client-core';

import { ChatRow } from '../../blocks/ChatRow';
import { ServerSwitcherTrigger } from '../../blocks/ServerSwitcher';
import { chatHref } from '../../blocks/shell/hrefs';
import { useAuth } from '../../services/auth/AuthProvider';
import { shareStore, useSharePayload } from '../../services/native/shareIntent';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { RouteSheet } from '../../ui/native/Sheet';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { Textarea } from '../../ui/primitives/Textarea';
import { toast } from '../../ui/primitives/Toast';
import { useRecentChats, useSendShare, useShareAgents, useShareProjects } from './queries';
import { fileIcon, fileKind, formatSize, shareProblem, shareTarget, textPreview, type ShareMode } from './shareModel';

type Href = Parameters<typeof router.replace>[0];

const MODES = [
  { value: 'existing' as const, label: 'Existing chat' },
  { value: 'new' as const, label: 'New chat' },
];

export default function ShareScreen(): React.ReactElement {
  const navigation = useNavigation();
  const payload = useSharePayload();
  const { servers } = useAuth();
  const [mode, setMode] = useState<ShareMode>('existing');
  const [chatId, setChatId] = useState<string | null>(null);
  const [agentRef, setAgentRef] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  // One key per opened share: pressing Send again after a lost answer replays instead of sending twice (MG-09).
  const [idempotencyKey] = useState(newIdempotencyKey);

  const recent = useRecentChats();
  const agents = useShareAgents(projectId);
  const projects = useShareProjects();
  const send = useSendShare();

  const chosen = recent.rows.find((r) => r.id === chatId) ?? null;
  const problem = shareProblem(payload);
  const target = shareTarget(mode, chatId, { agentRef, projectId });
  const agentOptions = useMemo(
    () => [{ value: '', label: 'Default' }, ...(agents.data ?? []).filter((a) => a.enabled).map((a) => ({ value: a.ref, label: a.name }))],
    [agents.data],
  );
  const projectOptions = useMemo(() => [{ value: '', label: 'None' }, ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))], [projects.data]);

  const close = (): void => {
    shareStore.clear();
    if (router.canGoBack()) router.back();
    else router.replace('/' as Href);
  };

  const submit = (): void => {
    if (!payload || !target || problem) return;
    send.mutate(
      { payload, target, note, idempotencyKey },
      {
        onSuccess: (result) => {
          shareStore.clear();
          router.replace(chatHref(result.chatId) as Href);
        },
        onError: (e) => toast({ kind: 'error', message: e instanceof Error ? e.message : "Couldn't send. Try again." }),
      },
    );
  };

  const footer = (
    <Button
      label="Send"
      icon="send"
      size="lg"
      fullWidth
      loading={send.isPending}
      disabled={!payload || !target || problem !== null}
      disabledReason={problem ?? (target ? undefined : 'Pick a chat')}
      onPress={submit}
      testID="share-send"
    />
  );

  return (
    <RouteSheet title="Send to agent" onDismiss={close} dirty={note.trim().length > 0 && !send.isSuccess} navigation={navigation as never} footer={footer} scrollable testID="share-sheet">
      <View className="gap-4">
        {payload ? (
          <ListSection title="Sharing">
            {payload.files.map((f, i) => (
              <ListRow key={`${f.uri}-${i}`} kind="info" icon={fileIcon(f.mimeType)} title={f.name} subtitle={[fileKind(f.mimeType), formatSize(f.size)].filter(Boolean).join(' · ')} testID={`share-file-${i}`} />
            ))}
            {payload.url ? <ListRow kind="info" icon="link" title={payload.url} subtitle="Link · sent as text" testID="share-url" /> : null}
            {payload.text ? <ListRow kind="info" icon="file-text" title={textPreview(payload.text)} subtitle={`Text · ${payload.text.length} characters`} testID="share-text" /> : null}
          </ListSection>
        ) : null}
        {problem ? (
          <View className="px-4">
            <Callout tone={payload ? 'warn' : 'info'} title={problem} {...(payload ? {} : { body: 'Share a file, a link or text to GeneratorAI from another app.' })} testID="share-problem" />
          </View>
        ) : null}

        <View className="px-4">
          <SegmentedControl segments={MODES} value={mode} onValueChange={setMode} accessibilityLabel="Send to" fullWidth testID="share-mode" />
        </View>

        {mode === 'existing' ? (
          <>
            <ListSection title="Recent chats" footer={recent.isError ? "Couldn't load your chats." : undefined}>
              {recent.rows.length === 0 && !recent.isLoading ? <ListRow kind="info" title="No chats yet" subtitle="Send it to a new chat instead" /> : null}
              {recent.rows.map((row) => (
                <ChatRow key={row.id} row={row} swipe={false} onAction={() => setChatId(row.id)} selection={{ selected: row.id === chatId, onToggle: () => setChatId(row.id) }} />
              ))}
            </ListSection>
            {chosen ? (
              <ListSection footer="Set when the chat was created. Start a new chat to pick another agent.">
                <ListRow kind="value" icon="lock" title="Agent" value={chosen.agent ?? chosen.model ?? 'Default'} testID="share-locked-agent" />
              </ListSection>
            ) : null}
          </>
        ) : (
          <ListSection title="New chat" footer="Named from what you share. The agent is fixed once the chat starts.">
            <ListRow kind="picker" icon="agents" title="Agent" picker={{ value: agentRef ?? '', options: agentOptions, onValueChange: (v) => setAgentRef(v || null), searchable: agentOptions.length > 30 }} testID="share-agent" />
            <ListRow
              kind="picker"
              icon="projects"
              title="Project"
              picker={{ value: projectId ?? '', options: projectOptions, onValueChange: (v) => { setProjectId(v || null); setAgentRef(null); }, searchable: projectOptions.length > 30 }}
              testID="share-project"
            />
          </ListSection>
        )}

        <View className="px-4">
          <Textarea label="Note (optional)" value={note} onChangeText={setNote} placeholder="What should the agent do with it?" minRows={3} testID="share-note" />
        </View>

        <ListSection footer={servers.length > 1 ? 'Sends to this server. Tap to choose another.' : undefined}>
          <View className="px-4 py-2">
            <ServerSwitcherTrigger {...(servers.length > 1 ? { onPress: () => router.push('/servers' as Href) } : {})} />
          </View>
        </ListSection>
      </View>
    </RouteSheet>
  );
}
