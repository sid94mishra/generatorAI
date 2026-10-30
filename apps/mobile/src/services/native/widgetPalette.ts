// Literal colours for the native system surfaces (02 §2.6 "Widgets, Live Activities, Live Updates, Control/QS
// tiles"): the active theme's 14 keys, written on every theme change so a surface drawn outside the app (the widget
// extension, a Live Activity, the Android notification) paints with the app's palette. iOS: App Group UserDefaults
// key `gai.palette`; Android: SharedPreferences `generatorai_widgets` key `palette` (through the generatorai-live
// module). The same object travels inside each widget snapshot and Live Activity's props, because expo-widgets
// layouts read only their props.
import { getThemeColors, subscribeThemeColors, type ThemeColors } from '../../theme/nativeColors';
import { setAppGroupString } from './appGroup';

export const WIDGET_PALETTE_KEYS = [
  'appearance', 'ground', 'surface', 'raised', 'line', 'fg', 'fg2', 'fg3', 'accent', 'onAccent', 'run', 'ok', 'warn', 'err',
] as const;
export type WidgetPaletteKey = (typeof WIDGET_PALETTE_KEYS)[number];
export type WidgetPalette = Record<WidgetPaletteKey, string>;

/** iOS App Group key. */
export const PALETTE_GROUP_KEY = 'gai.palette';

export function widgetPaletteOf(colors: ThemeColors): WidgetPalette {
  const out = {} as WidgetPalette;
  for (const key of WIDGET_PALETTE_KEYS) out[key] = String(colors[key]);
  return out;
}

/** The palette now, or null before the theme was applied (prepaint publishes it before any surface runs). */
export function currentWidgetPalette(): WidgetPalette | null {
  try {
    return widgetPaletteOf(getThemeColors());
  } catch {
    return null;
  }
}

type PaletteWriter = (json: string) => void;
const writers = new Set<PaletteWriter>([(json) => void setAppGroupString(PALETTE_GROUP_KEY, json)]);

/** Another store for the palette (the Android module registers its SharedPreferences writer). */
export function addPaletteWriter(writer: PaletteWriter): () => void {
  writers.add(writer);
  return () => writers.delete(writer);
}

let last = '';
function write(palette: WidgetPalette | null): void {
  if (!palette) return;
  const json = JSON.stringify(palette);
  if (json === last) return;
  last = json;
  for (const writer of writers) {
    try {
      writer(json);
    } catch {
      // A store that is not in this build: the surfaces fall back to their props.
    }
  }
}

/** Write now and on every theme change; returns the unsubscribe. */
export function startWidgetPaletteSync(onChange?: (palette: WidgetPalette) => void): () => void {
  write(currentWidgetPalette());
  return subscribeThemeColors((colors) => {
    const palette = widgetPaletteOf(colors);
    write(palette);
    onChange?.(palette);
  });
}
