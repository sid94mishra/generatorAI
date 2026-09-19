// ────────────────────────────────────────────────────────────────
// Code block.
//
// Header: language label, filename (from the fence info string), a wrap
// toggle and a copy button. Body: highlighted monospace text, horizontally
// scrollable by default so indentation survives, wrapped on request.
//
// Highlighting is the dependency-free scanner in `highlight.ts`, coloured
// from the theme. Three rules keep it off the hot path (§7.2):
//
//   1. never while `streaming` — the in-flight block is plain text until it
//      settles, so a chunk arriving never re-scans a growing block;
//   2. never past 400 lines / 40 KB — a file dump renders plain;
//   3. memoised per (code, language) — a settled block that re-renders
//      because a sibling changed costs one Map lookup.
//
// Line numbers appear for blocks longer than eight lines: below that they
// are noise, above it they are how a reader refers to "line 23".
// ────────────────────────────────────────────────────────────────

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View, type TextStyle } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import * as Clipboard from 'expo-clipboard';
import { Check, Copy, WrapText } from 'lucide-react-native';

import { useTheme } from '../../theme/ThemeProvider';
import { MAX_SCALE } from '../ui/accessibility';
import { Touchable } from '../ui/Touchable';
import { usePagerInnerScroll } from '../ui/Pager';
import { useToast } from '../ui/Toast';
import { highlight, languageLabel, type Line, type Span } from './highlight';
import { syntaxPalette, type SyntaxPalette } from './syntaxColors';
import { setCodeWrap, useCodeWrap } from './codeWrapStore';

export interface CodeBlockProps {
  code: string;
  language?: string | null;
  /** Filename or title from the fence info string (`ts src/app.ts`). */
  meta?: string | null;
  /** The block is still arriving: plain text, no highlighting. */
  streaming?: boolean;
}

/** Blocks longer than this get a line-number gutter. */
export const LINE_NUMBER_THRESHOLD = 8;

const CODE_TEXT = 'font-mono text-sm leading-code text-foreground';
const GUTTER_TEXT = 'font-mono text-sm leading-code text-muted-foreground';
const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

export const CodeBlock = memo(function CodeBlock({
  code,
  language,
  meta,
  streaming = false,
}: CodeBlockProps): React.ReactElement {
  const { colors } = useTheme();
  const toast = useToast();
  const wrap = useCodeWrap();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const onCopy = useCallback(async (): Promise<void> => {
    try {
      await Clipboard.setStringAsync(code);
    } catch {
      toast({ message: 'Could not copy', tone: 'error' });
      return;
    }
    // The success toast carries the haptic and the screen-reader announcement.
    toast({ message: 'Copied', tone: 'success' });
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1500);
  }, [code, toast]);

  const palette = useMemo(() => syntaxPalette(colors), [colors]);

  // Rule 1 and 2 live here; rule 3 lives inside `highlight`.
  const highlighted = useMemo(
    () => (streaming ? null : highlight(code, language)),
    [code, language, streaming],
  );

  const lineCount = useMemo(() => countLines(code), [code]);
  const showNumbers = lineCount > LINE_NUMBER_THRESHOLD;
  const isDiff = highlighted?.language === 'diff';

  return (
    <View className="overflow-hidden rounded-lg border border-border bg-subtle">
      <View className="flex-row items-center gap-2 border-b border-border px-3 py-1.5">
        <Text
          maxFontSizeMultiplier={MAX_SCALE.chrome}
          className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {languageLabel(language)}
        </Text>
        {meta ? (
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_SCALE.chrome}
            className="flex-1 font-mono text-xs text-muted-foreground"
          >
            {meta}
          </Text>
        ) : (
          <View className="flex-1" />
        )}
        <Touchable
          accessibilityLabel={wrap ? 'Scroll long lines' : 'Wrap long lines'}
          className="min-h-12 min-w-12 items-center justify-center"
          hitSlop={0}
          accessibilityState={{ selected: wrap }}
          haptic="select"
          ripple={false}
          onPress={() => setCodeWrap(!wrap)}
        >
          <WrapText size={14} color={wrap ? colors.primary : colors['muted-foreground']} />
        </Touchable>
        <Touchable
          accessibilityLabel={copied ? 'Copied' : 'Copy code'}
          className="min-h-12 min-w-12 items-center justify-center"
          hitSlop={0}
          haptic="none"
          ripple={false}
          onPress={() => void onCopy()}
        >
          {copied ? (
            <Check size={14} color={colors.success} />
          ) : (
            <Copy size={14} color={colors['muted-foreground']} />
          )}
        </Touchable>
      </View>
      <Body
        code={code}
        lines={highlighted?.lines ?? null}
        palette={palette}
        wrap={wrap}
        showNumbers={showNumbers}
        lineCount={lineCount}
        rowTones={isDiff}
        toneColors={{
          added: colors['success-muted'] ?? withAlpha(colors.success, 0.15),
          removed: colors['danger-muted'] ?? withAlpha(colors.danger, 0.15),
          meta: colors['border-muted'] ?? colors.subtle,
        }}
      />
    </View>
  );
});

// ── Body ────────────────────────────────────────────────────────

