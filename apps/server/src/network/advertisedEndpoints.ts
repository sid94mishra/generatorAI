import type { NetworkInterfaceInfo } from 'node:os';

export type NetworkInterfaces = Readonly<
  Record<string, readonly NetworkInterfaceInfo[] | undefined>
>;

export interface AdvertisedEndpointCandidate {
  id: string;
  origin: string;
  reachability: 'loopback' | 'lan' | 'private-network' | 'public';
  secure: boolean;
  source: 'configured' | 'interface' | 'bind';
}

export interface ResolveAdvertisedEndpointsInput {
  port: number;
  bindHost: string;
  configuredOrigins?: readonly string[];
  networkInterfaces: NetworkInterfaces;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]']);

function canonicalOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== '/' && url.pathname !== '') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [first, second] = octets as [number, number, number, number];
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function reachabilityOf(origin: string): AdvertisedEndpointCandidate['reachability'] {
  const url = new URL(origin);
  if (LOOPBACK_HOSTS.has(url.hostname)) return 'loopback';
  if (isPrivateIpv4(url.hostname) || url.hostname.endsWith('.local')) return 'lan';
  if (/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(url.hostname)) {
    return 'private-network';
  }
  return 'public';
}

function candidate(
  origin: string,
  source: AdvertisedEndpointCandidate['source'],
): AdvertisedEndpointCandidate {
  const reachability = reachabilityOf(origin);
  return {
    id: `${source}:${reachability}:${origin}`,
    origin,
    reachability,
    secure: origin.startsWith('https://'),
    source,
  };
}

export function resolveAdvertisedEndpoints(
  input: ResolveAdvertisedEndpointsInput,
): AdvertisedEndpointCandidate[] {
  const result: AdvertisedEndpointCandidate[] = [];
  const seen = new Set<string>();
  const add = (origin: string, source: AdvertisedEndpointCandidate['source']): void => {
    const normalized = canonicalOrigin(origin);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(candidate(normalized, source));
  };

  for (const configured of input.configuredOrigins ?? []) add(configured, 'configured');

  if (WILDCARD_HOSTS.has(input.bindHost)) {
    for (const addresses of Object.values(input.networkInterfaces)) {
      for (const address of addresses ?? []) {
        if (address.internal || address.family !== 'IPv4' || !isPrivateIpv4(address.address)) continue;
        add(`http://${address.address}:${input.port}`, 'interface');
      }
    }
  } else if (!LOOPBACK_HOSTS.has(input.bindHost)) {
    const host = input.bindHost.includes(':') ? `[${input.bindHost}]` : input.bindHost;
    add(`http://${host}:${input.port}`, 'bind');
  }

  add(`http://127.0.0.1:${input.port}`, 'bind');
  return result;
}

export function selectPairingEndpoint(
  endpoints: readonly AdvertisedEndpointCandidate[],
  platform: 'web' | 'desktop' | 'cli' | 'mobile' | 'other',
): AdvertisedEndpointCandidate | null {
  const usable = platform === 'mobile'
    ? endpoints.filter((endpoint) => endpoint.reachability !== 'loopback')
    : endpoints;
  return usable[0] ?? null;
}