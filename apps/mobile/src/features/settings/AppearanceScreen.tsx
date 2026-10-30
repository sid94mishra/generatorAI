// Settings › Appearance (MSetAppearance, MDF-117; `/settings/appearance`): Mode System / Light / Dark ("System is dark
// now"); Theme — Product / Editor / Low glare filter with counts, live previews of each theme in the current mode with
// the live accent (scoped themes), the selected theme's sentence; Accent — the seven swatches + on Android 12+ "System
// (Material You)" (MD-08 / MD-77, hidden elsewhere); Text size follows the OS (MD-69, an info row); Motion — Reduce
// motion and (iOS) Reduce transparency as System / On / Off. Everything applies at once and is stored on this device.
import React, { useState } from 'react';
import { View } from 'react-native';
import { themesByGroup, type ThemeMode } from '@generatorai/design-tokens';

import { usePreferences, type MotionPreference } from '../../services/prefs/preferences';
import { useTheme } from '../../theme/ThemeProvider';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { SectionHeader } from '../../ui/layout/SectionHeader';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { nativePlatform } from '../../ui/platform/geometry';
import { useOsReduceTransparency } from '../../ui/platform/transparency';
import { Pressable } from '../../ui/primitives/Pressable';
import { Radio } from '../../ui/primitives/RadioGroup';
import { Text } from '../../ui/primitives/Text';
import { AccentSwatch, ThemeCard } from './components/ThemePreview';
import { SettingsPage } from './components/SettingsPage';

const MODE_SEGMENTS = [
  { value: 'system', label: 'System', icon: 'mode-system' },
  { value: 'light', label: 'Light', icon: 'mode-light' },
  { value: 'dark', label: 'Dark', icon: 'mode-dark' },
] as const;

const FOLLOW_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'reduced', label: 'On' },
  { value: 'full', label: 'Off' },
];

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

// A section label with its trailing value. The label column takes the free width (SectionHeader's own spacer would
// otherwise claim the whole row and push the value past the screen edge); the value keeps its natural width and
// ellipsizes inside the row's padding when it cannot fit.
function LabelRow({ title, value, testID }: { title: string; value?: string; testID?: string }): React.ReactElement {
  return (
    <View className="flex-row items-center gap-2">
      <View className="flex-1">
        <SectionHeader title={title} variant="label" />
      </View>
      {value ? (
        <Text role="footnote" tone="fg-3" numberOfLines={1} className="shrink" testID={testID}>
          {value}
        </Text>
      ) : null}
    </View>
  );
}

export default function AppearanceScreen(): React.ReactElement {
  const { mode, appearance, themeId, theme, accents, accent, systemAccentAvailable, setMode, setThemeId, setAccent } = useTheme();
  const { motion, setMotion, transparency, setTransparency } = usePreferences();
  const osTransparency = useOsReduceTransparency();
  const groups = themesByGroup();
  const [groupId, setGroupId] = useState(() => theme.group);
  const group = groups.find((g) => g.id === groupId) ?? groups[0]!;
  const total = groups.reduce((n, g) => n + g.themes.length, 0);
  const ios = nativePlatform === 'ios';
  const accentLabel = accent === 'system' ? 'System' : (accents.find((a) => a.id === accent)?.label ?? '');

  return (
    <SettingsPage title="Appearance" testID="settings-appearance-screen">
      <View className="gap-2 px-4">
        <LabelRow title="Mode" value={mode === 'system' ? `System is ${appearance} now` : undefined} />
        <SegmentedControl<ThemeMode> accessibilityLabel="Mode" value={mode} onValueChange={setMode} segments={MODE_SEGMENTS} fullWidth testID="appearance-mode" />
      </View>

      <View className="gap-2 px-4">
        <LabelRow title="Theme" value={`${theme.label} + ${total - 1}`} testID="appearance-theme-value" />
        <SegmentedControl accessibilityLabel="Theme group" value={group.id} onValueChange={(id) => setGroupId(id as typeof groupId)} segments={groups.map((g) => ({ value: g.id, label: g.label, count: g.themes.length }))} fullWidth testID="appearance-theme-group" />
        <View className="gap-2" accessibilityRole="radiogroup" accessibilityLabel={`${group.label} themes`}>
          {chunk(group.themes, 3).map((row, i) => (
            <View key={i} className="flex-row gap-2">
              {row.map((t) => (
                <ThemeCard key={t.id} theme={t} appearance={appearance} accent={accent} selected={t.id === themeId} onPress={() => setThemeId(t.id)} />
              ))}
              {Array.from({ length: 3 - row.length }, (_, k) => (
                <View key={`pad-${k}`} className="flex-1" />
              ))}
            </View>
          ))}
        </View>
        <Text role="footnote" tone="fg-2">
          <Text role="footnote" weight={600}>
            {theme.label}
          </Text>{' '}
          — {theme.description}
        </Text>
      </View>

      <View className="gap-2 px-4">
        <SectionHeader title="Accent" variant="label" />
        <View className="flex-row flex-wrap items-center gap-1" accessibilityRole="radiogroup" accessibilityLabel="Accent">
          {accents.map((a) => (
            <AccentSwatch key={a.id} themeId={themeId} appearance={appearance} accent={a.id} label={a.label} selected={accent === a.id} onPress={() => setAccent(a.id)} />
          ))}
          <View className="flex-1" />
          <Text role="footnote" tone="fg-3">
            {accentLabel}
          </Text>
        </View>
        {systemAccentAvailable ? (
          <Pressable
            onPress={() => setAccent('system')}
            frame="none"
            haptic="selection"
            accessibilityRole="radio"
            accessibilityLabel="System (Material You) accent. Accent from your wallpaper. Status colours never change."
            accessibilityState={{ checked: accent === 'system' }}
            className="min-h-row-2 flex-row items-center gap-4 rounded-card bg-raised px-4 py-3"
            testID="accent-option-system"
          >
            <AccentSwatch themeId={themeId} appearance={appearance} accent="system" label="System" selected={accent === 'system'} onPress={() => setAccent('system')} testID="accent-swatch-system" />
            <View className="flex-1 gap-0.5">
              <Text role="body">System (Material You)</Text>
              <Text role="footnote" tone="fg-3">
                Accent from your wallpaper. Status colours never change.
              </Text>
            </View>
            <Radio value="system" selected={accent === 'system'} />
          </Pressable>
        ) : null}
      </View>

      <ListSection title="Text size" footer={`GeneratorAI uses the text size you set for ${ios ? 'iOS' : 'Android'}, so every app on this device reads the same.`}>
        <ListRow kind="info" icon="zoom-in" title={ios ? 'Follows iOS text size' : 'Follows system font size'} value="System" testID="appearance-text-size" />
      </ListSection>

      <ListSection title="Motion">
        <ListRow
          kind="picker"
          title="Reduce motion"
          picker={{ value: motion, options: FOLLOW_OPTIONS, onValueChange: (v) => setMotion(v as MotionPreference) }}
          testID="appearance-reduce-motion"
        />
        {ios ? (
          <ListRow
            kind="picker"
            title="Reduce transparency"
            picker={{ value: transparency, options: FOLLOW_OPTIONS.map((o) => (o.value === 'system' ? { ...o, description: osTransparency ? 'On in iOS Settings' : 'Off in iOS Settings' } : o)), onValueChange: (v) => setTransparency(v as MotionPreference) }}
            testID="appearance-reduce-transparency"
          />
        ) : null}
      </ListSection>
    </SettingsPage>
  );
}
