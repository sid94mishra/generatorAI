// ────────────────────────────────────────────────────────────────
// How the server starts a helper Node script as a process of its own
// (docs/devices: the iOS simulator helper).
//
// A plain Node server spawns its own binary. The desktop app's server is an
// Electron utility process whose binary cannot run a script (the RunAsNode
// fuse is off, F-4), so it asks the desktop shell, over the parent channel,
// to fork the script as another utility process:
//
//   server → shell  { type: 'node-helper.start', id, script, args }
//   server → shell  { type: 'node-helper.stop', id }
//   shell → server  { type: 'node-helper.exit', id, code }   (also when refused)
//
// The shell forks only scripts inside the app's own resources and ends every
// helper when the server goes away.
// ────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { spawnNodeScript, type ScriptLauncher, type ScriptProcess } from '@generatorai/core';
import { parentChannel, type ParentChannel } from '../parentChannel.js';

export function scriptLauncher(channel: ParentChannel | null = parentChannel()): ScriptLauncher {
  if (channel?.kind !== 'utility') return spawnNodeScript;
  const running = new Map<string, (code: number | null) => void>();
  channel.onMessage((message) => {
    const m = message as { type?: unknown; id?: unknown; code?: unknown } | null;
    if (!m || m.type !== 'node-helper.exit' || typeof m.id !== 'string') return;
    running.get(m.id)?.(typeof m.code === 'number' ? m.code : null);
  });
  return (script, args): ScriptProcess => {
    const id = randomUUID();
    let exited: { code: number | null } | null = null;
    const listeners: ((code: number | null) => void)[] = [];
    running.set(id, (code) => {
      if (exited) return;
      exited = { code };
      running.delete(id);
      for (const l of listeners) l(code);
    });
    channel.send({ type: 'node-helper.start', id, script, args });
    return {
      onExit: (listener) => {
        if (exited) listener(exited.code);
        else listeners.push(listener);
      },
      kill: () => {
        if (!exited) channel.send({ type: 'node-helper.stop', id });
      },
    };
  };
}
