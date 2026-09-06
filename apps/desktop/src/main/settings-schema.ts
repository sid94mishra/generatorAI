// ────────────────────────────────────────────────────────────────
// Value validation for the settings file and the `setSetting` IPC.
//
// The IPC used to check only that the KEY was on a whitelist; the value was
// written verbatim. A `harnessType` the types call legal but the server does
// not know, or a `serverPort` of `"abc"`, was persisted and then fed to the
// embedded server on every launch — which exited, every launch, until the
// user hand-edited settings.json. Values are now validated at both ends:
//
//   • `setSetting` rejects a bad value loudly (the renderer sees the error);
//   • `loadSettings` repairs a bad value to its default with a logged warning
//     rather than crashing the app or the server.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { DEFAULT_CONNECTION_STATE, sanitizeConnectionState } from './serverConnections';
import type { DesktopSettings } from './config';

export const HARNESS_TYPES = ['copilot', 'claude-agent', 'anthropic'] as const;

const port = z.number().int().min(0).max(65535);

const windowSchema = z.object({
  width: z.number().int().min(200).max(20_000),
  height: z.number().int().min(150).max(20_000),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  maximized: z.boolean().optional(),
});

/** One schema per user-settable key. `servers` is repaired separately. */
export const SETTING_SCHEMAS = {
  theme: z.enum(['light', 'dark', 'system']),
  serverPort: port,
  harnessType: z.enum(HARNESS_TYPES),
  minimizeToTray: z.boolean(),
  // An SPA route, never a full URL: `navigateTo` pushes it into history.
  lastRoute: z.string().max(300).regex(/^\/(?![/\\])/, 'must be an app route starting with /'),
  window: windowSchema,
} as const;

export type ValidatedSettingKey = keyof typeof SETTING_SCHEMAS;

/** Keys the renderer may read/write through the settings IPC. */
export const RENDERER_SETTING_KEYS = ['theme', 'serverPort', 'harnessType', 'minimizeToTray', 'lastRoute'] as const;
export type RendererSettingKey = (typeof RENDERER_SETTING_KEYS)[number];

export function isRendererSettingKey(key: unknown): key is RendererSettingKey {
  return typeof key === 'string' && (RENDERER_SETTING_KEYS as readonly string[]).includes(key);
}

export type SettingValidation<K extends ValidatedSettingKey> =
  | { ok: true; value: z.infer<(typeof SETTING_SCHEMAS)[K]> }
  | { ok: false; error: string };

export function validateSettingValue<K extends ValidatedSettingKey>(key: K, value: unknown): SettingValidation<K> {
  const result = SETTING_SCHEMAS[key].safeParse(value);
  if (result.success) return { ok: true, value: result.data as z.infer<(typeof SETTING_SCHEMAS)[K]> };
  const issue = result.error.issues[0];
  return { ok: false, error: `${key}: ${issue?.message ?? 'invalid value'}` };
}

export interface SanitizeReport {
  repaired: { key: string; error: string }[];
}

/**
 * Builds a full `DesktopSettings` from whatever was on disk. Each key is
 * validated on its own so one bad value costs one default, not the file.
 */
export function sanitizeSettings(
  parsed: unknown,
  defaults: DesktopSettings,
  report: SanitizeReport = { repaired: [] },
): DesktopSettings {
  const input = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const out: DesktopSettings = {
    ...defaults,
    window: { ...defaults.window },
    servers: { ...DEFAULT_CONNECTION_STATE },
  };

  for (const key of ['theme', 'serverPort', 'harnessType', 'minimizeToTray'] as const) {
    if (!(key in input)) continue;
    const v = validateSettingValue(key, input[key]);
    if (v.ok) (out as unknown as Record<string, unknown>)[key] = v.value;
    else report.repaired.push({ key, error: v.error });
  }

  if ('lastRoute' in input && input['lastRoute'] !== undefined) {
    const v = validateSettingValue('lastRoute', input['lastRoute']);
    if (v.ok) out.lastRoute = v.value;
    else report.repaired.push({ key: 'lastRoute', error: v.error });
  }

  if ('window' in input) {
    const merged = { ...defaults.window, ...(input['window'] as object) };
    const v = validateSettingValue('window', merged);
    if (v.ok) out.window = v.value;
    else report.repaired.push({ key: 'window', error: v.error });
  }

  // Repaired on every read: a half-written file must not be able to point
  // the window at a server with no way back.
  out.servers = sanitizeConnectionState(input['servers']);
  return out;
}
