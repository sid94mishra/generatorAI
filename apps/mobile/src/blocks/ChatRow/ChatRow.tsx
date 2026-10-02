// MB-48 ChatRow (03 MB-48; MChats): one chat as an ML-14 EntityRow inside an ML-15 SwipeRow. Leading status glyph
// (none for a chat that never ran; archived rows get the neutral badge), title, pin glyph and unread dot (MG-02),
// meta = mono project · AgentGlyph agent or the model label (MG-03), trailing DiffStat ("—" unknown), relative time.
// Swipe: leading Pin / Mark unread (iOS), trailing More / Archive (MD-52). Long-press: the MDF-57 menu. In selection
// mode (MD-60) the leading column is the checkbox and swipes and the menu are off.
import React from 'react';

import { EntityRow } from '../../ui/layout/EntityRow';
import type { RowPosition } from '../../ui/layout/ListSection/ListSection.types';
import { SwipeRow, type SwipeAction } from '../../ui/layout/SwipeRow';
import type { MenuEntry } from '../../ui/native/Menu/Menu.types';
import { AgentGlyph } from '../../ui/primitives/AgentGlyph';
import { DiffStat } from '../../ui/primitives/DiffStat';
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

export function ChatRow({ row, onAction, selection, swipe = true, position }: ChatRowProps): React.ReactElement {
  const meta = [
    ...(row.project
      ? [
          <Text key="project" role="monoSm" tone="fg-3" numberOfLines={1} className="shrink">
            {row.project}
          </Text>,
        ]
      : []),
    ...(row.agent ? [<AgentGlyph key="agent" kind="agent" name={row.agent} size={14} />] : row.model ? [row.model] : []),
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
      position={position}
      onPress={selection ? selection.onToggle : () => onAction('open', row)}
      {...(selection ? {} : { menu: chatRowMenu(row) as MenuEntry[], onMenuSelect: (id: string) => onAction(id as ChatRowActionId, row) })}
    />
  );
  if (selection || !swipe) return entity;
  const { leading, trailing } = chatRowSwipe(row);
  const toAction = (a: (typeof leading)[number]): SwipeAction => ({ ...a, onPress: () => onAction(a.id, row) });
  return (
    <SwipeRow leading={leading.map(toAction)} trailing={trailing.map(toAction)} fullSwipe="trailing">
      {entity}
    </SwipeRow>
  );
}
