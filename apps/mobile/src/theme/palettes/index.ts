// GENERATED from packages/design-tokens (emit/uniwind.ts) — do not edit. Regenerate with `pnpm tokens:write`.
/* eslint-disable @typescript-eslint/no-require-imports */
import type { NativeThemePalette } from '@generatorai/design-tokens';

/** The active theme's literal palette; an unknown id falls back to the default theme. */
export function loadPalette(id: string): NativeThemePalette {
  switch (id) {
    case "github":
      return (require('./github') as { default: NativeThemePalette }).default;
    case "graphite":
      return (require('./graphite') as { default: NativeThemePalette }).default;
    case "carbon":
      return (require('./carbon') as { default: NativeThemePalette }).default;
    case "clay":
      return (require('./clay') as { default: NativeThemePalette }).default;
    case "one":
      return (require('./one') as { default: NativeThemePalette }).default;
    case "dracula":
      return (require('./dracula') as { default: NativeThemePalette }).default;
    case "tokyo-night":
      return (require('./tokyo-night') as { default: NativeThemePalette }).default;
    case "catppuccin":
      return (require('./catppuccin') as { default: NativeThemePalette }).default;
    case "ayu":
      return (require('./ayu') as { default: NativeThemePalette }).default;
    case "night-owl":
      return (require('./night-owl') as { default: NativeThemePalette }).default;
    case "rose-pine":
      return (require('./rose-pine') as { default: NativeThemePalette }).default;
    case "nord":
      return (require('./nord') as { default: NativeThemePalette }).default;
    case "everforest":
      return (require('./everforest') as { default: NativeThemePalette }).default;
    case "gruvbox":
      return (require('./gruvbox') as { default: NativeThemePalette }).default;
    case "solarized":
      return (require('./solarized') as { default: NativeThemePalette }).default;
    case "flexoki":
      return (require('./flexoki') as { default: NativeThemePalette }).default;
    case "contrast":
      return (require('./contrast') as { default: NativeThemePalette }).default;
    default:
      return (require('./instrument') as { default: NativeThemePalette }).default;
  }
}
