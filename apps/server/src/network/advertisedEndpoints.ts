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
  /**
   * True when this address belongs to a hypervisor/container adapter (WSL,
   * Hyper-V, Docker, VirtualBox, VMware).
   *
   * These are RFC1918 and indistinguishable from a real LAN address by IP
   * alone, but nothing outside this machine can route to them. Advertising
   * one to a phone produces a connection that times out with no explanation,
   * so callers should rank or filter on this rather than show every private
   * address as equally usable.
   */
  virtual: boolean;
  /** Adapter this address came from, when it came from an interface scan. */
  interfaceName?: string;
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

/**
 * Adapter names created by virtualisation stacks. Matched case-insensitively
 * against the OS interface name, which is the only signal that separates a
 * routable LAN address from a host-only virtual switch — the IP ranges
 * overlap completely.
 */
const VIRTUAL_ADAPTER_PATTERN =
  /(vethernet|hyper-?v|wsl|docker|virtualbox|vmware|vboxnet|utun|tailscale|zerotier|default switch|loopback pseudo)/i;

function isVirtualAdapter(name: string): boolean {
  return VIRTUAL_ADAPTER_PATTERN.test(name);
}

function candidate(
  origin: string,
  source: AdvertisedEndpointCandidate['source'],
  interfaceName?: string,
): AdvertisedEndpointCandidate {
  const reachability = reachabilityOf(origin);
  return {
    id: `${source}:${reachability}:${origin}`,
    origin,
    reachability,
    secure: origin.startsWith('https://'),
    source,
    virtual: interfaceName ? isVirtualAdapter(interfaceName) : false,
    ...(interfaceName ? { interfaceName } : {}),
  };
}

export function resolveAdvertisedEndpoints(
  input: ResolveAdvertisedEndpointsInput,
): AdvertisedEndpointCandidate[] {
  const result: AdvertisedEndpointCandidate[] = [];
  const seen = new Set<string>();
  const add = (
    origin: string,
    source: AdvertisedEndpointCandidate['source'],
    interfaceName?: string,
  ): void => {
    const normalized = canonicalOrigin(origin);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(candidate(normalized, source, interfaceName));
  };

  for (const configured of input.configuredOrigins ?? []) add(configured, 'configured');

  if (WILDCARD_HOSTS.has(input.bindHost)) {
    // Interface NAME is retained (rather than iterating values alone) purely so
    // virtual adapters can be told apart from a real LAN card.
    const scanned: { origin: string; name: string }[] = [];
    for (const [name, addresses] of Object.entries(input.networkInterfaces)) {
      for (const address of addresses ?? []) {
        if (address.internal || address.family !== 'IPv4' || !isPrivateIpv4(address.address)) continue;
        scanned.push({ origin: `http://${address.address}:${input.port}`, name });
      }
    }
    // Real adapters first, so `selectPairingEndpoint` cannot hand a phone a
    // host-only virtual address just because the OS enumerated it first.
    scanned.sort((a, b) => Number(isVirtualAdapter(a.name)) - Number(isVirtualAdapter(b.name)));
    for (const entry of scanned) add(entry.origin, 'interface', entry.name);
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
  // A phone can reach neither loopback (that would be the phone itself) nor a
  // host-only virtual switch, so both are excluded rather than merely ranked.
  const usable = platform === 'mobile'
    ? endpoints.filter((endpoint) => endpoint.reachability !== 'loopback' && !endpoint.virtual)
    : endpoints;
  return usable[0] ?? null;
}