import { describe, expect, it } from 'vitest';
import { canonicalApprovalPayload, canonicalJson } from '../approvalProof.js';

describe('canonicalJson (MG-05)', () => {
  it('sorts keys at every depth, drops undefined and keeps no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 'x'], c: null }, e: undefined })).toBe('{"a":{"c":null,"d":[1,"x"]},"b":1}');
  });

  it('matches the documented payload byte for byte (06 §6.3)', () => {
    expect(
      canonicalApprovalPayload({
        v: 1,
        typ: 'gai-approval',
        nonce: 'n',
        iat: 1790412600,
        serverId: 's',
        deviceId: 'dev_1',
        decision: 'allow',
        gate: { kind: 'tool_permission', id: 'i', entityId: 'c' },
      }),
    ).toBe(
      '{"decision":"allow","deviceId":"dev_1","gate":{"entityId":"c","id":"i","kind":"tool_permission"},"iat":1790412600,"nonce":"n","serverId":"s","typ":"gai-approval","v":1}',
    );
  });
});
