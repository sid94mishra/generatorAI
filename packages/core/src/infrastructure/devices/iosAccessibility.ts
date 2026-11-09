// ────────────────────────────────────────────────────────────────
// The simulator helper's `/ax` JSON (an axe-shaped tree, frames in points)
// → raw device elements. Pure.
// ────────────────────────────────────────────────────────────────

import type { RawDeviceElement, RawDeviceSnapshot } from '../../domain/ports/IDeviceBridge.js';

interface AxNode {
  type?: string | null;
  role?: string | null;
  role_description?: string | null;
  AXLabel?: string | null;
  AXValue?: string | null;
  AXUniqueId?: string | null;
  enabled?: boolean | null;
  frame?: { x?: number; y?: number; width?: number; height?: number } | null;
  children?: AxNode[] | null;
}

const INTERACTIVE_TYPES = new Set([
  'Button',
  'Cell',
  'CheckBox',
  'Link',
  'Key',
  'MenuItem',
  'PopUpButton',
  'RadioButton',
  'SearchField',
  'SecureTextField',
  'SegmentedControl',
  'Slider',
  'Stepper',
  'Switch',
  'Tab',
  'TextField',
  'TextView',
  'Toggle',
  'DatePicker',
  'Picker',
  'PickerWheel',
]);

/** iOS AX type → the shared role vocabulary (the Android parser uses the same names). */
function roleFor(type: string): string {
  if (type === 'SearchField') return 'TextField';
  if (type === 'TextView') return 'TextField';
  if (type === 'Toggle') return 'Switch';
  if (type === 'GenericElement' || type === 'Other') return 'Group';
  return type || 'Group';
}

/**
 * Flattens the tree. The screen size comes from the first application node
 * with a real frame; the simulator reports `0×0` for an app still launching,
 * in which case `fallback` (points) is used.
 */
export function parseIosAccessibility(json: string, fallback?: { width: number; height: number }): RawDeviceSnapshot {
  let roots: AxNode[];
  try {
    const parsed = JSON.parse(json) as unknown;
    roots = Array.isArray(parsed) ? (parsed as AxNode[]) : [parsed as AxNode];
  } catch {
    return { screen: { width: fallback?.width ?? 0, height: fallback?.height ?? 0, unit: 'pt' }, elements: [] };
  }
  const app = roots.find((r) => (r.type ?? '') === 'Application' && (r.frame?.width ?? 0) > 0);
  const width = app?.frame?.width ?? fallback?.width ?? 0;
  const height = app?.frame?.height ?? fallback?.height ?? 0;
  const elements: RawDeviceElement[] = [];
  const walk = (node: AxNode, depth: number): void => {
    const type = node.type ?? '';
    const f = node.frame;
    const w = f?.width ?? 0;
    const h = f?.height ?? 0;
    if (type !== 'Application' && w > 0 && h > 0 && width > 0 && height > 0) {
      const label = node.AXLabel?.trim() || undefined;
      const value = node.AXValue?.trim() || undefined;
      elements.push({
        role: roleFor(type),
        type: type || undefined,
        ...(label ? { label } : {}),
        ...(value && value !== label ? { value } : {}),
        ...(node.AXUniqueId ? { id: node.AXUniqueId } : {}),
        enabled: node.enabled !== false,
        interactive: INTERACTIVE_TYPES.has(type),
        frame: { x: (f?.x ?? 0) / width, y: (f?.y ?? 0) / height, w: w / width, h: h / height },
        depth,
      });
    }
    for (const child of node.children ?? []) walk(child, type === 'Application' ? depth : depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return { screen: { width, height, unit: 'pt' }, elements };
}
