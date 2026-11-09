// ────────────────────────────────────────────────────────────────
// Element refs, the agent-facing text form, diffs and hit-testing for device
// snapshots (docs/devices DV-7, DV-11). Pure.
// ────────────────────────────────────────────────────────────────

import type { DeviceElement, DevicePlatform, DeviceSnapshot } from '@generatorai/shared';
import type { RawDeviceSnapshot } from '../../domain/ports/IDeviceBridge.js';

/** Builds the snapshot: keeps meaningful elements and numbers them e1…eN in reading order. */
export function buildSnapshot(
  device: string,
  platform: DevicePlatform,
  raw: RawDeviceSnapshot,
  options: { all?: boolean } = {},
): DeviceSnapshot {
  const elements: DeviceElement[] = [];
  const stack: { depth: number; ref: string }[] = [];
  for (const el of raw.elements) {
    const meaningful = options.all || el.interactive || !!el.label || !!el.value;
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= el.depth) stack.pop();
    if (!meaningful) continue;
    // A container that only repeats its single child's label adds nothing.
    const ref = `e${elements.length + 1}`;
    const parent = stack[stack.length - 1]?.ref;
    elements.push({
      ref,
      role: el.role,
      ...(el.label ? { label: el.label } : {}),
      ...(el.value ? { value: el.value } : {}),
      ...(el.id ? { id: el.id } : {}),
      ...(el.type ? { type: el.type } : {}),
      enabled: el.enabled,
      interactive: el.interactive,
      frame: round(el.frame),
      ...(parent ? { parent } : {}),
    });
    stack.push({ depth: el.depth, ref });
  }
  return {
    device,
    platform,
    ...(raw.app ? { app: raw.app } : {}),
    screen: raw.screen,
    elements,
    capturedAt: Date.now(),
  };
}

function round(f: { x: number; y: number; w: number; h: number }) {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { x: r(f.x), y: r(f.y), w: r(f.w), h: r(f.h) };
}

function quote(s: string, max = 80): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return JSON.stringify(one.length > max ? `${one.slice(0, max - 1)}…` : one);
}

/** One line per element: `e4 Button "Sign in" id=login @0.50,0.83`. */
export function elementLine(el: DeviceElement): string {
  const parts = [el.ref, el.role];
  if (el.label) parts.push(quote(el.label));
  if (el.value !== undefined) parts.push(`value=${quote(el.value, 60)}`);
  if (el.id) parts.push(`id=${el.id.replace(/^[\w.]+:id\//, '')}`);
  if (!el.enabled) parts.push('disabled');
  const cx = el.frame.x + el.frame.w / 2;
  const cy = el.frame.y + el.frame.h / 2;
  parts.push(`@${cx.toFixed(2)},${cy.toFixed(2)}`);
  return parts.join(' ');
}

/** What the agent reads for a screen without elements, and what to do about it. */
const EMPTY_SCREEN =
  'no elements yet: the screen is still loading or changing (or the app exposes none). Wait a moment (act wait with text) and snapshot again; device_screenshot shows what is on screen.';

/** The agent's text form, capped so a long list cannot flood the context. */
export function formatSnapshot(snapshot: DeviceSnapshot, maxLines = 250): string {
  if (snapshot.elements.length === 0) return `App: ${snapshot.app ?? 'unknown'} · ${EMPTY_SCREEN}`;
  const head = `App: ${snapshot.app ?? 'unknown'} · screen ${snapshot.screen.width}×${snapshot.screen.height} ${snapshot.screen.unit} · ${snapshot.elements.length} elements (refs valid until the next snapshot)`;
  const depthOf = new Map<string, number>();
  const lines = snapshot.elements.slice(0, maxLines).map((el) => {
    const depth = el.parent ? (depthOf.get(el.parent) ?? 0) + 1 : 0;
    depthOf.set(el.ref, depth);
    return `${'  '.repeat(Math.min(depth, 6))}${elementLine(el)}`;
  });
  if (snapshot.elements.length > maxLines) lines.push(`… ${snapshot.elements.length - maxLines} more (pass all:false or scroll)`);
  return [head, ...lines].join('\n');
}

function identity(el: DeviceElement): string {
  return `${el.role}|${el.id ?? ''}|${el.label ?? ''}`;
}

/** What changed between two snapshots of one device: the act tool's feedback. */
export function diffSnapshots(before: DeviceSnapshot | undefined, after: DeviceSnapshot, maxLines = 40): string {
  if (!before) return formatSnapshot(after, maxLines);
  if (after.elements.length === 0) {
    const app = before.app !== after.app ? `app: ${before.app ?? '?'} → ${after.app ?? '?'}\n` : '';
    return `${app}${before.elements.length} element(s) gone; ${EMPTY_SCREEN}`;
  }
  const lines: string[] = [];
  if (before.app !== after.app) lines.push(`app: ${before.app ?? '?'} → ${after.app ?? '?'}`);
  const prev = new Map<string, DeviceElement[]>();
  for (const el of before.elements) prev.set(identity(el), [...(prev.get(identity(el)) ?? []), el]);
  let unchanged = 0;
  for (const el of after.elements) {
    const bucket = prev.get(identity(el));
    const match = bucket?.shift();
    if (!match) lines.push(`+ ${elementLine(el)}`);
    else if (match.value !== el.value || match.enabled !== el.enabled) lines.push(`~ ${elementLine(el)} (was ${match.value !== el.value ? `value=${JSON.stringify(match.value ?? '')}` : match.enabled ? 'enabled' : 'disabled'})`);
    else unchanged += 1;
  }
  let removed = 0;
  for (const bucket of prev.values()) removed += bucket.length;
  if (removed > 0) lines.push(`- ${removed} element(s) gone`);
  if (lines.length === 0) return `No visible change (${unchanged} elements unchanged). Refs refreshed: e1…e${after.elements.length}.`;
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) shown.push(`… ${lines.length - maxLines} more changes; call device_snapshot for the full screen`);
  return [`Refs refreshed: e1…e${after.elements.length}. ${unchanged} unchanged.`, ...shown].join('\n');
}

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

/** Ancestors of an element, outermost first. */
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

/** Finds an element by ref, else by exact (then partial) label/value/id. */
export function findElement(snapshot: DeviceSnapshot, target: string): DeviceElement | undefined {
  const t = target.trim();
  const byRef = snapshot.elements.find((e) => e.ref === t);
  if (byRef) return byRef;
  const lower = t.toLowerCase();
  const exact = snapshot.elements.filter((e) => [e.label, e.value, e.id].some((v) => v?.toLowerCase() === lower));
  if (exact.length > 0) return exact.find((e) => e.interactive) ?? exact[0];
  const partial = snapshot.elements.filter((e) => [e.label, e.value].some((v) => v?.toLowerCase().includes(lower)));
  return partial.find((e) => e.interactive) ?? partial[0];
}
