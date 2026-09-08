// ────────────────────────────────────────────────────────────────
// Inspector — the session's vital signs: usage, context, ids, transport.
//
// Everything here is already known to the screen; this is the one place it
// is laid out for reading rather than glanced at in a chip.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Copy } from 'lucide-react-native';
import type { ChatSummary, StreamUsage } from '@generatorai/client-core';

import { ListGroup, ListRow } from '../../ui/ListRow';
import { SectionHeader } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';
import { useTheme } from '../../../theme/ThemeProvider';
import { compactTokens } from '../timeline/deriveTimeline';
import { formatDuration } from '../toolPresentation';

export function InspectorSection({
  chat,
  usage,
  contextTokens,
  transportLabel,
  streamKey,
}: {
  chat: ChatSummary | undefined;
  usage: StreamUsage | null;
  contextTokens: number | null;
  transportLabel: string;
  streamKey: string;
}): React.ReactElement {
  const toast = useToast();
  const { colors } = useTheme();
  const copy = (value: string) => {
    void Clipboard.setStringAsync(value).then(() => toast({ message: 'Copied.', tone: 'success' }));
  };
  const record = (chat ?? {}) as Record<string, unknown>;
  const harness = (record['harnessConfig'] ?? {}) as Record<string, unknown>;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <SectionHeader title="Last turn" />
      <ListGroup>
        {usage ? (
          <>
            <Stat title="Model" value={usage.model} />
            <Stat title="Input tokens" value={compactTokens(usage.inputTokens)} />
            <Stat title="Output tokens" value={compactTokens(usage.outputTokens)} />
            {usage.cacheReadTokens ? <Stat title="Cache read" value={compactTokens(usage.cacheReadTokens)} /> : null}
            {usage.cacheWriteTokens ? <Stat title="Cache write" value={compactTokens(usage.cacheWriteTokens)} /> : null}
            {usage.durationMs !== undefined ? <Stat title="Duration" value={formatDuration(usage.durationMs) ?? ''} /> : null}
            {usage.cost !== undefined ? <Stat title="Cost" value={`$${usage.cost.toFixed(4)}`} /> : null}
          </>
        ) : (
          <ListRow title="No usage yet" subtitle="Usage appears once a turn completes." />
        )}
      </ListGroup>

      <SectionHeader title="Session" />
      <ListGroup>
        <Stat title="Context in use" value={contextTokens === null ? '—' : `${compactTokens(contextTokens)} tokens`} />
        <Stat title="Transport" value={transportLabel} />
        <Stat title="Mode" value={String(chat?.defaultAgentMode ?? 'auto')} />
        <Stat title="Permission mode" value={String(chat?.permissionMode ?? 'default')} />
        {typeof harness['reasoningEffort'] === 'string' ? <Stat title="Reasoning effort" value={harness['reasoningEffort']} /> : null}
        {typeof harness['contextTier'] === 'string' ? <Stat title="Context tier" value={harness['contextTier']} /> : null}
      </ListGroup>

      <SectionHeader title="Identifiers" />
      <ListGroup>
        {chat ? (
          <ListRow
            title="Chat id"
            subtitle={chat.id}
            trailing={<Copy size={16} color={colors['muted-foreground']} />}
            onPress={() => copy(chat.id)}
          />
        ) : null}
        <ListRow
          title="Session id"
          subtitle={streamKey}
          trailing={<Copy size={16} color={colors['muted-foreground']} />}
          onPress={() => copy(streamKey)}
        />
        {chat?.workspaceId ? (
          <ListRow
            title="Workspace id"
            subtitle={chat.workspaceId}
            trailing={<Copy size={16} color={colors['muted-foreground']} />}
            onPress={() => copy(chat.workspaceId!)}
          />
        ) : null}
      </ListGroup>
      <View className="h-4" />
      <Text className="px-1 text-xs text-muted-foreground">
        Usage figures are the provider's own report for the most recent turn on this device.
      </Text>
    </ScrollView>
  );
}

function Stat({ title, value }: { title: string; value: string }): React.ReactElement {
  return (
    <ListRow
      title={title}
      trailing={
        <Text selectable className="font-mono text-xs text-foreground">
          {value}
        </Text>
      }
    />
  );
}
