// ────────────────────────────────────────────────────────────────
// Settings → Appearance.
//
// The mobile counterpart of the web's Appearance section, and it reads from
// exactly the same registry: mode, theme, accent. Adding a theme in
// `packages/design-tokens/src/themes/` makes it appear here with no change to
// this file.
//
// Selection is applied immediately rather than behind a Save button: the
// entire screen is a live preview of the choice, so a confirmation step would
// only add a tap to something already reversible.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { Check, Monitor, Moon, Sun } from 'lucide-react-native';
import {
  resolveAccentTokens,
  resolveAppearanceTokens,
  themesByGroup,
  type AccentId,
  type ThemeDef,
  type Appearance,
} from '@generatorai/design-tokens';

import { Badge, Card, SectionHeader } from '../../src/components/ui/primitives';
import { ListGroup, ListRow } from '../../src/components/ui/ListRow';
import { Touchable } from '../../src/components/ui/Touchable';
import { Screen } from '../../src/components/ui/Screen';
import { MODES, useTheme } from '../../src/theme/ThemeProvider';

const MODE_ICON: Record<string, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

/**
 * A miniature of the app chrome painted in a theme that is not currently
 * active. Swatch dots were tried first and are useless at this size: six
 * palettes of similar hues are indistinguishable as dots, and the question a
 * user is actually asking ("how loud is this, and can I read it?") is about
 * surfaces in composition.
 *
 * `accentId` is the LIVE accent, not the theme's default — selecting a theme
 * keeps the accent you already chose, so previewing anything else would be
 * previewing a combination the app will never render.
 */
function ThemePreview({
  theme,
  appearance,
  accentId,
}: {
  theme: ThemeDef;
  appearance: Appearance;
  accentId: AccentId;
}) {
  const t = resolveAppearanceTokens(theme, appearance);
  const accent = resolveAccentTokens(theme, accentId, appearance);
  return (
    <View
      className="h-14 w-24 flex-row overflow-hidden rounded-lg border"
      style={{ backgroundColor: t.background, borderColor: t.border }}
    >
      <View className="w-1/3 gap-1 p-1.5" style={{ backgroundColor: t.sidebar }}>
        <View className="h-1 w-full rounded-full" style={{ backgroundColor: accent.primary }} />
        <View className="h-1 w-2/3 rounded-full" style={{ backgroundColor: t.emphasis }} />
      </View>
      <View className="flex-1 justify-between p-1.5">
        <View className="gap-1">
          <View className="h-1 w-2/3 rounded-full" style={{ backgroundColor: t.foreground }} />
          <View className="h-1 w-full rounded-full" style={{ backgroundColor: t.mutedForeground }} />
        </View>
        <View className="flex-row gap-1">
          {[t.success, t.warning, t.danger].map((c) => (
            <View key={c} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />
          ))}
        </View>
      </View>
    </View>
  );
}

export default function AppearanceScreen(): React.ReactElement {
  const { mode, appearance, themeId, accents, accent, setMode, setThemeId, setAccent, colors } =
    useTheme();

  return (
    <Screen title="Appearance" back>
      <SectionHeader title="Mode" />
      <ListGroup>
        {MODES.map((option) => {
          const Icon = MODE_ICON[option.id] ?? Monitor;
          const selected = mode === option.id;
          return (
            <ListRow
              key={option.id}
              title={option.label}
              icon={<Icon size={18} color={selected ? colors.primary : colors['muted-foreground']} />}
              onPress={() => setMode(option.id)}
              chevron={false}
              trailing={
                <View className="flex-row items-center gap-2">
                  {/* `system` resolves to a variant the user cannot otherwise
                      see — so say which one it landed on. */}
                  {option.id === 'system' ? (
                    <Badge label={appearance === 'dark' ? 'Dark' : 'Light'} tone="neutral" />
                  ) : null}
                  <SelectionCheck selected={selected} color={colors.primary} />
                </View>
              }
            />
          );
        })}
      </ListGroup>

      {themesByGroup().map((group) => (
        <React.Fragment key={group.id}>
          <SectionHeader title={group.label} />
          <ListGroup>
            {group.themes.map((option) => {
              const selected = themeId === option.id;
              return (
                <ListRow
                  key={option.id}
                  title={option.label}
                  subtitle={option.description}
                  onPress={() => setThemeId(option.id)}
                  chevron={false}
                  trailing={
                    <View className="flex-row items-center gap-2">
                      <ThemePreview theme={option} appearance={appearance} accentId={accent} />
                      <SelectionCheck selected={selected} color={colors.primary} />
                    </View>
                  }
                />
              );
            })}
          </ListGroup>
        </React.Fragment>
      ))}

      <SectionHeader title="Accent" />
      <Card className="gap-3 p-4">
        <View className="flex-row flex-wrap gap-3">
          {accents.map((option) => {
            const selected = accent === option.id;
            // Swatch comes from the palette for the CURRENT theme and
            // appearance, so the dot matches what the accent will actually
            // look like right now.
            const swatch = option[appearance].primary;
            return (
              <Touchable
                key={option.id}
                accessibilityLabel={option.label}
                accessibilityState={{ selected }}
                haptic="select"
                onPress={() => setAccent(option.id)}
                className={`h-12 w-12 items-center justify-center rounded-full border-2 ${
                  selected ? 'border-primary' : 'border-border'
                }`}
              >
                <View
                  className="h-7 w-7 items-center justify-center rounded-full"
                  style={{ backgroundColor: swatch }}
                >
                  {selected ? <Check size={14} color={colors['primary-foreground']} /> : null}
                </View>
              </Touchable>
            );
          })}
        </View>
        <Text className="text-xs leading-relaxed text-muted-foreground">
          The accent colours buttons, links, the active tab and every selection state. Status
          colours — success, warning, failure — deliberately stay fixed, so “failed” always reads as
          failure whichever accent you pick.
        </Text>
      </Card>

      {/* A live preview beats a description: this card is rendered with the
          exact tokens every other surface uses. */}
      <SectionHeader title="Preview" />
      <Card className="gap-3 p-4">
        <Text className="text-lg font-semibold text-foreground">Heading</Text>
        <Text className="text-sm leading-relaxed text-muted-foreground">
          Body text sits at this contrast against the card surface.
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <Badge label="Primary" tone="primary" />
          <Badge label="Running" tone="info" />
          <Badge label="Completed" tone="success" />
          <Badge label="Needs you" tone="warning" />
          <Badge label="Failed" tone="danger" />
        </View>
      </Card>
    </Screen>
  );
}

/**
 * The selection tick, with its slot always reserved.
 *
 * Rendering `null` for the unselected rows made every preview in the list
 * jump 26pt sideways when the selection moved, so the four theme thumbnails
 * never lined up with each other.
 */
function SelectionCheck({ selected, color }: { selected: boolean; color: string | undefined }): React.ReactElement {
  return (
    <View className="w-[18px] items-center">
      {selected ? <Check size={18} color={color} /> : null}
    </View>
  );
}
