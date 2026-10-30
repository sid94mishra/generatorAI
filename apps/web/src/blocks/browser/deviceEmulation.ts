// ────────────────────────────────────────────────────────────────
// Device emulation (native desktop responsive toolbar): presets, zoom levels
// and the settings → bridge `setEmulation` mapping. Pure.
// ────────────────────────────────────────────────────────────────

export interface DevicePreset {
  id: string;
  label: string;
  /** 0×0 = Responsive: the width and height fields decide. */
  width: number;
  height: number;
  mobile: boolean;
}

export const DEVICE_PRESETS: readonly DevicePreset[] = [
  { id: 'responsive', label: 'Responsive', width: 0, height: 0, mobile: false },
  { id: 'mobile-s', label: 'Mobile S — 360×640', width: 360, height: 640, mobile: true },
  { id: 'iphone', label: 'iPhone 12/13 — 390×844', width: 390, height: 844, mobile: true },
  { id: 'mobile-l', label: 'Mobile L — 414×896', width: 414, height: 896, mobile: true },
  { id: 'pixel', label: 'Pixel 7 — 412×915', width: 412, height: 915, mobile: true },
  { id: 'tablet', label: 'Tablet — 768×1024', width: 768, height: 1024, mobile: true },
  { id: 'ipad-pro', label: 'iPad Pro — 1024×1366', width: 1024, height: 1366, mobile: true },
  { id: 'laptop', label: 'Laptop — 1366×768', width: 1366, height: 768, mobile: false },
  { id: 'desktop', label: 'Desktop — 1920×1080', width: 1920, height: 1080, mobile: false },
];

/** 0 = Fit: the device frame is scaled down to fit the panel (the default). */
export const ZOOM_FIT = 0;
export const ZOOM_LEVELS: readonly number[] = [ZOOM_FIT, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];

export interface EmulationSettings {
  on: boolean;
  preset: string;
  width: number;
  height: number;
  dpr: number;
  mobile: boolean;
  zoom: number;
}

export function findDevicePreset(id: string): DevicePreset {
  return DEVICE_PRESETS.find((p) => p.id === id) ?? DEVICE_PRESETS[0]!;
}

/**
 * The bridge's emulation params while device mode is on (D-144): the page
 * lays out at width×height CSS px, paints at `scale` to fit its frame. Off,
 * or with no usable size, it is null (the tab is restored).
 */
export function emulationParams(
  s: EmulationSettings,
  scale = 1,
): { width: number; height: number; deviceScaleFactor: number; mobile: boolean; scale: number } | null {
  if (!s.on || s.width <= 0 || s.height <= 0) return null;
  return { width: s.width, height: s.height, deviceScaleFactor: s.dpr, mobile: s.mobile, scale };
}

/**
 * The device frame in the panel: the device's CSS size at `zoom`, or — Fit —
 * scaled down (never up) to the space available, keeping its aspect ratio.
 */
export function deviceFrame(
  device: { width: number; height: number },
  avail: { width: number; height: number },
  zoom: number,
): { width: number; height: number; scale: number } {
  const pad = 24;
  const fit = Math.min(1, Math.max(0.1, (avail.width - pad) / device.width), Math.max(0.1, (avail.height - pad) / device.height));
  const scale = zoom > 0 ? zoom : fit;
  return { width: Math.round(device.width * scale), height: Math.round(device.height * scale), scale };
}

export const zoomLabel = (z: number): string => (z === ZOOM_FIT ? 'Fit' : `${Math.round(z * 100)}%`);
