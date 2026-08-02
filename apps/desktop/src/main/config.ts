// ────────────────────────────────────────────────────────────────
// Desktop settings store — a tiny JSON file in userData. Persists window
// state, theme preference, harness selection and an optional fixed server
// port. Intentionally dependency-free (no electron-store) to keep the bundle
// small and the format trivially inspectable.
// ────────────────────────────────────────────────────────────────

import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ThemePreference } from '../shared/ipc';
import { log } from './logger';

export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
}

export interface DesktopSettings {
  theme: ThemePreference;
  window: WindowState;
  /** Fixed server port. 0 (default) means "pick a free port each launch". */
  serverPort: number;
  /** Harness provider passed to the embedded server (HARNESS_TYPE). */
  harnessType: 'copilot' | 'claude-agent' | 'anthropic';
  /** Minimise to tray instead of quitting on window close. */
  minimizeToTray: boolean;
  /** Open the most recent route on launch. */
  lastRoute?: string;
}

const DEFAULTS: DesktopSettings = {
  theme: 'system',
  window: { width: 1440, height: 900 },
  serverPort: 0,
  harnessType: 'copilot',
  minimizeToTray: false,
};

let cache: DesktopSettings | null = null;

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): DesktopSettings {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<DesktopSettings>;
    cache = {
      ...DEFAULTS,
      ...parsed,
      window: { ...DEFAULTS.window, ...(parsed.window ?? {}) },
    };
  } catch {
    cache = { ...DEFAULTS, window: { ...DEFAULTS.window } };
  }
  return cache;
}

export function saveSettings(patch: Partial<DesktopSettings>): DesktopSettings {
  const current = loadSettings();
  cache = { ...current, ...patch, window: { ...current.window, ...(patch.window ?? {}) } };
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    log.warn('Failed to persist settings', err);
  }
  return cache;
}

export function getSetting<K extends keyof DesktopSettings>(key: K): DesktopSettings[K] {
  return loadSettings()[key];
}

export function setSetting<K extends keyof DesktopSettings>(
  key: K,
  value: DesktopSettings[K],
): void {
  saveSettings({ [key]: value } as Partial<DesktopSettings>);
}
