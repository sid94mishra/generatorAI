// ────────────────────────────────────────────────────────────────
// `uiautomator dump` XML → raw device elements (Android). Pure.
//
// The dump is a tree of `<node …/>` / `<node …>…</node>` with every attribute
// on the tag. A full XML parser is not needed: attribute values are escaped,
// tags do not nest inside attributes, and the only structure that matters is
// depth, which a stack of open tags gives.
// ────────────────────────────────────────────────────────────────

import type { RawDeviceElement, RawDeviceSnapshot } from '../../domain/ports/IDeviceBridge.js';

const ROLE_BY_CLASS: Record<string, string> = {
  Button: 'Button',
  ImageButton: 'Button',
  FloatingActionButton: 'Button',
  MaterialButton: 'Button',
  EditText: 'TextField',
  AutoCompleteTextView: 'TextField',
  TextInputEditText: 'TextField',
  TextView: 'StaticText',
  ImageView: 'Image',
  CheckBox: 'CheckBox',
  Switch: 'Switch',
  SwitchCompat: 'Switch',
  SwitchMaterial: 'Switch',
  ToggleButton: 'Switch',
  RadioButton: 'RadioButton',
  SeekBar: 'Slider',
  ProgressBar: 'ProgressIndicator',
  Spinner: 'PopUpButton',
  WebView: 'WebView',
  RecyclerView: 'List',
  ListView: 'List',
  ScrollView: 'ScrollArea',
  HorizontalScrollView: 'ScrollArea',
  ViewPager: 'ScrollArea',
  TabWidget: 'TabGroup',
};

function decode(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

function attrs(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of tag.matchAll(/([\w-]+)="([^"]*)"/g)) out.set(m[1]!, decode(m[2]!));
  return out;
}

function bounds(value: string | undefined): [number, number, number, number] | null {
  const m = value?.match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

/** The short class name: `android.widget.Button` → `Button`. */
function shortClass(cls: string): string {
  return cls.slice(cls.lastIndexOf('.') + 1);
}

export function roleForAndroidClass(cls: string, a: Map<string, string>): string {
  const name = shortClass(cls);
  if (a.get('password') === 'true') return 'SecureTextField';
  const known = ROLE_BY_CLASS[name];
  if (known) return known;
  if (a.get('checkable') === 'true') return 'CheckBox';
  if (a.get('clickable') === 'true') return 'Button';
  if (a.get('scrollable') === 'true') return 'ScrollArea';
  return 'Group';
}

/**
 * Parses a dump. `screen` is the display size in pixels (`wm size`); when
 * omitted the root node's bounds are used. Elements keep their dump order
 * (document order = reading order).
 */
export function parseUiautomatorDump(xml: string, screen?: { width: number; height: number }): RawDeviceSnapshot {
  const elements: RawDeviceElement[] = [];
  let depth = 0;
  let width = screen?.width ?? 0;
  let height = screen?.height ?? 0;
  const packages = new Map<string, number>();
  for (const m of xml.matchAll(/<node\b([^>]*?)(\/?)>|<\/node>/g)) {
    if (m[0] === '</node>') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    const a = attrs(m[1] ?? '');
    const selfClosing = m[2] === '/';
    const b = bounds(a.get('bounds'));
    if (b && (width === 0 || height === 0) && depth === 0) {
      width = b[2];
      height = b[3];
    }
    if (b && width > 0 && height > 0) {
      const [l, t, r, btm] = b;
      const w = r - l;
      const h = btm - t;
      if (w > 0 && h > 0) {
        const cls = a.get('class') ?? '';
        const role = roleForAndroidClass(cls, a);
        const text = a.get('text') || undefined;
        const desc = a.get('content-desc') || undefined;
        const hint = a.get('hint') || undefined;
        const isField = role === 'TextField' || role === 'SecureTextField';
        const interactive =
          a.get('clickable') === 'true' ||
          a.get('long-clickable') === 'true' ||
          a.get('checkable') === 'true' ||
          a.get('scrollable') === 'true' ||
          isField;
        const pkg = a.get('package');
        if (pkg) packages.set(pkg, (packages.get(pkg) ?? 0) + 1);
        const label = desc ?? (isField ? hint : text) ?? (isField ? undefined : hint);
        const value = isField ? text : a.get('checkable') === 'true' ? (a.get('checked') === 'true' ? 'on' : 'off') : undefined;
        elements.push({
          role,
          type: cls || undefined,
          ...(label ? { label } : {}),
          ...(value !== undefined && value !== label ? { value } : {}),
          ...(a.get('resource-id') ? { id: a.get('resource-id')! } : {}),
          enabled: a.get('enabled') !== 'false',
          interactive,
          frame: { x: l / width, y: t / height, w: w / width, h: h / height },
          depth,
        });
      }
    }
    if (!selfClosing) depth += 1;
  }
  // The foreground app is the package with the most nodes that is not the system UI.
  const app = [...packages.entries()]
    .filter(([p]) => p !== 'com.android.systemui')
    .sort((x, y) => y[1] - x[1])[0]?.[0];
  return { ...(app ? { app } : {}), screen: { width, height, unit: 'px' }, elements };
}
