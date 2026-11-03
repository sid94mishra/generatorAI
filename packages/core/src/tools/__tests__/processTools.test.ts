// `stop_port_listener`: what a person would do by hand to free a port — against a fake OS and a real server.

import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { buildStopPortListenerTool, createOsProcessControl, type PortListener, type ProcessControl } from '../processTools.js';

const noSleep = async () => {};

function fakeOs(listening: Map<number, PortListener[]>, stubborn = new Set<number>()) {
  const stopped: Array<[number, boolean]> = [];
  const control: ProcessControl = {
    listeners: async (port) => [...(listening.get(port) ?? [])],
    stop: async (pid, force) => {
      stopped.push([pid, force]);
      if (force || !stubborn.has(pid)) for (const [port, ls] of listening) listening.set(port, ls.filter((l) => l.pid !== pid));
    },
  };
  return { control, stopped };
}

describe('stop_port_listener', () => {
  it('stops what listens on the port and says it is free', async () => {
    const { control, stopped } = fakeOs(new Map([[4837, [{ pid: 501, command: 'node server.js' }]]]));
    const tool = buildStopPortListenerTool(control, { owner: 'test', protectedPids: [1], sleep: noSleep });
    expect(await tool.handler({ port: 4837 })).toMatchObject({ ok: true, stopped: [{ pid: 501, command: 'node server.js' }], message: 'Port 4837 is free now.' });
    expect(stopped).toEqual([[501, false]]);
  });

  it('kills a process outright when it does not let go of the port in time', async () => {
    const { control, stopped } = fakeOs(new Map([[5000, [{ pid: 777, command: 'node watch.js' }]]]), new Set([777]));
    const tool = buildStopPortListenerTool(control, { owner: 'test', protectedPids: [], sleep: noSleep });
    expect(await tool.handler({ port: 5000 })).toMatchObject({ ok: true });
    expect(stopped).toEqual([[777, false], [777, true]]);
  });

  it('never stops the app itself, refuses ports below 1024, and says when nothing listens', async () => {
    const { control, stopped } = fakeOs(new Map([[49769, [{ pid: 42, command: 'GeneratorAI server' }]]]));
    const tool = buildStopPortListenerTool(control, { owner: 'test', protectedPids: [42], sleep: noSleep });
    expect(await tool.handler({ port: 49769 })).toMatchObject({ ok: false });
    expect(await tool.handler({ port: 80 })).toMatchObject({ ok: false });
    expect(await tool.handler({ port: 'x' })).toMatchObject({ ok: false });
    expect(await tool.handler({ port: 6000 })).toMatchObject({ ok: true, stopped: [], message: 'Nothing is listening on port 6000.' });
    expect(stopped).toEqual([]);
  });

  it('reports a process it is not allowed to stop', async () => {
    const control: ProcessControl = {
      listeners: async () => [{ pid: 9, command: 'other user' }],
      stop: vi.fn(async () => {
        throw new Error('EPERM');
      }),
    };
    const tool = buildStopPortListenerTool(control, { owner: 'test', protectedPids: [], sleep: noSleep });
    expect(await tool.handler({ port: 7000 })).toMatchObject({ ok: false, stillListening: [{ pid: 9 }], message: 'Port 7000 is still in use.' });
  });

  it('stops a real server through the OS', async () => {
    const child = spawn(process.execPath, ['-e', "require('node:http').createServer(()=>{}).listen(0,'127.0.0.1',function(){console.log(this.address().port)})"], { stdio: ['ignore', 'pipe', 'ignore'] });
    const port = await new Promise<number>((resolve) => child.stdout!.once('data', (d) => resolve(Number(String(d).trim()))));
    const control = createOsProcessControl();
    const before = await control.listeners(port);
    if (before.length === 0) {
      child.kill();
      return; // no lsof/ss/PowerShell networking cmdlets on this machine: nothing to assert
    }
    expect(before.map((l) => l.pid)).toContain(child.pid);
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    const tool = buildStopPortListenerTool(control, { owner: 'test', protectedPids: [process.pid] });
    expect(await tool.handler({ port })).toMatchObject({ ok: true, stopped: [{ pid: child.pid }] });
    await exited;
  }, 20_000);
});
