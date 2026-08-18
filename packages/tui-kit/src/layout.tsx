// ────────────────────────────────────────────────────────────────
// Layout primitives.
//
// Everything here is a thin wrapper over Ink's Yoga flexbox. The value is not
// the wrapping — it is that spacing, borders and focus treatment are decided
// once, so twenty screens cannot each invent their own idea of a panel.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './theme.js';
import { useTerminalSize } from './hooks.js';

// ── Screen ────────────────────────────────────────────────────────

export interface ScreenProps {
  children: React.ReactNode;
}

/** Root container sized to the terminal. */
export function Screen({ children }: ScreenProps): React.JSX.Element {
  const { columns, rows } = useTerminalSize();
  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {children}
    </Box>
  );
}

// ── Panel ─────────────────────────────────────────────────────────

export interface PanelProps {
  title?: string;
  subtitle?: string;
  focused?: boolean;
  /** Suppresses the border, for panes that butt against a neighbour. */
  borderless?: boolean;
  flexGrow?: number;
  height?: number | string;
  width?: number | string;
  children: React.ReactNode;
}

/**
 * A titled region.
 *
 * The focus treatment is a border colour change rather than a background:
 * a background fill costs a full-width write per row on every focus change,
 * which is visible as a flash on a slow connection.
 */
export function Panel({
  title,
  subtitle,
  focused = false,
  borderless = false,
  flexGrow,
  height,
  width,
  children,
}: PanelProps): React.JSX.Element {
  const theme = useTheme();

  return (
    <Box
      flexDirection="column"
      flexGrow={flexGrow ?? 0}
      {...(height !== undefined ? { height } : {})}
      {...(width !== undefined ? { width } : {})}
      {...(borderless
        ? {}
        : {
            borderStyle: theme.borderStyle,
            borderColor: focused ? theme.c('focusBorder') : theme.c('borderMuted'),
          })}
      paddingX={borderless ? 0 : 1}
      overflow="hidden"
    >
      {title ? (
        <Box marginBottom={0}>
          <Text bold color={focused ? theme.c('primary') : theme.c('foreground')}>
            {title}
          </Text>
          {subtitle ? (
            <Text color={theme.c('muted')}>
              {'  '}
              {subtitle}
            </Text>
          ) : null}
        </Box>
      ) : null}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {children}
      </Box>
    </Box>
  );
}

// ── Split ─────────────────────────────────────────────────────────

export interface SplitProps {
  direction: 'horizontal' | 'vertical';
  /** Fraction taken by the first child, 0..1. */
  ratio?: number;
  first: React.ReactNode;
  second: React.ReactNode;
}

/**
 * Two panes sharing a region.
 *
 * `horizontal` means the divider is horizontal, i.e. the panes stack — the
 * tmux meaning, since the keybindings are tmux's.
 */
