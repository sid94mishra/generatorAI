// Settings › Diagnostics › Crash reports (MD-42, M10-06; MD-197): the per-device opt-in and DSN, persisted in MMKV and
// applied to the reporter on every change. Read once at startup by app/_layout.tsx, before the first screen.
import { useSyncExternalStore } from 'react';

import { PREF_KEYS, prefs } from '../storage/prefs';
import { applyCrashReporting, type CrashReportingSettings } from './crashReporting';

const listeners = new Set<() => void>();
let current: CrashReportingSettings | null = null;

export function readCrashSettings(): CrashReportingSettings {
  current ??= { enabled: prefs.getBoolean(PREF_KEYS.crashReports, false), dsn: prefs.getString(PREF_KEYS.crashDsn) ?? '' };
  return current;
}

export function setCrashSettings(next: Partial<CrashReportingSettings>): void {
  const merged = { ...readCrashSettings(), ...next };
  current = merged;
  prefs.setBoolean(PREF_KEYS.crashReports, merged.enabled);
  prefs.setString(PREF_KEYS.crashDsn, merged.dsn.trim());
  applyCrashReporting(merged);
  listeners.forEach((listener) => listener());
}

/** Startup: off unless the user turned it on with a DSN. */
export function startCrashReporting(): void {
  applyCrashReporting(readCrashSettings());
}

export function useCrashSettings(): CrashReportingSettings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readCrashSettings,
  );
}
