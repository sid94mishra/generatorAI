// Shared tab geometry. The JS navigator uses native Liquid Glass behind its
// iOS controls and opaque Material surfaces elsewhere. NativeTabs remains
// disabled until its distinct inset and gesture contracts are tested on iOS.

import { fontSize, lineHeight } from '../theme/tokens.generated';

export const USE_NATIVE_TABS = false as const;

export type TabPlatform = 'ios' | 'android' | 'web' | 'windows' | 'macos';

export interface TabBarMetrics {
  /** Bar height INCLUDING the bottom safe-area inset. */
  height: number;
  /** The bar's own content height, without the inset. */
  contentHeight: number;
  paddingBottom: number;
  iconSize: number;
  labelFontSize: number;
  labelLineHeight: number;
  /** Labels remain visible; only compact chrome typography is capped. */
  showLabel: boolean;
  /** Material 3 draws a pill behind the active icon; iOS does not. */
  activePill: boolean;
}

/** HIG: a standard tab bar is 49pt tall on iPhone. */
const IOS_BAR = 49;
/** Material 3 navigation bar height is 80dp. */
const M3_BAR = 80;
/** react-native-web's default, kept for the desktop preview. */
const WEB_BAR = 56;

/** Compact navigation caps type growth while keeping every destination labelled. */
export const LABEL_MAX_SCALE = 1.4;

export function tabBarMetrics(
  platform: TabPlatform,
  bottomInset: number,
  fontScale = 1,
): TabBarMetrics {
  const scale = Math.min(Math.max(fontScale, 1), LABEL_MAX_SCALE);
  const showLabel = true; // Keep destinations named; cap only the compact chrome typography.
  const labelFontSize = Math.round(fontSize.xs * scale);
  const labelLineHeight = Math.ceil(labelFontSize * lineHeight.tight);
  const iconSize = 24;
  const inset = Math.max(0, bottomInset);

  // Each platform's canonical height already accommodates icon + label at
  // the default reading size (49 = 24 icon + 2 gap + 14 label + 2×4 pad on
  // iOS, with a point to spare). Past that, the bar grows with the label so
  // it never clips — which is exactly what the web preview failed to do.
  const grown = iconSize + 2 + (showLabel ? labelLineHeight : 0) + 2 * 4;
  const base = platform === 'ios' ? IOS_BAR : platform === 'android' ? M3_BAR : WEB_BAR;
  const contentHeight = Math.max(base, grown);

  return {
    height: contentHeight + inset,
    contentHeight,
    paddingBottom: inset,
    iconSize,
    labelFontSize,
    labelLineHeight,
    showLabel,
    activePill: platform === 'android',
  };
}

/** Hex `#rrggbb` to rgba, for callers that need a translucent tint. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const hex = m[1]!;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ── Content insets inside the tab shell ─────────────────────────

/** HIG / M3 FAB diameter. */
export const FAB_SIZE = 56;
/** Gap between the FAB and whatever it floats above. */
export const FAB_MARGIN = 16;

export interface TabContentInsets {
  /**
   * How much of a tab scene the bar covers. The iOS bar is absolutely
   * positioned so content scrolls under its translucent tint; every other
   * platform lays the scene out ABOVE the bar, so nothing is covered.
   */
  barOverlap: number;
  /** `bottom` for a FAB in a tab scene. */
  fabBottom: number;
  /** Bottom padding a list needs so its last row clears the bar (and the FAB). */
  listBottom: (hasFab: boolean) => number;
}

/**
 * Where floating chrome and list ends sit inside a tab scene.
 *
 * This replaced a hard-coded `Fab offset={64}` plus per-screen
 * `paddingBottom: 140/160`, which was right for no platform: on iOS the last
 * rows scrolled under the FAB, on Android the FAB floated 64dp above a bar
 * that the scene already ended at.
 */
export function tabContentInsets(platform: TabPlatform, metrics: Pick<TabBarMetrics, 'height'>): TabContentInsets {
  const barOverlap = platform === 'ios' ? metrics.height : 0;
  const fabBottom = barOverlap + FAB_MARGIN;
  return {
    barOverlap,
    fabBottom,
    listBottom: (hasFab) => (hasFab ? fabBottom + FAB_SIZE + FAB_MARGIN : barOverlap + FAB_MARGIN + 8),
  };
}
