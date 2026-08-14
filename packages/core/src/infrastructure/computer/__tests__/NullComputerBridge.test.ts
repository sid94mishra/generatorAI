import { describe, it, expect } from 'vitest';
import { NullComputerBridge } from '../NullComputerBridge.js';
import { isElementAddressed } from '../../../domain/ports/IComputerBridge.js';
import type { ActionRequest, ComputerHandle } from '../../../domain/ports/IComputerBridge.js';
import {
  ALL_ACTION_REQUESTS,
  CONTRACT_ELEMENT_ADDRESSED_TYPES,
  CONTRACT_TARGET,
  describeComputerBridgeContract,
} from './computerBridgeContract.js';

describeComputerBridgeContract('NullComputerBridge', () => new NullComputerBridge(), {
  alwaysRefuses: true,
});

describe('NullComputerBridge', () => {
  it('is always available so chain resolution terminates here', async () => {
    await expect(new NullComputerBridge().isAvailable('ws-1')).resolves.toBe(true);
  });

  it('reports no capability and a platform it cannot honestly claim', async () => {
    const caps = await new NullComputerBridge().capabilities();
    expect(Object.values(caps.supports).every((v) => v === false)).toBe(true);
    expect(caps.platform).toBe('unknown');
    expect(caps.limitations.length).toBeGreaterThan(0);
  });

  it('marks the handle non-operational so no session_started is announced', async () => {
    const handle = await new NullComputerBridge().start({ workspaceId: 'ws-1', workspaceRoot: '/tmp' });
    expect(handle).toMatchObject({ provider: 'null', operational: false } satisfies Partial<ComputerHandle>);
  });

  it('carries the caller-supplied reason into every refusal', async () => {
    const bridge = new NullComputerBridge({ reason: 'no desktop attached' });
    const handle = await bridge.start({ workspaceId: 'ws-1', workspaceRoot: '/tmp' });
    const act = await bridge.act(handle, { type: 'click', snapshotId: 's1', elementIndex: 0 });
    const apps = await bridge.listApps(handle);
    expect(act.refusal?.message).toBe('no desktop attached');
    expect(apps.refusal?.message).toBe('no desktop attached');
  });
});

describe('isElementAddressed', () => {
  it.each(ALL_ACTION_REQUESTS.map((req) => [req.type, req] as const))(
    'partitions %s correctly',
    (type, req) => {
      expect(isElementAddressed(req)).toBe(CONTRACT_ELEMENT_ADDRESSED_TYPES.includes(type));
    },
  );

  it('narrows the type so snapshotId is reachable without a cast', () => {
    const req: ActionRequest = { type: 'click', snapshotId: 's9', elementIndex: 1 };
    if (!isElementAddressed(req)) throw new Error('expected element-addressed');
    expect(req.snapshotId).toBe('s9');
  });

  it('does not treat a present-but-undefined snapshotId as fenced', () => {
    // The earlier `'snapshotId' in req` implementation returned true here —
    // exactly the unfenced-action-treated-as-fenced failure the guard exists
    // to prevent.
    const req = {
      type: 'typeText',
      target: CONTRACT_TARGET,
      text: 'x',
      snapshotId: undefined,
    } as unknown as ActionRequest;
    expect(isElementAddressed(req)).toBe(false);
  });
});
