import { describe, expect, it } from 'vitest';
import { AdmissionController, providerFlowKey, sizeGlobalFlowLimit } from '../src/services/AdmissionController.js';

const tick = () => new Promise((r) => setImmediate(r));
const CLAUDE = providerFlowKey('claude-agent');

describe('sizeGlobalFlowLimit — the default `global` limit from the machine', () => {
  it('is bound by CPUs, by memory, by the ceiling of 16 and by the floor of 2', () => {
    expect(sizeGlobalFlowLimit({ cpus: 4, totalMemBytes: 64 * 1024 ** 3 })).toBe(4);
    expect(sizeGlobalFlowLimit({ cpus: 32, totalMemBytes: 2 * 1024 ** 3 })).toBe(4);
    expect(sizeGlobalFlowLimit({ cpus: 128, totalMemBytes: 512 * 1024 ** 3 })).toBe(16);
    expect(sizeGlobalFlowLimit({ cpus: 1, totalMemBytes: 256 * 1024 ** 2 })).toBe(2);
  });
});

describe('flow keys', () => {
  // ECON-R1 (blocker): a waiter blocked on one full key must not reserve the keys that still have room.
  it('a stage waiting on `global` does not block a chat turn on an idle provider key', async () => {
    const a = new AdmissionController({ flowLimits: { global: 1 } });
    const copilotStage = await a.acquireFlows(['global', providerFlowKey('copilot')]);
    let stageGranted = false;
    void a.acquireFlows(['global', CLAUDE]).then(() => {
      stageGranted = true;
    });
    const gate = a.flowGate(CLAUDE);
    const turn = gate.tryAcquire();
    expect(turn).toBeDefined();
    let chatGranted = false;
    void gate.acquire().then(() => {
      chatGranted = true;
    });
    await tick();
    expect(chatGranted).toBe(true);
    expect(stageGranted).toBe(false);
    copilotStage();
    await tick();
    expect(stageGranted).toBe(true);
  });

  // ECON-R2: an attended per-turn permit is queued ahead of stage launches.
  it('a chat turn is granted before stage launches queued earlier on the same provider', async () => {
    const a = new AdmissionController({ flowLimits: { global: 16 } });
    const held: Array<() => void> = [];
    for (let i = 0; i < 4; i++) held.push(await a.acquireFlows(['global', CLAUDE]));
    const order: string[] = [];
    for (let i = 0; i < 3; i++) void a.acquireFlows(['global', CLAUDE]).then((r) => (order.push(`stage${i}`), held.push(r)));
    void a.flowGate(CLAUDE).acquire().then((r) => (order.push('chat'), held.push(r)));
    held.shift()!();
    await tick();
    expect(order).toEqual(['chat']);
  });

  // ECON-R6: a queued waiter can be withdrawn.
  it('an aborted wait leaves the queue and rejects; the slot goes to the next waiter', async () => {
    const a = new AdmissionController({ flowLimits: { [CLAUDE]: 1 } });
    const first = await a.acquireFlows([CLAUDE]);
    const ac = new AbortController();
    const withdrawn = a.acquireFlows([CLAUDE], { signal: ac.signal });
    let nextGranted = false;
    void a.acquireFlows([CLAUDE]).then(() => {
      nextGranted = true;
    });
    ac.abort();
    await expect(withdrawn).rejects.toMatchObject({ name: 'AbortError' });
    first();
    await tick();
    expect(nextGranted).toBe(true);
    expect(a.flowSnapshot().find((f) => f.flowKey === CLAUDE)).toMatchObject({ running: 1, queued: 0 });
  });

  // ECON-R4: a gate inside a turn keeps the provider key and gives back the rest.
  it('pause keeps the listed keys; resume takes back only what was given', async () => {
    const a = new AdmissionController({ flowLimits: { global: 1, [CLAUDE]: 1 } });
    await a.admitFlows(['global', CLAUDE], async (ticket) => {
      ticket.pause({ keep: [CLAUDE] });
      expect(ticket.holds(CLAUDE)).toBe(true);
      expect(ticket.holds('global')).toBe(false);
      expect(a.flowGate(CLAUDE).tryAcquire()).toBeUndefined();
      const other = await a.acquireFlows(['global']);
      other();
      await ticket.resume();
      expect(ticket.holds('global')).toBe(true);
    });
    expect(a.flowSnapshot().every((f) => f.running === 0)).toBe(true);
  });
});
