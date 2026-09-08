// ────────────────────────────────────────────────────────────────
// sessionTransport — the header badge: LAN · Tunnel · Offline.
//
// Two sources have to agree: the auth transport (how requests reach the
// host — direct or through the relay) and the live stream (is the event
// socket actually up). A phone on Wi-Fi with a dead socket is not "LAN",
// it is "Reconnecting"; the stream's state therefore takes precedence over
// the transport's.
//
// Pure, no React, so every branch is testable.
// ────────────────────────────────────────────────────────────────

import type { TransportStatus } from '@generatorai/client-transport';

import type { ConnectionState } from '../../stream/streamHealth';

export interface TransportBadge {
  label: 'LAN' | 'Tunnel' | 'Offline' | 'Reconnecting' | 'Connecting';
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  detail: string;
}

export function describeSessionTransport(transport: TransportStatus, stream: ConnectionState): TransportBadge {
  if (transport.state === 'offline' || transport.state === 'host-mismatch') {
    return {
      label: 'Offline',
      tone: 'danger',
      detail: transport.state === 'offline' ? transport.reason : 'The host presented an unexpected identity key.',
    };
  }
  if (stream === 'offline') {
    return { label: 'Offline', tone: 'danger', detail: 'The live event stream is down — updates are paused.' };
  }
  if (stream === 'reconnecting' || transport.state === 'reconnecting') {
    return { label: 'Reconnecting', tone: 'warning', detail: 'Lost the connection; retrying.' };
  }
  if (transport.state === 'connecting' || transport.state === 'idle') {
    return { label: 'Connecting', tone: 'neutral', detail: 'Reaching the host…' };
  }
  if (transport.kind === 'relay' || transport.kind === 'ssh') {
    return { label: 'Tunnel', tone: 'warning', detail: `Through the relay — the host is not directly reachable. ${transport.endpoint}` };
  }
  return { label: 'LAN', tone: 'success', detail: `Direct to the host at ${transport.endpoint}.` };
}
