// The iOS Live Activity (MX-01, MLiveActivity; 06 §7.3): the Dynamic Island (compact, minimal, expanded) and the Lock
// Screen banner for one followed run or chat. expo-widgets evaluates the `'widget'` function inside the widget
// extension, so it can use only its props, its environment and the @expo/ui SwiftUI components and modifiers (the
// extension's globals) — no imports of ours, no module constants, no array destructuring (Babel helpers are not
// there). Props come from `toLiveActivityProps` (already redacted for the Lock Screen, MD-33).
//
// Loaded lazily by liveActivity.ios.ts once the ExpoWidgets native module is known to exist: importing expo-widgets
// in a client built without it would throw.
import { createLiveActivity } from 'expo-widgets';
import { HStack, Image, Link, RoundedRectangle, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityHidden,
  activityBackgroundTint,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  padding,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import type { LiveActivityProps } from '../../live/liveSurfaceModel';

/** Must match the name the app registers; the widget extension looks the layout up by it. */
export const RUN_ACTIVITY_NAME = 'RunActivity';

export const RunActivity = createLiveActivity<LiveActivityProps>(RUN_ACTIVITY_NAME, (p, env) => {
  'widget';
  const stale = env.isStale === true && !p.ended;
  const primary = { type: 'hierarchical', style: 'primary' } as const;
  const secondary = { type: 'hierarchical', style: 'secondary' } as const;

  // Elapsed since the start, ticking by itself (a Live Activity cannot run code); the final word once it ended.
  const Elapsed = (o: { size: number; color: string | typeof primary }) =>
    p.ended ? (
      <Text modifiers={[font({ size: o.size, weight: 'medium' }), foregroundStyle(p.tone)]}>{p.status}</Text>
    ) : (
      <Text
        timerInterval={{ lower: new Date(p.startedAt), upper: new Date(p.startedAt + 86400000) }}
        countsDown={false}
        modifiers={[font({ size: o.size, weight: 'medium', design: 'monospaced' }), monospacedDigit(), foregroundStyle(o.color)]}
      />
    );

  const Segments = () =>
    p.segments.length > 0 ? (
      <HStack spacing={4} modifiers={[accessibilityHidden(true)]}>
        {p.segments.map((color, i) => (
          <RoundedRectangle key={String(i)} cornerRadius={3} modifiers={[foregroundStyle(color), frame({ height: 6, maxWidth: 400 })]} />
        ))}
      </HStack>
    ) : null;

  const Footer = (o: { color: string | typeof secondary }) =>
    p.stage || p.next ? (
      <HStack>
        {p.stage ? <Text modifiers={[font({ size: 12, weight: 'medium' }), foregroundStyle(o.color), lineLimit(1)]}>{p.stage}</Text> : null}
        <Spacer />
        {p.next ? <Text modifiers={[font({ size: 12, weight: 'medium' }), foregroundStyle(o.color), lineLimit(1)]}>{p.next}</Text> : null}
      </HStack>
    ) : null;

  const Review = () =>
    p.reviewUrl ? (
      <Link label="Review" destination={p.reviewUrl} modifiers={[buttonStyle('borderedProminent'), tint(p.palette.accent), font({ size: 15, weight: 'semibold' })]} />
    ) : null;

  const Gate = (o: { fg: string | typeof primary; fg2: string | typeof secondary }) => (
    <HStack spacing={12}>
      <VStack alignment="leading" spacing={2}>
        <HStack spacing={6}>
          <Image systemName={p.symbol as never} size={16} color={p.tone} />
          <Text modifiers={[font({ size: 16, weight: 'semibold' }), foregroundStyle(o.fg), lineLimit(1)]}>{p.headline}</Text>
        </HStack>
        {p.detail ? <Text modifiers={[font({ size: 13, weight: 'medium' }), foregroundStyle(o.fg2), lineLimit(1)]}>{p.detail}</Text> : null}
      </VStack>
      <Spacer />
      <Review />
    </HStack>
  );

  const Stale = (o: { color: string | typeof secondary }) =>
    stale ? <Text modifiers={[font({ size: 12, weight: 'medium' }), foregroundStyle(o.color)]}>Updates paused · open the app</Text> : null;

  const Title = (o: { fg: string | typeof primary; fg3: string | typeof secondary }) => (
    <HStack spacing={6}>
      <Text modifiers={[font({ size: 14, weight: 'semibold' }), foregroundStyle(o.fg), lineLimit(1)]}>{p.title}</Text>
      {p.number ? <Text modifiers={[font({ size: 13, design: 'monospaced' }), foregroundStyle(o.fg3)]}>{p.number}</Text> : null}
    </HStack>
  );

  return {
    // Lock Screen / Notification Center: on the app's own surface colour, so the palette's text colours hold.
    banner: (
      <VStack alignment="leading" spacing={10} modifiers={[padding({ all: 14 }), activityBackgroundTint(p.palette.surface)]}>
        <HStack>
          <Title fg={p.palette.fg} fg3={p.palette.fg3} />
          <Spacer />
          <Elapsed size={15} color={p.palette.fg} />
        </HStack>
        <Gate fg={p.palette.fg} fg2={p.palette.fg2} />
        <Segments />
        <Footer color={p.palette.fg3} />
        <Stale color={p.palette.fg3} />
      </VStack>
    ),
    // The island is always dark: hierarchical styles for text, the palette for the status tone only.
    compactLeading: (
      <HStack spacing={4}>
        <Image systemName={p.symbol as never} size={14} color={p.tone} />
        <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(p.tone), lineLimit(1)]}>{p.status}</Text>
      </HStack>
    ),
    compactTrailing: p.progress ? (
      <Text modifiers={[font({ size: 14, weight: 'medium', design: 'monospaced' }), monospacedDigit(), foregroundStyle(primary)]}>{p.progress}</Text>
    ) : (
      <Elapsed size={14} color={primary} />
    ),
    minimal: <Image systemName={p.symbol as never} size={14} color={p.tone} />,
    expandedLeading: <Image systemName={p.symbol as never} size={20} color={p.tone} modifiers={[padding({ leading: 4 })]} />,
    expandedCenter: <Title fg={primary} fg3={secondary} />,
    expandedTrailing: <Elapsed size={15} color={primary} />,
    expandedBottom: (
      <VStack alignment="leading" spacing={8} modifiers={[padding({ horizontal: 4 })]}>
        <Gate fg={primary} fg2={secondary} />
        <Segments />
        <Footer color={secondary} />
        <Stale color={secondary} />
      </VStack>
    ),
  };
});
