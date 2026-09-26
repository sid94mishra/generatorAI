// ────────────────────────────────────────────────────────────────
// Device emulation (native desktop responsive toolbar): presets, zoom levels
// and the settings → bridge `setEmulation` mapping. Pure.
// ────────────────────────────────────────────────────────────────

export interface DevicePreset {
  id: string;
  label: string;
  /** 0×0 = Responsive (emulation off, view follows the panel size). */
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

export const ZOOM_LEVELS: readonly number[] = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];

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

/** The bridge's emulation params: null = responsive (emulation off). */
export function emulationParams(s: EmulationSettings): { width: number; height: number; deviceScaleFactor: number; mobile: boolean } | null {
  const responsive = !s.on || s.preset === 'responsive' || s.width <= 0 || s.height <= 0;
  return responsive ? null : { width: s.width, height: s.height, deviceScaleFactor: s.dpr, mobile: s.mobile };
}

/** Page zoom applies only while the device toolbar is on. */
export function emulationZoom(s: EmulationSettings): number {
  return s.on ? s.zoom : 1;
}
