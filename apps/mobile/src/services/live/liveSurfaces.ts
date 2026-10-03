// Live surfaces — the mobile half of the live-state model (MG-07 / MX-11, 06 §7.3, MD-90, MD-182). Pure: which
// followed items get a system surface under the per-device choices of Settings › Widgets & Live Activities, the
// follow set's MMKV shape, and how a finished run's status becomes its outcome. The store and the sync component
// wrap these.
import {
  FOLLOW_TTL_MS,
  liveCandidates,
  MAX_LIVE_SURFACES,
  type LiveMap,
  type LiveOutcome,
  type LiveState,
} from '@generatorai/client-core';
import type { AttentionEntity } from '@generatorai/shared';

/** MMKV key of the follow set, per server (so unpairing deletes it with `srv.<id>.`). */
export const followedPrefKey = (serverId: string): string => `srv.${serverId}.live.followed`;

/** `entity:entityId` → epoch ms of the last start / open on this device. */
export type FollowMap = Record<string, number>;

export function followId(entity: AttentionEntity, entityId: string): string {
  return `${entity}:${entityId}`;
}

/** Parse the stored follow map, dropping malformed entries and follows older than the TTL. */
export function parseFollowMap(raw: string | undefined, now: number): FollowMap {
  if (!raw) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: FollowMap = {};
  for (const [id, at] of Object.entries(value as Record<string, unknown>)) {
    if (typeof at === 'number' && Number.isFinite(at) && now - at < FOLLOW_TTL_MS && /^[a-z_]+:[A-Za-z0-9_-]+$/.test(id)) out[id] = at;
  }
  return out;
}

/** The follow map as full live keys (`serverId:entity:id`). */
export function followedLiveKeys(serverId: string, follows: FollowMap): Set<string> {
  return new Set(Object.keys(follows).map((id) => `${serverId}:${id}`));
}

export interface LiveSurfacePrefs {
  /** "Runs I start" — workflow runs and automation executions. */
  runs: boolean;
  /** "Chats waiting on me" — chats, and only while they need you. */
  chats: boolean;
}

/** The items that get a Live Activity / Live Update now (MD-90 + Settings › Widgets). */
export function surfaceCandidates(map: LiveMap, followed: ReadonlySet<string>, prefs: LiveSurfacePrefs, max = MAX_LIVE_SURFACES): LiveState[] {
  const allowed = new Set(
    [...followed].filter((key) => {
      const state = map[key];
      if (!state) return false;
      if (state.entity === 'chat') return prefs.chats && state.phase === 'needs_you';
      return prefs.runs;
    }),
  );
  return liveCandidates(map, allowed, max);
}

/** A finished workflow run's status → its outcome; null while it is still settling (try again later). */
export function runOutcome(status: string | undefined): LiveOutcome | null {
  if (status === 'completed') return 'succeeded';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return null;
}
