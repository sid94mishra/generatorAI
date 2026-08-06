import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  describeExposurePreconditions,
  readExposureMode,
  resolveBindHost,
  writeExposureMode,
} from '../../src/network/exposure.js';

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'generatorai-exposure-'));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('exposure mode persistence', () => {
  it('defaults to local-only when nothing has been persisted', () => {
    expect(readExposureMode(dataDir)).toBe('local-only');
  });

  it('round-trips a persisted mode', () => {
    writeExposureMode(dataDir, 'network-accessible');
    expect(readExposureMode(dataDir)).toBe('network-accessible');
    writeExposureMode(dataDir, 'local-only');
    expect(readExposureMode(dataDir)).toBe('local-only');
  });

  it('falls back to local-only for corrupt or hostile state', () => {
    // Fail closed: a damaged settings file must never be able to expose a
    // server that the user never opted in to exposing.
    for (const contents of ['', 'not json', '{}', 'null', '{"mode":"whatever"}', '[]']) {
      fs.writeFileSync(path.join(dataDir, 'network-exposure.json'), contents);
      expect(readExposureMode(dataDir)).toBe('local-only');
    }
  });

  it('creates the data directory if it does not exist yet', () => {
    const nested = path.join(dataDir, 'a', 'b');
    writeExposureMode(nested, 'network-accessible');
    expect(readExposureMode(nested)).toBe('network-accessible');
  });
});

describe('resolveBindHost', () => {
  it('binds loopback in local-only mode', () => {
    expect(resolveBindHost({ mode: 'local-only', envBindHost: undefined })).toBe('127.0.0.1');
  });

  it('binds all interfaces when the user opted into network access', () => {
    expect(resolveBindHost({ mode: 'network-accessible', envBindHost: undefined })).toBe('0.0.0.0');
  });

  it('lets an explicit environment override win over the setting', () => {
    // An operator who pinned a bind address in the environment must not have
    // it silently overridden by a toggle in the UI.
    expect(resolveBindHost({ mode: 'network-accessible', envBindHost: '127.0.0.1' })).toBe(
      '127.0.0.1',
    );
    expect(resolveBindHost({ mode: 'local-only', envBindHost: '10.0.0.5' })).toBe('10.0.0.5');
  });

  it('ignores a blank environment override', () => {
    expect(resolveBindHost({ mode: 'local-only', envBindHost: '   ' })).toBe('127.0.0.1');
  });
});

describe('describeExposurePreconditions', () => {
  it('reports nothing to fix on a properly secured server', () => {
    expect(
      describeExposurePreconditions({
        unauthenticatedLoopback: false,
        secretStoreSecure: true,
      }),
    ).toEqual([]);
  });

  it('blocks exposure while authentication is disabled', () => {
    // Exposing a server that accepts unauthenticated requests would hand the
    // whole API to anyone on the network.
    const blockers = describeExposurePreconditions({
      unauthenticatedLoopback: true,
      secretStoreSecure: true,
    });
    expect(blockers.map((blocker) => blocker.code)).toEqual(['unauthenticated_loopback']);
  });

  it('blocks exposure while secrets sit behind a world-readable key file', () => {
    const blockers = describeExposurePreconditions({
      unauthenticatedLoopback: false,
      secretStoreSecure: false,
    });
    expect(blockers.map((blocker) => blocker.code)).toEqual(['insecure_secret_store']);
  });

  it('reports every blocker at once so the user fixes them in one pass', () => {
    const blockers = describeExposurePreconditions({
      unauthenticatedLoopback: true,
      secretStoreSecure: false,
    });
    expect(blockers).toHaveLength(2);
  });
});
