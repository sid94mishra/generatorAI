import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LocalBootstrapError,
  isLoopbackOrigin,
  readBootstrapPairingFile,
  requestRecoveryPairing,
} from '../localBootstrap.js';

describe('isLoopbackOrigin', () => {
  it('accepts localhost, 127.0.0.1, 127.x.x.x and ::1', () => {
    expect(isLoopbackOrigin('http://localhost:3100')).toBe(true);
    expect(isLoopbackOrigin('http://127.0.0.1:3100')).toBe(true);
    expect(isLoopbackOrigin('http://127.5.5.5:3100')).toBe(true);
    expect(isLoopbackOrigin('http://[::1]:3100')).toBe(true);
  });

  it('rejects a LAN address, a public host, and a malformed URL', () => {
    expect(isLoopbackOrigin('http://192.168.1.20:3100')).toBe(false);
    expect(isLoopbackOrigin('https://attacker.example')).toBe(false);
    expect(isLoopbackOrigin('not a url')).toBe(false);
  });

  it('does not treat a hostname that merely contains "localhost" as loopback', () => {
    expect(isLoopbackOrigin('https://localhost.attacker.example')).toBe(false);
    expect(isLoopbackOrigin('https://notlocalhost.example')).toBe(false);
  });
});

describe('readBootstrapPairingFile', () => {
  function tempDir(): string {
    return mkdtempSync(join(tmpdir(), 'generatorai-bootstrap-'));
  }

  it('returns null when the file is absent', () => {
    const dir = tempDir();
    try {
      expect(readBootstrapPairingFile(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads a valid, unexpired grant', () => {
    const dir = tempDir();
    try {
      const expiresAt = Date.now() + 60_000;
      writeFileSync(
        join(dir, 'bootstrap-pairing.json'),
        JSON.stringify({ pairingCode: 'CODE123', pairingUrl: 'generatorai://pair?code=CODE123', expiresAt }),
      );
      expect(readBootstrapPairingFile(dir)).toEqual({
        pairingCode: 'CODE123',
        pairingUrl: 'generatorai://pair?code=CODE123',
        expiresAt,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('treats an expired grant as absent', () => {
    const dir = tempDir();
    try {
      writeFileSync(
        join(dir, 'bootstrap-pairing.json'),
        JSON.stringify({ pairingCode: 'CODE123', expiresAt: Date.now() - 1 }),
      );
      expect(readBootstrapPairingFile(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('treats malformed JSON and a missing pairingCode as absent, not a crash', () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, 'bootstrap-pairing.json'), '{not json');
      expect(readBootstrapPairingFile(dir)).toBeNull();
      writeFileSync(join(dir, 'bootstrap-pairing.json'), JSON.stringify({ expiresAt: Date.now() + 60_000 }));
      expect(readBootstrapPairingFile(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('requestRecoveryPairing', () => {
  it('refuses a non-loopback baseUrl and never calls fetch', async () => {
    const fetchImpl = vi.fn();
    await expect(
      requestRecoveryPairing('https://attacker.example', 'super-secret-token', 'my-device', fetchImpl),
    ).rejects.toMatchObject({ code: 'NOT_LOOPBACK' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never leaks the token into the thrown error for a non-loopback refusal', async () => {
    const token = 'super-secret-token-xyz';
    try {
      await requestRecoveryPairing('https://attacker.example', token, 'my-device', vi.fn());
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LocalBootstrapError);
      expect(String((error as Error).message)).not.toContain(token);
    }
  });

  it('posts to /internal/desktop/pairing with a Bearer token, only over loopback', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            pairingCode: 'CODE',
            pairingUrl: 'generatorai://pair?code=CODE',
            shortCode: '1234-5678',
            expiresAt: Date.now() + 60_000,
          }),
          { status: 201 },
        ),
    );

    const result = await requestRecoveryPairing('http://127.0.0.1:3100', 'the-token', 'my-device', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:3100/internal/desktop/pairing');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer the-token' });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ deviceName: 'my-device' });
    expect(result).toEqual({
      pairingCode: 'CODE',
      pairingUrl: 'generatorai://pair?code=CODE',
      shortCode: '1234-5678',
      expiresAt: result.expiresAt,
    });
  });

  it('surfaces a 401 as UNAUTHORIZED', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 401 }),
    );
    await expect(
      requestRecoveryPairing('http://localhost:3100', 'the-token', 'my-device', fetchImpl),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'nope' });
  });

  it('surfaces a network failure as UNREACHABLE', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      requestRecoveryPairing('http://127.0.0.1:3100', 'the-token', 'my-device', fetchImpl),
    ).rejects.toMatchObject({ code: 'UNREACHABLE' });
  });

  it('rejects a well-formed 2xx body missing required fields', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ pairingCode: 'CODE' }), { status: 201 }));
    await expect(
      requestRecoveryPairing('http://127.0.0.1:3100', 'the-token', 'my-device', fetchImpl),
    ).rejects.toMatchObject({ code: 'FAILED' });
  });
});
