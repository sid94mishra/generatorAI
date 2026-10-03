// iOS home-screen widgets (MX-03, MWidgets; 06 §7.4, MD-65): Needs you (medium), Running (medium / large) and
// Summary (small, with the "Nothing needs you" empty state). expo-widgets evaluates each `'widget'` function inside
// the widget extension, so it reads only its props (a `WidgetSnapshot`) and environment and the @expo/ui SwiftUI
// globals: no imports of ours at runtime, no module constants, no array destructuring. Props may be empty before the
// app's first write, so every field is guarded.
//
// Loaded lazily by homeWidgets.ts once the ExpoWidgets native module exists (importing expo-widgets in a client
// built without it throws). The names must match the `widgets` entries of the expo-widgets plugin in app.config.ts.
import { createWidget } from 'expo-widgets';
import { HStack, Image, Link, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  buttonStyle,
  containerBackground,
  controlSize,
  font,
  foregroundStyle,
  lineLimit,
  monospacedDigit,
  tint,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';

import type { WidgetSnapshot } from '../../live/widgetSnapshot';

export const NeedsYouWidget = createWidget<Partial<WidgetSnapshot>>('NeedsYou', (p) => {
  'widget';
  const c = p.palette;
  const fg = c ? c.fg : 'primary';
  const fg2 = c ? c.fg2 : 'secondary';
  const fg3 = c ? c.fg3 : 'secondary';
  const warn = c ? c.warn : 'orange';
  const items = p.needsYou || [];
  const count = p.counts ? p.counts.needsYou : 0;
  const Updated = () =>
    p.updatedAt ? (
      <HStack spacing={3}>
        <Text modifiers={[font({ size: 11 }), foregroundStyle(fg3)]}>Updated</Text>
        <Text date={new Date(p.updatedAt)} dateStyle="time" modifiers={[font({ size: 11, design: 'monospaced' }), foregroundStyle(fg3)]} />
      </HStack>
    ) : null;
  return (
    <VStack alignment="leading" spacing={8} modifiers={[containerBackground(c ? c.surface : { type: 'material', material: 'regular' }, 'widget'), widgetURL(p.homeUrl || 'generatorai:///')]}>
      <HStack spacing={6}>
        <Image systemName="hand.raised" size={14} color={warn} />
        <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(fg)]}>Needs you</Text>
        {count > 0 ? <Text modifiers={[font({ size: 13, weight: 'semibold' }), monospacedDigit(), foregroundStyle(warn)]}>{String(count)}</Text> : null}
        <Spacer />
        <Updated />
      </HStack>
      {!p.serverId ? (
        <Text modifiers={[font({ size: 13 }), foregroundStyle(fg2)]}>Open GeneratorAI to pair a server</Text>
      ) : items.length === 0 ? (
        <Text modifiers={[font({ size: 13 }), foregroundStyle(fg2)]}>Nothing needs you</Text>
      ) : null}
      {items.map((item) => (
        <HStack key={item.key} spacing={8}>
          <Image systemName={item.symbol as never} size={14} color={warn} />
          <VStack alignment="leading" spacing={1}>
            <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(fg), lineLimit(1)]}>{item.title}</Text>
            <Text modifiers={[font({ size: 11 }), foregroundStyle(fg3), lineLimit(1)]}>{item.sub}</Text>
          </VStack>
          <Spacer />
          <Link label="Review" destination={item.url} modifiers={[buttonStyle('bordered'), controlSize('small'), tint(fg), font({ size: 12, weight: 'semibold' })]} />
        </HStack>
      ))}
      <Spacer />
    </VStack>
  );
});

