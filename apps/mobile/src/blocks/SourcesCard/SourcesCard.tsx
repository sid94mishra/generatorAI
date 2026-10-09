// MB-45 SourcesCard (MPaneFiles): what this chat works on — "Sources · 2 mounts" over one row per mount: the alias
// (mono), Worktree / In place / Generated, the branch (mono) with a dot when the mount has uncommitted changes, the
// server path (mono, any OS separator) and "Copy path". "Edit sources" is not offered: an existing chat's sources are
// fixed (the New chat sheet's Where page edits them before the chat exists).
import React from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { haptic } from '../../ui/platform/haptics';
import { Badge } from '../../ui/primitives/Badge';
import { Icon } from '../../ui/primitives/Icon';
import { IconButton } from '../../ui/primitives/IconButton';
import { Text } from '../../ui/primitives/Text';
import { Separator } from '../../ui/primitives/Separator';

export interface SourceMount {
  alias: string;
  mode?: string;
  path?: string;
  hasUncommittedChanges?: boolean;
  git?: { branch?: string } | null;
}

export const MOUNT_MODE_LABEL: Record<string, string> = { worktree: 'Worktree', 'in-place': 'In place', generated: 'Generated' };

export function SourcesCard({ mounts, testID = 'sources-card' }: { mounts: readonly SourceMount[]; testID?: string }): React.ReactElement | null {
  if (mounts.length === 0) return null;
  return (
    <View testID={testID} className="gap-1.5">
      <View className="flex-row items-center gap-2 px-4">
        <Text role="footnote" weight={600} tone="fg-2" accessibilityRole="header">
          Sources
        </Text>
        <Text role="monoSm" tone="fg-3">{`${mounts.length} ${mounts.length === 1 ? 'mount' : 'mounts'}`}</Text>
      </View>
      <View className="mx-4 overflow-hidden rounded-card border border-line-soft bg-raised">
        {mounts.map((m, i) => (
          <React.Fragment key={m.alias}>
            {i > 0 ? <Separator inset={48} /> : null}
            <View accessibilityRole="text" className="min-h-row-2 flex-row items-center gap-3 py-2 pe-1 ps-3" accessible accessibilityLabel={[m.alias, m.mode ? (MOUNT_MODE_LABEL[m.mode] ?? m.mode) : null, m.git?.branch ? `branch ${m.git.branch}` : null, m.hasUncommittedChanges ? 'uncommitted changes' : null, m.path].filter(Boolean).join(', ')}>
              <Icon concept="folder-open" size={20} tone="fg-2" />
              <View className="flex-1 gap-0.5">
                <View className="flex-row items-center gap-2">
                  <Text role="mono" weight={500} numberOfLines={1} className="shrink">
                    {m.alias === '.' ? 'workspace' : m.alias}
                  </Text>
                  {m.mode ? <Badge label={MOUNT_MODE_LABEL[m.mode] ?? m.mode} size="sm" /> : null}
                </View>
                {m.git?.branch ? (
                  <View className="flex-row items-center gap-1">
                    <Icon concept="branch" size={12} tone="fg-3" />
                    <Text role="monoSm" tone="fg-2" numberOfLines={1} className="shrink">
                      {m.git.branch}
                    </Text>
                    {m.hasUncommittedChanges ? <View className="size-1.5 rounded-full bg-warn" /> : null}
                  </View>
                ) : null}
                {m.path ? (
                  <Text role="monoSm" tone="fg-3" numberOfLines={1} ellipsizeMode="middle">
                    {m.path}
                  </Text>
                ) : null}
              </View>
              {m.path ? (
                <IconButton
                  icon="copy"
                  size="sm"
                  label={`Copy path of ${m.alias}`}
                  onPress={() => {
                    void Clipboard.setStringAsync(m.path!);
                    haptic('success');
                  }}
                />
              ) : null}
            </View>
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}
