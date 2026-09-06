// ────────────────────────────────────────────────────────────────
// ArtifactCatalog — the single read model for skills + MCP servers.
//
// `AgentService` validates against it and `AgentResolver` materialises from it,
// so both agree on what a skill id or an MCP server id means. Everything is
// resolved by ID: an agent may only reference vetted registry entries, never
// carry an inline MCP server definition (which would be an arbitrary local
// process-spawn primitive that bypasses the `exec:terminal` scope).
//
// MCP servers come from three registries, all normalised to `CatalogMcpServer`:
//   system   templates/system/mcp-servers.json + the user's server-side prefs
//            (on/off, `{{input}}` values, stored credentials)
//   custom   servers added in Settings → MCP Servers (McpSettingsStore)
//   project  `project_configs` rows of type `mcp` (+ `credential_refs`)
//
// Credentials are forwarded as `secretref:` POINTERS in `config.headers` /
// `config.env`. The hub swaps them for values right before the harness gets
// the map; nothing that persists a catalog entry ever holds a value.
// ────────────────────────────────────────────────────────────────

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MCP_PLACEHOLDER_RE, mcpCredentialNamespace } from '@generatorai/shared';
import type {
  CustomMcpServerRecord,
  ILogger,
  McpCredentialRefs,
  McpNeedsConfiguration,
  McpServerConfig,
  McpServerSource,
  ProjectConfig,
  SystemMcpCatalogEntry,
  SystemMcpServerPrefs,
} from '@generatorai/shared';
import { McpCredentialVault } from '../mcp/McpCredentialVault.js';
import type { McpSettingsStore } from '../mcp/McpSettingsStore.js';
import type { SystemArtifactService } from './SystemArtifactService.js';

export interface CatalogSkill {
  id: string;
  name: string;
  description?: string;
  filePath: string;
  source: 'system' | 'project';
}

export interface CatalogMcpServer {
  id: string;
  name: string;
  description?: string;
  /** Harness-ready config, with credential POINTERS (never values). */
  config: McpServerConfig;
  source: McpServerSource;
  /**
   * Effective: the user's toggle AND fully configured. Only `enabled` servers
   * are ever sent to a harness.
   */
  enabled: boolean;
  /** The user's toggle alone. */
  userEnabled: boolean;
  /** Present when inputs or required credentials are still missing. */
  needsConfiguration?: McpNeedsConfiguration;
  credentialRefs?: McpCredentialRefs;
  /** Bundled-catalog metadata for the Settings form (system scope only). */
  catalog?: Pick<SystemMcpCatalogEntry, 'inputs' | 'credentials' | 'category'>;
  inputValues?: Record<string, string>;
}

export interface IProjectConfigReader {
  getByProjectId(projectId: string, type?: string): Promise<ProjectConfig[]>;
}

/** Raw entry shape of a project MCP JSON file (legacy `type` accepted). */
interface ProjectMcpFile {
  serverType?: string;
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  timeoutMs?: number;
  enabled?: boolean;
}

export interface ArtifactCatalogOptions {
  /** Server-side MCP settings. Absent → bundled defaults, no custom servers. */
  mcpSettings?: McpSettingsStore;
  /**
   * Resolve a project config row to the actual file on disk.
   *
   * `ProjectConfig.filePath` is stored RELATIVE to that project's per-type
   * config directory (`ProjectConfigService.uploadConfig` writes it that
   * way, and `getConfigContent`/`updateConfigContent` join it with
   * `projectService.getProjectConfigTypeDir(projectId, type)` before every
   * read). `ArtifactCatalog` has no `ProjectService` of its own, so without
   * this callback it read `c.filePath` as-is — a relative path resolved
   * against `process.cwd()`, which is never the config directory outside a
   * test that hands it an absolute path directly. Every real project MCP
   * server therefore failed to parse and was silently dropped (the
   * catch-and-skip a few lines below exists for a corrupt file, not this).
   * Default: identity, for callers (and the existing unit tests) that
   * already store/pass an absolute path.
   */
  resolveProjectConfigPath?: (config: ProjectConfig) => string;
}

