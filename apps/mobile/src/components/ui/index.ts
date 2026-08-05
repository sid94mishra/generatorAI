// Barrel for the design system. Screens import from here so a component can
// move between files without touching every call site.
//
// The `animated` import must come first: it registers the NativeWind interop
// for Reanimated components, and anything imported before it would render
// with its className silently dropped.
import './animated';

export { AnimatedPressable } from './animated';
export { haptics, setHapticsEnabled } from './haptics';
export {
  MAX_SCALE,
  MIN_TARGET,
  announce,
  scaled,
  useFontScale,
  useReduceMotion,
  useScreenReader,
  useSystemReduceMotion,
} from './accessibility';
export { Touchable, type TouchableProps, type HapticIntent } from './Touchable';
export { Button, IconButton, Fab, type ButtonVariant, type ButtonSize } from './Button';
export { Chip, StaticChip } from './Chip';
export {
  SegmentedControl,
  stepSegment,
  useSegmentSwipe,
  type Segment,
} from './SegmentedControl';
export { ListRow, ListGroup } from './ListRow';
export { Card, Surface, SectionHeader, Divider, Badge, StatusDot, type Tone } from './primitives';
export { Skeleton, SkeletonRow, SkeletonList, SkeletonCard } from './Skeleton';
export { ProgressRing, ProgressBar, usageTone } from './ProgressRing';
export { Sheet, SheetRow, SheetSection, type Detent, type SheetProps } from './Sheet';
export { ActionSheet, ConfirmSheet, type MenuAction } from './ActionSheet';
export { SwipeableRow, closeSwipedRow, type SwipeAction } from './SwipeableRow';
export { ToastProvider, useToast, type ToastTone } from './Toast';
export { Screen, ScreenHeader, PlainScroll, goBack } from './Screen';
export { Spinner, LoadingState, EmptyState, ErrorState, LockedState } from './States';
export { Switch, Field, SearchField } from './Form';
export {
  DURATION,
  TIMING,
  TIMING_FAST,
  TIMING_EMPHASIZED,
  SPRING_PRESS,
  SPRING_SHEET,
  SPRING_ENTER,
  SPRING_SWIPE,
  PRESS_SCALE,
  stagger,
} from './motion';
