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

/** Change only routing hints; preserve the host identity, grant and scopes. */
export function rewritePairUrl(pairingUrl, platform, port = 3197) {
  if (!['ios', 'android'].includes(platform)) throw new Error('Pairing platform must be ios or android');
  if (!Number.isInteger(port) || port < 1 || port > 65534) throw new Error('Invalid sandbox port');
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
  const endpoint = `http://${platform === 'ios' ? '127.0.0.1' : '10.0.2.2'}:${port}`;
  const first = offer.endpoints.find(item => item.origin === endpoint) ?? {
    origin: endpoint, reachability: platform === 'ios' ? 'loopback' : 'private-network',
  };
  offer.endpoint = endpoint;
  offer.endpoints = [first, ...offer.endpoints.filter(item => item.origin !== endpoint)]
    .map((item, priority) => ({ ...item, priority }));
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
