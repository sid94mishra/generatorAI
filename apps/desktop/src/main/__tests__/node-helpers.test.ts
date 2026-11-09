import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { NodeHelpers } from '../node-helpers';

const ROOT = path.resolve('/app/Resources');

function setup() {
  const children: (EventEmitter & { kill: ReturnType<typeof vi.fn> })[] = [];
  const fork = vi.fn((_script: string, _args: string[]) => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) });
    children.push(child);
    return child;
  });
  const send = vi.fn();
  const helpers = new NodeHelpers({ root: ROOT, fork, send, log: { warn: vi.fn() } });
  return { helpers, fork, send, children };
}

describe('NodeHelpers', () => {
  it('forks a script inside the app resources and reports its exit', () => {
    const { helpers, fork, send, children } = setup();
    const script = path.join(ROOT, 'server', 'node_modules', 'serve-sim', 'dist', 'serve-sim.js');
    expect(helpers.handle({ type: 'node-helper.start', id: 'h1', script, args: ['udid', '--port', '5000'] })).toBe(true);
    expect(fork).toHaveBeenCalledWith(script, ['udid', '--port', '5000']);
    helpers.handle({ type: 'node-helper.stop', id: 'h1' });
    expect(children[0]!.kill).toHaveBeenCalled();
    children[0]!.emit('exit', 0);
    expect(send).toHaveBeenCalledWith({ type: 'node-helper.exit', id: 'h1', code: 0 });
  });

  it('refuses a script outside the app resources', () => {
    const { helpers, fork, send } = setup();
    for (const script of [path.resolve('/tmp/evil.js'), path.join(ROOT, '..', 'evil.js'), 'relative.js']) {
      helpers.handle({ type: 'node-helper.start', id: 'h2', script, args: [] });
    }
    expect(fork).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({ type: 'node-helper.exit', id: 'h2', code: null });
  });

  it('ends every helper when the server goes away, and ignores other messages', () => {
    const { helpers, children } = setup();
    helpers.handle({ type: 'node-helper.start', id: 'a', script: path.join(ROOT, 'a.js'), args: [] });
    helpers.handle({ type: 'node-helper.start', id: 'b', script: path.join(ROOT, 'b.js'), args: [] });
    expect(helpers.handle({ type: 'secret-key-request' })).toBe(false);
    helpers.stopAll();
    expect(children.every((c) => c.kill.mock.calls.length === 1)).toBe(true);
  });
});
