// ────────────────────────────────────────────────────────────────
// @generatorai/cli-core — the headless brain behind every CLI surface.
//
// This package contains no rendering, no React, no Ink and no chalk. It
// describes what the CLI can do and how to do it; the three surfaces in
// apps/cli decide how that looks.
//
// Layering: may import @generatorai/shared, client-core, client-transport,
// client-runtime and secrets. May NOT import core, db, any provider SDK, or
// any UI framework.
// ────────────────────────────────────────────────────────────────

export * from './errors/CliError.js';

export * from './registry/CommandSpec.js';
export * from './registry/registry.js';
export * from './registry/toCommander.js';
export * from './registry/toCompletions.js';
export * from './registry/toForm.js';
export * from './registry/adminViews.js';
export * from './registry/surfaceSnapshot.js';
export * from './registry/generators.js';

export * from './context/CliContext.js';
export * from './capabilities/TerminalCapabilities.js';
export * from './connection/ConnectionManager.js';
export * from './refs/resolveRef.js';
export * from './keymap/Keymap.js';
export * from './auth/cliAuth.js';

export * from './config/schema.js';
export * from './config/settingsView.js';
export * from './config/migrate.js';
export * from './config/paths.js';
export * from './config/loadConfig.js';

export { buildRegistry } from './commands/index.js';
export type { BuildRegistryOptions } from './commands/index.js';
export {
  loadRunProfile,
  validateVariables,
  type RunProfile,
} from './commands/run.js';
export {
  isTerminalRunState,
  sleep,
  streamUntil,
  waitForRunTerminal,
} from './commands/_shared.js';

export * from './session/PaneModel.js';
export * from './viewmodels/index.js';
export * from './client/createCliClient.js';
