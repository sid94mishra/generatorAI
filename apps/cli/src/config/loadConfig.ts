import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CLIConfigSchema, type CLIConfig } from './schema.js';
import { getUserConfigFilePath, getProjectConfigFilePath } from './paths.js';

/**
 * Deep merge two objects (target wins for leaf values).
 */
function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const [key, val] of Object.entries(override)) {
    if (val !== undefined && val !== null && typeof val === 'object' && !Array.isArray(val)
        && typeof result[key] === 'object' && result[key] !== null && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, val as Record<string, unknown>);
    } else if (val !== undefined) {
      result[key] = val;
    }
  }
  return result;
}

/** Read a JSON file, returning empty object on ENOENT */
async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Failed to read config file at ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Get environment variable overrides for CLI config */
function getEnvOverrides(): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  if (process.env['GENERATORAI_SERVER_URL']) {
    overrides['server'] = { url: process.env['GENERATORAI_SERVER_URL'] };
  }
  if (process.env['GENERATORAI_API_KEY']) {
    overrides['server'] = { ...(overrides['server'] as object ?? {}), apiKey: process.env['GENERATORAI_API_KEY'] };
  }
  if (process.env['GENERATORAI_DEFAULT_MODEL']) {
    overrides['cli'] = { defaultModel: process.env['GENERATORAI_DEFAULT_MODEL'] };
  }
  if (process.env['NO_COLOR'] || process.env['GENERATORAI_NO_COLOR']) {
    overrides['cli'] = { ...(overrides['cli'] as object ?? {}), color: 'never' };
  }
  return overrides;
}

export interface LoadCLIConfigOptions {
  configPath?: string;
  cliFlags?: Record<string, unknown>;
  verbose?: boolean;
}

/**
 * Load CLI configuration with 5-layer precedence:
 * Layer 1: Built-in defaults (Zod schema)
 * Layer 2: User config (~/.generatorai/config.json)
 * Layer 3: Project config (.generatorai/config.json)
 * Layer 4: Environment variables
 * Layer 5: CLI flags (highest)
 */
export async function loadCLIConfig(options: LoadCLIConfigOptions = {}): Promise<CLIConfig> {
  const { configPath, cliFlags = {}, verbose = false } = options;

  // Layer 2: User config
  const userConfigPath = configPath ?? getUserConfigFilePath();
  const userConfig = await readJsonFile(userConfigPath);
  if (verbose && Object.keys(userConfig).length > 0) {
    process.stderr.write(`[config] Loaded user config from ${userConfigPath}\n`);
  }

  // Layer 3: Project config
  const projectConfigPath = getProjectConfigFilePath();
  const projectConfig = await readJsonFile(projectConfigPath);
  if (verbose && Object.keys(projectConfig).length > 0) {
    process.stderr.write(`[config] Loaded project config from ${projectConfigPath}\n`);
  }

  // Layer 4: Environment variables
  const envOverrides = getEnvOverrides();

  // Merge: defaults < user < project < env < CLI flags
  const merged = deepMerge(
    deepMerge(
      deepMerge(userConfig, projectConfig),
      envOverrides
    ),
    cliFlags as Record<string, unknown>,
  );

  // Validate and parse via Zod
  const result = CLIConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid CLI configuration:\n${issues}`);
  }

  // Apply active profile overrides
  const config = result.data;
  if (config.activeProfile) {
    if (!config.profiles?.[config.activeProfile]) {
      const available = Object.keys(config.profiles ?? {});
      throw new Error(
        `Unknown config profile: "${config.activeProfile}".\n` +
        (available.length > 0
          ? `Available profiles: ${available.join(', ')}`
          : 'No profiles defined. Create one with `generatorai config profile create <name>`.'),
      );
    }
    const profileOverrides = config.profiles[config.activeProfile]!;
    if (profileOverrides.server) {
      Object.assign(config.server, profileOverrides.server);
    }
    if (profileOverrides.cli) {
      Object.assign(config.cli, profileOverrides.cli);
    }
  }

  return config;
}

/** Ensure the user config directory exists */
export async function ensureConfigDir(): Promise<string> {
  const { getUserConfigDir } = await import('./paths.js');
  const configDir = getUserConfigDir();
  await fs.mkdir(configDir, { recursive: true });
  return configDir;
}

/** Write a default config file if one doesn't exist */
export async function writeDefaultConfig(configDir: string): Promise<string> {
  const filePath = path.join(configDir, 'config.json');
  try {
    await fs.access(filePath);
    return filePath;
  } catch {
    const defaults = CLIConfigSchema.parse({});
    await fs.writeFile(filePath, JSON.stringify(defaults, null, 2), 'utf-8');
    return filePath;
  }
}
