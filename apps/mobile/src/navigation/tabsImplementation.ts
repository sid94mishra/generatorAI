// ────────────────────────────────────────────────────────────────
// Tab bar implementation flag and metrics.
//
// ── The flag ─────────────────────────────────────────────────────
// expo-router 57 ships `expo-router/unstable-native-tabs`, which renders a
// real `UITabBarController` (iOS 26 Liquid Glass) and a Material 3
// `BottomNavigationView`. It is the right long-term answer and it is still
// marked unstable: badges, the re-tap-to-scroll-top listener and the
// accessory strip all need verifying on a device before it can carry the
// app. Until then the JS tab bar below is styled to feel native on both
// platforms, and this ONE constant is the switch.
//
// To flip:
//   1. set `USE_NATIVE_TABS = true`;
//   2. in `app/(tabs)/_layout.tsx`, render `<NativeTabs>` from
//      'expo-router/unstable-native-tabs' inside the `USE_NATIVE_TABS`
//      branch (the JS branch stays as the fallback for web);
//   3. verify on device: badge on Home, haptic on tab change, re-tap
//      scroll-to-top, the accessory strip sitting above the bar, Dynamic
//      Type at AX3, and that `sceneStyle` still paints the themed background.
//
// ── The metrics ──────────────────────────────────────────────────
// Pure so the bar height can be asserted in the node test-suite. The web
// preview clipped the tab labels because the bar height was left to the
// navigator's default while the label carried its own line-height and the
// bottom inset was added on top: the label row overflowed by a few points
// and the last line of every label was cut. The height is now computed from
// what is inside it.
// ────────────────────────────────────────────────────────────────

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
  /** Whether the label row is drawn at all at this reading size. */
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

/**
 * Labels are dropped rather than wrapped past ~1.4×: "Projects" on two
 * lines pushes the icon out of the bar entirely.
 */
export const LABEL_MAX_SCALE = 1.4;

export function tabBarMetrics(
  platform: TabPlatform,
  bottomInset: number,
  fontScale = 1,
): TabBarMetrics {
  const scale = Math.min(Math.max(fontScale, 1), LABEL_MAX_SCALE);
  const showLabel = fontScale <= LABEL_MAX_SCALE;
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

/**
 * Hex `#rrggbb` → `rgba()` at the given alpha; other inputs pass through.
 *
 * The tokens are delivered as opaque hex strings and the iOS bar wants a
 * translucent tint of the sidebar colour. Without `expo-blur` (no new native
 * modules) a 94% tint of the same surface is the closest honest reading of
 * "glass": content scrolling under it still shows through faintly.
 */
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
