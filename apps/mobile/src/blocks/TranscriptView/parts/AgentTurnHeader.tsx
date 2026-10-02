// MB-09 AgentTurnHeader: who answered (AgentGlyph: bot + agent name + model, or the model alone for model-only
// chats) and the mono time; the actions menu (`assistant-message-actions`): Copy, Copy transcript
// (`copy-transcript`), Fork from here (`fork-chat`), Read aloud.
import React, { memo } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { Menu } from '../../../ui/native/Menu';
import type { MenuEntry } from '../../../ui/native/Menu/Menu.types';
import { AgentGlyph } from '../../../ui/primitives/AgentGlyph';
import { IconButton } from '../../../ui/primitives/IconButton';
import { Text } from '../../../ui/primitives/Text';
import { useTranscriptActions } from '../transcriptContext';

const clock = (iso: string): string => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export interface AgentTurnHeaderProps {
  time: string | null;
  turnId?: string;
  /** The turn's answer text (Copy, Read aloud). */
  text: string;
}

export const AgentTurnHeader = memo(function AgentTurnHeader({ time, turnId, text }: AgentTurnHeaderProps): React.ReactElement {
  const { agent, model, onCopyTranscript, onForkFrom, onReadAloud } = useTranscriptActions();
  const items: MenuEntry[] = [
    ...(text ? [{ id: 'copy', label: 'Copy', icon: 'copy' as const }] : []),
    ...(onCopyTranscript ? [{ id: 'copy-transcript', label: 'Copy transcript', icon: 'copy' as const, testID: 'copy-transcript' }] : []),
    ...(onForkFrom && turnId ? [{ id: 'fork', label: 'Fork from here', icon: 'branch' as const, testID: 'fork-chat' }] : []),
    ...(onReadAloud && text ? [{ id: 'read', label: 'Read aloud', icon: 'mic' as const }] : []),
  ];
  const select = (id: string): void => {
    if (id === 'copy') void Clipboard.setStringAsync(text);
    else if (id === 'copy-transcript') onCopyTranscript?.();
    else if (id === 'fork' && turnId) onForkFrom?.(turnId);
    else if (id === 'read') onReadAloud?.(text);
  };
  return (
    <View className="flex-row items-center gap-2">
      <View className="min-w-0 flex-1">
        {agent ? <AgentGlyph kind="agent" name={agent.name} {...(model ? { model } : {})} size={14} /> : model ? <AgentGlyph kind="model" name={model} size={14} /> : null}
      </View>
      {time ? (
        <Text role="monoSm" tone="fg-3" chrome>
          {clock(time)}
        </Text>
      ) : null}
      {items.length ? (
        <Menu items={items} onSelect={select} accessibilityLabel="Message actions" testID="assistant-message-actions" trigger={<IconButton icon="more" label="Message actions" size="sm" onPress={() => undefined} />} />
      ) : null}
    </View>
  );
});
