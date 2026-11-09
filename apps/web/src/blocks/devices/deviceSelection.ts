// ────────────────────────────────────────────────────────────────
// Select → chat (docs/devices DV-11): hit-testing the latest snapshot and the
// two composer attachments for a picked element. Pure, except the crop,
// which reads the live canvas.
// ────────────────────────────────────────────────────────────────

import type { DeviceElement, DeviceInfo, DeviceSnapshot } from '@generatorai/shared';

/** The element under a normalised point: the smallest containing one, interactive first. */
export function elementAt(snapshot: DeviceSnapshot, x: number, y: number): DeviceElement | undefined {
  let best: DeviceElement | undefined;
  let bestScore = Infinity;
  for (const el of snapshot.elements) {
    const f = el.frame;
    if (x < f.x || y < f.y || x > f.x + f.w || y > f.y + f.h) continue;
    const score = f.w * f.h * (el.interactive ? 1 : 4);
    if (score < bestScore) {
      best = el;
      bestScore = score;
    }
  }
  return best;
}

export function ancestorsOf(snapshot: DeviceSnapshot, el: DeviceElement): DeviceElement[] {
  const byRef = new Map(snapshot.elements.map((e) => [e.ref, e]));
  const out: DeviceElement[] = [];
  let cur = el.parent ? byRef.get(el.parent) : undefined;
  while (cur && out.length < 20) {
    out.unshift(cur);
    cur = cur.parent ? byRef.get(cur.parent) : undefined;
  }
  return out;
}

const describe = (e: DeviceElement): string => [e.role, e.label ? `"${e.label}"` : null, e.id ? `#${e.id}` : null].filter(Boolean).join(' ');

/** The picked element as JSON the agent can act on. */
export function elementSummary(device: DeviceInfo, snapshot: DeviceSnapshot, el: DeviceElement): Record<string, unknown> {
  const { width, height, unit } = snapshot.screen;
  return {
    kind: 'mobile-device-element',
    device: { name: device.name, platform: device.platform, os: device.osVersion ?? null, kind: device.kind },
    app: snapshot.app ?? null,
    screen: { width, height, unit },
    element: {
      role: el.role,
      label: el.label ?? null,
      value: el.value ?? null,
      id: el.id ?? null,
      type: el.type ?? null,
      enabled: el.enabled,
      bounds: el.frame,
      boundsNative: {
        x: Math.round(el.frame.x * width),
        y: Math.round(el.frame.y * height),
        width: Math.round(el.frame.w * width),
        height: Math.round(el.frame.h * height),
        unit,
      },
    },
    path: [...ancestorsOf(snapshot, el).map(describe), describe(el)].join(' › '),
    note: 'Picked on the live device in the Devices tab. Bounds are fractions of the screen; a PNG crop is attached alongside.',
  };
}

export function elementJsonFile(summary: Record<string, unknown>, now: number = Date.now()): File {
  return new File([JSON.stringify(summary, null, 2)], `device-element-${now}.json`, { type: 'application/json' });
}

/**
 * A PNG of the element with some context around it, cut from the live canvas
 * (what the user saw when they picked it). Null when nothing is painted.
 */
export async function elementCropFile(
  canvas: HTMLCanvasElement | null,
  el: DeviceElement,
  outline: string,
  now: number = Date.now(),
): Promise<File | null> {
  if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
  const pad = 0.04;
  const x = Math.max(0, (el.frame.x - pad) * canvas.width);
  const y = Math.max(0, (el.frame.y - pad) * canvas.height);
  const w = Math.min(canvas.width - x, (el.frame.w + pad * 2) * canvas.width);
  const h = Math.min(canvas.height - y, (el.frame.h + pad * 2) * canvas.height);
  if (w < 2 || h < 2) return null;
  const out = document.createElement('canvas');
  out.width = Math.round(w);
  out.height = Math.round(h);
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height);
  // The element's own outline, so the crop shows exactly what was picked.
  ctx.strokeStyle = outline;
  ctx.lineWidth = Math.max(2, Math.round(out.width / 200));
  ctx.strokeRect(el.frame.x * canvas.width - x, el.frame.y * canvas.height - y, el.frame.w * canvas.width, el.frame.h * canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
  return blob ? new File([blob], `device-element-${now}.png`, { type: 'image/png' }) : null;
}
