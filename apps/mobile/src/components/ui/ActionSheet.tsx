// ────────────────────────────────────────────────────────────────
// ActionSheet — the long-press / overflow menu.
//
// The app had no way to reach a secondary action on anything: no context
// menu on a chat, a message, a file or a run. On a phone that is not a
// missing nicety, it is the only place those actions can live, because there
// is no room for a row of buttons and no hover to reveal them.
//
// Modelled on the platform action sheet rather than on a dropdown:
//   • actions stack full-width at the bottom, within thumb reach,
//   • the destructive one is tinted, not hidden,
//   • Cancel is separated and always present (HIG: never rely on the scrim),
//   • an optional title states what the actions apply to, because a menu
//     with no subject is how people delete the wrong thing.
//
// Built on `Sheet` so it inherits the theme re-application, the scrim, the
// swipe dismissal and the modal semantics rather than re-deriving them.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';

import { Sheet } from './Sheet';
import { Touchable } from './Touchable';
import { MAX_SCALE } from './accessibility';
import { haptics } from './haptics';

export interface MenuAction {
  label: string;
  icon?: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  /** Shown under the label — say why a disabled action is unavailable. */
  detail?: string;
  /** For E2E: an action that a test has to tap by name rather than by label. */
  testID?: string;
  onPress: () => void;
}

export function ActionSheet({
  visible,
  onClose,
  title,
  message,
  actions,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  actions: MenuAction[];
}): React.ReactElement | null {
  if (!visible) return null;

  return (
    <Sheet visible={visible} onClose={onClose} detents={[0.4]} scrollable fitContent>
      {title || message ? (
        <View className="gap-1 px-5 pb-3 pt-1">
          {title ? (
            <Text
              accessibilityRole="header"
              numberOfLines={2}
              className="text-md font-semibold text-foreground"
            >
              {title}
            </Text>
          ) : null}
          {message ? <Text className="text-sm text-muted-foreground">{message}</Text> : null}
        </View>
      ) : null}

      <View className="mx-4 overflow-hidden rounded-3xl border border-border bg-raised">
        {actions.map((action, index) => (
          <View key={action.label}>
            {index > 0 ? <View className="h-px bg-border-muted" /> : null}
            <Touchable
              accessibilityLabel={action.label}
              accessibilityHint={action.detail}
              {...(action.testID ? { testID: action.testID } : {})}
              disabled={action.disabled}
              haptic="none"
              scale="none"
              onPress={() => {
                if (action.destructive) haptics.warn();
                else haptics.tap();
                onClose();
                action.onPress();
              }}
              className="min-h-14 flex-row items-center gap-3 px-4 py-3"
            >
              {action.icon}
              <View className="flex-1 gap-0.5">
                <Text
                  maxFontSizeMultiplier={MAX_SCALE.control}
                  className={`text-md font-medium ${action.destructive ? 'text-danger' : 'text-foreground'}`}
                >
                  {action.label}
                </Text>
                {action.detail ? (
                  <Text className="text-sm text-muted-foreground">{action.detail}</Text>
                ) : null}
              </View>
            </Touchable>
          </View>
        ))}
      </View>

      <View className="px-4 pb-2 pt-3">
        <Touchable
          accessibilityLabel="Cancel"
          haptic="tap"
          scale="none"
          onPress={onClose}
          className="min-h-14 items-center justify-center rounded-3xl border border-border bg-card py-3"
        >
          <Text
            maxFontSizeMultiplier={MAX_SCALE.control}
            className="text-md font-semibold text-foreground"
          >
            Cancel
          </Text>
        </Touchable>
      </View>
    </Sheet>
  );
}

/**
 * A destructive confirmation.
 *
 * `Alert.alert` is the platform default and is used elsewhere for genuinely
 * modal decisions; this exists for confirmations that need to show *context*
 * — which files, which chat — that an alert body cannot carry legibly.
 */
export function ConfirmSheet({
  visible,
  onClose,
  title,
  message,
  confirmLabel,
  onConfirm,
  destructive = true,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
}): React.ReactElement | null {
  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      title={title}
      {...(message ? { message } : {})}
      actions={[{ label: confirmLabel, destructive, onPress: onConfirm }]}
    />
  );
}
