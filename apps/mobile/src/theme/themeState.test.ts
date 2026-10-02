import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { THEMES, accentVars, getThemeDef, resolveAccentFromSeed, toAccentVars } from '@generatorai/design-tokens';

const store = new Map<string, string>();
vi.mock('../services/storage/prefs', () => ({
  prefs: { getString: (k: string) => store.get(k), setString: (k: string, v: string) => void store.set(k, v) },
}));
vi.mock('../ui/platform/accent', () => ({ systemAccentAvailable: true, readSystemAccentSeeds: () => null }));
// The generated modules are require()d by Metro; here the same data comes from the builder they are emitted from
// (design-tokens' uniwind.test.ts pins the emitted files to it).
vi.mock('./palettes', async () => {
  const tokens = await import('@generatorai/design-tokens');
  return { loadPalette: (id: string) => tokens.buildNativePalette(tokens.getThemeDef(id)) };
});

const { resolveTheme, resolveAccentChoice, readCachedSeeds, writeCachedSeeds } = await import('./themeState');
const { LEGACY_COLOR_TOKEN, legacyColorsFrom } = await import('./legacyColorNames');

describe('theme resolution (M3-08)', () => {
  it('uses the generated palette with the named accent overlaid, for every theme', () => {
    for (const theme of THEMES) {
      for (const appearance of ['dark', 'light'] as const) {
        const { triple, colors } = resolveTheme(theme.id, appearance, 'blue', null);
        expect(toAccentVars(triple)).toEqual(accentVars(theme, appearance, 'blue'));
        expect(colors.accent).toBe(triple.accent);
        expect(colors.appearance).toBe(appearance);
        expect(colors.terminal.background).toMatch(/^#/);
      }
    }
  });

  it('derives the System accent from the cached seed, falling back to the theme default', () => {
    const theme = getThemeDef('nord');
    const seeds = { dark: '#7cc4ff', light: '#0b57d0' };
    expect(resolveTheme('nord', 'light', 'system', seeds).triple).toEqual(resolveAccentFromSeed(theme, 'light', seeds.light));
    expect(toAccentVars(resolveTheme('nord', 'dark', 'system', null).triple)).toEqual(accentVars(theme, 'dark', theme.defaultAccent));
    expect(toAccentVars(resolveTheme('nord', 'dark', 'system', { dark: 'blue', light: 'red' }).triple)).toEqual(
      accentVars(theme, 'dark', theme.defaultAccent),
    );
  });

  it("keeps 'system' only where it is available and resolves unknown accents to the theme default", () => {
    expect(resolveAccentChoice('instrument', 'system')).toBe('system');
    expect(resolveAccentChoice('gruvbox', 'nope')).toBe('orange');
  });

  it('caches the seeds as JSON with a timestamp', () => {
    writeCachedSeeds({ dark: '#111111', light: '#222222' });
    expect(readCachedSeeds()).toEqual({ dark: '#111111', light: '#222222' });
    expect(JSON.parse(store.get('generatorai-system-accent-seed')!)).toHaveProperty('at');
  });

  it('maps legacy literal names exactly as legacy.css maps the legacy classes', () => {
    const css = readFileSync(new URL('./legacy.css', import.meta.url), 'utf8');
    const camel = (s: string): string => s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    const fromCss = Object.fromEntries([...css.matchAll(/--color-([a-z-]+): var\(--gai-([a-z0-9-]+)\);/g)].map((m) => [m[1], camel(m[2]!)]));
    for (const [name, token] of Object.entries(fromCss)) expect(LEGACY_COLOR_TOKEN[name as keyof typeof LEGACY_COLOR_TOKEN], name).toBe(token);
    const legacy = legacyColorsFrom(resolveTheme('instrument', 'dark', 'ink', null).colors);
    expect(legacy['muted-foreground']).toBe(resolveTheme('instrument', 'dark', 'ink', null).colors.fg2);
    expect(legacy['file-icon-blue']).toMatch(/^#/);
  });
});
