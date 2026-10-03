// Settings › Security › Pair a new device (MSetPairDevice, MDF-113, MD-35): the invite request (`POST /auth/pair`),
// its response, the countdown, which shared presets (MG-23) this device may hand out (the server refuses anything
// beyond the caller's own grant) and what a paired device's scope set is called. Pure.
import { SCOPE_PRESETS, type ScopePreset, type ScopePresetId } from '@generatorai/shared/ui-contract';

export const PAIRING_TTL_MS = 10 * 60_000;

/** The joining device names itself when it pairs; the invite carries only a neutral hint. */
export function inviteBody(preset: ScopePreset): { deviceName: string; platform: string; scopes: string[]; ttlMs: number } {
  return { deviceName: preset.platform === 'mobile' ? 'New phone or tablet' : preset.platform === 'cli' ? 'New command line' : 'New device', platform: preset.platform, scopes: [...preset.scopes], ttlMs: PAIRING_TTL_MS };
}

export interface PairingInvite {
  grantId: string;
  expiresAt: number;
  requestedScopes: string[];
  /** 12 characters, grouped `XXXX-XXXX-XXXX` by the server. */
  shortCode: string;
  joinUrl: string;
  pairingUrl: string;
}

export function parsePairingInvite(body: unknown): PairingInvite | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const str = (key: string): string | null => (typeof b[key] === 'string' && b[key] ? (b[key] as string) : null);
  const grantId = str('grantId');
  const shortCode = str('shortCode');
  const pairingUrl = str('pairingUrl');
  const expiresAt = typeof b['expiresAt'] === 'number' ? b['expiresAt'] : Number.NaN;
  if (!grantId || !shortCode || !pairingUrl || !Number.isFinite(expiresAt)) return null;
  return {
    grantId,
    expiresAt,
    requestedScopes: Array.isArray(b['requestedScopes']) ? b['requestedScopes'].filter((s): s is string => typeof s === 'string') : [],
    shortCode,
    joinUrl: str('joinUrl') ?? '',
    pairingUrl,
  };
}

export function secondsRemaining(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

/** "4:05". */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A preset this device may hand out: every scope in it is one the caller holds. */
export function presetWithinAuthority(preset: ScopePreset, callerScopes: readonly string[]): boolean {
  return preset.scopes.every((s) => callerScopes.includes(s));
}

export function presetById(id: ScopePresetId): ScopePreset {
  return SCOPE_PRESETS.find((p) => p.id === id) ?? SCOPE_PRESETS[0]!;
}

/** The preset a device's scopes equal, else "Custom". */
export function presetName(scopes: readonly string[]): string {
  const set = new Set(scopes);
  const match = SCOPE_PRESETS.find((p) => p.scopes.length === set.size && p.scopes.every((s) => set.has(s)));
  return match?.label ?? 'Custom';
}