export function Split({ direction, ratio = 0.5, first, second }: SplitProps): React.JSX.Element {
  const stacked = direction === 'horizontal';
  const firstPercent = `${Math.round(Math.max(0.15, Math.min(0.85, ratio)) * 100)}%`;

  return (
    <Box flexDirection={stacked ? 'column' : 'row'} flexGrow={1} overflow="hidden">
      <Box {...(stacked ? { height: firstPercent } : { width: firstPercent })} overflow="hidden">
        {first}
      </Box>
      <Box flexGrow={1} overflow="hidden">
        {second}
      </Box>
    </Box>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────

export interface TabItem {
  id: string;
  label: string;
  /** Shown as a status dot before the label. */
  tone?: 'running' | 'success' | 'failure' | 'warning' | 'idle' | 'neutral';
  badge?: string | number;
}

export interface TabsProps {
  items: TabItem[];
  activeId: string;
  /** Prefixes each tab with its 1-based index, matching the jump bindings. */
  numbered?: boolean;
}

export function Tabs({ items, activeId, numbered = true }: TabsProps): React.JSX.Element {
  const theme = useTheme();
  const { columns } = useTerminalSize();

  // Tabs are elided rather than wrapped: a wrapped tab bar changes height and
  // pushes the whole layout down by a row, which reads as a glitch.
  const budget = columns - 4;
  let used = 0;
  const visible: TabItem[] = [];
  for (const item of items) {
    const width = item.label.length + (numbered ? 4 : 2) + 4;
    if (used + width > budget && visible.length > 0) break;
    used += width;
    visible.push(item);
  }
  const hidden = items.length - visible.length;

  return (
    <Box>
      {visible.map((item, index) => {
        const active = item.id === activeId;
        return (
          <Box key={item.id} marginRight={1}>
            <Text
              color={active ? theme.c('primaryForeground') : theme.c('muted')}
              backgroundColor={active ? theme.c('primary') : undefined}
              bold={active}
            >
              {' '}
              {numbered ? `${index + 1} ` : ''}
              {item.tone ? `${toneGlyph(theme, item.tone)} ` : ''}
              {item.label}
              {item.badge !== undefined ? ` (${item.badge})` : ''}{' '}
            </Text>
          </Box>
        );
      })}
      {hidden > 0 ? <Text color={theme.c('muted')}>+{hidden}</Text> : null}
    </Box>
  );
}

function toneGlyph(theme: ReturnType<typeof useTheme>, tone: NonNullable<TabItem['tone']>): string {
  return theme.glyphs[tone];
}

// ── Status bar ────────────────────────────────────────────────────

export interface StatusSegment {
  text: string;
  tone?: 'running' | 'success' | 'failure' | 'warning' | 'idle' | 'neutral' | 'primary';
  /** Dropped first when the bar does not fit. */
  priority?: number;
}

export interface StatusBarProps {
  left: StatusSegment[];
  right: StatusSegment[];
}

export function StatusBar({ left, right }: StatusBarProps): React.JSX.Element {
  const theme = useTheme();
  const { columns } = useTerminalSize();

  const colourFor = (tone: StatusSegment['tone']): string | undefined => {
    switch (tone) {
      case 'running':
        return theme.c('running');
      case 'success':
        return theme.c('success');
      case 'failure':
        return theme.c('danger');
      case 'warning':
        return theme.c('warning');
      case 'primary':
        return theme.c('primary');
      default:
        return theme.c('muted');
    }
  };

  // Drop by priority until it fits, rather than letting the bar wrap and eat
  // a second row of the viewport.
  const fit = (segments: StatusSegment[], budget: number): StatusSegment[] => {
    const sorted = [...segments].sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5));
    const kept = new Set<StatusSegment>();
    let used = 0;
    for (const segment of sorted) {
      const width = segment.text.length + 3;
      if (used + width > budget) continue;
      used += width;
      kept.add(segment);
    }
    return segments.filter((s) => kept.has(s));
  };

  const half = Math.floor((columns - 2) / 2);
  const leftVisible = fit(left, half);
  const rightVisible = fit(right, columns - 2 - half);

  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Box>
        {leftVisible.map((segment, index) => (
          <Text key={index} color={colourFor(segment.tone)}>
            {index > 0 ? `  ${theme.glyphs.neutral}  ` : ''}
            {segment.text}
          </Text>
        ))}
      </Box>
      <Box>
        {rightVisible.map((segment, index) => (
          <Text key={index} color={colourFor(segment.tone)}>
            {index > 0 ? `  ${theme.glyphs.neutral}  ` : ''}
            {segment.text}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

// ── Overlay ───────────────────────────────────────────────────────

export interface OverlayProps {
  title: string;
  footer?: string;
  width?: number | string;
  height?: number | string;
  children: React.ReactNode;
}

/**
 * A modal surface.
 *
 * Ink has no true z-index, so an overlay is rendered INSTEAD of the content
 * beneath it rather than on top. Trying to fake stacking with absolute
 * positioning produces a frame where both are half-drawn. It fills its
 * container rather than the screen, so the host can keep the title and status
 * bars visible around it.
 */
export function Overlay({ title, footer, width, height, children }: OverlayProps): React.JSX.Element {
  const theme = useTheme();
  const { columns } = useTerminalSize();

  return (
    <Box
      width="100%"
      height="100%"
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
    >
      <Box
        flexDirection="column"
        width={width ?? Math.min(columns - 4, 96)}
        // Height is deliberately content-sized: a fixed box leaves a block of
        // dead rows under a short menu.
        {...(height === undefined ? {} : { height })}
        borderStyle={theme.borderStyle}
        borderColor={theme.c('primary')}
        paddingX={1}
      >
        <Box marginBottom={1}>
          <Text bold color={theme.c('primary')}>
            {title}
          </Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          {children}
        </Box>
        {footer ? (
          <Box marginTop={1}>
            <Text color={theme.c('muted')}>{footer}</Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

// ── Key hints ─────────────────────────────────────────────────────

export interface KeyHintProps {
  hints: Array<{ keys: string; label: string }>;
}

/** The `^K palette  ? help` strip. Keys come from the keymap, never inline. */
export function KeyHints({ hints }: KeyHintProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <Box>
      {hints.map((hint, index) => (
        <Text key={hint.keys + hint.label} color={theme.c('muted')}>
          {index > 0 ? '   ' : ''}
          <Text color={theme.c('foreground')} bold>
            {prettyChord(hint.keys)}
          </Text>{' '}
          {hint.label}
        </Text>
      ))}
    </Box>
  );
}

/** `ctrl+k` → `^K`; `shift+return` → `⇧⏎`. */
export function prettyChord(chord: string): string {
  return chord
    .split(' ')
    .map((part) =>
      part
        .replace(/^ctrl\+/, '^')
        .replace(/^alt\+/, '⌥')
        .replace(/^shift\+/, '⇧')
        .replace(/\breturn\b/, '⏎')
        .replace(/\bescape\b/, 'esc')
        .replace(/\bpageup\b/, 'PgUp')
        .replace(/\bpagedown\b/, 'PgDn')
        // Only a modified letter is capitalised. Printing a bare `g d` as
        // `G D` tells the reader to hold Shift, which does not work.
        .replace(/^(\^|⌥|⇧)([a-z])$/, (_, mod: string, letter: string) =>
          `${mod}${letter.toUpperCase()}`,
        ),
    )
    .join(' ');
}