export const RunningWidget = createWidget<Partial<WidgetSnapshot>>('Running', (p) => {
  'widget';
  const c = p.palette;
  const fg = c ? c.fg : 'primary';
  const fg2 = c ? c.fg2 : 'secondary';
  const fg3 = c ? c.fg3 : 'secondary';
  const run = c ? c.run : 'blue';
  const items = p.running || [];
  const count = p.counts ? p.counts.running : 0;
  return (
    <VStack alignment="leading" spacing={8} modifiers={[containerBackground(c ? c.surface : { type: 'material', material: 'regular' }, 'widget'), widgetURL(p.homeUrl || 'generatorai:///')]}>
      <HStack spacing={6}>
        <Image systemName="progress.indicator" size={14} color={run} />
        <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(fg)]}>Running</Text>
        {count > 0 ? <Text modifiers={[font({ size: 13, weight: 'semibold' }), monospacedDigit(), foregroundStyle(fg3)]}>{String(count)}</Text> : null}
        <Spacer />
        {p.updatedAt ? (
          <HStack spacing={3}>
            <Text modifiers={[font({ size: 11 }), foregroundStyle(fg3)]}>Updated</Text>
            <Text date={new Date(p.updatedAt)} dateStyle="time" modifiers={[font({ size: 11, design: 'monospaced' }), foregroundStyle(fg3)]} />
          </HStack>
        ) : null}
      </HStack>
      {!p.serverId ? (
        <Text modifiers={[font({ size: 13 }), foregroundStyle(fg2)]}>Open GeneratorAI to pair a server</Text>
      ) : items.length === 0 ? (
        <Text modifiers={[font({ size: 13 }), foregroundStyle(fg2)]}>Nothing running</Text>
      ) : null}
      {items.map((item) => (
        <Link key={item.key} destination={item.url}>
          <HStack spacing={8}>
            <VStack alignment="leading" spacing={1}>
              <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(fg), lineLimit(1)]}>{item.title}</Text>
              <Text modifiers={[font({ size: 11 }), foregroundStyle(fg3), lineLimit(1)]}>{item.sub}</Text>
            </VStack>
            <Spacer />
            <Text
              timerInterval={{ lower: new Date(item.startedAt), upper: new Date(item.startedAt + 86400000) }}
              countsDown={false}
              modifiers={[font({ size: 14, design: 'monospaced' }), monospacedDigit(), foregroundStyle(fg2)]}
            />
          </HStack>
        </Link>
      ))}
      <Spacer />
    </VStack>
  );
});

export const SummaryWidget = createWidget<Partial<WidgetSnapshot>>('Summary', (p) => {
  'widget';
  const c = p.palette;
  const fg = c ? c.fg : 'primary';
  const fg2 = c ? c.fg2 : 'secondary';
  const fg3 = c ? c.fg3 : 'secondary';
  const needs = p.counts ? p.counts.needsYou : 0;
  const running = p.counts ? p.counts.running : 0;
  const Row = (o: { symbol: string; color: string; word: string; count: number }) => (
    <HStack spacing={6}>
      <Image systemName={o.symbol as never} size={13} color={o.color} />
      <Text modifiers={[font({ size: 13 }), foregroundStyle(fg)]}>{o.word}</Text>
      <Spacer />
      <Text modifiers={[font({ size: 17, weight: 'semibold' }), monospacedDigit(), foregroundStyle(fg)]}>{String(o.count)}</Text>
    </HStack>
  );
  return (
    <VStack alignment="leading" spacing={8} modifiers={[containerBackground(c ? c.surface : { type: 'material', material: 'regular' }, 'widget'), widgetURL(p.homeUrl || 'generatorai:///')]}>
      <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(fg), lineLimit(1)]}>{p.serverName || 'GeneratorAI'}</Text>
      {!p.serverId ? (
        <Text modifiers={[font({ size: 13 }), foregroundStyle(fg2)]}>Open GeneratorAI to pair a server</Text>
      ) : needs === 0 ? (
        <VStack alignment="leading" spacing={4}>
          <Image systemName="checkmark.circle" size={16} color={c ? c.ok : 'green'} />
          <Text modifiers={[font({ size: 15, weight: 'semibold' }), foregroundStyle(fg)]}>Nothing needs you</Text>
          <Text modifiers={[font({ size: 12 }), foregroundStyle(fg2)]}>{`${running} running`}</Text>
        </VStack>
      ) : (
        <VStack alignment="leading" spacing={6}>
          <Row symbol="hand.raised" color={c ? c.warn : 'orange'} word="Needs you" count={needs} />
          <Row symbol="progress.indicator" color={c ? c.run : 'blue'} word="Running" count={running} />
        </VStack>
      )}
      <Spacer />
      {p.updatedAt ? (
        <HStack spacing={3}>
          <Text modifiers={[font({ size: 11 }), foregroundStyle(fg3)]}>Updated</Text>
          <Text date={new Date(p.updatedAt)} dateStyle="time" modifiers={[font({ size: 11, design: 'monospaced' }), foregroundStyle(fg3)]} />
        </HStack>
      ) : null}
    </VStack>
  );
});