interface BodyProps {
  code: string;
  /** Highlighted lines, or `null` to render the source plain. */
  lines: Line[] | null;
  palette: SyntaxPalette;
  wrap: boolean;
  showNumbers: boolean;
  lineCount: number;
  /** Tint rows by their `tone` (diff blocks). Forces one row per line. */
  rowTones: boolean;
  toneColors: Record<'added' | 'removed' | 'meta', string | undefined>;
}

function Body({ code, lines, palette, wrap, showNumbers, lineCount, rowTones, toneColors }: BodyProps) {
  // Per-line rows are needed when a row has its own background (diff) or
  // when wrapped lines must stay aligned with their gutter number. Otherwise
  // one `Text` for the gutter and one for the code is far cheaper — and a
  // shared line height keeps them aligned without a row per line.
  const perLine = rowTones || (wrap && showNumbers);
  const gutterWidth = showNumbers ? String(lineCount).length * 8 + 12 : 0;
  // Inside the session pager: a sideways drag on a wide code block scrolls
  // the code instead of switching panes. Inert outside a pager.
  const inner = usePagerInnerScroll();

  if (perLine) {
    const source = lines ?? plainLines(code);
    const rows = (
      <View>
        {source.map((line, i) => (
          <View
            // Positional: lines are replaced wholesale when the code changes.
            key={i}
            className="flex-row"
            style={line.tone ? { backgroundColor: toneColors[line.tone] } : undefined}
          >
            {showNumbers ? (
              <Text
                className={`${GUTTER_TEXT} pl-3 pr-2 text-right`}
                style={[TABULAR, { width: gutterWidth + 12 }]}
                maxFontSizeMultiplier={MAX_SCALE.control}
              >
                {i + 1}
              </Text>
            ) : null}
            <Text
              selectable
              className={`${CODE_TEXT} ${showNumbers ? 'pr-3' : 'px-3'} ${wrap ? 'flex-1' : ''}`}
              maxFontSizeMultiplier={MAX_SCALE.control}
            >
              {renderSpans(line.spans, palette)}
              {/* An empty line still needs height. */}
              {line.spans.length === 0 ? ' ' : null}
            </Text>
          </View>
        ))}
      </View>
    );
    return wrap ? (
      <View className="py-2">{rows}</View>
    ) : (
      <GestureDetector gesture={inner.gesture}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          contentContainerClassName="py-2"
          onLayout={inner.onLayout}
          onContentSizeChange={inner.onContentSizeChange}
        >
          {rows}
        </ScrollView>
      </GestureDetector>
    );
  }

  const body = (
    <Text selectable className={`${CODE_TEXT} px-3`} maxFontSizeMultiplier={MAX_SCALE.control}>
      {lines ? renderLines(lines, palette) : code}
    </Text>
  );

  if (wrap) return <View className="py-2">{body}</View>;

  return (
    <View className="flex-row">
      {showNumbers ? (
        <Text
          className={`${GUTTER_TEXT} border-r border-border py-2 pl-3 pr-2 text-right`}
          style={[TABULAR, { width: gutterWidth + 12 }]}
          maxFontSizeMultiplier={MAX_SCALE.control}
        >
          {gutterNumbers(lineCount)}
        </Text>
      ) : null}
      <GestureDetector gesture={inner.gesture}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          className="flex-1"
          contentContainerClassName="py-2"
          onLayout={inner.onLayout}
          onContentSizeChange={inner.onContentSizeChange}
        >
          {body}
        </ScrollView>
      </GestureDetector>
    </View>
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function countLines(code: string): number {
  let n = 1;
  for (let i = 0; i < code.length; i += 1) if (code.charCodeAt(i) === 10) n += 1;
  return n;
}

function plainLines(code: string): Line[] {
  return code.split('\n').map((text) => ({ spans: text ? [{ kind: 'plain', text }] : [] }));
}

const gutterCache = new Map<number, string>();
function gutterNumbers(count: number): string {
  let s = gutterCache.get(count);
  if (s === undefined) {
    s = Array.from({ length: count }, (_, i) => String(i + 1)).join('\n');
    if (gutterCache.size > 64) gutterCache.clear();
    gutterCache.set(count, s);
  }
  return s;
}

function renderSpans(spans: Span[], palette: SyntaxPalette): React.ReactNode[] {
  return spans.map((span, i) => {
    const color = palette[span.kind];
    // A plain span is a bare string: no element, no style object.
    if (!color) return span.text;
    return (
      <Text key={i} style={{ color }}>
        {span.text}
      </Text>
    );
  });
}

function renderLines(lines: Line[], palette: SyntaxPalette): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  lines.forEach((line, li) => {
    if (li > 0) out.push('\n');
    line.spans.forEach((span, si) => {
      const color = palette[span.kind];
      out.push(
        color ? (
          <Text key={`${li}-${si}`} style={{ color }}>
            {span.text}
          </Text>
        ) : (
          span.text
        ),
      );
    });
  });
  return out;
}

/** `#rrggbb` → `rgba(r,g,b,a)`. Non-hex colours are returned untouched. */
export function withAlpha(color: string | undefined, alpha: number): string | undefined {
  if (!color) return undefined;
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color.trim());
  if (!m) return color;
  const hex = m[1]!;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
