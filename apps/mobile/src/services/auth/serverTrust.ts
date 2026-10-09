// ────────────────────────────────────────────────────────────────
// Server trust (MV-44, MD-199): the stored CA fingerprints per server and the
// native anchors they become. The rules are in `services/transport/trust.ts`;
// this file only stores records (secure store, next to the session and the
// device key — never changed silently: a new CA means pairing again) and
// hands them to the native module.
// ────────────────────────────────────────────────────────────────

import { NativeTrust } from '../native/trustModule';
import {
  anchorTargets,
  diagnoseConnection,
  hostPortOf,
  isLocalNetworkHost,
  parseTrustRecord,
  type ConnectionProblem,
  type TrustRecord,
} from '../transport/trust';
import * as SecureStore from './secureItemStore';
import { serverStorageKeys } from './serverStorageKeys';

const OPTIONS = SecureStore.KEYCHAIN_OPTIONS;

export async function loadTrust(serverId: string): Promise<TrustRecord | null> {
  return parseTrustRecord(await SecureStore.getItemAsync(serverStorageKeys(serverId).trust, OPTIONS));
}

export async function saveTrust(serverId: string, record: TrustRecord): Promise<void> {
  await SecureStore.setItemAsync(serverStorageKeys(serverId).trust, JSON.stringify(record), OPTIONS);
}

export async function deleteTrust(serverId: string): Promise<void> {
  NativeTrust.clearAnchors(serverId);
  await SecureStore.deleteItemAsync(serverStorageKeys(serverId).trust, OPTIONS);
}

/** Anchors the server's LAN `https://` endpoints to its CA (or clears them when the record has none). */
export function applyTrust(serverId: string, record: TrustRecord | null, endpoints: readonly string[]): void {
  const targets = anchorTargets(record, endpoints);
  if (targets.length && record) NativeTrust.setAnchors(serverId, targets, record.fingerprints);
  else NativeTrust.clearAnchors(serverId);
}

/** Reads the stored record and installs it; resolves once the anchors are in place. */
export async function installTrust(serverId: string, endpoints: readonly string[]): Promise<TrustRecord | null> {
  const record = await loadTrust(serverId);
  applyTrust(serverId, record, endpoints);
  return record;
}

/**
 * After a failed connection: the reason worth telling the person (MD-202), or
 * null for an ordinary "can't reach". `since` is when the failed attempt began.
 */
export async function explainConnectionFailure(
  endpoints: readonly string[],
  record: TrustRecord | null,
  since: number,
): Promise<ConnectionProblem | null> {
  const known = diagnoseConnection({ endpoints, record, since, lastFailure: (host, port) => NativeTrust.lastFailure(host, port) });
  if (known) return known;
  for (const endpoint of endpoints) {
    const target = hostPortOf(endpoint);
    if (!target || !isLocalNetworkHost(target.host)) continue;
    // Only after a failure: on iOS this probe itself raises the Local Network prompt when undecided.
    if ((await NativeTrust.localNetwork(target.host, target.port)) === 'denied') return 'local-network-denied';
    break;
  }
  return null;
}
