import * as path from 'node:path';
import * as os from 'node:os';

/**
 * User-level GeneratorAI config directory.
 *
 * Holds the CLI's config file AND its credential vault (device key + session),
 * so `GENERATORAI_CONFIG_DIR` is the single switch for pointing the CLI at an
 * isolated identity — used by tests, by CI, and by anyone who wants a
 * throwaway profile without touching their real one.
 */
export function getUserConfigDir(): string {
  const override = process.env['GENERATORAI_CONFIG_DIR'];
  if (override) return path.resolve(override);
  return path.join(os.homedir(), '.generatorai');
}

/** User-level config file path */
export function getUserConfigFilePath(): string {
  return path.join(getUserConfigDir(), 'config.json');
}

/** Project-level config directory (in CWD or git root) */
export function getProjectConfigDir(): string {
  return path.join(process.cwd(), '.generatorai');
}

/** Project-level config file */
export function getProjectConfigFilePath(): string {
  return path.join(getProjectConfigDir(), 'config.json');
}

/** Profiles directory */
export function getProfilesDir(): string {
  return path.join(getUserConfigDir(), 'profiles');
}

/** History directory for command history */
export function getHistoryDir(): string {
  return path.join(getUserConfigDir(), 'history');
}

/** Cache directory */
export function getCacheDir(): string {
  return path.join(getUserConfigDir(), 'cache');
}
