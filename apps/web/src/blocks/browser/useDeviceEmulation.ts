// ────────────────────────────────────────────────────────────────
// Device mode (native desktop responsive toolbar, D-144): preset, size,
// rotate, pixel ratio, mobile, zoom. The first switch-on shows a real phone
// (iPhone, 390×844 @3×, mobile) so the page visibly reflows. The panel sizes
// the device frame and pushes the settings — with the fit scale — to the
// native view (`useDeviceFrame`).
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';

import { deviceFrame, emulationParams, findDevicePreset, ZOOM_FIT } from './deviceEmulation.js';
import { nativeBrowserBridge } from './nativeBrowserBridge.js';

export function useDeviceEmulation({ nativeAvailable, nativeTabId }: { nativeAvailable: boolean; nativeTabId: string | null }) {
  const [emulationOn, setEmulationOn] = useState(false);
  const [emuPreset, setEmuPreset] = useState<string>('iphone');
  const [emuWidth, setEmuWidth] = useState<number>(390);
  const [emuHeight, setEmuHeight] = useState<number>(844);
  const [emuDpr, setEmuDpr] = useState<number>(3);
  const [emuMobile, setEmuMobile] = useState<boolean>(true);
  const [emuZoom, setEmuZoom] = useState<number>(ZOOM_FIT);

  const handleToggleEmulation = useCallback(() => setEmulationOn((v) => !v), []);

  const handlePickPreset = useCallback((id: string) => {
    const preset = findDevicePreset(id);
    setEmuPreset(id);
    if (preset.width > 0) { setEmuWidth(preset.width); setEmuHeight(preset.height); }
    setEmuMobile(preset.mobile);
    setEmuDpr(preset.mobile ? 3 : 1);
  }, []);

  const handleEmuDimChange = useCallback((w: number, h: number) => {
    setEmuWidth(w); setEmuHeight(h);
    setEmuPreset((p) => (p === 'responsive' ? p : 'custom'));
  }, []);

  const handleEmuRotate = useCallback(() => {
    setEmuWidth(emuHeight); setEmuHeight(emuWidth);
  }, [emuWidth, emuHeight]);

  return {
    emulationOn, emuPreset, emuWidth, emuHeight, emuDpr, emuMobile, emuZoom,
    handleToggleEmulation, handlePickPreset, handleEmuDimChange, handleEmuRotate,
    handleEmuZoom: setEmuZoom, handleEmuDpr: setEmuDpr, handleEmuMobile: setEmuMobile,
    nativeAvailable, nativeTabId,
  };
}

/**
 * The device frame: measures the space the panel gives the page, sizes the
 * frame (Fit, or the chosen zoom) and pushes the device to the native view
 * whenever any of it changes — and restores the tab when device mode ends.
 */
export function useDeviceFrame(emu: ReturnType<typeof useDeviceEmulation>) {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const [avail, setAvail] = useState({ width: 0, height: 0 });
  const { emulationOn, emuWidth, emuHeight, emuDpr, emuMobile, emuZoom, emuPreset, nativeAvailable, nativeTabId } = emu;

  useEffect(() => {
    const el = areaRef.current;
    if (!el || !emulationOn) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setAvail((prev) => (prev.width === Math.round(r.width) && prev.height === Math.round(r.height) ? prev : { width: Math.round(r.width), height: Math.round(r.height) }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [emulationOn]);

  const frame = emulationOn && avail.width > 0 ? deviceFrame({ width: emuWidth, height: emuHeight }, avail, emuZoom) : null;
  const scale = frame?.scale ?? 1;
  const measured = frame !== null;

  useEffect(() => {
    const nb = nativeBrowserBridge();
    if (!nativeAvailable || !nativeTabId || !nb) return;
    if (emulationOn && !measured) return; // not measured yet
    const params = emulationParams({ on: emulationOn, preset: emuPreset, width: emuWidth, height: emuHeight, dpr: emuDpr, mobile: emuMobile, zoom: emuZoom }, scale);
    void nb.setEmulation(nativeTabId, params).catch(() => undefined);
    void nb.setZoom(nativeTabId, 1).catch(() => undefined);
  }, [nativeAvailable, nativeTabId, emulationOn, emuPreset, emuWidth, emuHeight, emuDpr, emuMobile, emuZoom, scale, measured]);

  return { areaRef, frame };
}
