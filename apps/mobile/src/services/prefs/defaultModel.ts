// The default chat model is per device on mobile (MD-30; desktop keeps it per browser): Settings › General picks
// it, New chat pre-selects it for "Just a model" chats. Stored per server (MMKV `srv.<serverId>.defaultModel`,
// 06 §6.7), because model ids belong to one server's providers.
import { useSyncExternalStore } from 'react';

import { prefs } from '../storage/prefs';

export interface DefaultModel {
  provider: string;
  model: string;
}

const key = (serverId: string): string => `srv.${serverId}.defaultModel`;
const listeners = new Set<() => void>();
const cache = new Map<string, DefaultModel | null>();

export function readDefaultModel(serverId: string | null): DefaultModel | null {
  if (!serverId) return null;
  if (cache.has(serverId)) return cache.get(serverId) ?? null;
  let value: DefaultModel | null = null;
  try {
    const raw = prefs.getString(key(serverId));
    const parsed = raw ? (JSON.parse(raw) as Partial<DefaultModel>) : null;
    value = parsed && typeof parsed.provider === 'string' && typeof parsed.model === 'string' ? { provider: parsed.provider, model: parsed.model } : null;
  } catch {
    value = null;
  }
  cache.set(serverId, value);
  return value;
}

/** `null` clears it (New chat then uses the server default). */
export function writeDefaultModel(serverId: string, value: DefaultModel | null): void {
  if (value) prefs.setString(key(serverId), JSON.stringify(value));
  else prefs.delete(key(serverId));
  cache.set(serverId, value);
  for (const l of listeners) l();
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useDefaultModel(serverId: string | null): DefaultModel | null {
  return useSyncExternalStore(subscribe, () => readDefaultModel(serverId), () => null);
}
