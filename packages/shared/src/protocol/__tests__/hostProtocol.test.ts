import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILD_STAMP_ENV,
  HOST_PROTOCOL_VERSIONS,
  assertHostHello,
  isHostHelloFrame,
} from '../hostProtocol.js';
import { makeHostHello, readBuildStamp } from '../buildStamp.js';

describe('hostProtocol — plan item 43 handshake', () => {
  const savedStamp = process.env[BUILD_STAMP_ENV];
  afterEach(() => {
    if (savedStamp === undefined) delete process.env[BUILD_STAMP_ENV];
    else process.env[BUILD_STAMP_ENV] = savedStamp;
  });

  it('makeHostHello carries the host name and its current protocol version', () => {
    const hello = makeHostHello('pty-host', import.meta.url);
    expect(hello).toMatchObject({ type: 'hello', host: 'pty-host', protocolVersion: HOST_PROTOCOL_VERSIONS['pty-host'] });
    expect(isHostHelloFrame(hello)).toBe(true);
  });

  it('readBuildStamp prefers GENERATORAI_BUILD_STAMP, else the nearest package.json version', () => {
    delete process.env[BUILD_STAMP_ENV];
    // This test file lives under packages/shared, whose package.json has a version.
    expect(readBuildStamp(import.meta.url)).toMatch(/^\d+\.\d+\.\d+/);
    expect(readBuildStamp()).toBe('unknown');
    process.env[BUILD_STAMP_ENV] = 'abc123';
    expect(readBuildStamp(import.meta.url)).toBe('abc123');
  });

  it('accepts a matching hello silently', () => {
    const hello = { type: 'hello', host: 'agent-host', protocolVersion: 1, buildStamp: 's' };
    expect(assertHostHello('agent-host', 1, 's', hello)).toBeUndefined();
  });

  it('throws a rebuild-hint message on a protocol version mismatch', () => {
    const hello = { type: 'hello', host: 'pty-host', protocolVersion: 1, buildStamp: 's' };
    expect(() => assertHostHello('pty-host', 2, 's', hello)).toThrow(
      'pty-host protocol mismatch: server expects v2, host dist is v1 — rebuild apps/pty-host (pnpm --filter @generatorai/pty-host build)',
    );
  });

  it('treats a missing hello (older dist, first frame is something else) as version 0 and throws', () => {
    expect(() => assertHostHello('browser-host', 1, 's', { type: 'pong', reqId: '__ready__' })).toThrow(
      /browser-host protocol mismatch: server expects v1, host dist is v0/,
    );
    expect(() => assertHostHello('cua-host', 1, 's', undefined)).toThrow(/cua-host protocol mismatch/);
  });

  it('throws when the process at the entry point is a different host', () => {
    const hello = { type: 'hello', host: 'pty-host', protocolVersion: 1, buildStamp: 's' };
    expect(() => assertHostHello('agent-host', 1, 's', hello)).toThrow(/identifies itself as "pty-host"/);
  });

  it('only WARNS (returns a string) when just the build stamp differs', () => {
    const hello = { type: 'hello', host: 'agent-host', protocolVersion: 1, buildStamp: 'host-x' };
    const warning = assertHostHello('agent-host', 1, 'server-y', hello);
    expect(warning).toMatch(/build stamp differs/);
    expect(warning).toContain('host-x');
    expect(warning).toContain('server-y');
  });

  it('isHostHelloFrame rejects unknown host names and malformed frames', () => {
    expect(isHostHelloFrame({ type: 'hello', host: 'nope', protocolVersion: 1, buildStamp: 's' })).toBe(false);
    expect(isHostHelloFrame({ type: 'hello', host: 'pty-host', protocolVersion: '1', buildStamp: 's' })).toBe(false);
    expect(isHostHelloFrame(null)).toBe(false);
  });
});
