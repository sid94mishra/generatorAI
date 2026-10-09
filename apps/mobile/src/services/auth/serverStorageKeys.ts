/** Server ids are base64url host fingerprints; never let a URL become a storage key. */
export function serverStorageKeys(serverId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(serverId)) throw new Error('Invalid server identity');
  return {
    session: `session.${serverId}`,
    device: `gai.device.${serverId}`,
    software: `gai.device.${serverId}.software`,
    approval: `gai.approval.${serverId}`,
    /** The CA fingerprints this server's LAN addresses are anchored to (MV-44, `services/transport/trust.ts`). */
    trust: `gai.trust.${serverId}`,
  };
}
