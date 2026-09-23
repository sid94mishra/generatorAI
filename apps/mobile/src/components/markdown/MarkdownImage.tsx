// ────────────────────────────────────────────────────────────────
// Markdown images.
//
// `expo-image` is not a dependency (no new native modules), so this is the
// core `Image` with the two things it lacks done by hand:
//
//   • intrinsic size, via `Image.getSize`, cached per URI in a module map so
//     a transcript that scrolls the same screenshot in and out of view asks
//     the network exactly once — and skipped entirely while the block is
//     streaming, because the URI may still be growing;
//   • a full-screen viewer with pinch-zoom and pan, since a 320pt-tall box is
//     a preview of a screenshot, not a way to read it.
//
// A blocked source (anything but http(s) or data:image) renders its alt text
// with a "blocked" tone. It is never fetched.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Modal, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ImageOff, ShieldOff, X } from 'lucide-react-native';

import { useTheme } from '../../theme/ThemeProvider';
import { MAX_SCALE } from '../ui/accessibility';
import { SPRING_SHEET, TIMING_FAST } from '../ui/motion';
import { Touchable } from '../ui/Touchable';

/** Tallest an inline image may render; taller images letterbox to width. */
export const MAX_IMAGE_HEIGHT = 320;
/** Height used before the intrinsic size is known (or while streaming). */
const PLACEHOLDER_HEIGHT = 180;

export interface LightboxImage {
  src: string;
  alt: string;
}

interface Size {
  width: number;
  height: number;
}

// ── Size cache ──────────────────────────────────────────────────

/** `null` records a failure so a broken URI is not re-fetched every mount. */
const sizeCache = new Map<string, Size | null>();
const sizeInFlight = new Map<string, Promise<Size | null>>();

function loadSize(src: string): Promise<Size | null> {
  const cached = sizeCache.get(src);
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = sizeInFlight.get(src);
  if (pending) return pending;

  const promise = new Promise<Size | null>((resolve) => {
    Image.getSize(
      src,
      (width, height) => resolve(width > 0 && height > 0 ? { width, height } : null),
      () => resolve(null),
    );
  }).then((size) => {
    sizeCache.set(src, size);
    sizeInFlight.delete(src);
    return size;
  });
  sizeInFlight.set(src, promise);
  return promise;
}

/** `undefined` = not known yet; `null` = could not be determined. */
function useImageSize(src: string, enabled: boolean): Size | null | undefined {
  const [size, setSize] = useState<Size | null | undefined>(() => sizeCache.get(src));

  useEffect(() => {
    if (!enabled) return;
    const cached = sizeCache.get(src);
    if (cached !== undefined) {
      setSize(cached);
      return;
    }
    let live = true;
    void loadSize(src).then((result) => {
      if (live) setSize(result);
    });
    return () => {
      live = false;
    };
  }, [src, enabled]);

  return size;
}

// ── Inline image ────────────────────────────────────────────────

export interface MarkdownImageProps {
  src: string;
  alt: string;
  /** From `classifyImage`; a blocked image is never fetched. */
  allowed: boolean;
  /** Skip sizing until the block settles. */
  streaming?: boolean;
  onOpen?: (image: LightboxImage) => void;
}

export function MarkdownImage({ src, alt, allowed, streaming = false, onOpen }: MarkdownImageProps): React.ReactElement {
  const { colors } = useTheme();
  const [containerWidth, setContainerWidth] = useState(0);
  const [failed, setFailed] = useState(false);
  const size = useImageSize(src, allowed && !streaming);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    setContainerWidth((prev) => (prev === w ? prev : w));
  }, []);

  const box = useMemo(() => {
    if (!size || containerWidth === 0) {
      return { width: containerWidth || undefined, height: PLACEHOLDER_HEIGHT };
    }
    const scale = Math.min(containerWidth / size.width, MAX_IMAGE_HEIGHT / size.height);
    return {
      width: Math.round(size.width * scale),
      height: Math.round(size.height * scale),
    };
  }, [size, containerWidth]);

  if (!allowed || failed || size === null) {
    const Icon = allowed ? ImageOff : ShieldOff;
    const reason = allowed ? 'Image could not be loaded' : 'Image blocked';
    return (
      <View
        accessibilityRole="image"
        accessibilityLabel={`${reason}${alt ? `: ${alt}` : ''}`}
        className="flex-row items-center gap-2 rounded-lg border border-border bg-subtle px-3 py-2"
      >
        <Icon size={16} color={colors['muted-foreground']} />
        <Text
          numberOfLines={2}
          maxFontSizeMultiplier={MAX_SCALE.control}
          className="flex-1 text-sm italic text-muted-foreground"
        >
          {alt || reason}
        </Text>
      </View>
    );
  }

  return (
    <View onLayout={onLayout}>
      <Touchable
        a11yRole="imagebutton"
        accessibilityLabel={alt || 'Image'}
        accessibilityHint="Opens full screen"
        haptic="tap"
        ripple={false}
        scale="none"
        disabled={!onOpen}
        onPress={() => onOpen?.({ src, alt })}
        className="self-start"
      >
        <Image
          source={{ uri: src }}
          resizeMode="contain"
          accessible={false}
          onError={() => setFailed(true)}
          style={[box, { borderRadius: 8, backgroundColor: colors.subtle }]}
        />
      </Touchable>
    </View>
  );
}

