// The toast store (03 MP-30; MD-26, MD-58): one toast at a time; a newer one replaces the older (whose undo commit
// still runs); undo defers the destructive commit until the toast expires, is dismissed or is replaced.
import { useSyncExternalStore } from 'react';
import type { ToastHandle, ToastKind, ToastOptions } from './Toast.types';

export const TOAST_DURATION: Record<ToastKind, number> = { error: 6000, background: 4000, undo: 5000 };

export interface ToastEntry {
  id: number;
  options: ToastOptions;
}

type Reason = 'expired' | 'dismissed' | 'replaced' | 'undone' | 'action';

let current: ToastEntry | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((l) => l());

function settle(entry: ToastEntry, reason: Reason): void {
  const undo = entry.options.undo;
  if (entry.options.kind !== 'undo' || !undo) return;
  if (reason === 'undone') undo.onUndo();
  else void undo.commit?.().catch(() => undefined);
}

export function toast(options: ToastOptions): ToastHandle {
  if (options.kind === 'undo' && !options.undo) throw new Error("toast(): kind 'undo' needs `undo`.");
  const entry = { id: nextId++, options };
  const previous = current;
  current = entry;
  notify();
  if (previous) settle(previous, 'replaced');
  return { dismiss: () => closeToast(entry.id, 'dismissed') };
}

export function closeToast(id: number, reason: Reason = 'dismissed'): void {
  if (!current || current.id !== id) return;
  const entry = current;
  current = null;
  notify();
  settle(entry, reason);
}

/** The toast's action button: "Undo" restores; any other action runs, then the toast goes. */
export function pressToastAction(id: number): void {
  if (!current || current.id !== id) return;
  const { options } = current;
  if (options.kind === 'undo') closeToast(id, 'undone');
  else {
    options.action?.onPress();
    closeToast(id, 'action');
  }
}

export function toastActionLabel(options: ToastOptions): string | undefined {
  return options.kind === 'undo' ? 'Undo' : options.action?.label;
}

export function toastDuration(options: ToastOptions): number {
  return options.durationMs ?? TOAST_DURATION[options.kind];
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useCurrentToast(): ToastEntry | null {
  return useSyncExternalStore(subscribe, () => current);
}

/** Tests only. */
export function resetToasts(): void {
  current = null;
  notify();
}

// ── Hosts ──────────────────────────────────────────────────────
// The shell mounts a ToastHost; full-screen editors and route sheets mount their own, because on iOS a native modal
// screen covers the shell's (an editor's error toast was invisible). Only the most recently mounted host renders.
let hosts: number[] = [];
let nextHost = 1;
const hostListeners = new Set<() => void>();
const notifyHosts = (): void => hostListeners.forEach((l) => l());

export function nextToastHostId(): number {
  return nextHost++;
}

/** Adds the host; returns its release. */
export function registerToastHost(id: number): () => void {
  hosts = [...hosts, id];
  notifyHosts();
  return () => {
    hosts = hosts.filter((h) => h !== id);
    notifyHosts();
  };
}

export function subscribeToastHosts(listener: () => void): () => void {
  hostListeners.add(listener);
  return () => hostListeners.delete(listener);
}

export function topToastHost(): number | null {
  return hosts.at(-1) ?? null;
}
