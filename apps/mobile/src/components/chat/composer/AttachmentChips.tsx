// ────────────────────────────────────────────────────────────────
// Attachment chips — row 1 of the composer.
//
// Image chips show a thumbnail; file chips an icon and name; captures a
// camera glyph. Each carries its own remove target (44pt), an upload
// spinner while its send is in flight, and a red ring + message when the
// send failed — the draft is still there, so the user can retry or remove.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Camera, FileText, TerminalSquare, X } from 'lucide-react-native';

import { Touchable } from '../../ui/Touchable';
import { Spinner } from '../../ui/States';
import { MAX_SCALE, MIN_TARGET } from '../../ui/accessibility';
import { useTheme } from '../../../theme/ThemeProvider';
import { formatBytes } from './attachmentPolicy';
import type { ComposerAttachment } from './types';
import { useChatMotion } from '../chatMotion';

/** Legacy callers still pass `{ id, name }`; everything else is optional. */
export type ChipAttachment = Pick<ComposerAttachment, 'id' | 'name'> & Partial<ComposerAttachment>;

export function AttachmentChips({
  items,
  onRemove,
}: {
  items: readonly ChipAttachment[];
  onRemove: (id: string) => void;
}): React.ReactElement | null {
  const motion = useChatMotion();
  const { colors } = useTheme();
  if (items.length === 0) return null;

  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingTop: 10 }}
    >
      {items.map((item) => {
        const failed = Boolean(item.error);
        const label = item.name;
        return (
          <Animated.View
            key={item.id}
            entering={motion.fadeIn(140)}
            exiting={motion.fadeOut(120)}
            layout={motion.layout(160)}
            accessible={false}
            accessibilityLabel={`${item.kind === 'image' ? 'Image' : item.kind === 'capture' ? 'Capture' : 'File'} ${item.name}${
              failed ? `, failed: ${item.error}` : item.uploading ? ', uploading' : ''
            }`}
            style={{ minHeight: MIN_TARGET }}
            className={`flex-row items-center gap-2 rounded-2xl border pl-1.5 pr-1 ${
              failed ? 'border-danger bg-danger-muted' : 'border-border bg-raised'
            }`}
          >
            {(item.kind === 'image' || item.kind === 'capture') && item.previewUri ? (
              <Image
                source={{ uri: item.previewUri }}
                accessibilityIgnoresInvertColors
                style={{ width: 32, height: 32, borderRadius: 8 }}
              />
            ) : (
              <View className="h-8 w-8 items-center justify-center rounded-lg bg-subtle">
                {item.kind === 'capture' && item.name.startsWith('terminal-') ? (
                  <TerminalSquare size={16} color={colors['muted-foreground']} />
                ) : item.kind === 'capture' && item.text === undefined ? (
                  <Camera size={16} color={colors['muted-foreground']} />
                ) : (
                  <FileText size={16} color={colors['muted-foreground']} />
                )}
              </View>
            )}
            <View className="max-w-40">
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_SCALE.chrome}
                className={`text-xs font-medium ${failed ? 'text-danger' : 'text-foreground'}`}
              >
                {label}
              </Text>
              {failed ? (
                <Text numberOfLines={1} maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-xs text-danger">
                  {item.error}
                </Text>
              ) : item.size ? (
                <Text maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-xs text-muted-foreground">
                  {formatBytes(item.size)}
                </Text>
              ) : null}
            </View>
            {item.uploading ? (
              <View className="h-8 w-8 items-center justify-center">
                <Spinner />
              </View>
            ) : (
              <Touchable
                accessibilityLabel={`Remove ${item.name}`}
                haptic="select"
                onPress={() => onRemove(item.id)}
                style={{ width: MIN_TARGET, height: MIN_TARGET }}
                className="items-center justify-center rounded-full"
              >
                <X size={14} color={colors['muted-foreground']} />
              </Touchable>
            )}
          </Animated.View>
        );
      })}
    </ScrollView>
  );
}