// ── Lightbox ────────────────────────────────────────────────────

const MIN_SCALE = 1;
const MAX_SCALE_FACTOR = 5;
const DOUBLE_TAP_SCALE = 2.5;

export function ImageLightbox({
  image,
  onClose,
}: {
  image: LightboxImage | null;
  onClose: () => void;
}): React.ReactElement | null {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  // Every open starts un-zoomed; a viewer that remembers the last image's
  // zoom shows the next one cropped.
  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    tx.value = 0;
    ty.value = 0;
    savedTx.value = 0;
    savedTy.value = 0;
  }, [image, scale, savedScale, tx, ty, savedTx, savedTy]);

  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .onUpdate((e) => {
        scale.value = Math.min(MAX_SCALE_FACTOR, Math.max(0.5, savedScale.value * e.scale));
      })
      .onEnd(() => {
        if (scale.value < MIN_SCALE) {
          scale.value = withSpring(MIN_SCALE, SPRING_SHEET);
          tx.value = withSpring(0, SPRING_SHEET);
          ty.value = withSpring(0, SPRING_SHEET);
          savedScale.value = MIN_SCALE;
          savedTx.value = 0;
          savedTy.value = 0;
        } else {
          savedScale.value = scale.value;
        }
      });

    const pan = Gesture.Pan()
      .minPointers(1)
      .maxPointers(2)
      .onUpdate((e) => {
        // Panning an un-zoomed image has nowhere to go; keep it centred so
        // the tap-to-close target stays where the user expects.
        if (savedScale.value <= MIN_SCALE) return;
        tx.value = savedTx.value + e.translationX;
        ty.value = savedTy.value + e.translationY;
      })
      .onEnd(() => {
        savedTx.value = tx.value;
        savedTy.value = ty.value;
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd(() => {
        const next = savedScale.value > MIN_SCALE ? MIN_SCALE : DOUBLE_TAP_SCALE;
        scale.value = withTiming(next, TIMING_FAST);
        tx.value = withTiming(0, TIMING_FAST);
        ty.value = withTiming(0, TIMING_FAST);
        savedScale.value = next;
        savedTx.value = 0;
        savedTy.value = 0;
      });

    const singleTap = Gesture.Tap()
      .numberOfTaps(1)
      .onEnd(() => {
        if (savedScale.value <= MIN_SCALE) runOnJS(onClose)();
      });

    return Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap));
  }, [onClose, scale, savedScale, tx, ty, savedTx, savedTy]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  if (!image) return null;

  return (
    <Modal
      visible
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      {/* Its own gesture root: a Modal is a separate window on Android, where
          pinch and pan would otherwise never reach the detector (see Sheet). */}
      <GestureHandlerRootView style={styles.backdrop}>
        <GestureDetector gesture={gesture}>
          <Animated.Image
            source={{ uri: image.src }}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel={image.alt || 'Image'}
            style={[{ width, height }, animatedStyle]}
          />
        </GestureDetector>
        <View style={[styles.closeWrap, { top: insets.top + 8, right: insets.right + 12 }]}>
          <Touchable accessibilityLabel="Close" haptic="tap" ripple={false} onPress={onClose} style={styles.close}>
            <X size={20} color="#ffffff" />
          </Touchable>
        </View>
        {image.alt ? (
          <View pointerEvents="none" style={[styles.captionWrap, { bottom: insets.bottom + 16 }]}>
            <Text numberOfLines={2} maxFontSizeMultiplier={MAX_SCALE.control} style={styles.caption}>
              {image.alt}
            </Text>
          </View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

// The viewer is intentionally theme-independent: an image reads best on
// black regardless of palette, and the chrome must be legible over any
// photo, so these are literal colours rather than tokens.
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' },
  closeWrap: { position: 'absolute' },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  captionWrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  caption: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
});
