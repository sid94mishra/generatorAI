// ────────────────────────────────────────────────────────────────
// F-settings-03 Appearance (board SettingsAppearance; D-11, D-13, D-15, D-20,
// D-25). Mode · Theme gallery (filter Product / Editor / Low glare, 5-column
// tiles) · Accent (7 swatches) · Density · Interface font size · Reduce
// motion. Everything applies instantly through ThemeProvider, the single
// writer of the appearance axes; nothing here touches <html>.
//
// Live previews without inline colour: a tile (and each accent swatch) is a
// subtree scoped with the theme's own `data-theme` / `data-accent` and the
// current mode's `light` class. The generated token CSS selects on those
// attributes anywhere in the document (`[data-theme="x"]`,
// `.light[data-theme="x"][data-accent="a"]`), so the design utilities inside
// resolve to that theme's values — the preview is painted by the same CSS
// the app will use once it is chosen.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import {
  ACCENT_IDS,
  ACCENT_LABELS,
  DENSITIES,
  FONT_SIZES,
  VISIBLE_THEMES,
  themesByGroup,
  type AccentId,
  type Appearance,
  type Density,
  type FontSizeSetting,
  type ThemeGroup,
  type ThemeMode,
} from '@generatorai/design-tokens';
import { useTheme } from '@/providers/ThemeProvider.js';
import { cn } from '@/ui/lib/cn.js';
import { RadioGroup, Radio } from '@/ui/primitives/RadioGroup/RadioGroup.js';
import { RadioCard } from '@/ui/primitives/RadioCard/RadioCard.js';
import { SegmentedControl, type SegmentedItem } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { SettingRow, SettingsSection } from '@/ui/patterns/SettingsSection/SettingsSection.js';

const MODE_ITEMS: readonly SegmentedItem<ThemeMode>[] = [
  { value: 'system', label: 'System', icon: 'mode-system' },
  { value: 'light', label: 'Light', icon: 'mode-light' },
  { value: 'dark', label: 'Dark', icon: 'mode-dark' },
];

const DENSITY_LABEL: Record<Density, string> = { compact: 'Compact', comfortable: 'Comfortable' };
// Board order: Compact first.
const DENSITY_ITEMS: readonly SegmentedItem<Density>[] = [...DENSITIES]
  .reverse()
  .map((value) => ({ value, label: DENSITY_LABEL[value] }));

const FONT_SIZE_ITEMS: readonly SegmentedItem<FontSizeSetting>[] = FONT_SIZES.map((value) => ({ value, label: value }));

const GROUPS = themesByGroup();

/** Scope a subtree to another theme / accent / mode so its design utilities resolve there. */
function scopeProps(themeId: string, accent: AccentId, appearance: Appearance) {
  return { 'data-theme': themeId, 'data-accent': accent, className: appearance === 'light' ? 'light' : undefined };
}

