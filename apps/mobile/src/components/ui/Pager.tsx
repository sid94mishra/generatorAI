// ────────────────────────────────────────────────────────────────
// Pager — horizontally swipeable pages, for the chat session panes.
//
// Built on gesture-handler `Pan` + Reanimated rather than
// `react-native-pager-view`, because the product constraint is no extra
// native modules. What that costs (native page recycling) does not matter
// for four or five panes; what it buys is a pager whose every frame runs on
// the UI thread while the JS thread is busy applying stream deltas.
//
// Rules, each of which exists because its absence was felt:
//   • The leftmost 24pt is not the pager's. That strip belongs to the iOS
//     back-swipe and Android's predictive back.
//   • At most one page per gesture, as UIPageViewController does.
//   • Pages mount lazily (`preload` neighbours) and stay mounted, so a
//     terminal WebView is not torn down every time the user peeks at Changes.
//   • Nothing sets React state per frame. `onIndexChange` fires once, on
//     settle; a parent that wants the live position reads `progress`.
// ────────────────────────────────────────────────────────────────

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Text, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { Touchable } from './Touchable';
import { useReducedMotionPreset } from './motion';
import { MAX_SCALE } from './accessibility';
import { haptics } from './haptics';
import {
  EDGE_GUTTER,
  clampIndex,
  clampOffset,
  isEdgeTouch,
  mountedPages,
  pageOffset,
  pageProgress,
  settlePage,
} from './pagerMath';

export interface PagerHandle {
  /** Animate to a page. */
  goTo: (index: number) => void;
}

// ── Inner horizontal scrollers ──────────────────────────────────
//
// A diff, a code block or a wide table inside a page scrolls sideways, and
// the page pan must yield to it: `requireExternalGestureToFail` makes the
// pan wait for the scroller's native gesture, which activates on a
// horizontal drag inside it and never begins for a touch outside it. The
// scrollers register themselves through this context so a page deep in the
// tree (a timeline row) needs no plumbing from the screen.
//
// The native gesture is enabled only while the content is wider than its
// frame: a scroller whose content fits still recognises the drag on iOS,
// and would otherwise pin the pager on every short diff.

interface InnerGestureRegistry {
  register: (gesture: GestureType) => () => void;
}

const PagerInnerGestureContext = createContext<InnerGestureRegistry | null>(null);

export interface PagerInnerScroll {
  /** Wrap the horizontal `ScrollView` in `<GestureDetector gesture={…}>`. */
  gesture: GestureType;
  onLayout: (event: LayoutChangeEvent) => void;
  onContentSizeChange: (width: number, height: number) => void;
}

/**
 * For a horizontal scroller rendered inside a `Pager` page. Harmless
 * without a pager above: the gesture is created and never consulted.
 */
export function usePagerInnerScroll(): PagerInnerScroll {
  const registry = useContext(PagerInnerGestureContext);
  const gesture = useMemo(() => Gesture.Native(), []);
  const [frameWidth, setFrameWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  // Config is read by the detector on every render of the wrapping component.
  gesture.enabled(contentWidth > frameWidth + 1);

  useEffect(() => registry?.register(gesture), [registry, gesture]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setFrameWidth(event.nativeEvent.layout.width);
  }, []);
  const onContentSizeChange = useCallback((width: number) => setContentWidth(width), []);

  return useMemo(() => ({ gesture, onLayout, onContentSizeChange }), [gesture, onLayout, onContentSizeChange]);
}

export interface PagerProps {
  count: number;
  /** Controlled page. When omitted the pager owns its index. */
  index?: number;
  defaultIndex?: number;
  /** Fires once per settled page change — never per frame. */
  onIndexChange?: (index: number) => void;
  /**
   * `active` is true only for the current page, so a page can pause its
   * polling or its WebView when it is off-screen.
   */
  renderPage: (index: number, active: boolean) => React.ReactNode;
  /**
   * Gestures that may run at the same time as the page pan — an inner
   * horizontal scroller, a diff's pinch. Pass the same gesture objects those
   * detectors use.
   */
  simultaneousHandlers?: GestureType[];
  /** Left strip left to the platform back gesture. Defaults to 24pt. */
  edgeGutter?: number;
  /** Neighbours mounted on each side of the active page. */
  preload?: number;
  /** Unmount pages once they leave the preload window. Off by default. */
  unmountHidden?: boolean;
  /** Built-in strip under the pages. `labels` renders tappable names. */
  indicator?: 'none' | 'dots' | 'labels';
  labels?: string[];
  /**
   * Continuous position 0..count-1, written on the UI thread every frame.
   * Hand it to `SegmentedControl`'s `progress` to sync an external strip.
   */
  progress?: SharedValue<number>;
  enabled?: boolean;
  /** Selection haptic when a swipe settles on a new page. */
  haptic?: boolean;
  ref?: React.Ref<PagerHandle>;
  accessibilityLabel?: string;
  className?: string;
  style?: ViewStyle;
}

