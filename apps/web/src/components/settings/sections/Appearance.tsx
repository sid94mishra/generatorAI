// ────────────────────────────────────────────────────────────────
// Settings → Appearance.
//
// Three independent controls, presented in the order they matter:
//
//   Mode     light / dark / system
//   Theme    the palette itself — six of them, each with both variants
//   Accent   interactive colour, drawn from the active theme's own hues
//
// Everything applies instantly and persists on this device. There is no Save
// button on purpose: the whole modal is rendered with the tokens being edited,
// so the page *is* the preview and a confirmation step would only add a click
// to something already reversible.
//
// The theme cards are the one place in the app that renders raw hex. That is
// deliberate — a swatch has to show a colour the app is NOT currently using,
// which is exactly what a token cannot do. The values come from the registry,
// never from a literal in this file.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/providers/ThemeProvider.js';
import { cn } from '@/lib/utils.js';
import {
  MODES,
  resolveAccentTokens,
  resolveAppearanceTokens,
  themeAccents,
  themesByGroup,
  type AccentId,
  type Appearance,
  type ModeDef,
  type ThemeDef,
} from '@generatorai/design-tokens';
import { SectionHeader, SettingsCard } from '../shared.js';
import { Button } from '@/components/ui/index.js';

const MODE_ICONS: Record<ModeDef['icon'], React.ReactNode> = {
  Sun: <Sun className="h-4 w-4" />,
  Moon: <Moon className="h-4 w-4" />,
  Monitor: <Monitor className="h-4 w-4" />,
};

