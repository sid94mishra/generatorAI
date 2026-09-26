// ────────────────────────────────────────────────────────────────
// DeviceEmulationBar (F-dock-04) — the native desktop responsive toolbar:
// device preset menu, width × height, rotate, DPR, Mobile and page zoom.
// A thin view over useDeviceEmulation; "Responsive" disables the size fields.
// ────────────────────────────────────────────────────────────────

import { DEVICE_PRESETS, ZOOM_LEVELS, findDevicePreset } from './deviceEmulation.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Checkbox } from '@/ui/primitives/Checkbox/Checkbox.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import {
  MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRoot, MenuSeparator, MenuTrigger,
} from '@/ui/primitives/Menu/Menu.js';

const DPR_LEVELS = [1, 1.5, 2, 3] as const;

export interface DeviceEmulationBarProps {
  preset: string;
  width: number;
  height: number;
  dpr: number;
  mobile: boolean;
  zoom: number;
  onPickPreset: (id: string) => void;
  onDimChange: (width: number, height: number) => void;
  onRotate: () => void;
  onDpr: (dpr: number) => void;
  onMobile: (mobile: boolean) => void;
  onZoom: (zoom: number) => void;
}

const zoomLabel = (z: number): string => `${Math.round(z * 100)}%`;
const dimension = (raw: string): number => Math.max(100, Number(raw) || 0);

export function DeviceEmulationBar({
  preset, width, height, dpr, mobile, zoom,
  onPickPreset, onDimChange, onRotate, onDpr, onMobile, onZoom,
}: DeviceEmulationBarProps): React.JSX.Element {
  const responsive = preset === 'responsive';
  const presetName = preset === 'custom' ? 'Custom' : (findDevicePreset(preset).label.split(' — ')[0] ?? '');

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-2 py-1.5 text-small text-fg">
      <MenuRoot>
        <MenuTrigger
          render={
            <Button variant="secondary" size="sm" icon="device" trailingIcon="chevron-down" title="Device preset" aria-label="Device preset">
              {presetName}
            </Button>
          }
        />
        <MenuPopup>
          <MenuRadioGroup value={preset} onValueChange={(v: string) => onPickPreset(v)}>
            {DEVICE_PRESETS.map((p) => (
              <MenuRadioItem closeOnClick key={p.id} value={p.id}>{p.label}</MenuRadioItem>
            ))}
            {preset === 'custom' && <MenuRadioItem closeOnClick value="custom">Custom</MenuRadioItem>}
          </MenuRadioGroup>
          {preset !== 'custom' && (
            <>
              <MenuSeparator />
              <MenuItem disabled>Custom — edit width or height</MenuItem>
            </>
          )}
        </MenuPopup>
      </MenuRoot>

      <div className="flex items-center gap-1">
        <Input
          size="sm"
          mono
          type="number"
          min={100}
          max={4096}
          value={width}
          onChange={(e) => onDimChange(dimension(e.target.value), height)}
          disabled={responsive}
          className="w-20"
          title="Width (px)"
          aria-label="Width (px)"
        />
        <span className="text-fg-3">×</span>
        <Input
          size="sm"
          mono
          type="number"
          min={100}
          max={4096}
          value={height}
          onChange={(e) => onDimChange(width, dimension(e.target.value))}
          disabled={responsive}
          className="w-20"
          title="Height (px)"
          aria-label="Height (px)"
        />
        <IconButton size="sm" icon="undo" label="Rotate viewport" tooltip="Rotate (swap width/height)" onClick={onRotate} disabled={responsive} />
      </div>

      <MenuRoot>
        <MenuTrigger
          disabled={responsive}
          render={
            <Button variant="ghost" size="sm" trailingIcon="chevron-down" title="Device pixel ratio" aria-label="Device pixel ratio">
              {dpr}×
            </Button>
          }
        />
        <MenuPopup>
          <MenuRadioGroup value={String(dpr)} onValueChange={(v: string) => onDpr(Number(v))}>
            {DPR_LEVELS.map((d) => (
              <MenuRadioItem closeOnClick key={d} value={String(d)}>{d}×</MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuPopup>
      </MenuRoot>

      <Checkbox
        size="sm"
        label="Mobile"
        checked={mobile}
        disabled={responsive}
        onCheckedChange={onMobile}
        title="Emulate touch / mobile user-agent metrics"
      />

      <MenuRoot>
        <MenuTrigger
          render={
            <Button variant="ghost" size="sm" trailingIcon="chevron-down" title="Page zoom" aria-label="Page zoom">
              {zoomLabel(zoom)}
            </Button>
          }
        />
        <MenuPopup>
          <MenuRadioGroup value={String(zoom)} onValueChange={(v: string) => onZoom(Number(v))}>
            {ZOOM_LEVELS.map((z) => (
              <MenuRadioItem closeOnClick key={z} value={String(z)}>{zoomLabel(z)}</MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuPopup>
      </MenuRoot>
    </div>
  );
}
