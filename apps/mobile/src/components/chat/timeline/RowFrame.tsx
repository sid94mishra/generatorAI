// ────────────────────────────────────────────────────────────────
// RowFrame — the card every activity row is drawn in.
//
// One frame, so the taxonomy in `deriveTimeline` maps to ONE visual
// grammar: a 28pt leading icon, a title, an optional mono sub-line, a
// trailing slot (spinner, "+12 −3", exit code) and a chevron when the row
// expands. Tone tints the border and surface — `danger` for failures,
// `warning` for MCP trouble, `info` for sub-agents, `primary` for the
// "waiting for you" row — so a reader can scan a long turn by colour.
//
// Long-press opens the shared context menu (`useContextMenu`); the items
// are supplied by the row, because only the row knows what "copy" means for
// it. The frame's own tap toggles expansion; nested pressables are avoided
// so the long-press is never swallowed.
// ────────────────────────────────────────────────────────────────

import React, { useCallback } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { ChevronDown, ChevronRight } from 'lucide-react-native';

import { useCardEntering } from '../../common/enterMotion';
import { useContextMenu, type ContextMenuItem } from '../../ui/ContextMenu';
import { Touchable } from '../../ui/Touchable';
import { MAX_SCALE } from '../../ui/accessibility';
import { haptics } from '../../ui/haptics';
import { useTheme } from '../../../theme/ThemeProvider';

export type RowTone = 'default' | 'primary' | 'info' | 'warning' | 'danger' | 'success';

const TONE_CARD: Record<RowTone, string> = {
  default: 'border-border bg-card',
  primary: 'border-primary bg-accent',
  info: 'border-info bg-info-muted',
  warning: 'border-warning bg-warning-muted',
  danger: 'border-danger bg-danger-muted',
  success: 'border-success bg-success-muted',
};

const TONE_ICON_WELL: Record<RowTone, string> = {
  default: 'bg-subtle',
  primary: 'bg-card',
  info: 'bg-card',
  warning: 'bg-card',
  danger: 'bg-card',
  success: 'bg-card',
};

export interface RowFrameProps {
  icon: React.ReactNode;
  title: string;
  /** Mono sub-line — a path, a command, a query. */
  subtitle?: string | null;
  /** Non-mono second line — an error message, a warning's detail. */
  detail?: string | null;
  right?: React.ReactNode;
  tone?: RowTone;
  /** Omit to render a static row (no chevron, no toggle). */
  expanded?: boolean;
  onToggle?: () => void;
  /** Long-press menu items; empty means no menu. */
  menu?: ContextMenuItem[];
  menuTitle?: string;
  /** Indented and lighter — a child of a sub-agent row. */
  nested?: boolean;
  accessibilityLabel?: string;
  children?: React.ReactNode;
}

export function RowFrame({
  icon,
  title,
  subtitle,
  detail,
  right,
  tone = 'default',
  expanded,
  onToggle,
  menu,
  menuTitle,
  nested = false,
  accessibilityLabel,
  children,
}: RowFrameProps): React.ReactElement {
  const { colors } = useTheme();
  const entering = useCardEntering();
  const { open } = useContextMenu();

  const expandable = onToggle !== undefined;
  const hasMenu = (menu?.length ?? 0) > 0;

  const onLongPress = useCallback(() => {
    if (!hasMenu || !menu) return;
    haptics.tap();
    open(menu, menuTitle ? { title: menuTitle } : undefined);
  }, [hasMenu, menu, menuTitle, open]);

  const label = accessibilityLabel ?? `${title}${subtitle ? `, ${subtitle}` : ''}`;

  return (
    <Animated.View
      entering={entering}
      className={`overflow-hidden rounded-2xl border ${TONE_CARD[tone]} ${nested ? 'ml-6' : ''}`}
    >
      <Touchable
        accessibilityLabel={expandable ? `${label}${expanded ? ', collapse' : ', expand'}` : label}
        {...(hasMenu ? { accessibilityHint: 'Double tap and hold for actions' } : {})}
        {...(expandable ? { accessibilityState: { expanded: Boolean(expanded) } } : {})}
        a11yRole={expandable ? 'button' : 'text'}
        haptic={expandable ? 'select' : 'none'}
        scale={expandable ? 'large' : 'none'}
        ripple={expandable}
        disabled={!expandable && !hasMenu}
        onPress={expandable ? onToggle : undefined}
        onLongPress={hasMenu ? onLongPress : undefined}
        className={`min-h-11 flex-row items-center gap-2.5 px-3 ${nested ? 'py-1.5' : 'py-2'}`}
      >
        <View className={`h-7 w-7 items-center justify-center rounded-xl ${TONE_ICON_WELL[tone]}`}>{icon}</View>
        <View className="flex-1 gap-0.5">
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_SCALE.chrome}
            className={`font-medium text-foreground ${nested ? 'text-xs' : 'text-sm'}`}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} className="font-mono text-xs text-muted-foreground">
              {subtitle}
            </Text>
          ) : null}
          {detail ? (
            <Text numberOfLines={2} className={`text-xs ${tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-muted-foreground'}`}>
              {detail}
            </Text>
          ) : null}
        </View>
        {right}
        {expandable ? (
          expanded ? (
            <ChevronDown size={16} color={colors['muted-foreground']} />
          ) : (
            <ChevronRight size={16} color={colors['muted-foreground']} />
          )
        ) : null}
      </Touchable>
      {expandable && expanded && children ? (
        <Animated.View entering={FadeIn.duration(120)} className="border-t border-border-muted">
          {children}
        </Animated.View>
      ) : null}
    </Animated.View>
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
