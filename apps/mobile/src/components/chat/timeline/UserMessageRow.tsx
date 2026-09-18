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
// Code's `/rewind` lists user prompts and nothing else. It is reached by
// long-press — the convention every messaging app teaches for a bubble — and
// by a screen- or switch-reader user through the actions rotor, which
// `ContextMenu` exposes. The "⋯" that used to sit under every bubble is gone:
// repeated under each message it was the noisiest thing in the transcript.
// Rewind is also offered from the header menu's history section.
// ────────────────────────────────────────────────────────────────

import React, { memo, useMemo, useState } from 'react';
import { Platform, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Copy, FileImage, History, Paperclip, Share2 } from 'lucide-react-native';
import type { ChatMessage } from '@generatorai/client-core';

import { StaticChip } from '../../ui/Chip';
import { ContextMenu, type ContextMenuItem } from '../../ui/ContextMenu';
import { useToast } from '../../ui/Toast';
import { useTheme } from '../../../theme/ThemeProvider';
import { messageAttachments } from './chatMessageToBlocks';
import { useTimelineActions } from './TimelineActions';

const MENU_TITLE = 'Your message';

export const UserMessageRow = memo(function UserMessageRow({ message }: { message: ChatMessage }): React.ReactElement {
  const toast = useToast();
  const { colors } = useTheme();
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
        {message.content ? <UserBubbleText text={message.content} /> : null}
      </View>
    </ContextMenu>
  );
});

/** Past this many characters a prompt collapses to its first lines. */
export const USER_BUBBLE_COLLAPSE_CHARS = 600;
const COLLAPSED_LINES = 8;

/**
 * Long prompts (pasted logs, a workflow stage's injected instructions) filled
 * the whole screen with one bubble on a phone. They open collapsed with a
 * "Show more" toggle; the full text stays selectable once expanded and is
 * always available to screen readers.
 */
function UserBubbleText({ text }: { text: string }): React.ReactElement {
  const long = text.length > USER_BUBBLE_COLLAPSE_CHARS || text.split('\n').length > COLLAPSED_LINES + 4;
  const [expanded, setExpanded] = useState(false);
  const collapsed = long && !expanded;
  return (
    <View className="rounded-3xl bg-accent px-3.5 py-2.5">
      <Text
        selectable={!collapsed}
        accessibilityLabel={text}
        {...(collapsed ? { numberOfLines: COLLAPSED_LINES } : {})}
        className="text-md leading-relaxed text-foreground"
      >
        {text}
      </Text>
      {long ? (
        <Text
          accessibilityRole="button"
          onPress={() => setExpanded((v) => !v)}
          suppressHighlighting
          className="min-h-11 pt-2 text-sm font-semibold text-primary"
        >
          {expanded ? 'Show less' : 'Show more'}
        </Text>
      ) : null}
    </View>
  );
}
