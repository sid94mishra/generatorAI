// MB-22 ChangeFileRow (MPaneChanges): the status letter (mono, `CHANGE_KIND` tone), the path with its directory dimmed
// (renamed: old → new), the open review comments, the DiffStat and the row's ⋯ / ⋮ menu — Open diff, Mention in chat,
// Copy path, Keep / Unkeep (`keep-file` / `unkeep-file`), Discard changes (destructive, confirmed by the caller). Tap
// opens the diff. Every menu item is also an accessibility action on the row (MD-28).
import React from 'react';
import { View } from 'react-native';

import type { MenuEntry } from '../../ui/native/Menu/Menu.types';
import { Menu } from '../../ui/native/Menu';
import { overflowIcon } from '../../ui/platform/overflow';
import { DiffStat } from '../../ui/primitives/DiffStat';
import { Icon } from '../../ui/primitives/Icon';
import { IconButton } from '../../ui/primitives/IconButton';
import { Pressable } from '../../ui/primitives/Pressable';
import { Spinner } from '../../ui/primitives/Spinner';
import { Text } from '../../ui/primitives/Text';
import { changeLetter, changeRowLabel, changeTone, splitPath, type ChangeRow } from './model/changeKinds';

export type ChangeRowAction = 'open' | 'mention' | 'copy' | 'keep' | 'unkeep' | 'discard';

export interface ChangeFileRowProps {
  row: ChangeRow;
  /** Prefix the mount alias (more than one mount). */
  showAlias: boolean;
  comments: number;
  busy: boolean;
  /** Which actions this device may take. */
  can: { review: boolean; discard: boolean; mention: boolean };
  onAction: (action: ChangeRowAction, row: ChangeRow) => void;
}

export function changeRowMenu(row: Pick<ChangeRow, 'kept'>, can: ChangeFileRowProps['can']): MenuEntry[] {
  const entries: MenuEntry[] = [{ id: 'open', label: 'Open diff', icon: 'diff' }];
  if (can.mention) entries.push({ id: 'mention', label: 'Mention in chat', icon: 'mention' });
  entries.push({ id: 'copy', label: 'Copy path', icon: 'copy' });
  if (can.review) entries.push(row.kept ? { id: 'unkeep', label: 'Unkeep', icon: 'undo', testID: 'unkeep-file' } : { id: 'keep', label: 'Keep', icon: 'check', testID: 'keep-file' });
  if (can.discard) entries.push({ type: 'separator' }, { id: 'discard', label: 'Discard changes', icon: 'undo', destructive: true });
  return entries;
}

export function ChangeFileRow({ row, showAlias, comments, busy, can, onAction }: ChangeFileRowProps): React.ReactElement {
  const { dir, name } = splitPath(row.path);
  const prefix = showAlias && row.alias !== '.' ? `${row.alias}/` : '';
  const menu = changeRowMenu(row, can);
  const items = menu.filter((e): e is Extract<MenuEntry, { id: string }> => !('type' in e));
  // The actions menu sits beside the row, not inside it: an accessible row hides its children, so a nested button
  // was unreachable for VoiceOver focus and for automation (the row's custom actions stay for screen readers).
  return (
    <View className="min-h-item flex-row items-center pe-1">
      <Pressable
        testID="changes-file-row"
        frame="none"
        onPress={() => onAction('open', row)}
        accessibilityRole="button"
        accessibilityLabel={changeRowLabel(row, comments)}
        accessibilityHint="Opens the diff"
        accessibilityActions={items.filter((e) => e.id !== 'open').map((e) => ({ name: e.id, label: e.label }))}
        onAccessibilityAction={(name) => onAction(name as ChangeRowAction, row)}
        className="min-h-item flex-1 flex-row items-center gap-3 ps-4"
      >
        <Text role="mono" weight={600} tone={changeTone(row.status)} className="w-3">
          {changeLetter(row.status)}
        </Text>
        <Text role="mono" numberOfLines={1} ellipsizeMode="middle" className="flex-1">
          {row.status === 'renamed' && row.oldPath ? (
            <Text role="mono" tone="fg-3">{`${row.oldPath} → `}</Text>
          ) : null}
          <Text role="mono" tone="fg-3">{`${prefix}${dir}`}</Text>
          {name}
        </Text>
        {comments > 0 ? (
          <View className="flex-row items-center gap-0.5">
            <Icon concept="message" size={12} tone="fg-3" />
            <Text role="monoSm" tone="fg-3">
              {comments}
            </Text>
          </View>
        ) : null}
        {busy ? <Spinner size={14} /> : <DiffStat additions={row.additions} deletions={row.deletions} />}
      </Pressable>
      <Menu
        items={menu}
        onSelect={(id) => onAction(id as ChangeRowAction, row)}
        accessibilityLabel={`Actions for ${row.path}`}
        trigger={<IconButton icon={overflowIcon} size="sm" label={`Actions for ${row.path}`} onPress={() => undefined} />}
        testID="changes-file-menu"
      />
    </View>
  );
}
