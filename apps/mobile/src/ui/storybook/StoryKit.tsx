// Story scaffolding for the kit (03 §1.7): sections, the theme matrix (Instrument dark, Instrument light,
// Solarized light — 00 §5.12), a simulated font scale and an RTL frame. Stories only; never used by screens.
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { LayoutDirection } from 'uniwind';

import { ThemeProvider } from '../../theme/ThemeProvider';
import { cn } from '../lib/cn';
import { FontScaleOverrideContext } from '../platform/fontScale';

export function StoryPage({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="gap-6 p-4">
      {children}
    </ScrollView>
  );
}

export function StorySection({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <View className="gap-3">
      <Text className="text-small font-semibold text-fg-3">{title}</Text>
      {children}
    </View>
  );
}

export function StoryRow({ children }: { children: React.ReactNode }): React.ReactElement {
  return <View className="flex-row flex-wrap items-center gap-3">{children}</View>;
}

const MATRIX = [
  { theme: 'instrument', mode: 'dark', label: 'Instrument dark' },
  { theme: 'instrument', mode: 'light', label: 'Instrument light' },
  { theme: 'solarized', mode: 'light', label: 'Solarized light' },
] as const;

/** The same content under the three matrix themes, each scoped (the app theme is untouched). */
export function ThemeMatrix({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <View className="gap-4">
      {MATRIX.map((m) => (
        <ThemeProvider key={m.label} initialTheme={m.theme} initialMode={m.mode} persist={false}>
          <View className="gap-2 rounded-card border border-line-soft bg-surface p-3">
            <Text className="text-micro text-fg-3">{m.label}</Text>
            {children}
          </View>
        </ThemeProvider>
      ))}
    </View>
  );
}

/** Renders Text roles at a simulated OS font scale, still capped per role (MD-126). */
export function WithFontScale({ scale, children }: { scale: number; children: React.ReactNode }): React.ReactElement {
  return <FontScaleOverrideContext.Provider value={scale}>{children}</FontScaleOverrideContext.Provider>;
}

/** A right-to-left frame: start/end classes and mirrored glyphs must follow it. */
export function RightToLeft({ children }: { children: React.ReactNode }): React.ReactElement {
  return <LayoutDirection rtl>{children}</LayoutDirection>;
}

export const LONG_TEXT = 'A deliberately long label that keeps going well past sixty characters to test wrapping';

const STRIPES = ['bg-accent', 'bg-run', 'bg-ok', 'bg-warn', 'bg-err', 'bg-fg-2'] as const;

/** Busy content behind floating chrome, so Liquid Glass (which samples what is under it) can be judged; a flat canvas
 * shows almost nothing through glass by design. Stories only. */
export function GlassBackdrop({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <View className="relative overflow-hidden rounded-card">
      <View className="absolute inset-0">
        {Array.from({ length: 18 }, (_, i) => (
          <View key={i} className={cn('h-6', STRIPES[i % STRIPES.length])} />
        ))}
      </View>
      <View className="absolute inset-0 justify-around px-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Text key={i} className="text-title font-semibold text-surface">
            Transcript text scrolling under the glass
          </Text>
        ))}
      </View>
      <View className="gap-4 p-4">{children}</View>
    </View>
  );
}
