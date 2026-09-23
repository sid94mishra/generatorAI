// ────────────────────────────────────────────────────────────────
// RowFrame — the frame every activity row is drawn in.
//
// Two grammars, one component:
//
//   line  the default. Borderless, one line: a 20pt glyph, the title and
//         its mono target on the SAME line, a trailing slot (spinner,
//         "+12 −3", exit code) and a chevron when the row expands. A turn's
//         tool calls read as a quiet list, not a stack of cards.
//   card  a bordered, tinted card with a 28pt icon well — kept for rows
//         whose colour means something: a failure (`danger`), the agent
//         waiting on you (`primary`/`warning`), a sub-agent still running
//         (`info`) and source-control results (`card`).
//
// Nested rows (children of a sub-agent or a group) are always lines, drawn
// beside a left rule by their container.
//
// Entering motion only plays for LIVE rows (`RowEnterContext`): a history
// turn mounting on open — or re-mounting as the list scrolls back — must not
// spring every row in. Expanding a row eases its body open (`Collapsible`:
// the body's own height animates, so the list re-measures one row and the
// rows below glide) and turns the chevron. There is no layout transition:
// the transcript is a virtualised list that positions every row itself, and
// a Reanimated layout animation inside it made the rows below bounce. All of
// it is dropped under reduced motion (OS switch or app preference).
//
// Long-press opens the shared context menu (`useContextMenu`); the items
// are supplied by the row, because only the row knows what "copy" means for
// it. The frame's own tap toggles expansion; nested pressables are avoided
// so the long-press is never swallowed.
// ────────────────────────────────────────────────────────────────

import React, { createContext, useCallback, useContext } from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { ChevronRight } from 'lucide-react-native';

import { useCardEntering } from '../../common/enterMotion';
import { Collapsible, useChevronTurn } from '../../ui/Collapsible';
import { useContextMenu, type ContextMenuItem } from '../../ui/ContextMenu';
import { Touchable } from '../../ui/Touchable';
import { MAX_SCALE } from '../../ui/accessibility';
import { haptics } from '../../ui/haptics';
import { useTheme } from '../../../theme/ThemeProvider';
import { useChatMotion } from '../chatMotion';

export type RowTone = 'default' | 'primary' | 'info' | 'warning' | 'danger' | 'success';

/** True inside a row of the live turn — the only rows that animate in. */
export const RowEnterContext = createContext(false);

const TONE_CARD: Record<RowTone, string> = {
  default: 'border-border bg-card',
  primary: 'border-primary bg-accent',
  info: 'border-info bg-info-muted',
  warning: 'border-warning bg-warning-muted',
  danger: 'border-danger bg-danger-muted',
  success: 'border-success bg-success-muted',
};

const TONE_ICON_WELL: Record<RowTone, string> = {
  default: 'bg-control',
  primary: 'bg-card',
  info: 'bg-card',
  warning: 'bg-card',
  danger: 'bg-card',
  success: 'bg-card',
};

export interface RowFrameProps {
  icon: React.ReactNode;
  title: string;
  /** Mono target — a path, a command, a query. On a line row it shares the title's line. */
  subtitle?: string | null;
  /** Non-mono second line — an error message, a warning's detail. */
  detail?: string | null;
  right?: React.ReactNode;
  tone?: RowTone;
  /** Force the card grammar regardless of tone (source-control results). */
  card?: boolean;
  /** Omit to render a static row (no chevron, no toggle). */
  expanded?: boolean;
  onToggle?: () => void;
  /** Long-press menu items; empty means no menu. */
  menu?: ContextMenuItem[];
  menuTitle?: string;
  /** A child of a sub-agent or a group: always a line, a size smaller. */
  nested?: boolean;
  accessibilityLabel?: string;
  /**
   * The expanded body is a `NestedRows` list (a work fold, a group, a
   * sub-agent's steps). It then starts at the row's own left edge so the
   * rule runs straight down from the row's icon, as desktop's timeline
   * connector does. Other bodies (a diff, a command, arguments) are indented
   * to the title instead.
   */
  flushChildren?: boolean;
  /** Lines the title may wrap to on a line row (a work summary takes two). */
  titleLines?: number;
  children?: React.ReactNode;
}

