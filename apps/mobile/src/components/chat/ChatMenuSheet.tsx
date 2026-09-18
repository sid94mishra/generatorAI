// ────────────────────────────────────────────────────────────────
// ChatMenuSheet — the chat's ONE overflow menu, in sections.
//
//   Workbench   Files · Plan · Tasks · Session info
//   Chat        Rename · Rewind · Share · Copy transcript · Fork · Archive
//
// The screen used to have two "⋯" buttons a thumb apart: the header's chat
// menu and the pane strip's "More". One menu with labelled sections says
// where everything is, and — because the header is always there — the
// Workbench is reachable on a chat that has no workspace (and so no strip).
//
// Composed from `Sheet` + `Touchable` rather than `ActionSheet`, which has no
// section headers; the row styling matches ActionSheet's so the two read as
// the same control.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';

import { Sheet } from '../ui/Sheet';
import { Touchable } from '../ui/Touchable';
import { MAX_SCALE } from '../ui/accessibility';
import { haptics } from '../ui/haptics';

export interface ChatMenuItem {
  label: string;
  icon: React.ReactNode;
  detail?: string;
  /** Short trailing text — a count. */
  trailing?: string;
  disabled?: boolean;
  testID?: string;
  onPress: () => void;
}

export interface ChatMenuSection {
  title: string;
  items: ChatMenuItem[];
}

export function ChatMenuSheet({
  visible,
  onClose,
  title,
  sections,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  sections: ChatMenuSection[];
}): React.ReactElement | null {
  if (!visible) return null;
  return (
    <Sheet visible={visible} onClose={onClose} title={title} detents={[0.92]} fitContent scrollable keyboardAware={false}>
      <View className="gap-4 pb-4">
        {sections.map((section) => (
          <View key={section.title} className="gap-1.5">
            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={MAX_SCALE.chrome}
              className="px-5 text-sm font-medium text-muted-foreground"
            >
              {section.title}
            </Text>
            <View className="mx-4 overflow-hidden rounded-3xl border border-border bg-raised">
              {section.items.map((item, index) => (
                <View key={item.label}>
                  {index > 0 ? <View className="ml-14 h-px bg-border-muted" /> : null}
                  <Touchable
                    accessibilityLabel={item.label}
                    {...(item.detail ? { accessibilityHint: item.detail } : {})}
                    {...(item.testID ? { testID: item.testID } : {})}
                    disabled={item.disabled}
                    haptic="none"
                    scale="none"
                    onPress={() => {
                      haptics.tap();
                      onClose();
                      item.onPress();
                    }}
                    className={`min-h-12 flex-row items-center gap-3 px-4 py-2.5 ${item.disabled ? 'opacity-50' : ''}`}
                  >
                    <View className="w-6 items-center">{item.icon}</View>
                    <View className="flex-1 gap-0.5">
                      <Text maxFontSizeMultiplier={MAX_SCALE.control} className="text-md font-medium text-foreground">
                        {item.label}
                      </Text>
                      {item.detail ? <Text className="text-sm text-muted-foreground">{item.detail}</Text> : null}
                    </View>
                    {item.trailing ? (
                      <Text className="text-sm font-medium text-muted-foreground">{item.trailing}</Text>
                    ) : null}
                  </Touchable>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    </Sheet>
  );
}
