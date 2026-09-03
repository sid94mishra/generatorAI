// ────────────────────────────────────────────────────────────────
// Config loading — five layers, lowest to highest:
//
//   1. Built-in defaults (the Zod schema)
//   2. User config      ~/.generatorai/config.json
//   3. Project config   ./.generatorai/config.json
//   4. Environment      GENERATORAI_*
//   5. CLI flags
//
// The active profile is overlaid last of all, on top of the merged result,
// because a profile is "these settings, whichever way you got here".
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import { CliError } from '../errors/CliError.js';
import { migrateConfig, type ConfigMigration } from './migrate.js';
import {
  CliConfigSchema,
  CONFIG_VERSION,
  type CliConfig,
  type ResolvedCliConfig,
} from './schema.js';
import {
  getProjectConfigFilePath,
  getUserConfigDir,
  getUserConfigFilePath,
} from './paths.js';

type Json = Record<string, unknown>;

function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Later wins. Objects merge; arrays and scalars replace. */
function deepMerge(base: Json, override: Json): Json {
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const existing = out[key];
    out[key] = isPlainObject(value) && isPlainObject(existing) ? deepMerge(existing, value) : value;
  }
  return out;
}

async function readJson(path: string): Promise<{ data: Json; found: boolean }> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      throw CliError.usage(`Config at ${path} must be a JSON object.`);
    }
    return { data: parsed, found: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { data: {}, found: false };
    if (error instanceof CliError) throw error;
    throw new CliError('VALIDATION', `Could not read config at ${path}.`, {
      hint: error instanceof Error ? error.message : String(error),
      suggestions: [`generatorai config edit`],
    });
  }
}

/** Which env vars were actually consulted — reported by `config show --sources`. */
const ENV_MAP: Array<{ env: string; apply: (target: Json, value: string) => void }> = [
  {
    env: 'GENERATORAI_SERVER_URL',
    apply: (t, v) => set(t, ['server', 'url'], v),
  },
  {
    env: 'GENERATORAI_API_KEY',
    apply: (t, v) => set(t, ['server', 'apiKey'], v),
  },
  {
    env: 'GENERATORAI_DEFAULT_MODEL',
    apply: (t, v) => set(t, ['cli', 'defaultModel'], v),
  },
  {
    env: 'GENERATORAI_PROJECT',
    apply: (t, v) => set(t, ['cli', 'defaultProjectId'], v),
  },
  {
    env: 'GENERATORAI_PROFILE',
    apply: (t, v) => set(t, ['activeProfile'], v),
  },
  {
    env: 'GENERATORAI_CONNECTION',
    apply: (t, v) => set(t, ['activeConnection'], v),
  },
  {
    env: 'GENERATORAI_THEME',
    apply: (t, v) => set(t, ['tui', 'theme'], v),
  },
  {
    env: 'GENERATORAI_OUTPUT',
    apply: (t, v) => set(t, ['cli', 'output'], v),
  },
];

function set(target: Json, path: string[], value: unknown): void {
  let node = target;
  for (const key of path.slice(0, -1)) {
    if (!isPlainObject(node[key])) node[key] = {};
    node = node[key] as Json;
  }
  node[path.at(-1)!] = value;
}

function envLayer(env: NodeJS.ProcessEnv): { data: Json; used: string[] } {
  const data: Json = {};
  const used: string[] = [];
  for (const { env: name, apply } of ENV_MAP) {
    const value = env[name];
    if (value === undefined || value === '') continue;
    apply(data, value);
    used.push(name);
  }
  // NO_COLOR is a cross-tool contract, not a GeneratorAI setting.
  if (env['NO_COLOR'] !== undefined) {
    set(data, ['cli', 'color'], 'never');
    used.push('NO_COLOR');
  }
  return { data, used };
}

export interface LoadConfigOptions {
  /** Explicit config file, bypassing the user-config path. */
  configPath?: string;
  /** Layer 5. Already shaped like the config tree. */
  flags?: Json;
  /** Names of the flags that produced `flags`, for `--sources`. */
  flagNames?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<ResolvedCliConfig> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();

  const userPath = options.configPath ?? getUserConfigFilePath();
  const user = await readJson(userPath);

  const projectPath = getProjectConfigFilePath(cwd);
  const project = await readJson(projectPath);

  const { data: envData, used: envUsed } = envLayer(env);

  const merged = deepMerge(
    deepMerge(deepMerge(user.data, project.data), envData),
    options.flags ?? {},
  );

