// ────────────────────────────────────────────────────────────────
// Per-platform geometry (M-04, D-40).
//
// Colours are shared by every platform; geometry is not. The same class
// vocabulary (`text-ui`, `rounded-card`, `h-row` …) resolves to per-platform
// values: web holds the values globals.css emits; iOS (pt) and Android (dp)
// hold the mobile values (mobile 02 §3–4, M3-03), which emit/uniwind.ts writes
// into the `@variant ios` / `@variant android` blocks of the mobile theme CSS.
// Mobile radii are absolute and density-free (MD-69); line heights and
// tracking are absolute pt / sp (MD-71).
// ────────────────────────────────────────────────────────────────

import {
  HEIGHTS,
  MIN_HIT_TARGET,
  RADIUS_OFFSETS,
  CONTAINER_WIDTHS,
  TYPE_SCALE,
  Z_INDEX,
  type TypeStep,
} from './design.js';
import type { Density } from './registry.js';
import type { ContainerName, HeightName, RadiusStep, TextStep, ZName } from './vocabulary.js';
import type {
  MobileContainerName,
  MobileHeightName,
  MobileRadiusStep,
  MobileSpacingName,
  MobileTextStep,
} from './vocabulary-mobile.js';

export const PLATFORMS = ['web', 'ios', 'android'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** One platform's geometry, in its own unit (px on web, pt on iOS, dp on Android). */
export interface PlatformGeometry {
  /** The type ramp at the default size setting. */
  type: Record<TextStep, TypeStep>;
  /** Offsets from a theme's base radius (D-14); the base stays theme-owned. */
  radiusOffsets: Record<RadiusStep, number>;
  /** Row and control heights per density. */
  heights: Record<Density, Record<HeightName, number>>;
  /** Minimum touch/click target. */
  minHitTarget: number;
  /** Named stacking layers. */
  zIndex: Record<ZName, number>;
  /** Shell widths (sidebar, dock, dialogs …). */
  shell: Record<ContainerName, number>;
}

/** iOS text styles accepted by RN `Text` `dynamicTypeRamp`. */
export type DynamicTypeRamp =
  | 'caption2'
  | 'caption1'
  | 'footnote'
  | 'subheadline'
  | 'callout'
  | 'body'
  | 'headline'
  | 'title3'
  | 'title2'
  | 'title1'
  | 'largeTitle';

/** M3 type roles (Android reference; `null` = off-scale value the boards chose). */
export type M3TypeRole =
  | 'displayLarge'
  | 'displayMedium'
  | 'displaySmall'
  | 'headlineLarge'
  | 'headlineMedium'
  | 'headlineSmall'
  | 'titleLarge'
  | 'titleMedium'
  | 'titleSmall'
  | 'bodyLarge'
  | 'bodyMedium'
  | 'bodySmall'
  | 'labelLarge'
  | 'labelMedium'
  | 'labelSmall';

export interface NativeTypeStep {
  /** pt / sp. */
  size: number;
  /** ABSOLUTE pt / sp (MD-71). */
  lineHeight: number;
  weight: 400 | 500 | 600;
  /** ABSOLUTE pt / sp (letterSpacing). */
  tracking: number;
  /** iOS scaling curve; Android ignores it. */
  ramp: DynamicTypeRamp;
  /** Android reference role. */
  m3: M3TypeRole | null;
  /** maxFontSizeMultiplier for content use; 0 = uncapped. */
  maxScale: number;
  /** JetBrains Mono (+ tabular by construction). */
  mono: boolean;
}

export interface NativeControlGeometry {
  switch: { width: number; height: number; thumbOn: number; thumbOff: number; outline: number };
  checkbox: { size: number; radius: number; border: number };
  radio: { size: number; ring: number; dot: number; checkmark: number };
  segmented: { trackPadding: number; gap: number };
  chip: { paddingX: number; gap: number; check: number };
  badge: { paddingX: number; icon: number; statusLineIcon: number };
  grabber: { width: number; height: number; radius: number };
  sheetInset: number;
  newAction: { endInset: number; bottomAboveSafeArea: number; icon: number; paddingStart: number; paddingEnd: number };
  header: { maxTrailing: number; overflowMenu: boolean; backGlyph: number; toolbarGlyph: number };
  swipeAction: { leading: number; trailing: number };
  composer: { control: number; controlGap: number; send: number };
  drawerSnapFraction: number;
}

export type NativeIconSize = 12 | 14 | 16 | 18 | 20 | 22 | 24;

/** One native platform's geometry (mobile 02 §3.8). */
export interface NativeGeometry extends Omit<PlatformGeometry, 'type' | 'radiusOffsets'> {
  unit: 'pt' | 'dp';
  /** Shared steps + mobile steps. */
  type: Record<TextStep | MobileTextStep, NativeTypeStep>;
  /** Absolute radii; themes do not change them (MD-69). */
  radii: Record<RadiusStep | MobileRadiusStep, number>;
  /** Mobile-only heights (the shared ones stay in `heights`, both densities identical). */
  mobileHeights: Record<MobileHeightName, number>;
  mobileShell: Record<MobileContainerName, number>;
  /** Max fraction of the window width a phone panel may take (79 % / 82 %, 89 %). */
  panelMaxFraction: Record<MobileContainerName, number>;
  spacing: Record<MobileSpacingName, number>;
  breakpoints: { medium: 600; expanded: 840 };
  /** maxFontSizeMultiplier for dense chrome (badges, chips, counts, tab labels, key row). */
  chromeScaleCap: number;
  icon: { sizes: readonly NativeIconSize[]; header: number; row: number; inline: number; badge: number };
  controls: NativeControlGeometry;
  tablet: { panelInset: number; panelRadiusStep: 'group' | null; paneSurface: 'raised' | 'overlay' };
}

export interface Geometry {
  web: PlatformGeometry;
  ios: NativeGeometry;
  android: NativeGeometry;
}

type StepRow = [size: number, lineHeight: number, weight: 400 | 500 | 600, tracking: number];

/** Shared role data (mobile 02 §4.1): ramp, M3 role, content cap, family. Same on both platforms. */
const ROLE: Record<TextStep | MobileTextStep, Pick<NativeTypeStep, 'ramp' | 'm3' | 'maxScale' | 'mono'>> = {
  display: { ramp: 'largeTitle', m3: 'headlineMedium', maxScale: 1.3, mono: false },
  heading: { ramp: 'title3', m3: 'titleLarge', maxScale: 1.4, mono: false },
  title: { ramp: 'headline', m3: 'titleMedium', maxScale: 1.6, mono: false },
  'detail-title': { ramp: 'callout', m3: null, maxScale: 1.4, mono: false },
  body: { ramp: 'body', m3: 'bodyLarge', maxScale: 0, mono: false },
  transcript: { ramp: 'callout', m3: 'bodyLarge', maxScale: 0, mono: false },
  ui: { ramp: 'subheadline', m3: 'bodyMedium', maxScale: 0, mono: false },
  small: { ramp: 'footnote', m3: 'bodyMedium', maxScale: 0, mono: false },
  micro: { ramp: 'caption1', m3: 'labelMedium', maxScale: 0, mono: false },
  'mono-lg': { ramp: 'subheadline', m3: 'bodyMedium', maxScale: 0, mono: true },
  mono: { ramp: 'footnote', m3: 'bodyMedium', maxScale: 0, mono: true },
  'mono-sm': { ramp: 'caption1', m3: 'bodySmall', maxScale: 0, mono: true },
};

function typeRamp(rows: Record<TextStep | MobileTextStep, StepRow>): Record<TextStep | MobileTextStep, NativeTypeStep> {
  const out = {} as Record<TextStep | MobileTextStep, NativeTypeStep>;
  for (const [step, [size, lineHeight, weight, tracking]] of Object.entries(rows) as Array<[TextStep | MobileTextStep, StepRow]>) {
    out[step] = { size, lineHeight, weight, tracking, ...ROLE[step] };
  }
  return out;
}

/** Both density keys hold the same comfortable heights on mobile (MD-69). */
function oneDensity(h: Record<HeightName, number>): Record<Density, Record<HeightName, number>> {
  return { comfortable: h, compact: h };
}

const ICON_SIZES = [12, 14, 16, 18, 20, 22, 24] as const satisfies readonly NativeIconSize[];
const BREAKPOINTS = { medium: 600, expanded: 840 } as const;

/** iOS, in pt (mobile 02 §3.1–3.6, §4.1). */
const IOS: NativeGeometry = {
  unit: 'pt',
  type: typeRamp({
    display: [32, 37, 600, -0.64],
    heading: [20, 25, 600, -0.2],
    title: [17, 22, 600, 0],
    body: [17, 24, 400, 0],
    ui: [15, 20, 400, 0],
    small: [13, 18, 400, 0],
    micro: [12, 16, 500, 0],
    'detail-title': [16, 21, 600, 0],
    transcript: [16, 24, 400, 0],
    'mono-lg': [14, 20, 400, 0],
    mono: [13, 19, 400, 0],
    'mono-sm': [12, 17, 400, 0],
  }),
  radii: {
    badge: 12,
    'control-sm': 16,
    control: 12,
    seg: 9,
    card: 14,
    panel: 28,
    dialog: 38,
    'seg-item': 7,
    'card-lg': 20,
    group: 22,
    nav: 12,
    field: 12,
    code: 12,
    composer: 28,
    new: 26,
    toast: 24,
  },
  heights: oneDensity({
    'control-sm': 36,
    control: 44,
    'control-lg': 50,
    nav: 44,
    item: 44,
    step: 44,
    th: 30,
    row: 52,
    tab: 32,
    bar: 52,
    badge: 24,
    kbd: 40,
    'panel-bar': 52,
    'dialog-bar': 56,
    footer: 64,
    strip: 0,
    meter: 4,
    tile: 72,
  }),
  mobileHeights: {
    chip: 32,
    seg: 32,
    field: 44,
    search: 44,
    'search-sm': 44,
    'row-2': 68,
    'bar-lg': 60,
    hit: 44,
    'icon-button': 44,
    'icon-button-sm': 36,
    new: 52,
    toast: 48,
    'badge-sm': 20,
  },
  minHitTarget: 44,
  zIndex: Z_INDEX,
  shell: {
    sidebar: 312,
    rail: 0,
    dock: 410,
    'dock-run': 410,
    sheet: 540,
    aside: 320,
    'side-rail': 360,
    inspector: 400,
    'dialog-sm': 290,
    dialog: 540,
    'dialog-lg': 720,
  },
  mobileShell: { drawer: 318, pane: 356 },
  panelMaxFraction: { drawer: 0.79, pane: 0.89 },
  spacing: { gutter: 16, 'gutter-title': 20 },
  breakpoints: BREAKPOINTS,
  chromeScaleCap: 1.4,
  icon: { sizes: ICON_SIZES, header: 22, row: 20, inline: 16, badge: 14 },
  controls: {
    switch: { width: 51, height: 31, thumbOn: 27, thumbOff: 27, outline: 0 },
    checkbox: { size: 22, radius: 11, border: 1.5 },
    radio: { size: 0, ring: 0, dot: 0, checkmark: 18 },
    segmented: { trackPadding: 2, gap: 0 },
    chip: { paddingX: 12, gap: 6, check: 16 },
    badge: { paddingX: 9, icon: 14, statusLineIcon: 12 },
    grabber: { width: 36, height: 5, radius: 3 },
    sheetInset: 8,
    newAction: { endInset: 16, bottomAboveSafeArea: 6, icon: 20, paddingStart: 16, paddingEnd: 20 },
    header: { maxTrailing: 3, overflowMenu: false, backGlyph: 22, toolbarGlyph: 22 },
    swipeAction: { leading: 64, trailing: 74 },
    composer: { control: 36, controlGap: 8, send: 36 },
    drawerSnapFraction: 0.4,
  },
  tablet: { panelInset: 8, panelRadiusStep: 'group', paneSurface: 'raised' },
};

/** Android, in dp / sp (mobile 02 §3.1–3.6, §4.1). */
const ANDROID: NativeGeometry = {
  unit: 'dp',
  type: typeRamp({
    display: [28, 34, 600, -0.28],
    heading: [22, 28, 600, 0],
    title: [16, 24, 600, 0],
    body: [16, 24, 400, 0],
    ui: [14, 20, 400, 0],
    small: [14, 20, 400, 0],
    micro: [12, 16, 500, 0],
    'detail-title': [18, 24, 600, 0],
    transcript: [16, 24, 400, 0],
    'mono-lg': [14, 20, 400, 0],
    mono: [13, 19, 400, 0],
    'mono-sm': [12, 17, 400, 0],
  }),
  radii: {
    badge: 8,
    'control-sm': 8,
    control: 8,
    seg: 20,
    card: 12,
    panel: 16,
    dialog: 28,
    'seg-item': 8,
    'card-lg': 16,
    group: 16,
    nav: 24,
    field: 4,
    code: 8,
    composer: 28,
    new: 16,
    toast: 8,
  },
  heights: oneDensity({
    'control-sm': 36,
    control: 40,
    'control-lg': 48,
    nav: 48,
    item: 48,
    step: 48,
    th: 30,
    row: 56,
    tab: 48,
    bar: 64,
    badge: 26,
    kbd: 40,
    'panel-bar': 52,
    'dialog-bar': 64,
    footer: 64,
    strip: 0,
    meter: 4,
    tile: 72,
  }),
  mobileHeights: {
    chip: 32,
    seg: 40,
    field: 56,
    search: 56,
    'search-sm': 48,
    'row-2': 72,
    'bar-lg': 64,
    hit: 48,
    'icon-button': 48,
    'icon-button-sm': 40,
    new: 56,
    toast: 48,
    // 02 §3.3 (h-badge-sm 20 / 20); the §3.8 value table omits the Android cell.
    'badge-sm': 20,
  },
  minHitTarget: 48,
  zIndex: Z_INDEX,
  shell: {
    sidebar: 300,
    rail: 0,
    dock: 400,
    'dock-run': 400,
    sheet: 640,
    aside: 320,
    'side-rail': 360,
    inspector: 400,
    'dialog-sm': 300,
    dialog: 560,
    'dialog-lg': 720,
  },
  mobileShell: { drawer: 336, pane: 364 },
  panelMaxFraction: { drawer: 0.82, pane: 0.89 },
  spacing: { gutter: 16, 'gutter-title': 16 },
  breakpoints: BREAKPOINTS,
  chromeScaleCap: 1.4,
  icon: { sizes: ICON_SIZES, header: 24, row: 24, inline: 16, badge: 14 },
  controls: {
    switch: { width: 52, height: 32, thumbOn: 24, thumbOff: 16, outline: 2 },
    checkbox: { size: 18, radius: 3, border: 2 },
    radio: { size: 20, ring: 2, dot: 10, checkmark: 0 },
    segmented: { trackPadding: 0, gap: 2 },
    chip: { paddingX: 12, gap: 8, check: 16 },
    badge: { paddingX: 8, icon: 14, statusLineIcon: 12 },
    grabber: { width: 32, height: 4, radius: 2 },
    sheetInset: 0,
    newAction: { endInset: 16, bottomAboveSafeArea: 16, icon: 24, paddingStart: 16, paddingEnd: 20 },
    header: { maxTrailing: 2, overflowMenu: true, backGlyph: 24, toolbarGlyph: 24 },
    swipeAction: { leading: 64, trailing: 74 },
    composer: { control: 40, controlGap: 8, send: 48 },
    drawerSnapFraction: 0.4,
  },
  tablet: { panelInset: 0, panelRadiusStep: null, paneSurface: 'overlay' },
};

export const GEOMETRY: Geometry = {
  web: {
    type: TYPE_SCALE,
    radiusOffsets: RADIUS_OFFSETS,
    heights: HEIGHTS,
    minHitTarget: MIN_HIT_TARGET,
    zIndex: Z_INDEX,
    shell: CONTAINER_WIDTHS,
  },
  ios: IOS,
  android: ANDROID,
};
