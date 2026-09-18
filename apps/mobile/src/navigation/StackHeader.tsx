// ────────────────────────────────────────────────────────────────
// StackHeader — the header drawn for every pushed screen.
//
// Why not the native header: `ConnectionStripHost` pays the status-bar band
// once, above the whole app, and hands children a zero top inset so the
// connection strip can sit directly under the bar. The native Android header
// (react-native-screens ≥ 4, edge-to-edge since SDK 35) hard-codes its own
// status-bar inset and cannot be told otherwise, so every detail screen paid
// the band twice — ~50dp of dead space above each title. A JS header reads the
// inset context like the rest of the app, looks identical on iOS and Android,
// and matches the compact tab header (one ~52pt row, title left).
//
// It honours the options screens already set: `title`, `headerTitle` (string
// or render function — the chat screen's tappable title), `headerLeft` and
// `headerRight`.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';

import { MAX_SCALE } from '../components/ui/accessibility';
import { useTheme } from '../theme/ThemeProvider';

type Slot = (props: { canGoBack: boolean; tintColor?: string }) => React.ReactNode;

export interface StackHeaderProps {
  options: {
    title?: string;
    headerTitle?: string | ((props: { children: string; tintColor?: string }) => React.ReactNode);
    headerLeft?: Slot;
    headerRight?: Slot;
  };
  route: { name: string };
  back?: unknown;
}

/** Exported for tests: the text a header shows when no render function is given. */
export function stackHeaderTitle(options: StackHeaderProps['options'], routeName: string): string {
  if (typeof options.headerTitle === 'string') return options.headerTitle;
  if (options.title !== undefined) return options.title;
  return routeName;
}

export function StackHeader({ options, route, back }: StackHeaderProps): React.ReactElement {
  const { colors } = useTheme();
  const title = stackHeaderTitle(options, route.name);
  const slotProps = { canGoBack: Boolean(back), tintColor: colors.foreground };
  const left = options.headerLeft?.(slotProps);
  const right = options.headerRight?.(slotProps);

  return (
    <View
      className="min-h-[52px] flex-row items-center gap-1 bg-background pl-2 pr-3"
      accessibilityRole="header"
    >
      {left ? <View className="items-center justify-center">{left}</View> : <View className="w-2" />}
      <View className="min-w-0 flex-1 justify-center px-1">
        {typeof options.headerTitle === 'function' ? (
          options.headerTitle({ children: title, tintColor: colors.foreground })
        ) : (
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_SCALE.chrome}
            className="text-lg font-semibold text-foreground"
          >
            {title}
          </Text>
        )}
      </View>
      {right ? <View className="flex-row items-center gap-1">{right}</View> : null}
    </View>
  );
}
