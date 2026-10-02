// MP-42 CodeLine (03 MB-24 / MB-26 rows; MD-39, MD-61): one virtualised mono line — the old / new number gutter
// (`text-fg-3`, tappable to comment), the +/− sign (`text-err` / `text-ok`), the row fill (`bg-del-bg` / `bg-add-bg`),
// bounded token colours from `ui/lib/highlight` in the theme's syntax palette, the selected-line ring, the file
// preview's changed-line bar, and a comment-count chip. Spoken "Line 20 added: <text>" with old / new named.
import React, { memo, useMemo } from 'react';
import { Text as RNText, View } from 'react-native';

import { cn } from '../../lib/cn';
import { highlight } from '../../lib/highlight';
import { useThemeColors } from '../../lib/themeColors';
import { tokenColour } from '../CodeText';
import { Icon } from '../Icon';
import { Pressable } from '../Pressable';
import type { CodeLineProps } from './CodeLine.types';

export type { CodeLineKind, CodeLineProps } from './CodeLine.types';

const SIGN = { add: '+', del: '−', context: ' ', plain: '' } as const;
/** Lines past this length render without token colours (the highlighter's budget is per block, not per line). */
export const CODE_LINE_HIGHLIGHT_MAX = 2_000;

export function codeLineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.5);
}

export function codeLineLabel({ kind, oldNumber, newNumber, text }: Pick<CodeLineProps, 'kind' | 'oldNumber' | 'newNumber' | 'text'>): string {
  const body = text.trim() || 'empty line';
  if (kind === 'add') return `Line ${newNumber ?? ''} added: ${body}`;
  if (kind === 'del') return `Line ${oldNumber ?? ''} removed: ${body}`;
  if (kind === 'context' && oldNumber !== undefined && newNumber !== undefined && oldNumber !== newNumber) return `Line ${newNumber}, was ${oldNumber}: ${body}`;
  return `Line ${newNumber ?? oldNumber ?? ''}: ${body}`;
}

export const CodeLine = memo(function CodeLine(props: CodeLineProps): React.ReactElement {
  const { text, kind, language, oldNumber, newNumber, gutterWidth, dualGutter = false, fontSize, wrap, selected = false, changed = false, noNewline = false, commentCount = 0, onPressGutter, onPressComments, onLongPress, accessibilityActions, onAccessibilityAction, testID } = props;
  const colors = useThemeColors();
  const lineHeight = codeLineHeight(fontSize);
  const spans = useMemo(() => {
    if (!language || text.length === 0 || text.length > CODE_LINE_HIGHLIGHT_MAX) return null;
    return highlight(text, language)?.lines[0]?.spans ?? null;
  }, [language, text]);
  const mono = { fontSize, lineHeight };
  const number = { width: gutterWidth, fontSize: Math.max(10, fontSize - 1), lineHeight };
  const fill = kind === 'add' || changed ? 'bg-add-bg' : kind === 'del' ? 'bg-del-bg' : undefined;
  const live = kind === 'del' ? oldNumber : (newNumber ?? oldNumber);

  const gutter = (
    <View className="flex-row">
      {dualGutter ? (
        <RNText className="text-right font-mono text-fg-3" style={number} accessible={false}>
          {oldNumber ?? ''}
        </RNText>
      ) : null}
      <RNText className="pe-1 text-right font-mono text-fg-3" style={number} accessible={false}>
        {dualGutter ? (newNumber ?? '') : (live ?? '')}
      </RNText>
    </View>
  );

  return (
    <Pressable
      testID={testID}
      frame="none"
      feedback="none"
      onLongPress={onLongPress}
      accessibilityRole="text"
      accessibilityLabel={codeLineLabel(props)}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction ? (name: string) => onAccessibilityAction(name) : undefined}
      className={cn('flex-row items-start', fill, selected && 'rounded-badge border-2 border-fg-2')}
    >
      {changed ? <View className="w-0.75 self-stretch bg-ok" /> : null}
      {onPressGutter ? (
        <Pressable frame="none" feedback="none" onPress={onPressGutter} accessibilityRole="button" accessibilityLabel={`Comment on line ${live ?? ''}`}>
          {gutter}
        </Pressable>
      ) : (
        gutter
      )}
      {kind !== 'plain' ? (
        <RNText className={cn('w-4 text-center font-mono', kind === 'add' ? 'text-ok' : kind === 'del' ? 'text-err' : 'text-fg-3')} style={mono} accessible={false}>
          {SIGN[kind]}
        </RNText>
      ) : (
        <View className="w-2" />
      )}
      <RNText className="flex-1 pe-2 font-mono text-fg" style={mono} numberOfLines={wrap ? undefined : 1} ellipsizeMode="clip" accessible={false}>
        {spans
          ? spans.map((span, i) => {
              const colour = tokenColour(span.kind, colors.syntax);
              return colour ? (
                <RNText key={i} style={{ color: colour }}>
                  {span.text}
                </RNText>
              ) : (
                span.text
              );
            })
          : text || ' '}
        {noNewline ? <RNText className="text-warn"> ↵</RNText> : null}
      </RNText>
      {commentCount > 0 ? (
        <Pressable onPress={onPressComments} frame="none" accessibilityRole="button" accessibilityLabel={`${commentCount} review ${commentCount === 1 ? 'comment' : 'comments'} on line ${live ?? ''}`} className="flex-row items-center gap-0.5 self-center rounded-full bg-selected px-1.5 me-1">
          <Icon concept="message" size={12} tone="fg-2" />
          <RNText className="font-mono text-mono-sm text-fg-2">{commentCount}</RNText>
        </Pressable>
      ) : null}
    </Pressable>
  );
});
