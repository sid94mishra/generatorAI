// ────────────────────────────────────────────────────────────────
// UserMessageRow — the right-aligned bubble, with attachment chips.
//
// Long-press is the only route to copy or share on a phone (web has
// neither). Attachments come from the message's `attachments` array; each
// renders as a chip so a prompt that shipped a screenshot says so, instead
// of reading as bare text once history replaces the optimistic bubble.
//
// A user bubble is also the anchor for REWIND: "go back to just before I
// sent this" is a thing you say about a prompt, which is exactly why Claude
// Code's `/rewind` lists user prompts and nothing else. That action is
// reachable two ways on purpose:
//
//   • long-press, the gesture the row already taught, and
//   • an explicit "⋯" button under the bubble.
//
// The button is not redundant. A long-press is undiscoverable — nothing on
// screen says a message has actions — and it is unavailable to a switch- or
// screen-reader user, who gets it through the actions rotor instead. Both
// routes open the SAME menu, built once here.
// ────────────────────────────────────────────────────────────────

import React, { memo, useMemo } from 'react';
import { Platform, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Copy, Ellipsis, FileImage, History, Paperclip, Share2 } from 'lucide-react-native';
import type { ChatMessage } from '@generatorai/client-core';

import { StaticChip } from '../../ui/Chip';
import { IconButton } from '../../ui/Button';
import { ContextMenu, useContextMenu, type ContextMenuItem } from '../../ui/ContextMenu';
import { useToast } from '../../ui/Toast';
import { useTheme } from '../../../theme/ThemeProvider';
import { messageAttachments } from './chatMessageToBlocks';
import { useTimelineActions } from './TimelineActions';

const MENU_TITLE = 'Your message';

export const UserMessageRow = memo(function UserMessageRow({ message }: { message: ChatMessage }): React.ReactElement {
  const toast = useToast();
  const { colors } = useTheme();
  const { open } = useContextMenu();
  const { onRewind } = useTimelineActions();
  const attachments = useMemo(() => messageAttachments(message), [message]);

  // Optimistic bubbles have no turn id yet (the server assigns it), so the
  // rewind item simply is not offered on them — there is nothing to anchor
  // to, and an item that always failed would be worse than its absence.
  const turnId = message.metadata?.turnId;

  const items = useMemo<ContextMenuItem[]>(
    () => [
      {
        label: 'Copy text',
        icon: <Copy size={18} color={colors.foreground} />,
        onPress: () => {
          void Clipboard.setStringAsync(message.content).then(() => toast({ message: 'Copied.', tone: 'success' }));
        },
      },
      ...(onRewind && turnId
        ? [
            {
              label: 'Rewind to here',
              detail: 'Restore the files, the conversation, or both.',
              icon: <History size={18} color={colors.foreground} />,
              onPress: () => onRewind(turnId, message.content),
            },
          ]
        : []),
      // react-native-web's `Share` rejects on browsers without the Web Share
      // API; offer the item only where a share sheet can actually open.
      ...(Platform.OS !== 'web' || typeof navigator?.share === 'function'
        ? [
            {
              label: 'Share',
              icon: <Share2 size={18} color={colors.foreground} />,
              onPress: () => {
                void Share.share({ message: message.content }).catch(() => {
                  toast({ message: 'Could not open the share sheet.', tone: 'error' });
                });
              },
            },
          ]
        : []),
    ],
    [message.content, colors.foreground, toast, onRewind, turnId],
  );

  const hasMenu = Boolean(message.content) && items.length > 0;

  return (
    <ContextMenu
      items={message.content ? items : []}
      title={MENU_TITLE}
      accessibilityLabel={`You said: ${message.content}`}
      className="items-end"
    >
      <View className="max-w-[85%] items-end gap-1.5">
        {attachments.length > 0 ? (
          <View className="flex-row flex-wrap justify-end gap-1.5">
            {attachments.map((a) => (
              <StaticChip
                key={a.artifactId ?? a.path}
                label={a.name}
                size="sm"
                icon={
                  a.mimeType?.startsWith('image/') ? (
                    <FileImage size={12} color={colors['muted-foreground']} />
                  ) : (
                    <Paperclip size={12} color={colors['muted-foreground']} />
                  )
                }
              />
            ))}
          </View>
        ) : null}
        {message.content ? (
          <View className="rounded-3xl bg-accent px-3.5 py-2.5">
            <Text selectable className="text-md leading-relaxed text-foreground">
              {message.content}
            </Text>
          </View>
        ) : null}
        {hasMenu ? (
          <IconButton
            testID="user-message-actions"
            accessibilityLabel="Message actions"
            accessibilityHint="Copy, rewind to here, or share"
            variant="ghost"
            compact
            icon={<Ellipsis size={16} color={colors['muted-foreground']} />}
            onPress={() => open(items, { title: MENU_TITLE })}
          />
        ) : null}
      </View>
    </ContextMenu>
  );
});
