// ────────────────────────────────────────────────────────────────
// Per-platform geometry (M-04, D-40).
//
// Colours are shared by every platform; geometry is not. The same class
// vocabulary (`text-ui`, `rounded-card`, `h-row` …) resolves to per-platform
// values: web fills its slot now (the values globals.css emits), iOS and
// Android are typed slots the mobile pass fills at M0 (08-mobile-readiness.md).
// A consumer that needs a mobile value before then gets `undefined` and must
// fall back to web explicitly, which keeps the gap visible.
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

export interface Geometry {
  web: PlatformGeometry;
  /**
   * TODO(mobile M0): iOS ramp (body 17pt), 44pt touch targets, radii, iPad
   * chrome (312pt sidebar, 410pt pane). Left undefined until the mobile pass.
   */
  ios: PlatformGeometry | undefined;
  /**
   * TODO(mobile M0): Android ramp (body 16sp), 48dp touch targets, radii,
   * tablet chrome (300dp drawer, 400dp pane). Left undefined until the mobile pass.
   */
  android: PlatformGeometry | undefined;
}

export const GEOMETRY: Geometry = {
  web: {
    type: TYPE_SCALE,
    radiusOffsets: RADIUS_OFFSETS,
    heights: HEIGHTS,
    minHitTarget: MIN_HIT_TARGET,
    zIndex: Z_INDEX,
    shell: CONTAINER_WIDTHS,
  },
  ios: undefined,
  android: undefined,
};
