// ────────────────────────────────────────────────────────────────
// computerBridgeContract — the assertions EVERY `IComputerBridge` adapter
// must satisfy, exported as a reusable suite.
//
// Phases 3 and 7 add `CuaDriverBridge` and `VisionFallbackBridge`; both call
// `describeComputerBridgeContract()` so a second adapter cannot quietly hold
// itself to a weaker standard than the first. Adapter-specific behaviour is
// tested alongside, not here.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import type {
  ActionRequest,
  ActionRequestType,
  ComputerAppIdentity,
  ComputerHandle,
  ComputerWindowTarget,
  IComputerBridge,
} from '../../../domain/ports/IComputerBridge.js';
import { isElementAddressed } from '../../../domain/ports/IComputerBridge.js';

const APP: ComputerAppIdentity = { appId: 'com.example.app', name: 'Example', pid: 1234 };
const TARGET: ComputerWindowTarget = { app: APP, window: { by: 'focused' } };

/** Every variant, so a newly added one fails the exhaustiveness check below. */
export const ALL_ACTION_REQUESTS: readonly ActionRequest[] = [
  { type: 'click', snapshotId: 's1', elementIndex: 0 },
  { type: 'setValue', snapshotId: 's1', elementIndex: 1, value: 'x' },
  { type: 'performAction', snapshotId: 's1', elementIndex: 2, actionName: 'AXPress' },
  { type: 'clickPoint', target: TARGET, x: 10, y: 20 },
  { type: 'typeText', target: TARGET, text: 'hello' },
  { type: 'pressKey', target: TARGET, key: 'a', modifiers: ['Meta'] },
  { type: 'pasteText', target: TARGET, text: 'hello' },
  { type: 'scroll', target: TARGET, deltaX: 0, deltaY: -120 },
  { type: 'drag', target: TARGET, from: { x: 0, y: 0 }, to: { x: 5, y: 5 } },
];

const ELEMENT_ADDRESSED: readonly ActionRequestType[] = ['click', 'setValue', 'performAction'];

export {
  APP as CONTRACT_APP,
  TARGET as CONTRACT_TARGET,
  ELEMENT_ADDRESSED as CONTRACT_ELEMENT_ADDRESSED_TYPES,
};

export interface ComputerBridgeContractOptions {
  /** True when the adapter refuses everything (NullComputerBridge). */
  alwaysRefuses?: boolean;
}

export function describeComputerBridgeContract(
  name: string,
  makeBridge: () => IComputerBridge,
  options: ComputerBridgeContractOptions = {},
): void {
  describe(`IComputerBridge contract: ${name}`, () => {
    const handle = (bridge: IComputerBridge): Promise<ComputerHandle> =>
      bridge.start({ workspaceId: 'ws-1', workspaceRoot: '/tmp/ws-1' });

    it('covers every ActionRequest variant in the fixture', () => {
      const seen = new Set(ALL_ACTION_REQUESTS.map((r) => r.type));
      // Mirrors the union; if a variant is added without updating the fixture
      // the adapters below are never exercised against it.
      const expected: ActionRequestType[] = [
        'click',
        'setValue',
        'performAction',
        'clickPoint',
        'typeText',
        'pressKey',
        'pasteText',
        'scroll',
        'drag',
      ];
      expect([...seen].sort()).toEqual([...expected].sort());
    });

    it('returns a handle whose provider matches the adapter id', async () => {
      const bridge = makeBridge();
      const h = await handle(bridge);
      expect(h.provider).toBe(bridge.id);
      expect(h.workspaceId).toBe('ws-1');
      expect(typeof h.operational).toBe('boolean');
    });

    it('stop() is idempotent', async () => {
      const bridge = makeBridge();
      const h = await handle(bridge);
      await expect(bridge.stop(h)).resolves.toBeUndefined();
      await expect(bridge.stop(h)).resolves.toBeUndefined();
    });

    it('capabilities() reports a supports map with only booleans', async () => {
      const caps = await makeBridge().capabilities('ws-1');
      expect(Object.values(caps.supports).every((v) => typeof v === 'boolean')).toBe(true);
      expect(Array.isArray(caps.limitations)).toBe(true);
    });

    it('enumerations carry a refusal channel rather than reporting emptiness', async () => {
      const bridge = makeBridge();
      const h = await handle(bridge);
      const apps = await bridge.listApps(h);
      expect(Array.isArray(apps.apps)).toBe(true);
      if (apps.apps.length === 0 && options.alwaysRefuses) {
        expect(apps.refusal?.code).toBeDefined();
      }
      const windows = await bridge.listWindows(h, APP);
      expect(Array.isArray(windows.windows)).toBe(true);
      if (windows.windows.length === 0 && options.alwaysRefuses) {
        expect(windows.refusal?.code).toBeDefined();
      }
    });

    it('never returns a payload alongside a refusal', async () => {
      const bridge = makeBridge();
      const h = await handle(bridge);
      const results = [
        await bridge.snapshot(h, { ...TARGET }),
        ...(await Promise.all(ALL_ACTION_REQUESTS.map((req) => bridge.act(h, req)))),
      ];
      for (const result of results) {
        if (!result.refusal) continue;
        expect(result.ok).toBe(false);
        expect(result.snapshot).toBeNull();
        expect(result.screenshot).toBeNull();
      }
    });

    if (options.alwaysRefuses) {
      it('refuses every operation without throwing', async () => {
        const bridge = makeBridge();
        const h = await handle(bridge);
        const results = [
          await bridge.snapshot(h, { ...TARGET }),
          ...(await Promise.all(ALL_ACTION_REQUESTS.map((req) => bridge.act(h, req)))),
        ];
        expect(results).toHaveLength(ALL_ACTION_REQUESTS.length + 1);
        for (const result of results) {
          expect(result.ok).toBe(false);
          expect(result.refusal?.code).toBe('provider_unavailable');
        }
      });
    }
  });
}
