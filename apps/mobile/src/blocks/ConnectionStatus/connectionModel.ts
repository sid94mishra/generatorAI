// Pure ConnectionStatus rules (03 MB-43; MD-89): one connection state from the transport and the shared stream.
import type { ConnectionHealth } from '@generatorai/shared';
import type { ConnectionState } from '../../services/stream/streamHealth';

type Transport =
  | { state: 'idle' }
  | { state: 'connecting' }
  | { state: 'connected'; endpoint: string }
  | { state: 'reconnecting' }
  | { state: 'offline' }
  | { state: 'host-mismatch' };

/** Online follows the server (MD-89): offline transport or stream → disconnected; any retry → reconnecting. */
export function connectionHealth(transport: Transport, stream: ConnectionState): ConnectionHealth {
  if (transport.state === 'offline' || transport.state === 'host-mismatch' || stream === 'offline') return 'disconnected';
  if (transport.state !== 'connected' || stream === 'reconnecting') return 'reconnecting';
  return 'connected';
}

/** The address in the footer and Home subtitle: `local:3100`, `10.0.4.12:3100` (no scheme). */
export function connectionAddress(transport: Transport): string | null {
  if (transport.state !== 'connected') return null;
  return transport.endpoint.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '').replace(/^(localhost|127\.0\.0\.1)(?=:)/, 'local');
}
