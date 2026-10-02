// MB-48 ChatRow (03 MB-48; MChats): one chat as an ML-14 EntityRow inside an ML-15 SwipeRow. Leading status glyph
// (none for a chat that never ran; archived rows get the neutral badge), title, pin glyph and unread dot (MG-02),
// meta = mono project · AgentGlyph agent or the sans model label (MG-03), trailing DiffStat ("—" unknown), relative
// time. With a `position` the row is part of its section's iOS inset group (raised, rounded ends, inset hairlines);
// Android rows stay flat.
// Swipe: leading Pin / Mark unread (iOS), trailing More / Archive (MD-52). Long-press: the MDF-57 menu. In selection
// mode (MD-60) the leading column is the checkbox and swipes and the menu are off.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../ui/lib/cn';
import { EntityRow } from '../../ui/layout/EntityRow';
import type { RowPosition } from '../../ui/layout/ListSection/ListSection.types';
import { IOS_GROUP_CORNERS } from '../../ui/layout/ListSection/listSectionModel';
import { nativePlatform } from '../../ui/platform/geometry';
import { SwipeRow, type SwipeAction } from '../../ui/layout/SwipeRow';
import type { MenuEntry } from '../../ui/native/Menu/Menu.types';
import { AgentGlyph } from '../../ui/primitives/AgentGlyph';
import { DiffStat } from '../../ui/primitives/DiffStat';
import { Separator } from '../../ui/primitives/Separator';
import { Text } from '../../ui/primitives/Text';
import { chatRowMenu, chatRowSpokenMeta, chatRowSwipe, type ChatRowActionId, type ChatRowView } from './chatRowModel';

export interface ChatRowProps {
  row: ChatRowView;
  onAction: (id: ChatRowActionId, row: ChatRowView) => void;
  /** Selection mode (MD-60): a checkbox, and a tap toggles. */
  selection?: { selected: boolean; onToggle: () => void };
  /** Off where swiping does not belong (palette, Home). */
  swipe?: boolean;
  position?: RowPosition;
}

/** MChats sets the project *slug* in mono; a display name ("Mobile sandbox repo") reads as prose (MD-163). */
const isSlug = (name: string): boolean => /^[a-z0-9][a-z0-9._/-]*$/.test(name);

export function ChatRow({ row, onAction, selection, swipe = true, position }: ChatRowProps): React.ReactElement {
  const meta = [
    ...(row.project
      ? [
          <Text key="project" role={isSlug(row.project) ? 'monoSm' : 'footnote'} tone="fg-3" numberOfLines={1} className="shrink">
            {row.project}
          </Text>,
        ]
      : []),
    // The board sets only the project slug in mono; the agent / model label is sans (MChats).
    ...(row.agent
      ? [<AgentGlyph key="agent" kind="agent" name={row.agent} size={14} />]
      : row.model
        ? [
            <Text key="model" role="footnote" tone="fg-2" numberOfLines={1} className="shrink">
              {row.model}
            </Text>,
          ]
        : []),
  ];
  const entity = (
    <EntityRow
      testID={`chat-row-${row.id}`}
      title={row.title}
      leading={selection ? { checkbox: selection.selected } : row.status ? { status: row.status } : { icon: 'chats' }}
      meta={meta}
      metaLabel={chatRowSpokenMeta(row)}
      time={row.time}
      pinned={row.pinned}
      unread={row.unread}
      archived={row.archived}
      trailing={<DiffStat additions={row.changes?.additions} deletions={row.changes?.deletions} />}
      selected={selection?.selected}
      onPress={selection ? selection.onToggle : () => onAction('open', row)}
      {...(selection ? {} : { menu: chatRowMenu(row) as MenuEntry[], onMenuSelect: (id: string) => onAction(id as ChatRowActionId, row) })}
    />
  );
  const { leading, trailing } = chatRowSwipe(row);
  const toAction = (a: (typeof leading)[number]): SwipeAction => ({ ...a, onPress: () => onAction(a.id, row) });
  const body =
    selection || !swipe ? (
      entity
    ) : (
      <SwipeRow leading={leading.map(toAction)} trailing={trailing.map(toAction)} fullSwipe="trailing" grouped={position !== undefined}>
        {entity}
      </SwipeRow>
    );
  if (!position || nativePlatform === 'android') return body;
  return (
    <View className={cn('overflow-hidden', IOS_GROUP_CORNERS[position])}>
      {position === 'middle' || position === 'last' ? <Separator inset={48} /> : null}
      {body}
    </View>
  );
}