export function RowFrame({
  icon,
  title,
  subtitle,
  detail,
  right,
  tone = 'default',
  card,
  expanded,
  onToggle,
  menu,
  menuTitle,
  nested = false,
  accessibilityLabel,
  flushChildren = false,
  titleLines = 1,
  children,
}: RowFrameProps): React.ReactElement {
  const { colors } = useTheme();
  const live = useContext(RowEnterContext);
  const cardEntering = useCardEntering();
  const motion = useChatMotion();
  const { open } = useContextMenu();

  const expandable = onToggle !== undefined;
  const hasMenu = (menu?.length ?? 0) > 0;
  const asCard = !nested && (card === true || tone !== 'default');

  const onLongPress = useCallback(() => {
    if (!hasMenu || !menu) return;
    haptics.tap();
    open(menu, menuTitle ? { title: menuTitle } : undefined);
  }, [hasMenu, menu, menuTitle, open]);

  const label = accessibilityLabel ?? `${title}${subtitle ? `, ${subtitle}` : ''}`;
  const touchProps = {
    accessibilityLabel: expandable ? `${label}${expanded ? ', collapse' : ', expand'}` : label,
    ...(hasMenu ? { accessibilityHint: 'Double tap and hold for actions' } : {}),
    ...(expandable ? { accessibilityState: { expanded: Boolean(expanded) } } : {}),
    a11yRole: expandable ? ('button' as const) : ('text' as const),
    haptic: expandable ? ('select' as const) : ('none' as const),
    disabled: !expandable && !hasMenu,
    onPress: expandable ? onToggle : undefined,
    onLongPress: hasMenu ? onLongPress : undefined,
  };
  const turn = useChevronTurn(Boolean(expanded));
  const chevron = expandable ? (
    <Animated.View style={turn}>
      <ChevronRight size={16} color={colors['muted-foreground']} />
    </Animated.View>
  ) : null;
  const detailTone = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-muted-foreground';

  if (!asCard) {
    return (
      <Animated.View entering={live && !nested ? motion.fadeIn(160) : undefined}>
        <Touchable
          {...touchProps}
          scale="none"
          ripple={expandable}
          className={`min-h-11 flex-row items-center gap-3 rounded-xl ${nested ? 'py-1' : 'py-1.5'}`}
        >
          <View className="h-5 w-5 items-center justify-center">{icon}</View>
          <View className="flex-1 gap-0.5">
            <Text numberOfLines={titleLines} maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-sm text-foreground">
              <Text className="font-medium">{title}</Text>
              {subtitle ? <Text className="font-mono text-muted-foreground">{`  ${subtitle}`}</Text> : null}
            </Text>
            {detail ? (
              <Text numberOfLines={2} className={`text-sm ${detailTone}`}>
                {detail}
              </Text>
            ) : null}
          </View>
          {right}
          {chevron}
        </Touchable>
        {expandable && children ? (
          <Collapsible open={Boolean(expanded)} className={flushChildren ? 'pb-1' : 'pb-1 pl-8'}>
            {children}
          </Collapsible>
        ) : null}
      </Animated.View>
    );
  }

  return (
    <Animated.View
      entering={live ? cardEntering : undefined}
      className={`overflow-hidden rounded-2xl border ${TONE_CARD[tone]}`}
    >
      <Touchable
        {...touchProps}
        scale={expandable ? 'large' : 'none'}
        ripple={expandable}
        className="min-h-11 flex-row items-center gap-2.5 px-3 py-2"
      >
        <View className={`h-7 w-7 items-center justify-center rounded-xl ${TONE_ICON_WELL[tone]}`}>{icon}</View>
        <View className="flex-1 gap-0.5">
          <Text numberOfLines={1} maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-sm font-medium text-foreground">
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} className="font-mono text-xs text-muted-foreground">
              {subtitle}
            </Text>
          ) : null}
          {detail ? (
            <Text numberOfLines={2} className={`text-sm ${detailTone}`}>
              {detail}
            </Text>
          ) : null}
        </View>
        {right}
        {chevron}
      </Touchable>
      {expandable && children ? (
        <Collapsible open={Boolean(expanded)} className="border-t border-border-muted">
          {children}
        </Collapsible>
      ) : null}
    </Animated.View>
  );
}

/** Centre of a line row's 20pt icon box, from the row's left edge. */
export const LINE_ICON_AXIS = 10;
/** Centre of a card row's icon well (12pt padding + half of 28pt). */
export const CARD_ICON_AXIS = 26;

/**
 * Children of a sub-agent, a group or a work fold: plain lines beside a left
 * rule. The rule sits on `axis`, the centre of the parent row's icon, so it
 * hangs straight down from that icon with no gap on its left; the children's
 * own icons then line up with the parent's title.
 */
export function NestedRows({
  children,
  axis = LINE_ICON_AXIS,
}: {
  children: React.ReactNode;
  axis?: number;
}): React.ReactElement {
  return (
    <View
      className="border-l border-border"
      style={{ marginLeft: axis - 0.5, paddingLeft: 32 - LINE_ICON_AXIS - 0.5 }}
    >
      {children}
    </View>
  );
}

/** The 28pt icon well's colour for a step status. */
export function statusColor(
  status: 'running' | 'done' | 'failed' | 'waiting' | 'pending',
  colors: Record<string, string>,
): string {
  switch (status) {
    case 'running':
      return colors['primary']!;
    case 'failed':
      return colors['danger']!;
    case 'waiting':
      return colors['primary']!;
    default:
      return colors['muted-foreground']!;
  }
}