export function Pager({
  count,
  index,
  defaultIndex = 0,
  onIndexChange,
  renderPage,
  simultaneousHandlers,
  edgeGutter = EDGE_GUTTER,
  preload = 1,
  unmountHidden = false,
  indicator = 'none',
  labels,
  progress: externalProgress,
  enabled = true,
  haptic = true,
  ref,
  accessibilityLabel,
  className,
  style,
}: PagerProps): React.ReactElement {
  const presets = useReducedMotionPreset();
  const [width, setWidth] = useState(0);
  const widthSv = useSharedValue(0);
  const translateX = useSharedValue(0);
  const dragStart = useSharedValue(0);

  const controlled = index !== undefined;
  const [internal, setInternal] = useState(() => clampIndex(defaultIndex, count));
  const active = clampIndex(controlled ? index : internal, count);
  const activeSv = useSharedValue(active);

  // Pages that have been visited stay mounted (unless `unmountHidden`).
  const [mounted, setMounted] = useState<Set<number>>(() => new Set(mountedPages(active, count, preload)));

  useEffect(() => {
    setMounted((prev) => {
      const wanted = mountedPages(active, count, preload);
      if (unmountHidden) return new Set(wanted);
      let changed = false;
      const next = new Set(prev);
      for (const i of wanted) {
        if (!next.has(i)) {
          next.add(i);
          changed = true;
        }
      }
      for (const i of prev) {
        if (i >= count) {
          next.delete(i);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [active, count, preload, unmountHidden]);

  const commit = useCallback(
    (next: number) => {
      if (next === active) return;
      if (haptic) haptics.select();
      if (!controlled) setInternal(next);
      onIndexChange?.(next);
    },
    [active, controlled, haptic, onIndexChange],
  );

  // Settle onto the active page whenever it or the width changes — covers
  // the controlled case, rotation, and the first layout.
  useEffect(() => {
    activeSv.value = active;
    if (width === 0) return;
    translateX.value = withSpring(pageOffset(active, width), presets.springSheet);
  }, [active, width, activeSv, translateX, presets]);

  const goTo = useCallback(
    (next: number) => {
      const target = clampIndex(next, count);
      if (width > 0) translateX.value = withSpring(pageOffset(target, width), presets.springSheet);
      commit(target);
    },
    [count, width, translateX, presets, commit],
  );

  useImperativeHandle(ref, () => ({ goTo }), [goTo]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const next = event.nativeEvent.layout.width;
      setWidth(next);
      widthSv.value = next;
      // Land on the page immediately on the first layout; the settle effect
      // above would otherwise animate it in from x = 0.
      translateX.value = pageOffset(activeSv.value, next);
    },
    [widthSv, translateX, activeSv],
  );

  const [innerGestures, setInnerGestures] = useState<GestureType[]>([]);
  const registry = useMemo<InnerGestureRegistry>(
    () => ({
      register: (gesture) => {
        setInnerGestures((prev) => (prev.includes(gesture) ? prev : [...prev, gesture]));
        return () => setInnerGestures((prev) => prev.filter((g) => g !== gesture));
      },
    }),
    [],
  );

  const pan = useMemo(() => {
    const gesture = Gesture.Pan()
      .enabled(enabled && count > 1)
      // Horizontal-only activation so a vertical transcript scroll is never
      // stolen by a sideways drift of the thumb.
      .activeOffsetX([-14, 14])
      .failOffsetY([-12, 12])
      .onTouchesDown((event, state) => {
        const touch = event.allTouches[0];
        if (touch && isEdgeTouch(touch.x, edgeGutter)) state.fail();
      })
      .onBegin(() => {
        dragStart.value = translateX.value;
      })
      .onUpdate((event) => {
        translateX.value = clampOffset(dragStart.value + event.translationX, widthSv.value, count);
      })
      .onEnd((event) => {
        const target = settlePage({
          offset: translateX.value,
          velocity: event.velocityX,
          width: widthSv.value,
          count,
          from: activeSv.value,
        });
        translateX.value = withSpring(pageOffset(target, widthSv.value), presets.springSheet);
        if (target !== activeSv.value) {
          activeSv.value = target;
          runOnJS(commit)(target);
        }
      });
    if (simultaneousHandlers && simultaneousHandlers.length > 0) {
      gesture.simultaneousWithExternalGesture(...simultaneousHandlers);
    }
    // Inner horizontal scrollers (diffs, code blocks) win a sideways drag
    // that starts inside them; see `usePagerInnerScroll`.
    if (innerGestures.length > 0) {
      gesture.requireExternalGestureToFail(...innerGestures);
    }
    return gesture;
  }, [enabled, count, edgeGutter, dragStart, translateX, widthSv, activeSv, presets, commit, simultaneousHandlers, innerGestures]);

  const internalProgress = useDerivedValue(() => pageProgress(translateX.value, widthSv.value, count));

  // Mirror into the caller's shared value without a JS round-trip.
  useDerivedValue(() => {
    if (externalProgress) externalProgress.value = internalProgress.value;
  });

  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View className={`flex-1 ${className ?? ''}`} style={style} {...(accessibilityLabel ? { accessibilityLabel } : {})}>
      <PagerInnerGestureContext.Provider value={registry}>
        <GestureDetector gesture={pan}>
          <View className="flex-1 overflow-hidden" onLayout={onLayout}>
            {width > 0 ? (
              <Animated.View className="flex-1 flex-row" style={[{ width: width * count }, trackStyle]}>
                {Array.from({ length: count }, (_, i) => (
                  <View
                    key={i}
                    style={{ width }}
                    className="flex-1"
                    // Only the active page is in the accessibility tree; a
                    // screen reader otherwise walks straight off the edge into
                    // the next pane.
                    accessibilityElementsHidden={i !== active}
                    importantForAccessibility={i === active ? 'auto' : 'no-hide-descendants'}
                  >
                    {mounted.has(i) ? renderPage(i, i === active) : null}
                  </View>
                ))}
              </Animated.View>
            ) : null}
          </View>
        </GestureDetector>
      </PagerInnerGestureContext.Provider>

      {indicator !== 'none' && count > 1 ? (
        <PagerIndicator
          count={count}
          active={active}
          progress={internalProgress}
          variant={indicator}
          {...(labels ? { labels } : {})}
          onSelect={goTo}
        />
      ) : null}
    </View>
  );
}

/**
 * The strip under a pager. `dots` for unlabelled pages; `labels` renders
 * the names as tabs with an underline that tracks the drag.
 */
export function PagerIndicator({
  count,
  active,
  progress,
  variant = 'dots',
  labels,
  onSelect,
}: {
  count: number;
  active: number;
  progress: SharedValue<number>;
  variant?: 'dots' | 'labels';
  labels?: string[];
  onSelect?: (index: number) => void;
}): React.ReactElement {
  const [width, setWidth] = useState(0);
  const slot = width > 0 ? width / count : 0;
  const measured = useRef(false);

  const underlineStyle = useAnimatedStyle(
    () => ({
      transform: [{ translateX: progress.value * slot }],
      width: slot,
    }),
    [slot],
  );

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * 14 }],
  }));

  if (variant === 'dots') {
    return (
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={`Page ${active + 1} of ${count}`}
        className="h-6 flex-row items-center justify-center"
      >
        <View className="flex-row items-center" style={{ gap: 8 }}>
          {Array.from({ length: count }, (_, i) => (
            <View key={i} className="h-1.5 w-1.5 rounded-full bg-emphasis" />
          ))}
          <Animated.View
            pointerEvents="none"
            className="absolute left-0 h-1.5 w-1.5 rounded-full bg-primary"
            style={pillStyle}
          />
        </View>
      </View>
    );
  }

  return (
    <View
      accessibilityRole="tablist"
      className="border-t border-border-muted"
      onLayout={(e) => {
        measured.current = true;
        setWidth(e.nativeEvent.layout.width);
      }}
    >
      <View className="flex-row">
        {Array.from({ length: count }, (_, i) => (
          <Touchable
            key={i}
            a11yRole="tab"
            accessibilityState={{ selected: i === active }}
            accessibilityLabel={labels?.[i] ?? `Page ${i + 1}`}
            haptic="select"
            ripple={false}
            scale="none"
            onPress={() => onSelect?.(i)}
            className="min-h-11 flex-1 items-center justify-center px-2"
          >
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={MAX_SCALE.chrome}
              className={`text-sm font-semibold ${i === active ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              {labels?.[i] ?? `${i + 1}`}
            </Text>
          </Touchable>
        ))}
      </View>
      {slot > 0 ? (
        <Animated.View
          pointerEvents="none"
          className="absolute bottom-0 h-0.5 rounded-full bg-primary"
          style={underlineStyle}
        />
      ) : null}
    </View>
  );
}
