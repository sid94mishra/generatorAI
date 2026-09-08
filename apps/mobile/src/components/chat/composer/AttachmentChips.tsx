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
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { Camera, FileText, X } from 'lucide-react-native';

import { Touchable } from '../../ui/Touchable';
import { Spinner } from '../../ui/States';
import { MAX_SCALE } from '../../ui/accessibility';
import { useTheme } from '../../../theme/ThemeProvider';
import { formatBytes } from './attachmentPolicy';
import type { ComposerAttachment } from './types';

/** Legacy callers still pass `{ id, name }`; everything else is optional. */
export type ChipAttachment = Pick<ComposerAttachment, 'id' | 'name'> & Partial<ComposerAttachment>;

export function AttachmentChips({
  items,
  onRemove,
}: {
  items: readonly ChipAttachment[];
  onRemove: (id: string) => void;
}): React.ReactElement | null {
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
            entering={FadeIn.duration(140)}
            exiting={FadeOut.duration(120)}
            layout={LinearTransition.duration(160)}
            accessible
            accessibilityLabel={`${item.kind === 'image' ? 'Image' : 'File'} ${item.name}${
              failed ? `, failed: ${item.error}` : item.uploading ? ', uploading' : ''
            }`}
            className={`h-11 flex-row items-center gap-2 rounded-2xl border pl-1.5 pr-1 ${
              failed ? 'border-danger bg-danger-muted' : 'border-border bg-raised'
            }`}
          >
            {item.kind === 'image' && item.previewUri ? (
              <Image
                source={{ uri: item.previewUri }}
                accessibilityIgnoresInvertColors
                style={{ width: 32, height: 32, borderRadius: 8 }}
              />
            ) : (
              <View className="h-8 w-8 items-center justify-center rounded-lg bg-subtle">
                {item.kind === 'capture' ? (
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
                className="h-8 w-8 items-center justify-center rounded-full"
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
