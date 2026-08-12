// ────────────────────────────────────────────────────────────────
// ArtifactCatalog — the single read model for skills + MCP servers.
//
// `AgentService` validates against it and `AgentResolver` materialises from it,
// so both agree on what a skill id or an MCP server id means. Everything is
// resolved by ID: an agent may only reference vetted registry entries, never
// carry an inline MCP server definition (which would be an arbitrary local
// process-spawn primitive that bypasses the `exec:terminal` scope).
// ────────────────────────────────────────────────────────────────

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ILogger, McpServerConfig, ProjectConfig } from '@generatorai/shared';
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
  config: McpServerConfig;
  source: 'system' | 'project';
  enabled: boolean;
}

export interface IProjectConfigReader {
  getByProjectId(projectId: string, type?: string): Promise<ProjectConfig[]>;
}

/** Raw entry shape of `templates/system/mcp-servers.json`. */
interface SystemMcpEntry {
  id?: string;
  name?: string;
  description?: string;
  serverType?: string;
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  enabled?: boolean;
}

export class ArtifactCatalog {
  constructor(
    private systemArtifactService: SystemArtifactService,
    private projectConfigRepo: IProjectConfigReader,
    private systemTemplatesDir: string,
    private logger: ILogger,
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

  async listMcpServers(projectId?: string): Promise<CatalogMcpServer[]> {
    const out: CatalogMcpServer[] = [];

    try {
      const raw = await readFile(join(this.systemTemplatesDir, 'mcp-servers.json'), 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const entry of parsed as SystemMcpEntry[]) {
          const built = this.toConfig(entry);
          if (!built || !entry.id || !entry.name) continue;
          out.push({
            id: entry.id,
            name: entry.name,
            ...(entry.description ? { description: entry.description } : {}),
            config: built,
            source: 'system',
            enabled: entry.enabled !== false,
          });
        }
      }
    } catch (err) {
      this.logger.warn(`[ArtifactCatalog] Could not read system MCP registry: ${String(err)}`);
    }

    if (projectId) {
      const configs = await this.projectConfigRepo.getByProjectId(projectId, 'mcp');
      for (const c of configs) {
        try {
          const body = JSON.parse(await readFile(c.filePath, 'utf-8')) as SystemMcpEntry;
          const built = this.toConfig(body);
          if (!built) continue;
          out.push({
            id: c.id,
            name: c.name,
            ...(c.description ? { description: c.description } : {}),
            config: built,
            source: 'project',
            enabled: body.enabled !== false,
          });
        } catch {
          // A project MCP file that no longer parses is skipped rather than
          // failing the whole catalog read.
        }
      }
    }
    return out;
  }

  /** Both registries historically use `serverType`; the runtime type is `type`. */
  private toConfig(entry: SystemMcpEntry): McpServerConfig | null {
    const kind = entry.serverType ?? entry.type;
    if (kind === 'stdio') {
      if (!entry.command) return null;
      return { type: 'stdio', command: entry.command, args: entry.args ?? [] };
    }
    if (kind === 'http' || kind === 'sse') {
      if (!entry.url) return null;
      return { type: kind, url: entry.url };
    }
    return null;
  }
}
