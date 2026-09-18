// ────────────────────────────────────────────────────────────────
// ChangesTray — "N files changed +a −b · Review ›" in the composer dock.
//
// A flat strip INSIDE the dock (under its one divider), not a floating card
// over the transcript: drawn as a rounded card above the divider it read as
// part of the conversation, with the last row cut off behind it.
//
// The one-line answer to "did the agent touch anything?" without leaving
// the transcript. Collapsed it is a single row; expanded it lists the files
// (capped) so a quick check does not need the full pane. "Review" jumps to
// the Changes pane; a file row jumps to that file.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { ChevronDown, ChevronRight, FileDiff } from 'lucide-react-native';
import type { ChangeFileEntry, ChangeSummary } from '@generatorai/client-core';

import { Touchable } from '../../ui/Touchable';
import { MAX_SCALE } from '../../ui/accessibility';
import { useTheme } from '../../../theme/ThemeProvider';
import { useChatMotion } from '../chatMotion';

const MAX_LISTED = 6;

const STATUS_LETTER: Record<ChangeFileEntry['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
};

const STATUS_TONE: Record<ChangeFileEntry['status'], string> = {
  added: 'text-success',
  modified: 'text-warning',
  deleted: 'text-danger',
  renamed: 'text-info',
};

export function ChangesTray({
  summary,
  onReview,
  onOpenFile,
}: {
  summary: ChangeSummary | undefined;
  onReview: () => void;
  onOpenFile: (path: string) => void;
}): React.ReactElement | null {
  const { colors } = useTheme();
  const motion = useChatMotion();
  const [expanded, setExpanded] = useState(false);

  const files = useMemo(() => {
    if (!summary) return [];
    const out: ChangeFileEntry[] = [];
    for (const repo of summary.repos) {
      for (const file of repo.files) {
        out.push(file);
        if (out.length >= MAX_LISTED) return out;
      }
    }
    return out;
  }, [summary]);

  if (!summary || summary.stats.files === 0) return null;
  const { stats } = summary;
  const label = `${stats.files} ${stats.files === 1 ? 'file' : 'files'} changed`;

  return (
    <Animated.View
      entering={motion.fadeIn(160)}
      exiting={motion.fadeOut(120)}
      layout={motion.layout(160)}
      className="border-b border-border-muted bg-background"
    >
      <View className="flex-row items-center">
        <Touchable
          accessibilityLabel={`${label}, ${stats.additions} added, ${stats.deletions} removed${expanded ? ', collapse' : ', expand'}`}
          accessibilityState={{ expanded }}
          haptic="select"
          ripple={false}
          scale="none"
          onPress={() => setExpanded((v) => !v)}
          className="min-h-11 flex-1 flex-row items-center gap-2 pl-4 pr-3"
        >
          <FileDiff size={14} color={colors['muted-foreground']} />
          <Text numberOfLines={1} maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-sm font-medium text-foreground">
            {label}
          </Text>
          <Text className="font-mono text-sm">
            <Text className="text-success">+{stats.additions}</Text> <Text className="text-danger">−{stats.deletions}</Text>
          </Text>
          <View className="flex-1" />
          {expanded ? (
            <ChevronDown size={14} color={colors['muted-foreground']} />
          ) : (
            <ChevronRight size={14} color={colors['muted-foreground']} />
          )}
        </Touchable>
        <Touchable
          accessibilityLabel="Review changes"
          haptic="tap"
          ripple={false}
          scale="none"
          onPress={onReview}
          className="min-h-11 flex-row items-center gap-0.5 pl-3 pr-4"
        >
          <Text maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-sm font-semibold text-primary">
            Review
          </Text>
          <ChevronRight size={14} color={colors.primary} />
        </Touchable>
      </View>

      {expanded ? (
        <Animated.View entering={motion.fadeIn(120)} className="border-t border-border-muted py-1">
          {files.map((file) => (
            <Touchable
              key={file.path}
              accessibilityLabel={`${file.status} ${file.path}`}
              haptic="tap"
              ripple={false}
              scale="none"
              onPress={() => onOpenFile(file.path)}
              className="min-h-11 flex-row items-center gap-2 px-4"
            >
              <Text className={`w-3 font-mono text-xs font-semibold ${STATUS_TONE[file.status]}`}>
                {STATUS_LETTER[file.status]}
              </Text>
              <Text numberOfLines={1} className="flex-1 font-mono text-xs text-foreground">
                {file.path}
              </Text>
              <Text className="font-mono text-xs">
                <Text className="text-success">+{file.additions}</Text> <Text className="text-danger">−{file.deletions}</Text>
              </Text>
            </Touchable>
          ))}
          {stats.files > files.length ? (
            <Text className="px-4 py-2 text-sm text-muted-foreground">
              +{stats.files - files.length} more — tap Review for the full list.
            </Text>
          ) : null}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
