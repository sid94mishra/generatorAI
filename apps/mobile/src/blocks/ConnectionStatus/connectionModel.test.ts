import { describe, expect, it } from 'vitest';

import { connectionAddress, connectionHealth } from './connectionModel';

describe('ConnectionStatus model (MB-43, MD-89)', () => {
  it('follows the server: transport and stream together', () => {
    expect(connectionHealth({ state: 'connected', endpoint: 'http://127.0.0.1:3100' }, 'connected')).toBe('connected');
    expect(connectionHealth({ state: 'connected', endpoint: 'x' }, 'reconnecting')).toBe('reconnecting');
    expect(connectionHealth({ state: 'connecting' }, 'idle')).toBe('reconnecting');
    expect(connectionHealth({ state: 'connected', endpoint: 'x' }, 'offline')).toBe('disconnected');
    expect(connectionHealth({ state: 'offline' }, 'connected')).toBe('disconnected');
    expect(connectionHealth({ state: 'host-mismatch' }, 'connected')).toBe('disconnected');
  });

  it('prints the address without a scheme, loopback as local', () => {
    expect(connectionAddress({ state: 'connected', endpoint: 'http://127.0.0.1:3100/' })).toBe('local:3100');
    expect(connectionAddress({ state: 'connected', endpoint: 'https://10.0.4.12:3100' })).toBe('10.0.4.12:3100');
    expect(connectionAddress({ state: 'offline' })).toBeNull();
  });
});
