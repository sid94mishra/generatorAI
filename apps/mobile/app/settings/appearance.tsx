// ────────────────────────────────────────────────────────────────
// Settings → Appearance.
//
// The palette is fully wired for light, dark and six accents, and has been
// since the tokens were generated — but nothing in the app ever called
// `setTheme` or `setAccent`, so the only way to reach light mode was to
// change the whole OS. Shipping a theme the user cannot select is the same
// as not having one.
//
// Selection is applied immediately rather than behind a Save button: the
// entire screen is a live preview of the choice, so a confirmation step would
// only add a tap to something already reversible.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { Check, Monitor, Moon, Sun } from 'lucide-react-native';

import { Badge, Card, SectionHeader } from '../../src/components/ui/primitives';
import { ListGroup, ListRow } from '../../src/components/ui/ListRow';
import { Touchable } from '../../src/components/ui/Touchable';
import { Screen } from '../../src/components/ui/Screen';
import { ACCENTS, THEMES, useTheme } from '../../src/theme/ThemeProvider';

const THEME_ICON: Record<string, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

export default function AppearanceScreen(): React.ReactElement {
  const { theme, appearance, accent, setTheme, setAccent, colors } = useTheme();

  return (
    <Screen title="Appearance" back>
      <SectionHeader title="Theme" />
      <ListGroup>
        {THEMES.map((option) => {
          const Icon = THEME_ICON[option.id] ?? Monitor;
          const selected = theme === option.id;
          return (
            <ListRow
              key={option.id}
              title={option.label}
              icon={<Icon size={18} color={selected ? colors.primary : colors['muted-foreground']} />}
              onPress={() => setTheme(option.id as 'system' | 'light' | 'dark')}
              chevron={false}
              trailing={
                <View className="flex-row items-center gap-2">
                  {/* `system` resolves to a concrete appearance the user
                      cannot otherwise see — so say which one it landed on. */}
                  {option.id === 'system' ? <Badge label={appearance} tone="neutral" /> : null}
                  {selected ? <Check size={18} color={colors.primary} /> : null}
                </View>
              }
            />
          );
        })}
      </ListGroup>

      <SectionHeader title="Accent" />
      <Card className="gap-3 p-4">
        <View className="flex-row flex-wrap gap-3">
          {ACCENTS.map((option) => {
            const selected = accent === option.id;
            // Swatch comes from the palette for the CURRENT appearance, so the
            // dot matches what the accent will actually look like right now.
            const swatch = option[appearance]?.primary ?? colors.primary;
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
