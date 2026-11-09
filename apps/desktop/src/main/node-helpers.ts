// ────────────────────────────────────────────────────────────────
// Helper Node scripts the embedded server asks for (docs/devices: the iOS
// simulator helper). The packaged server cannot run a script with its own
// binary (the RunAsNode fuse is off, F-4), so it asks over its channel and
// the shell forks the script as a utility process — the same way it runs the
// server. Protocol: apps/server/src/devices/scriptLauncher.ts.
//
// Only scripts inside the app's own resources are forked, and every helper
// ends with the server that asked for it.
// ────────────────────────────────────────────────────────────────

import * as path from 'node:path';

export interface HelperProcess {
  once(event: 'exit', listener: (code: number) => void): unknown;
  kill(): boolean;
}

export type ForkHelper = (script: string, args: string[]) => HelperProcess;

export class NodeHelpers {
  private readonly running = new Map<string, HelperProcess>();

  constructor(
    private readonly options: {
      /** Scripts must live under this directory (the app's Resources). */
      root: string;
      fork: ForkHelper;
      /** Answers go back over the server's channel. */
      send: (message: unknown) => void;
      log: { warn: (message: string, meta?: object) => void };
    },
  ) {}

  /** Handles a server message; true when it was one of ours. */
  handle(message: unknown): boolean {
    const m = message as { type?: unknown; id?: unknown; script?: unknown; args?: unknown } | null;
    if (!m || typeof m.type !== 'string' || !m.type.startsWith('node-helper.')) return false;
    if (typeof m.id !== 'string' || !/^[\w-]{1,64}$/.test(m.id)) return true;
    if (m.type === 'node-helper.stop') {
      this.running.get(m.id)?.kill();
      return true;
    }
    if (m.type !== 'node-helper.start') return true;
    const id = m.id;
    const script = typeof m.script === 'string' ? path.resolve(m.script) : '';
    const args = Array.isArray(m.args) && m.args.every((a) => typeof a === 'string') ? (m.args as string[]) : null;
    const rel = script ? path.relative(this.options.root, script) : '';
    // `relative` gives `..` for a path outside, and an absolute path for another drive (Windows).
    const inside = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
    if (!inside || !args || this.running.has(id)) {
      this.options.log.warn('Refused a helper script the server asked for', { script });
      this.options.send({ type: 'node-helper.exit', id, code: null });
      return true;
    }
    let child: HelperProcess;
    try {
      child = this.options.fork(script, args);
    } catch (err) {
      this.options.log.warn('Could not start a helper script', { script, error: (err as Error).message });
      this.options.send({ type: 'node-helper.exit', id, code: null });
      return true;
    }
    this.running.set(id, child);
    child.once('exit', (code) => {
      this.running.delete(id);
      this.options.send({ type: 'node-helper.exit', id, code });
    });
    return true;
  }

  /** Ends every helper (the server exited). */
  stopAll(): void {
    for (const child of this.running.values()) child.kill();
    this.running.clear();
  }
}