  const parsed = CliConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new CliError('VALIDATION', `Invalid CLI configuration:\n${issues}`, {
      suggestions: [`generatorai config edit`, `generatorai config reset`],
      details: { file: user.found ? userPath : projectPath },
    });
  }

  const config = applyProfile(parsed.data);

  return {
    ...config,
    sources: {
      user: user.found ? userPath : null,
      project: project.found ? projectPath : null,
      env: envUsed,
      flags: options.flagNames ?? [],
    },
  };
}

/**
 * Overlays the active profile.
 *
 * An unknown profile name is an error rather than a silent no-op: quietly
 * running against production because `--config-profile staging` was a typo is
 * exactly the failure this feature exists to prevent.
 */
function applyProfile(config: CliConfig): CliConfig {
  const name = config.activeProfile;
  if (!name) return config;

  const overrides = config.profiles[name];
  if (!overrides) {
    const available = Object.keys(config.profiles);
    throw new CliError('USAGE', `Unknown config profile "${name}".`, {
      hint: available.length
        ? `Available: ${available.join(', ')}`
        : 'No profiles are defined yet.',
      suggestions: ['generatorai config profile list', `generatorai config profile create ${name}`],
    });
  }

  return {
    ...config,
    server: { ...config.server, ...overrides.server },
    cli: { ...config.cli, ...overrides.cli },
    tui: { ...config.tui, ...overrides.tui },
    ...(overrides.activeConnection ? { activeConnection: overrides.activeConnection } : {}),
  };
}

export async function ensureConfigDir(): Promise<string> {
  const dir = getUserConfigDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** Writes the user config, creating the directory and preserving a backup. */
export async function saveUserConfig(config: CliConfig, configPath?: string): Promise<string> {
  const target = configPath ?? getUserConfigFilePath();
  await ensureConfigDir();
  try {
    await fs.copyFile(target, `${target}.bak`);
  } catch {
    // First write — nothing to back up.
  }
  const { sources: _sources, ...serialisable } = config as CliConfig & { sources?: unknown };
  await fs.writeFile(
    target,
    `${JSON.stringify({ ...serialisable, configVersion: CONFIG_VERSION }, null, 2)}\n`,
    'utf8',
  );
  return target;
}

/** Reads the raw user config without merging, for `config set`/`unset`. */
export async function readUserConfig(configPath?: string): Promise<CliConfig> {
  const { data } = await readJson(configPath ?? getUserConfigFilePath());
  // Salvage rather than reset (open question #37). This used to be
  // `parsed.success ? parsed.data : CliConfigSchema.parse({})` — a config the
  // schema could not parse was silently replaced by DEFAULTS, and since
  // `config set` reads through here and then writes the result back, one
  // unrecognised key turned into "every setting you ever changed is gone",
  // with no message. `migrateConfig` keeps every section and key that still
  // validates and reports the rest.
  return migrateConfig(data).config;
}

/**
 * The same read, with what the migration had to drop.
 *
 * Separate from `readUserConfig` so the common caller stays a one-liner
 * while a surface that can actually TELL the user (`config show`, the TUI's
 * settings pane) can report it.
 */
export async function readUserConfigWithMigration(
  configPath?: string,
): Promise<ConfigMigration> {
  const { data } = await readJson(configPath ?? getUserConfigFilePath());
  return migrateConfig(data);
}

/** `server.url` → the value at that path, or undefined. */
export function getConfigValue(config: CliConfig, dottedKey: string): unknown {
  let node: unknown = config;
  for (const key of dottedKey.split('.')) {
    if (!isPlainObject(node)) return undefined;
    node = node[key];
  }
  return node;
}

/**
 * Sets a dotted key, coercing the string a shell gives us into the type the
 * schema wants. Without coercion `config set tui.mouse true` stores the
 * STRING "true", which is truthy but fails schema validation on next load.
 */
export function setConfigValue(config: CliConfig, dottedKey: string, raw: string): CliConfig {
  const clone = structuredClone(config) as unknown as Json;
  const path = dottedKey.split('.');

  let value: unknown = raw;
  if (raw === 'true') value = true;
  else if (raw === 'false') value = false;
  else if (raw === 'null') value = null;
  else if (raw !== '' && !Number.isNaN(Number(raw)) && /^-?\d+(\.\d+)?$/.test(raw)) {
    value = Number(raw);
  }

  set(clone, path, value);

  const parsed = CliConfigSchema.safeParse(clone);
  if (!parsed.success) {
    const issue = parsed.error.issues.find((i) => i.path.join('.') === dottedKey)
      ?? parsed.error.issues[0];
    throw new CliError('VALIDATION', `Cannot set ${dottedKey}: ${issue?.message ?? 'invalid value'}`, {
      hint: `Received ${JSON.stringify(value)}.`,
    });
  }
  return parsed.data;
}
