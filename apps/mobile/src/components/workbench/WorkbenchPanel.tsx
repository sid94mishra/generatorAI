// ────────────────────────────────────────────────────────────────
// WorkbenchPanel — the index of session tools, inside the right-hand panel.
//
// The phone form of the desktop right pane's tab strip. Each row is a tool
// with a one-line glimpse of what is in it, so the panel answers "did the
// agent change anything / is the browser up / is a task still running"
// without opening a thing. Picking a row closes the panel and raises the tool
// as a sheet from the bottom.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight, Lock, X } from 'lucide-react-native';

import { IconButton } from '../ui/Button';
import { Touchable } from '../ui/Touchable';
import { MAX_SCALE } from '../ui/accessibility';
import { useWindowInsets } from '../ui/windowInsets';
import { useTheme } from '../../theme/ThemeProvider';
import { TOOL_ICONS } from './toolIcons';
import type { ToolDescriptor, ToolId, ToolTone } from './workbenchModel';

const TONE_TOKEN: Record<ToolTone, string> = {
  neutral: 'muted-foreground',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

export function WorkbenchPanel({
  title = 'Workbench',
  subtitle,
  tools,
  activeTool,
  onPick,
  onClose,
  footer,
}: {
  title?: string;
  subtitle?: string | null;
  tools: readonly ToolDescriptor[];
  /** The tool currently open in the sheet, if any. */
  activeTool: ToolId | null;
  onPick: (tool: ToolId) => void;
  onClose: () => void;
  footer?: React.ReactNode;
}): React.ReactElement {
  const { colors } = useTheme();
  // The panel sits inside `ConnectionStripHost`, which already consumed the
  // top inset; the bottom one is still live.
  const insets = useSafeAreaInsets();
  const windowInsets = useWindowInsets();

  return (
    <View className="flex-1" style={{ paddingTop: insets.top, paddingRight: windowInsets.right }}>
      <View className="flex-row items-center gap-2 pl-5 pr-2" style={{ minHeight: 56 }}>
        <View className="min-w-0 flex-1">
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_SCALE.chrome}
            className="text-lg font-bold text-foreground"
          >
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-xs text-muted-foreground">
              {subtitle}
            </Text>
          ) : null}
        </View>
        <IconButton
          accessibilityLabel="Close workbench"
          icon={<X size={20} color={colors['muted-foreground']} />}
          onPress={onClose}
        />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: insets.bottom + 16, gap: 6 }}
      >
        {tools.length === 0 ? (
          <Text className="px-3 py-6 text-sm leading-relaxed text-muted-foreground">
            Tools appear here once the agent has a workspace — it is created the first time it runs.
          </Text>
        ) : null}
        {tools.map((tool) => {
          const Icon = TOOL_ICONS[tool.id];
          const selected = tool.id === activeTool;
          const tint = colors[TONE_TOKEN[tool.tone]] ?? colors['muted-foreground'];
          return (
            <Touchable
              key={tool.id}
              testID={`workbench-tool-${tool.id}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${tool.label}. ${
                tool.stats ? `${tool.stats.additions} added, ${tool.stats.deletions} removed. ` : ''
              }${tool.glimpse}${tool.locked ? '. Locked' : ''}`}
              haptic="select"
              onPress={() => onPick(tool.id)}
              // Flat rows, icon and text, as desktop's sidebar: no card per
              // item; the open one takes the sidebar's selection tint.
              className={`min-h-14 flex-row items-center gap-3 rounded-lg px-3 py-2 ${
                selected ? 'bg-sidebar-accent' : ''
              }`}
            >
              <View
                className="h-10 w-8 items-center justify-center"
              >
                <Icon size={19} color={tool.tone === 'neutral' ? colors.foreground : tint} />
                {tool.live || tool.attention ? (
                  <View
                    className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: tool.attention ? colors.warning : colors.success }}
                  />
                ) : null}
              </View>
              <View className="min-w-0 flex-1">
                <View className="flex-row items-center gap-1.5">
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={MAX_SCALE.control}
                    className={`shrink text-base font-semibold ${selected ? 'text-sidebar-accent-foreground' : 'text-foreground'}`}
                  >
                    {tool.label}
                  </Text>
                  {tool.count ? (
                    <View className="min-w-5 items-center rounded-md bg-control px-1.5">
                      <Text maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-xs font-semibold text-foreground">
                        {tool.count > 99 ? '99+' : tool.count}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={MAX_SCALE.control}
                  className="text-sm"
                  style={{ color: tool.tone === 'neutral' ? colors['muted-foreground'] : tint }}
                >
                  {tool.stats ? (
                    <Text className="font-mono text-xs">
                      <Text className="text-success">+{tool.stats.additions}</Text>{' '}
                      <Text className="text-danger">−{tool.stats.deletions}</Text>
                      {'  '}
                    </Text>
                  ) : null}
                  {tool.glimpse}
                </Text>
              </View>
              {tool.locked ? (
                <Lock size={15} color={colors['muted-foreground']} />
              ) : (
                <ChevronRight size={16} color={colors['muted-foreground']} />
              )}
            </Touchable>
          );
        })}
        {footer}
      </ScrollView>
    </View>
  );
}