/** A miniature of the app painted in `themeId`: sidebar, lines of text, status dots and an accent button. */
function ThemePreview({ themeId, accent, appearance }: { themeId: string; accent: AccentId; appearance: Appearance }) {
  const scope = scopeProps(themeId, accent, appearance);
  return (
    <div aria-hidden data-theme={scope['data-theme']} data-accent={scope['data-accent']} className={cn('size-full', scope.className)}>
      <div className="flex size-full gap-1.5 bg-ground p-1.5">
        <div className="flex w-1/4 flex-col gap-1 pt-0.5">
          <span className="py-px w-full rounded-full bg-fg" />
          <span className="py-px w-3/4 rounded-full bg-fg-3" />
          <span className="py-px w-3/4 rounded-full bg-fg-3" />
        </div>
        <div className="flex flex-1 flex-col gap-1 rounded-control-sm bg-surface p-1">
          <span className="py-px w-3/4 rounded-full bg-fg" />
          <span className="py-px w-full rounded-full bg-fg-2" />
          <div className="mt-auto flex items-center gap-0.5">
            <span className="size-1 rounded-full bg-ok" />
            <span className="size-1 rounded-full bg-warn" />
            <span className="size-1 rounded-full bg-err" />
            <span className="ml-auto w-4 rounded-full bg-accent py-0.5" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppearanceSection() {
  const {
    mode,
    setMode,
    resolvedTheme,
    themeId,
    setThemeId,
    theme,
    accent,
    setAccent,
    density,
    setDensity,
    fontSize,
    setFontSize,
    reduceMotion,
    setReduceMotion,
  } = useTheme();
  const [group, setGroup] = useState<ThemeGroup>(theme.group);
  const shown = GROUPS.find((g) => g.id === group) ?? GROUPS[0]!;

  const modeHint =
    mode === 'system' ? `System follows your OS · currently ${resolvedTheme}` : 'Every theme has a light and a dark variant';

  return (
    <SettingsSection title="Appearance" description="How GeneratorAI looks on this device. Other devices keep their own choice.">
      <div className="flex flex-col">
        <SettingRow
          label="Mode"
          hint={modeHint}
          control={<SegmentedControl label="Mode" value={mode} onValueChange={setMode} items={MODE_ITEMS} />}
        />

        <SettingRow
          label="Theme"
          hint={`${theme.label} + ${VISIBLE_THEMES.length - 1} themes, each with a light and a dark variant`}
          control={
            <SegmentedControl
              label="Theme group"
              semantics="tabs"
              value={group}
              onValueChange={setGroup}
              items={GROUPS.map((g) => ({ value: g.id, label: g.label, count: g.themes.length }))}
            />
          }
          stacked={
            <div className="flex flex-col gap-2 pt-1">
              <RadioGroup
                aria-label="Theme"
                value={themeId}
                onValueChange={(next) => setThemeId(String(next))}
                className="grid grid-cols-5 gap-2"
              >
                {shown.themes.map((t) => (
                  <RadioCard
                    key={t.id}
                    variant="tile"
                    value={t.id}
                    title={t.label}
                    preview={<ThemePreview themeId={t.id} accent={accent} appearance={resolvedTheme} />}
                  />
                ))}
              </RadioGroup>
              <p className="text-small text-fg-3">
                <span className="font-medium text-fg">{theme.label}</span> · {theme.description}
                {theme.credit ? ` ${theme.label}: ${theme.credit}.` : null}
              </p>
            </div>
          }
        />

        <SettingRow
          label="Accent"
          hint="Primary buttons, focus rings and selection"
          control={
            <div className="flex items-center gap-3">
              <RadioGroup
                aria-label="Accent"
                orientation="horizontal"
                value={accent}
                onValueChange={(next) => setAccent(String(next))}
                className="gap-2"
              >
                {ACCENT_IDS.map((id) => {
                  const scope = scopeProps(themeId, id, resolvedTheme);
                  return (
                    <span key={id} data-theme={scope['data-theme']} data-accent={scope['data-accent']} className={cn('inline-flex', scope.className)}>
                      <Radio variant="swatch" value={id} aria-label={ACCENT_LABELS[id]} swatchClassName="bg-accent" />
                    </span>
                  );
                })}
              </RadioGroup>
              <span className="w-12 text-small text-fg-2">{ACCENT_LABELS[accent]}</span>
            </div>
          }
        />

        <SettingRow
          label="Density"
          hint="Row and control heights across the app"
          control={<SegmentedControl label="Density" value={density} onValueChange={setDensity} items={DENSITY_ITEMS} />}
        />

        <SettingRow
          label="Interface font size"
          hint="Transcript text scales with it"
          control={
            <SegmentedControl label="Interface font size" value={fontSize} onValueChange={setFontSize} items={FONT_SIZE_ITEMS} />
          }
        />

        <SettingRow
          label="Reduce motion"
          hint="Also on when your OS asks for it"
          control={
            <Switch
              aria-label="Reduce motion"
              checked={reduceMotion === 'on'}
              onCheckedChange={(on) => setReduceMotion(on ? 'on' : 'system')}
            />
          }
        />
      </div>
    </SettingsSection>
  );
}