export class ArtifactCatalog {
  constructor(
    private systemArtifactService: SystemArtifactService,
    private projectConfigRepo: IProjectConfigReader,
    private systemTemplatesDir: string,
    private logger: ILogger,
    private options: ArtifactCatalogOptions = {},
  ) {}

  async listSkills(projectId?: string): Promise<CatalogSkill[]> {
    const system = await this.systemArtifactService.listSystemArtifacts('skill');
    const out: CatalogSkill[] = system.map((s) => ({
      id: s.id,
      name: s.name,
      ...(s.description ? { description: s.description } : {}),
      filePath: s.filePath,
      source: 'system' as const,
    }));

    if (projectId) {
      const configs = await this.projectConfigRepo.getByProjectId(projectId, 'skill');
      for (const c of configs) {
        out.push({
          id: c.id,
          name: c.name,
          ...(c.description ? { description: c.description } : {}),
          filePath: c.filePath,
          source: 'project',
        });
      }
    }
    return out;
  }

  /** The raw bundled catalog, validated. Missing/corrupt file → `[]` (logged). */
  async readSystemCatalog(): Promise<SystemMcpCatalogEntry[]> {
    try {
      const raw = await readFile(join(this.systemTemplatesDir, 'mcp-servers.json'), 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return (parsed as SystemMcpCatalogEntry[]).filter(
        (e) => e && typeof e.id === 'string' && typeof e.name === 'string',
      );
    } catch (err) {
      this.logger.warn(`[ArtifactCatalog] Could not read system MCP registry: ${String(err)}`);
      return [];
    }
  }

  async listMcpServers(projectId?: string): Promise<CatalogMcpServer[]> {
    const out: CatalogMcpServer[] = [];
    const settings = this.options.mcpSettings?.load();

    for (const entry of await this.readSystemCatalog()) {
      const built = this.buildSystemServer(entry, settings?.system[entry.id] ?? {});
      if (built) out.push(built);
    }

    for (const custom of settings?.custom ?? []) {
      const built = this.buildCustomServer(custom);
      if (built) out.push(built);
    }

    if (projectId) {
      const configs = await this.projectConfigRepo.getByProjectId(projectId, 'mcp');
      for (const c of configs) {
        try {
          const path = this.options.resolveProjectConfigPath?.(c) ?? c.filePath;
          const body = JSON.parse(await readFile(path, 'utf-8')) as ProjectMcpFile;
          const built = this.buildProjectServer(c, body);
          if (built) out.push(built);
        } catch {
          // A project MCP file that no longer parses is skipped rather than
          // failing the whole catalog read.
        }
      }
    }
    return out;
  }

  // ── Builders ──

  private buildSystemServer(
    entry: SystemMcpCatalogEntry,
    prefs: SystemMcpServerPrefs,
  ): CatalogMcpServer | null {
    const inputs = prefs.inputs ?? {};
    const declared = new Map((entry.inputs ?? []).map((i) => [i.key, i]));

    // Substitute `{{key}}`. Any placeholder — declared or not — that has no
    // value is a missing input: an unfilled example value must never reach a
    // harness (the bundled Postgres/filesystem entries used to ship as
    // `postgresql://localhost/mydb` and `/tmp`, which "worked" by connecting
    // to the wrong thing).
    const missingInputs = new Set<string>();
    const fill = (s: string): string =>
      s.replace(MCP_PLACEHOLDER_RE, (_m, key: string) => {
        const v = inputs[key];
        if (v === undefined || v === '') {
          missingInputs.add(key);
          return '';
        }
        return v;
      });
    for (const [key, def] of declared) {
      if (def.required !== false && (inputs[key] === undefined || inputs[key] === '')) missingInputs.add(key);
    }

    const filled: ProjectMcpFile = {
      serverType: entry.serverType,
      ...(entry.url ? { url: fill(entry.url) } : {}),
      ...(entry.command ? { command: fill(entry.command) } : {}),
      ...(entry.args ? { args: entry.args.map(fill) } : {}),
    };
    const config = this.toConfig(filled);
    if (!config) return null;

    const refs = prefs.credentialRefs ?? {};
    const missingCredentials: string[] = [];
    for (const c of entry.credentials?.env ?? []) {
      if (c.required !== false && !refs.env?.includes(c.name)) missingCredentials.push(c.name);
    }
    for (const c of entry.credentials?.headers ?? []) {
      if (c.required !== false && !refs.headers?.includes(c.name)) missingCredentials.push(c.name);
    }
    Object.assign(config, McpCredentialVault.refsToConfigFields(mcpCredentialNamespace('system', entry.id), refs));

    const needs: McpNeedsConfiguration | undefined =
      missingInputs.size || missingCredentials.length
        ? { missingInputs: [...missingInputs].sort(), missingCredentials }
        : undefined;
    const userEnabled = prefs.enabled ?? entry.enabled !== false;

    return {
      id: entry.id,
      name: entry.name,
      ...(entry.description ? { description: entry.description } : {}),
      config,
      source: 'system',
      enabled: userEnabled && !needs,
      userEnabled,
      ...(needs ? { needsConfiguration: needs } : {}),
      credentialRefs: refs,
      catalog: {
        ...(entry.inputs ? { inputs: entry.inputs } : {}),
        ...(entry.credentials ? { credentials: entry.credentials } : {}),
        ...(entry.category ? { category: entry.category } : {}),
      },
      ...(Object.keys(inputs).length ? { inputValues: inputs } : {}),
    };
  }

  private buildCustomServer(record: CustomMcpServerRecord): CatalogMcpServer | null {
    const config = this.toConfig({
      serverType: record.serverType,
      ...(record.url ? { url: record.url } : {}),
      ...(record.command ? { command: record.command } : {}),
      ...(record.args ? { args: record.args } : {}),
      ...(record.timeoutMs ? { timeoutMs: record.timeoutMs } : {}),
    });
    if (!config) return null;
    Object.assign(
      config,
      McpCredentialVault.refsToConfigFields(mcpCredentialNamespace('custom', record.id), record.credentialRefs),
    );
    return {
      id: record.id,
      name: record.name,
      ...(record.description ? { description: record.description } : {}),
      config,
      source: 'custom',
      enabled: record.enabled,
      userEnabled: record.enabled,
      credentialRefs: record.credentialRefs,
    };
  }

  private buildProjectServer(c: ProjectConfig, body: ProjectMcpFile): CatalogMcpServer | null {
    const config = this.toConfig(body);
    if (!config) return null;
    const refs = c.credentialRefs ?? {};
    Object.assign(config, McpCredentialVault.refsToConfigFields(mcpCredentialNamespace('project', c.id), refs));
    const enabled = body.enabled !== false;
    return {
      id: c.id,
      name: c.name,
      ...(c.description ? { description: c.description } : {}),
      config,
      source: 'project',
      enabled,
      userEnabled: enabled,
      credentialRefs: refs,
    };
  }

  /** Registries historically use `serverType`; the runtime type is `type`. */
  private toConfig(entry: ProjectMcpFile): McpServerConfig | null {
    const kind = entry.serverType ?? entry.type;
    const timeout = typeof entry.timeoutMs === 'number' && entry.timeoutMs > 0 ? { timeoutMs: entry.timeoutMs } : {};
    if (kind === 'stdio') {
      if (!entry.command) return null;
      return { type: 'stdio', command: entry.command, args: entry.args ?? [], ...timeout };
    }
    if (kind === 'http' || kind === 'sse') {
      if (!entry.url) return null;
      return { type: kind, url: entry.url, ...timeout };
    }
    return null;
  }
}
