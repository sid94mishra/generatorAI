// The home-screen widgets' writer (MX-03, 06 §7.4): one `WidgetSnapshot` to every widget through expo-widgets
// (`updateSnapshot` stores it in the App Group and reloads the widget's timeline). iOS only — expo-widgets 57 has no
// Android widgets (MD-188). Null-safe: a client built without the ExpoWidgets module writes nothing.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

import type { WidgetSnapshot } from '../../live/widgetSnapshot';

interface WidgetHandle {
  updateSnapshot(props: Partial<WidgetSnapshot>): void;
}

let widgets: WidgetHandle[] | null | undefined;

/** Construct the widgets (which stores their layouts in the App Group); null where they are not built. */
function load(): WidgetHandle[] | null {
  if (widgets !== undefined) return widgets;
  widgets = null;
  if (Platform.OS !== 'ios' || requireOptionalNativeModule('ExpoWidgets') === null) return widgets;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./HomeWidgets') as Record<'NeedsYouWidget' | 'RunningWidget' | 'SummaryWidget', WidgetHandle>;
    widgets = [mod.NeedsYouWidget, mod.RunningWidget, mod.SummaryWidget];
  } catch {
    widgets = null;
  }
  return widgets;
}

export function homeWidgetsAvailable(): boolean {
  return load() !== null;
}

/** Write one snapshot to every widget; false when nothing was written. */
export function writeWidgetSnapshot(snapshot: WidgetSnapshot): boolean {
  const all = load();
  if (!all) return false;
  let ok = true;
  for (const widget of all) {
    try {
      widget.updateSnapshot(snapshot);
    } catch {
      ok = false;
    }
  }
  return ok;
}