/**
 * A miniature of the app chrome, painted in a theme the app is not currently
 * using: sidebar, content surface, a line of body text, a line of muted text
 * and the four status colours.
 *
 * A flat row of swatches was the first attempt and it was useless — six
 * palettes of similar hues are indistinguishable as dots, and the thing users
 * actually want to know ("how loud is this, and can I read it?") is a question
 * about surfaces in composition, not about individual colours.
 *
 * `accentId` is the LIVE accent, not the theme's default. Painting each card
 * in its own signature accent looked better and was a lie: selecting a theme
 * keeps the accent you already chose, so a Clay card previewing terracotta
 * while Clay-plus-your-blue is what you get is a preview of something the app
 * will never render.
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
    <div
      aria-hidden
      className="flex h-[4.5rem] w-full overflow-hidden rounded-md border"
      style={{ background: t.background, borderColor: t.border, fontFamily: theme.fonts.sans }}
    >
      <div className="flex w-1/4 flex-col gap-1 p-1.5" style={{ background: t.sidebar }}>
        <div
          className="h-1.5 w-full rounded-full"
          style={{ background: accent.primary }}
        />
        <div className="h-1.5 w-3/4 rounded-full" style={{ background: t.emphasis }} />
        <div className="h-1.5 w-2/3 rounded-full" style={{ background: t.emphasis }} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        <div className="h-1.5 w-2/3 rounded-full" style={{ background: t.foreground }} />
        <div className="h-1.5 w-full rounded-full" style={{ background: t.mutedForeground }} />
        <div className="mt-auto flex gap-1">
          {[t.success, t.warning, t.danger, t.info].map((c) => (
            <span key={c} className="h-2 w-2 rounded-full" style={{ background: c }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ThemeCard({
  theme,
  appearance,
  accentId,
  selected,
  onSelect,
}: {
  theme: ThemeDef;
  appearance: Appearance;
  accentId: AccentId;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      variant="ghost"
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        // `Button` is an inline-flex, vertically-centred, NON-WRAPPING row by
        // default — correct for a button, wrong for a card. All three have to
        // be undone here or the card's own description renders as one endless
        // line that escapes the card and paints across its neighbours (it did:
        // the Theme grid overlapped itself horizontally on this very screen).
        'h-auto group flex w-full flex-col items-stretch gap-2 whitespace-normal rounded-lg border p-2.5 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-subtle',
      )}
    >
      <ThemePreview theme={theme} appearance={appearance} accentId={accentId} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            {theme.label}
            {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
            {theme.description}
          </p>
        </div>
      </div>
    </Button>
  );
}

export function AppearanceSection() {
  const { mode, setMode, resolvedTheme, themeId, setThemeId, theme, accent, setAccent } = useTheme();
  const accents = themeAccents(theme);

  return (
    <div>
      <SectionHeader
        title="Appearance"
        description="Theme, light/dark mode and accent colour. Applies instantly and is remembered on this device."
      />

      <div className="space-y-4">
        <SettingsCard
          title="Mode"
          description="Every theme ships both a light and a dark variant — this picks which one you see."
        >
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Appearance mode">
            {MODES.map((m) => (
              <Button
                key={m.id}
                variant="ghost"
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                onClick={() => setMode(m.id)}
                title={m.description}
                className={cn(
                  'h-auto flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  mode === m.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-subtle',
                )}
              >
                {MODE_ICONS[m.icon]}
                {m.label}
                {/* `system` resolves to a variant the user cannot otherwise
                    see — so say which one it landed on. */}
                {m.id === 'system' && (
                  <span className="rounded bg-subtle px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {resolvedTheme}
                  </span>
                )}
              </Button>
            ))}
          </div>
        </SettingsCard>

        <SettingsCard
          title="Theme"
          description="Surfaces, type and corner radius — not just colour. Each preview is painted in that theme's own tokens."
        >
          <div className="space-y-5" role="radiogroup" aria-label="Theme">
            {themesByGroup().map((group) => (
              <div key={group.id}>
                <div className="mb-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                    {group.label}
                  </h4>
                  <p className="mt-0.5 text-xs text-muted-foreground">{group.description}</p>
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {group.themes.map((t) => (
                    <ThemeCard
                      key={t.id}
                      theme={t}
                      appearance={resolvedTheme}
                      accentId={accent}
                      selected={themeId === t.id}
                      onSelect={() => setThemeId(t.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {theme.credit && (
            <p className="mt-4 text-xs text-muted-foreground">
              {theme.label}: {theme.credit}. Adapted where the original palette fell below our
              contrast floor — see the theme source for each deviation.
            </p>
          )}
        </SettingsCard>

        <SettingsCard
          title="Accent colour"
          description="Used for buttons, links and selection. Drawn from the active theme's own palette, so it never clashes."
        >
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent colour">
            {accents.map((a) => {
              const swatch = a[resolvedTheme].primary;
              const selected = accent === a.id;
              return (
                <Button
                  key={a.id}
                  variant="ghost"
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={a.label}
                  title={a.label}
                  onClick={() => setAccent(a.id)}
                  className={cn(
                    'h-auto flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-subtle',
                  )}
                >
                  <span
                    aria-hidden
                    className="h-3.5 w-3.5 rounded-full"
                    style={{ backgroundColor: swatch }}
                  />
                  {a.label}
                </Button>
              );
            })}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Status colours — success, warning, failed — deliberately stay fixed, so “failed” always
            reads as failure whichever accent you pick.
          </p>
        </SettingsCard>

        {/* Rendered with the live tokens rather than with the theme object, so
            it verifies the whole pipeline (CSS variables, not just data). */}
        <SettingsCard title="Preview" description="Live — these are the tokens every other surface uses.">
          <div className="space-y-3">
            <div>
              <div className="text-base font-semibold text-foreground">Heading</div>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Body text sits at this contrast against the card surface, and secondary text at
                this one.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-primary-emphasis px-2.5 py-1 text-xs font-medium text-primary-foreground">
                Primary
              </span>
              <span className="rounded-md border border-border bg-subtle px-2.5 py-1 text-xs font-medium text-foreground">
                Secondary
              </span>
              <span className="rounded-md bg-info-muted px-2 py-0.5 text-xs font-medium text-info">
                Running
              </span>
              <span className="rounded-md bg-success-muted px-2 py-0.5 text-xs font-medium text-success">
                Completed
              </span>
              <span className="rounded-md bg-warning-muted px-2 py-0.5 text-xs font-medium text-warning">
                Needs you
              </span>
              <span className="rounded-md bg-danger-muted px-2 py-0.5 text-xs font-medium text-danger">
                Failed
              </span>
            </div>
            <pre className="overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs">
              <code className="hljs">
                <span className="hljs-comment">{'// syntax follows the theme too'}</span>
                {'\n'}
                <span className="hljs-keyword">const</span>{' '}
                <span className="hljs-variable">run</span> ={' '}
                <span className="hljs-keyword">await</span>{' '}
                <span className="hljs-title">start</span>({'{'} retries:{' '}
                <span className="hljs-number">3</span> {'}'});
              </code>
            </pre>
          </div>
        </SettingsCard>
      </div>
    </div>
  );
}
