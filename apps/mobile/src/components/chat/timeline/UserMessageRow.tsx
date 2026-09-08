// ────────────────────────────────────────────────────────────────
// UserMessageRow — the right-aligned bubble, with attachment chips.
//
// Long-press is the only route to copy or share on a phone (web has
// neither). Attachments come from the message's `attachments` array; each
// renders as a chip so a prompt that shipped a screenshot says so, instead
// of reading as bare text once history replaces the optimistic bubble.
// ────────────────────────────────────────────────────────────────

import React, { memo, useMemo } from 'react';
import { Platform, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Copy, FileImage, Paperclip, Share2 } from 'lucide-react-native';
import type { ChatMessage } from '@generatorai/client-core';

import { StaticChip } from '../../ui/Chip';
import { ContextMenu, type ContextMenuItem } from '../../ui/ContextMenu';
import { useToast } from '../../ui/Toast';
import { useTheme } from '../../../theme/ThemeProvider';
import { messageAttachments } from './chatMessageToBlocks';

export const UserMessageRow = memo(function UserMessageRow({ message }: { message: ChatMessage }): React.ReactElement {
  const toast = useToast();
  const { colors } = useTheme();
  const attachments = useMemo(() => messageAttachments(message), [message]);

  const items = useMemo<ContextMenuItem[]>(
    () => [
      {
        label: 'Copy text',
        icon: <Copy size={18} color={colors.foreground} />,
        onPress: () => {
          void Clipboard.setStringAsync(message.content).then(() => toast({ message: 'Copied.', tone: 'success' }));
        },
      },
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
    [message.content, colors.foreground, toast],
  );

  return (
    <ContextMenu
      items={message.content ? items : []}
      title="Your message"
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
      </View>
    </ContextMenu>
  );
});
