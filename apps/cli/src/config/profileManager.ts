import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getUserConfigFilePath, getProfilesDir } from './paths.js';

export interface Profile {
  name: string;
  server?: { url?: string; apiKey?: string };
  cli?: { defaultModel?: string };
}

/** List all saved profiles */
export async function listProfiles(): Promise<string[]> {
  const configPath = getUserConfigFilePath();
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as Record<string, unknown>;
    const profiles = config['profiles'] as Record<string, unknown> | undefined;
    return profiles ? Object.keys(profiles) : [];
  } catch {
    return [];
  }
}

/** Get the active profile name */
export async function getActiveProfile(): Promise<string | undefined> {
  const configPath = getUserConfigFilePath();
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as Record<string, unknown>;
    return config['activeProfile'] as string | undefined;
  } catch {
    return undefined;
  }
}

/** Create a new profile */
export async function createProfile(name: string, profile: Omit<Profile, 'name'> = {}): Promise<void> {
  const configPath = getUserConfigFilePath();
  let config: Record<string, unknown> = {};
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(content) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`Failed to parse config: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const profiles = (config['profiles'] ?? {}) as Record<string, unknown>;
  if (profiles[name]) throw new Error(`Profile "${name}" already exists`);
  profiles[name] = profile;
  config['profiles'] = profiles;

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/** Switch to a named profile */
export async function useProfile(name: string): Promise<void> {
  const configPath = getUserConfigFilePath();
  let config: Record<string, unknown> = {};
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(content) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`Failed to parse config: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const profiles = (config['profiles'] ?? {}) as Record<string, unknown>;
  if (!profiles[name]) throw new Error(`Profile "${name}" not found`);
  config['activeProfile'] = name;

  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/** Delete a profile */
export async function deleteProfile(name: string): Promise<void> {
  const configPath = getUserConfigFilePath();
  let config: Record<string, unknown> = {};
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(content) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`Failed to parse config: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  const profiles = (config['profiles'] ?? {}) as Record<string, unknown>;
  if (!profiles[name]) throw new Error(`Profile "${name}" not found`);
  delete profiles[name];
  config['profiles'] = profiles;
  if (config['activeProfile'] === name) delete config['activeProfile'];

  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
