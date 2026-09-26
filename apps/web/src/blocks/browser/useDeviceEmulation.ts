// ────────────────────────────────────────────────────────────────
// Device emulation state (native desktop responsive toolbar): preset,
// dimensions, rotate, DPR, mobile, zoom — each change is pushed to the
// native view at once.
// ────────────────────────────────────────────────────────────────

import { useCallback, useState } from 'react';

import { emulationParams, emulationZoom, findDevicePreset, type EmulationSettings } from './deviceEmulation.js';
import { nativeBrowserBridge } from './nativeBrowserBridge.js';

export function useDeviceEmulation({ nativeAvailable, nativeTabId }: { nativeAvailable: boolean; nativeTabId: string | null }) {
  const [emulationOn, setEmulationOn] = useState(false);
  const [emuPreset, setEmuPreset] = useState<string>('responsive');
  const [emuWidth, setEmuWidth] = useState<number>(390);
  const [emuHeight, setEmuHeight] = useState<number>(844);
  const [emuDpr, setEmuDpr] = useState<number>(1);
  const [emuMobile, setEmuMobile] = useState<boolean>(false);
  const [emuZoom, setEmuZoom] = useState<number>(1);

  const applyEmulation = useCallback((opts: EmulationSettings) => {
    const nb = nativeBrowserBridge();
    if (!nativeAvailable || !nativeTabId || !nb) return;
    void nb.setEmulation(nativeTabId, emulationParams(opts)).catch(() => undefined);
    void nb.setZoom(nativeTabId, emulationZoom(opts)).catch(() => undefined);
  }, [nativeAvailable, nativeTabId]);

  const handleToggleEmulation = useCallback(() => {
    setEmulationOn((prev) => {
      const next = !prev;
      applyEmulation({ on: next, preset: emuPreset, width: emuWidth, height: emuHeight, dpr: emuDpr, mobile: emuMobile, zoom: emuZoom });
      return next;
    });
  }, [applyEmulation, emuPreset, emuWidth, emuHeight, emuDpr, emuMobile, emuZoom]);

  const handlePickPreset = useCallback((id: string) => {
    const preset = findDevicePreset(id);
    setEmuPreset(id);
    if (preset.width > 0) { setEmuWidth(preset.width); setEmuHeight(preset.height); }
    setEmuMobile(preset.mobile);
    applyEmulation({ on: true, preset: id, width: preset.width || emuWidth, height: preset.height || emuHeight, dpr: emuDpr, mobile: preset.mobile, zoom: emuZoom });
  }, [applyEmulation, emuWidth, emuHeight, emuDpr, emuZoom]);

  const handleEmuDimChange = useCallback((w: number, h: number) => {
    setEmuWidth(w); setEmuHeight(h); setEmuPreset('custom');
    applyEmulation({ on: true, preset: 'custom', width: w, height: h, dpr: emuDpr, mobile: emuMobile, zoom: emuZoom });
  }, [applyEmulation, emuDpr, emuMobile, emuZoom]);

  const handleEmuRotate = useCallback(() => {
    const w = emuHeight, h = emuWidth;
    setEmuWidth(w); setEmuHeight(h);
    applyEmulation({ on: true, preset: emuPreset, width: w, height: h, dpr: emuDpr, mobile: emuMobile, zoom: emuZoom });
  }, [applyEmulation, emuWidth, emuHeight, emuPreset, emuDpr, emuMobile, emuZoom]);

  const handleEmuZoom = useCallback((z: number) => {
    setEmuZoom(z);
    applyEmulation({ on: true, preset: emuPreset, width: emuWidth, height: emuHeight, dpr: emuDpr, mobile: emuMobile, zoom: z });
  }, [applyEmulation, emuPreset, emuWidth, emuHeight, emuDpr, emuMobile]);

  const handleEmuDpr = useCallback((dpr: number) => {
    setEmuDpr(dpr);
    applyEmulation({ on: true, preset: emuPreset, width: emuWidth, height: emuHeight, dpr, mobile: emuMobile, zoom: emuZoom });
  }, [applyEmulation, emuPreset, emuWidth, emuHeight, emuMobile, emuZoom]);

  const handleEmuMobile = useCallback((mobile: boolean) => {
    setEmuMobile(mobile);
    applyEmulation({ on: true, preset: emuPreset, width: emuWidth, height: emuHeight, dpr: emuDpr, mobile, zoom: emuZoom });
  }, [applyEmulation, emuPreset, emuWidth, emuHeight, emuDpr, emuZoom]);

  return {
    emulationOn, emuPreset, emuWidth, emuHeight, emuDpr, emuMobile, emuZoom,
    handleToggleEmulation, handlePickPreset, handleEmuDimChange, handleEmuRotate, handleEmuZoom, handleEmuDpr, handleEmuMobile,
  };
}
