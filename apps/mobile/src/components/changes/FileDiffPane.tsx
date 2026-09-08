// ────────────────────────────────────────────────────────────────
// FileDiffPane — toolbar + full-screen FileDiff.
//
// The detail view inside the workbench Changes pane and the body of the
// `/changes/[workspaceId]/file` route are the same component, so the two
// cannot drift (D20). The toolbar carries the path, the +/− counts, wrap,
// layout (tablet), font size reset and the comments entry point.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Columns2, Copy, MessageSquare, Rows3, WrapText } from 'lucide-react-native';

import { useTheme } from '../../theme/ThemeProvider';
import { IconButton } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { FileDiff, type FileDiffProps } from './FileDiff';
import { Toolbar } from './Toolbar';
import { setDiffLayout, setDiffWrap, useDiffPrefs } from './diffPrefs';
import { SPLIT_MIN_WIDTH, prefersSplit } from './diffModel';
import { splitPath } from './statusStyle';

export interface FileDiffPaneProps extends Omit<FileDiffProps, 'embedded'> {
  additions?: number;
  deletions?: number;
  /** Open threads on this file, for the toolbar badge. */
  openThreadCount?: number;
  onShowComments?: () => void;
}

export function FileDiffPane({
  additions,
  deletions,
  openThreadCount = 0,
  onShowComments,
  ...diff
}: FileDiffPaneProps): React.ReactElement {
  const { colors } = useTheme();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const { wrap, layout } = useDiffPrefs();
  const wide = width >= SPLIT_MIN_WIDTH;
  const split = prefersSplit(width, layout);
  const { name, dir } = splitPath(diff.path);

  return (
    <View className="flex-1">
      <Toolbar>
        <View className="flex-1">
          <Text numberOfLines={1} className="text-sm font-medium text-foreground">
            {name}
          </Text>
          <Text numberOfLines={1} ellipsizeMode="head" className="font-mono text-xs text-muted-foreground">
            {diff.alias && diff.alias !== '.' ? `${diff.alias}/` : ''}
            {dir || '·'}
          </Text>
        </View>
        {additions !== undefined || deletions !== undefined ? (
          <Text className="font-mono text-xs">
            <Text className="text-success">+{additions ?? 0}</Text> <Text className="text-danger">−{deletions ?? 0}</Text>
          </Text>
        ) : null}
        <IconButton
          accessibilityLabel="Copy path"
          compact
          icon={<Copy size={15} color={colors['muted-foreground']} />}
          onPress={() => {
            void Clipboard.setStringAsync(diff.path);
            toast({ message: 'Path copied', tone: 'success' });
          }}
        />
        {wide ? (
          <IconButton
            accessibilityLabel={split ? 'Unified view' : 'Split view'}
            compact
            selected={split}
            icon={
              split ? (
                <Rows3 size={16} color={colors.primary} />
              ) : (
                <Columns2 size={16} color={colors['muted-foreground']} />
              )
            }
            onPress={() => setDiffLayout(split ? 'unified' : 'split')}
          />
        ) : null}
        <IconButton
          accessibilityLabel={wrap ? 'Stop wrapping long lines' : 'Wrap long lines'}
          compact
          selected={wrap}
          icon={<WrapText size={16} color={wrap ? colors.primary : colors['muted-foreground']} />}
          onPress={() => setDiffWrap(!wrap)}
        />
        {onShowComments ? (
          <IconButton
            accessibilityLabel={openThreadCount ? `${openThreadCount} review comments` : 'Review comments'}
            compact
            badge={openThreadCount > 0}
            icon={<MessageSquare size={16} color={openThreadCount ? colors.primary : colors['muted-foreground']} />}
            onPress={onShowComments}
          />
        ) : null}
      </Toolbar>
      <FileDiff {...diff} />
    </View>
  );
}
