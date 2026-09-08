// ────────────────────────────────────────────────────────────────
// One diff line — the leaf every Changes surface shares.
//
// Fixed height at the current font size (unless wrapping), a line-number
// gutter, the +/− marker, and the content highlighted through the markdown
// agent's scanner. Colours come from the theme's semantic tokens
// (`success`/`danger` tints) so the tray, the pane and the route agree.
//
// Long-press opens the review context menu; a comment marker in the gutter
// says a thread already sits here and taps through to it.
//
// Memoised: a recycled LegendList row re-renders on every scroll tick unless
// its props are referentially stable, so the callbacks below are expected
// to be `useCallback`ed by the parent.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { MessageSquare } from 'lucide-react-native';
import type { DiffRow } from '@generatorai/client-core';

import { useTheme } from '../../theme/ThemeProvider';
import { tokenize, type Language, type Span } from '../markdown/highlight';
import { syntaxPalette } from '../markdown/syntaxColors';
import { withAlpha } from '../markdown/CodeBlock';
import { lineHeightFor, rowHeightFor, type DiffSide } from './diffModel';

export interface DiffLineProps {
  row: DiffRow;
  fontSize: number;
  wrap: boolean;
  /** Width of each line-number column. */
  gutter: number;
  /** Show both old and new numbers (split/tablet) or just the live one. */
  dualGutter?: boolean;
  language: Language | null;
  /** Open review threads anchored on this line. */
  threadCount?: number;
  onLongPress?: (row: DiffRow) => void;
  onPressThreads?: (side: DiffSide, line: number) => void;
}

const MARKER: Record<DiffRow['kind'], string> = { add: '+', del: '−', context: ' ' };

export const DiffLine = React.memo(function DiffLine({
  row,
  fontSize,
  wrap,
  gutter,
  dualGutter = false,
  language,
  threadCount = 0,
  onLongPress,
  onPressThreads,
}: DiffLineProps): React.ReactElement {
  const { colors } = useTheme();
  const lineHeight = lineHeightFor(fontSize);
  const rowHeight = rowHeightFor(fontSize);
  const palette = useMemo(() => syntaxPalette(colors), [colors]);

  const spans = useMemo<Span[] | null>(() => {
    if (!language || row.content.length === 0 || row.content.length > 2_000) return null;
    return tokenize(row.content, language)[0]?.spans ?? null;
  }, [language, row.content]);

  const tone = row.kind === 'add' ? colors.success : row.kind === 'del' ? colors.danger : undefined;
  const background = tone ? withAlpha(tone, 0.12) : undefined;
  const markerColour = tone ?? colors['muted-foreground'];
  const numberStyle = {
    width: gutter,
    fontSize: fontSize - 1,
    lineHeight,
    color: colors['muted-foreground'],
    textAlign: 'right' as const,
    paddingRight: 4,
  };

  const side: DiffSide = row.kind === 'del' ? 'deletions' : 'additions';
  const line = row.kind === 'del' ? (row.oldNumber ?? 0) : (row.newNumber ?? row.oldNumber ?? 0);

  return (
    <Pressable
      accessibilityLabel={`${row.kind === 'add' ? 'Added' : row.kind === 'del' ? 'Removed' : 'Line'} ${line}: ${row.content}`}
      onLongPress={onLongPress ? () => onLongPress(row) : undefined}
      delayLongPress={350}
      style={{
        minHeight: rowHeight,
        height: wrap ? undefined : rowHeight,
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: background,
        paddingVertical: 1,
      }}
    >
      {dualGutter ? (
        <Text className="font-mono" style={numberStyle}>
          {row.oldNumber ?? ''}
        </Text>
      ) : null}
      <Text className="font-mono" style={numberStyle}>
        {dualGutter ? (row.newNumber ?? '') : line || ''}
      </Text>
      <Text
        className="font-mono"
        style={{ width: 14, fontSize, lineHeight, color: markerColour, textAlign: 'center' }}
      >
        {MARKER[row.kind]}
      </Text>
      <Text
        className="font-mono"
        numberOfLines={wrap ? undefined : 1}
        ellipsizeMode="clip"
        style={{ flex: 1, fontSize, lineHeight, color: colors.foreground, paddingRight: 8 }}
      >
        {spans
          ? spans.map((span, i) =>
              palette[span.kind] ? (
                <Text key={i} style={{ color: palette[span.kind] }}>
                  {span.text}
                </Text>
              ) : (
                span.text
              ),
            )
          : row.content || ' '}
        {row.noNewline ? <Text style={{ color: colors.warning }}> ↵</Text> : null}
      </Text>
      {threadCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${threadCount} review ${threadCount === 1 ? 'comment' : 'comments'} on line ${line}`}
          onPress={onPressThreads ? () => onPressThreads(side, line) : undefined}
          hitSlop={6}
          style={{ height: rowHeight, paddingHorizontal: 6, justifyContent: 'center' }}
        >
          <View className="flex-row items-center gap-0.5 rounded-full bg-accent px-1.5 py-0.5">
            <MessageSquare size={fontSize - 1} color={colors.primary} />
            <Text className="text-primary" style={{ fontSize: fontSize - 2 }}>
              {threadCount}
            </Text>
          </View>
        </Pressable>
      ) : null}
    </Pressable>
  );
});
