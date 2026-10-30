// MB-08 UserMessage: the end-aligned bubble (`bg-raised` + 1px `border-line-soft`, transcript 16/1.45, the tail on
// the end-bottom corner), attachment chips above the text, long prompts collapsed to 8 lines with "Show more".
// Long-press menu: Copy, Rewind to here (the rewind sheet, `rewind-sheet-*`), Share. Pending (optimistic) bubbles
// draw at 60 % with a clock glyph. Spoken "You, <time>: <text>".
import React, { memo, useMemo, useState } from 'react';
import { Share, View, useWindowDimensions } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { MessageAttachment } from '@generatorai/client-core';

import { cn } from '../../../ui/lib/cn';
import { spokenRelative } from '../../../ui/lib/format';
import { ContextMenu } from '../../../ui/native/ContextMenu';
import type { MenuEntry } from '../../../ui/native/Menu/Menu.types';
import { Chip } from '../../../ui/primitives/Chip';
import { Icon } from '../../../ui/primitives/Icon';
import { Pressable } from '../../../ui/primitives/Pressable';
import { Text } from '../../../ui/primitives/Text';
import { useTranscriptActions } from '../transcriptContext';

export const USER_BUBBLE_COLLAPSE_CHARS = 600;
const COLLAPSED_LINES = 8;

export interface UserMessageProps {
  text: string;
  attachments?: readonly MessageAttachment[];
  time?: string | null;
  turnId?: string;
  pending?: boolean;
}

export const UserMessage = memo(function UserMessage({ text, attachments = [], time, turnId, pending = false }: UserMessageProps): React.ReactElement {
  const { onRewind } = useTranscriptActions();
  // MB-08: ≈ 320–330 on phones, 80 % up to 380 on wider windows.
  const maxWidth = Math.min(useWindowDimensions().width * 0.82, 380);
  const long = text.length > USER_BUBBLE_COLLAPSE_CHARS || text.split('\n').length > COLLAPSED_LINES + 4;
  const [expanded, setExpanded] = useState(false);
  const collapsed = long && !expanded;
  const menu = useMemo<MenuEntry[]>(
    () => [
      { id: 'copy', label: 'Copy', icon: 'copy' },
      ...(onRewind && turnId ? [{ id: 'rewind', label: 'Rewind to here', icon: 'history' as const }] : []),
      { id: 'share', label: 'Share', icon: 'external-link' },
    ],
    [onRewind, turnId],
  );
  const select = (id: string): void => {
    if (id === 'copy') void Clipboard.setStringAsync(text);
    else if (id === 'rewind' && turnId) onRewind?.(turnId, text);
    else if (id === 'share') void Share.share({ message: text }).catch(() => undefined);
  };
  const label = `You${time ? `, ${spokenRelative(time)}` : ''}${pending ? ', sending' : ''}: ${text}`;
  const bubble = (
    <Pressable frame="none" feedback="none" accessibilityRole="text" accessibilityLabel={label} style={{ maxWidth }} className={cn('items-end gap-1.5 self-end', pending && 'opacity-60')}>
      {attachments.length ? (
        <View className="flex-row flex-wrap justify-end gap-1.5">
          {attachments.map((a) => (
            <Chip key={a.artifactId ?? a.path} variant="attachment" label={a.name} icon={a.mimeType?.startsWith("image/") ? "image" : "attach"} />
          ))}
        </View>
      ) : null}
      {text ? (
        <View className="rounded-card-lg rounded-ee-badge border border-line-soft bg-raised px-3.5 py-2.5">
          <Text role="transcript" selectable={!collapsed} {...(collapsed ? { numberOfLines: COLLAPSED_LINES } : {})}>
            {text}
          </Text>
          {long ? (
            <Pressable onPress={() => setExpanded((v) => !v)} accessibilityRole="button" accessibilityLabel={expanded ? 'Show less' : 'Show more'} className="self-start">
              <Text role="footnote" weight={600} tone="fg-2">
                {expanded ? 'Show less' : 'Show more'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {pending ? <Icon concept="clock" size={12} tone="fg-3" /> : null}
    </Pressable>
  );
  return (
    <View className="items-end">
      {text && !pending ? (
        <ContextMenu items={menu} onSelect={select}>
          {bubble}
        </ContextMenu>
      ) : (
        bubble
      )}
    </View>
  );
});
