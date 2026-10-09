import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function tempRelative(target) {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const resolved = fs.realpathSync(target);
  const relative = path.relative(temporaryRoot, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Refusing a path outside the temporary sandbox directory');
  }
  return { resolved, parts: relative.split(path.sep) };
}

export function assertSandboxDbPath(target) {
  const { resolved, parts } = tempRelative(target);
  if (parts.length !== 2 || !parts[0].startsWith('generatorai-sandbox-') || parts[1] !== 'sandbox.db') {
    throw new Error('The database must be a sandbox-created temporary sandbox.db');
  }
  return resolved;
}

export function assertDummyRepo(target) {
  const { resolved, parts } = tempRelative(target);
  if (parts.length !== 2 || !parts[0].startsWith('generatorai-dummy-repo-') || parts[1] !== 'work'
    || !fs.existsSync(path.join(resolved, '.git'))) {
    throw new Error('SCM fixtures require make-dummy-repo.mjs output, never this checkout');
  }
  return resolved;
}

/**
 * Change only routing hints; preserve the host identity, grant, scopes and CA fingerprints. The LAN sandbox
 * (`sandbox.mjs --lan`, MV-44) offers https:// LAN addresses, which a simulator, an emulator (NAT to the host) and a
 * phone on the same Wi-Fi all reach: the first https:// private IPv4 address goes first. There is no plain-HTTP
 * address to rewrite to any more (D-127).
 */
export function rewritePairUrl(pairingUrl, platform, { keepOrder = false } = {}) {
  if (!['ios', 'android'].includes(platform)) throw new Error('Pairing platform must be ios or android');
  const url = new URL(pairingUrl);
  if (url.protocol !== 'generatorai:' || (url.hostname || url.pathname.replace(/^\//, '')) !== 'pair') {
    throw new Error('Unexpected pairing URL');
  }
  const code = url.searchParams.get('code');
  if (!code) throw new Error('Pairing response has no code');
  const offer = JSON.parse(Buffer.from(code, 'base64url').toString('utf8'));
  if (offer.v !== 2 || typeof offer.serverId !== 'string' || typeof offer.serverPublicKey !== 'string'
    || typeof offer.pairingGrant !== 'string' || !Array.isArray(offer.endpoints)) {
    throw new Error('Invalid v2 pairing offer');
  }
  const lan = offer.endpoints.find(item => /^https:\/\/(10|192\.168|172\.(1[6-9]|2\d|3[01]))\.[\d.]+:\d+$/.test(item.origin));
  if (!lan) throw new Error('The sandbox offers no https:// LAN address; start it with --lan on a machine that is on a network');
  // --keep-order: pair through the offer exactly as minted (e.g. an unreachable ts.net address first), so the app's own
  // fallback picks the route (MD-203).
  if (keepOrder) return pairingUrl;
  offer.endpoint = lan.origin;
  offer.endpoints = [lan, ...offer.endpoints.filter(item => item !== lan)].map((item, priority) => ({ ...item, priority }));
  url.searchParams.set('code', Buffer.from(JSON.stringify(offer)).toString('base64url'));
  return url.toString();
}

export function mergedFixture(web, mobile) {
  for (const key of Object.keys(mobile)) {
    if (!key.startsWith('Mobile — ') || key in web) throw new Error(`Unexpected mobile fixture key: ${key}`);
  }
  return {
    ...web, ...mobile,
    'Mobile — Long stream': [[
      { type: 'text', content: Array.from({ length: 2000 }, (_, i) => `${i + 1}. Native streaming performance fixture.`).join('\n') },
      { type: 'complete' },
    ]],
  };
}

/**
 * The device a pairing just created: not in the `before` set, not revoked, created after the pairing started (one
 * minute of clock skew allowed). The name only breaks ties, case-insensitively — the app's Name field
 * auto-capitalises typed text and the automation keeps the default name ("My iPhone"). Null while none, or while more
 * than one candidate remains and the name does not single one out.
 */
export function findNewPairing(devices, { before, started, name }) {
  const candidates = devices.filter(device => !before.has(device.deviceId) && !device.revokedAt
    && new Date(device.createdAt).getTime() >= started - 60000);
  if (candidates.length === 1) return candidates[0];
  const named = candidates.filter(device => typeof name === 'string' && device.name?.toLowerCase() === name.toLowerCase());
  return named.length === 1 ? named[0] : null;
}
