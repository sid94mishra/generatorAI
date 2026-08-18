// ────────────────────────────────────────────────────────────────
// Where the CLI keeps things on disk.
//
// One directory (`~/.generatorai`, overridable) holds config, the credential
// vault, logs, history and TUI layout state, so "back up my CLI" and "sign me
// out completely" are each a single path.
// ────────────────────────────────────────────────────────────────

import * as os from 'node:os';
import * as path from 'node:path';

/**
 * User-level GeneratorAI directory.
 *
 * `GENERATORAI_CONFIG_DIR` points the whole CLI — config AND credentials — at
 * an isolated identity. Tests, CI and throwaway profiles rely on that being
 * one switch rather than several.
 */
export function getUserConfigDir(): string {
  const override = process.env['GENERATORAI_CONFIG_DIR'];
  if (override) return path.resolve(override);
  return path.join(os.homedir(), '.generatorai');
}

export function getUserConfigFilePath(): string {
  return path.join(getUserConfigDir(), 'config.json');
}

/** Project-level overrides, checked into the repo alongside the code. */
export function getProjectConfigDir(cwd = process.cwd()): string {
  return path.join(cwd, '.generatorai');
}

export function getProjectConfigFilePath(cwd = process.cwd()): string {
  return path.join(getProjectConfigDir(cwd), 'config.json');
}

export function getRunProfilesDir(cwd = process.cwd()): string {
  return path.join(getProjectConfigDir(cwd), 'run-profiles');
}

export function getUserRunProfilesDir(): string {
  return path.join(getUserConfigDir(), 'run-profiles');
}

export function getLogsDir(): string {
  return path.join(getUserConfigDir(), 'logs');
}

export function getHistoryFilePath(): string {
  return path.join(getUserConfigDir(), 'history.jsonl');
}

/** Pane layout so `tui --restore` can reattach what was open. */
export function getTuiStateFilePath(): string {
  return path.join(getUserConfigDir(), 'tui-state.json');
}

export function getConnectionsFilePath(): string {
  return path.join(getUserConfigDir(), 'connections.json');
}

export function getCompanionAuditPath(): string {
  return path.join(getLogsDir(), 'companion-audit.ndjson');
}
