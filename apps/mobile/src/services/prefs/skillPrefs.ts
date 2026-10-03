// Skills switched off on this device (MD-30, MDF-109): Settings › Skills writes the list, the composer's slash menu
// stops offering them. Per device, like the web's per-browser catalog prefs; the server's skills are unchanged.
import { useSyncExternalStore } from 'react';

import { PREF_KEYS, prefs } from '../storage/prefs';

const listeners = new Set<() => void>();
let cache: string[] | null = null;

export function readDisabledSkills(): string[] {
  if (cache) return cache;
  try {
    const raw = prefs.getString(PREF_KEYS.disabledSkills);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    cache = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    cache = [];
  }
  return cache;
}

export function setSkillEnabled(id: string, enabled: boolean): void {
  const current = readDisabledSkills();
  const next = enabled ? current.filter((s) => s !== id) : current.includes(id) ? current : [...current, id];
  prefs.setString(PREF_KEYS.disabledSkills, JSON.stringify(next));
  cache = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const EMPTY: string[] = [];

export function useDisabledSkills(): string[] {
  return useSyncExternalStore(subscribe, readDisabledSkills, () => EMPTY);
}
