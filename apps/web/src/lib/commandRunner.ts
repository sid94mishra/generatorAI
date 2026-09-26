// ────────────────────────────────────────────────────────────────
// commandRunner — runs a registry command (D-24) from anywhere in the app.
//
// The command host (useCommandHost) owns the one exhaustive handler table and
// registers itself here while it is mounted; the command palette and any other
// caller run commands through `runCommand(id)`, so a palette row does exactly
// what the menu item, the key binding and the IPC command do. Lives in lib/
// (not next to the host) because features/ may import lib/ but not app/, where
// the host moves with the shell (P3-04).
// ────────────────────────────────────────────────────────────────

import type { RendererCommandId } from '@generatorai/shared/ui-contract';
import { globalSingleton } from './globalSingleton.js';

type Runner = (id: RendererCommandId) => void;

// HMR-split-proof: every module instance sees the same registration.
const slot = globalSingleton('web.commandRunner', () => ({ runner: null as Runner | null }));

/** Installs the handler table's runner; returns the cleanup that removes it. */
export function registerCommandRunner(runner: Runner): () => void {
  slot.runner = runner;
  return () => {
    if (slot.runner === runner) slot.runner = null;
  };
}

/** Runs a global renderer command through the mounted command host. */
export function runCommand(id: RendererCommandId): void {
  // The shell mounts the host before anything can call this; no host is a wiring bug.
  if (!slot.runner) throw new Error(`No command host is mounted; "${id}" was not run`);
  slot.runner(id);
}
