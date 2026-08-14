// ────────────────────────────────────────────────────────────────
// Computer Use enablement — "may the agent drive my desktop?"
//
// Modelled on `network/exposure.ts`: a persisted setting the app can flip from
// Settings, with the environment kept as an operator override.
//
// It defaults to OFF and stays off until the user says otherwise. Desktop
// automation is the highest-consequence capability in the product — it can
// click anything the user can click — so it is the one feature that must never
// be on because nobody looked at it.
//
// `GENERATORAI_COMPUTER_USE` set to a disable token remains a hard kill switch
// inside `ComputerService` and beats everything written here.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';

const STATE_FILE = 'computer-use.json';

export interface ComputerUsePreferences {
  enabled: boolean;
  /**
   * Synthetic OS input — keystrokes, hotkeys, scroll, drag, coordinate clicks.
   * Separate from `enabled` because it is the only tier that can take the
   * user's screen: reading windows and clicking controls go through the
   * accessibility layer and never touch focus.
   */
  allowSynthetic: boolean;
}

function stateFilePath(dataDir: string): string {
  return path.join(dataDir, STATE_FILE);
}

/**
 * Reads the persisted preferences. `fallback` (normally the env defaults)
 * applies only when nothing has been written yet, so an explicit "off" from the
 * UI is never re-enabled by a stale env var.
 *
 * Any unreadable or malformed state resolves to disabled rather than throwing:
 * a corrupt settings file must not be able to hand out desktop control.
 */
export function readComputerUsePreferences(
  dataDir: string,
  fallback: ComputerUsePreferences = { enabled: false, allowSynthetic: false },
): ComputerUsePreferences {
  try {
    const raw = fs.readFileSync(stateFilePath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ComputerUsePreferences> | null;
    return {
      enabled: typeof parsed?.enabled === 'boolean' ? parsed.enabled : false,
      allowSynthetic: typeof parsed?.allowSynthetic === 'boolean' ? parsed.allowSynthetic : false,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    return { enabled: false, allowSynthetic: false };
  }
}

/** Persists the preferences. Applies live — no restart needed. */
export function writeComputerUsePreferences(dataDir: string, prefs: ComputerUsePreferences): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    stateFilePath(dataDir),
    `${JSON.stringify({ ...prefs, updatedAt: Date.now() }, null, 2)}\n`,
    { mode: 0o600 },
  );
}
