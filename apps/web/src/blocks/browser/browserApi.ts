// ────────────────────────────────────────────────────────────────
// Browser REST transport (03-component-inventory-domain.md §6.2).
//
// Every `/api/workspaces/:id/browser/*` call the browser panel makes, in one
// place. Plain `fetch` (same-origin, cookie auth) exactly as the panel always
// did; the hooks in this folder own the cadence and the React state.
// ────────────────────────────────────────────────────────────────

import type { BrowserInputEvent } from './browserInput.js';

export type BrowserMode = 'native' | 'screencast' | 'off';

/** The server's browser session descriptor. */
export interface BrowserDescriptor {
  status: string;
  mode: BrowserMode;
  ready: boolean;
  currentUrl?: string;
  targetId?: string;
  viewport?: { width: number; height: number };
  attachedToChat?: boolean;
  config?: { visibility?: string; evalAllowed?: boolean; enabled?: boolean };
}

/** Page scroll metrics of the screencast page (drives the overlay scrollbar). */
export interface BrowserScrollState {
  scrollY: number;
  scrollHeight: number;
  clientHeight: number;
}

/** A clip in page pixels. */
export interface BrowserClip {
  x: number;
  y: number;
  width: number;
  height: number;
}

const base = (workspaceId: string): string => `/api/workspaces/${workspaceId}/browser`;

/** Carries the HTTP status so a caller can tell a hiccup from a verdict. */
export class DescriptorError extends Error {
  constructor(readonly status: number) {
    super(`descriptor ${status}`);
    this.name = 'DescriptorError';
  }
}

/** 401/403 are settled answers: retrying cannot change them. */
export function isAuthDenial(err: unknown): boolean {
  return err instanceof DescriptorError && (err.status === 401 || err.status === 403);
}

export async function fetchBrowserDescriptor(workspaceId: string): Promise<BrowserDescriptor> {
  const res = await fetch(`${base(workspaceId)}/descriptor`);
  if (!res.ok) throw new DescriptorError(res.status);
  return (await res.json()) as BrowserDescriptor;
}

/** The server's error message (or its validation issues), else `fallback`. */
export async function extractApiError(res: Response, fallback: string): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string; issues?: Array<{ message?: string }> } };
    const issues = parsed.error?.issues;
    if (Array.isArray(issues) && issues.length > 0) {
      return issues.map((i) => i.message ?? '').filter(Boolean).join('; ') || fallback;
    }
    return parsed.error?.message?.trim() || fallback;
  } catch { return fallback; }
}

export async function startBrowser(workspaceId: string, url?: string): Promise<BrowserDescriptor> {
  const res = await fetch(`${base(workspaceId)}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, config: { enabled: true } }),
  });
  if (!res.ok) throw new Error(await extractApiError(res, `start failed (${res.status})`));
  return (await res.json()) as BrowserDescriptor;
}

export async function stopBrowser(workspaceId: string): Promise<void> {
  await fetch(`${base(workspaceId)}/stop`, { method: 'POST' });
}

export async function postBrowserAction(workspaceId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${base(workspaceId)}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await extractApiError(res, `action failed (${res.status})`));
  return (await res.json()) as Record<string, unknown>;
}

/** Share toggle: `attach` (share with the agent) or `detach`. */
export async function setBrowserShared(workspaceId: string, shared: boolean): Promise<{ attachedToChat?: boolean }> {
  const path = shared ? 'attach' : 'detach';
  const res = await fetch(`${base(workspaceId)}/${path}`, { method: 'POST' });
  if (!res.ok) throw new Error(`${path} failed (${res.status})`);
  return await res.json() as { attachedToChat?: boolean };
}

/** Viewport hint for the headless page. Fire-and-forget. */
export function postBrowserViewport(workspaceId: string, width: number, height: number): void {
  void fetch(`${base(workspaceId)}/resize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ width, height }), cache: 'no-store',
  }).catch(() => undefined);
}

/** Scroll metrics, or null on a non-OK answer. Network errors reject. */
export async function fetchBrowserScroll(workspaceId: string): Promise<BrowserScrollState | null> {
  const res = await fetch(`${base(workspaceId)}/scroll`, { cache: 'no-store' });
  if (!res.ok) return null;
  return await res.json() as BrowserScrollState;
}

/** Server-side crop of the live page, as a PNG blob. */
export async function captureBrowserRegion(workspaceId: string, clip: BrowserClip): Promise<Blob> {
  const res = await fetch(`${base(workspaceId)}/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clip }),
  });
  if (!res.ok) throw new Error(await extractApiError(res, `capture failed (${res.status})`));
  return await res.blob();
}

/** HTTP fallback for input while the screencast socket is not open. */
export async function postBrowserInput(workspaceId: string, event: BrowserInputEvent): Promise<void> {
  await fetch(`${base(workspaceId)}/input`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event), cache: 'no-store',
  });
}

/** One JPEG frame of the page — the degraded (HTTP polling) live view. */
export function fetchBrowserScreencastJpeg(workspaceId: string, cacheKey: number, signal: AbortSignal): Promise<Response> {
  return fetch(
    `${base(workspaceId)}/screencast.jpg?quality=45&k=${cacheKey}`,
    { signal, cache: 'no-store' },
  );
}

/**
 * The screencast socket endpoint (unauthenticated; the caller mints the
 * ticket). The Vite dev server on :5173 does not proxy WebSockets, so dev
 * talks to the API server on :3100 directly.
 */
export function browserStreamEndpoint(workspaceId: string): string {
  const isDev = window.location.port === '5173';
  const origin = isDev
    ? `${window.location.protocol}//${window.location.hostname}:3100`
    : window.location.origin;
  return `${origin}${base(workspaceId)}/stream`;
}
