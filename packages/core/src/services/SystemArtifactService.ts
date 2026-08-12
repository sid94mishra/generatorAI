// ────────────────────────────────────────────────────────────────
// SystemArtifactService — Manages system-level skills/prompts/agents
// Loads from templates/system/artifacts/ at boot and persists to DB
// ────────────────────────────────────────────────────────────────

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, basename, extname, resolve, relative, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ConfigType, SystemConfig, ArtifactWithSource, ProjectConfig, ILogger } from '@generatorai/shared';

export interface ISystemConfigRepository {
  upsert(config: SystemConfig): Promise<SystemConfig>;
  getById(id: string): Promise<SystemConfig>;
  getAll(type?: ConfigType): Promise<SystemConfig[]>;
  deleteAll(): Promise<void>;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Read `name` / `description` / arbitrary metadata out of a skill or prompt
 * file's YAML frontmatter. Returns empty metadata for files without one, which
 * is the common case for plain-markdown prompts.
 */
function readFrontmatter(raw: string): { name?: string; description?: string; metadata: Record<string, unknown> } {
  const match = FRONTMATTER_RE.exec(raw.replace(/^\uFEFF/, ''));
  if (!match) return { metadata: {} };
  try {
    const parsed = parseYaml(match[1] ?? '', { maxAliasCount: 0 }) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { metadata: {} };
    const fm = parsed as Record<string, unknown>;
    return {
      ...(typeof fm['name'] === 'string' ? { name: fm['name'] } : {}),
      ...(typeof fm['description'] === 'string' ? { description: fm['description'] } : {}),
      metadata: fm,
    };
  } catch {
    return { metadata: {} };
  }
}

export class SystemArtifactService {
  constructor(
    private systemConfigRepo: ISystemConfigRepository,
    private systemArtifactsDir: string,
    private logger: ILogger,
  ) {}

  /** Absolute path of the directory this service scans. */
  get artifactsDir(): string {
    return this.systemArtifactsDir;
  }

  /**
   * Scan the system artifacts directory and upsert into DB.
   * Called at boot time.
   *
   * Ids are derived from the path RELATIVE to the category root, not the
   * basename: two files with the same basename in different subfolders used to
   * collide and silently overwrite each other.
   */
  async loadSystemArtifacts(): Promise<void> {
    const categories: ConfigType[] = ['skill', 'prompt', 'agent'];
    let total = 0;

    for (const type of categories) {
      const dir = join(this.systemArtifactsDir, `${type}s`);
      try {
        const dirStat = await stat(dir).catch(() => null);
        if (!dirStat?.isDirectory()) continue;
        const root = resolve(dir);

        const files = await readdir(dir, { recursive: true });
        for (const file of files) {
          const filePath = resolve(join(dir, file));
          const rel = relative(root, filePath);
          // Reject anything that escapes the category root (symlink, ..).
          if (rel.startsWith('..') || rel.startsWith(sep)) continue;
          const fileStat = await stat(filePath).catch(() => null);
          if (!fileStat?.isFile()) continue;

          const slug = rel.slice(0, rel.length - extname(rel).length).split(sep).join('-');
          const id = `system-${type}-${slug}`;
          const now = new Date();

          let front: ReturnType<typeof readFrontmatter> = { metadata: {} };
          try {
            front = readFrontmatter(await readFile(filePath, 'utf-8'));
          } catch {
            // Binary or unreadable file — still catalog it, just without metadata.
          }

          await this.systemConfigRepo.upsert({
            id,
            type,
            name: front.name ?? basename(file, extname(file)),
            description: front.description ?? `System ${type}: ${basename(file, extname(file))}`,
            filePath,
            version: typeof front.metadata['version'] === 'string' ? front.metadata['version'] : '1.0.0',
            metadata: front.metadata,
            createdAt: now,
            updatedAt: now,
          });
          total++;
        }
      } catch (err) {
        this.logger.warn(`[SystemArtifact] Error scanning ${dir}: ${err}`);
      }
    }

    this.logger.info(`[SystemArtifact] Loaded ${total} system artifacts from ${this.systemArtifactsDir}`);
  }

  async listSystemArtifacts(type?: ConfigType): Promise<SystemConfig[]> {
    return this.systemConfigRepo.getAll(type);
  }

  async getSystemArtifactContent(id: string): Promise<string> {
    const config = await this.systemConfigRepo.getById(id);
    return readFile(config.filePath, 'utf-8');
  }

  /**
   * Merged list: system + project artifacts with a source indicator.
   *
   * This is a PRECEDENCE merge, not a concatenation: a project artifact with
   * the same `(type, name)` as a system one shadows it, so resolving an
   * artifact by name is unambiguous.
   */
  async getAvailableArtifacts(
    projectConfigs: ProjectConfig[],
    type?: ConfigType,
  ): Promise<ArtifactWithSource[]> {
    const systemArtifacts = await this.listSystemArtifacts(type);
    const byKey = new Map<string, ArtifactWithSource>();

    for (const sa of systemArtifacts) {
      byKey.set(`${sa.type}:${sa.name.toLowerCase()}`, {
        id: sa.id,
        type: sa.type,
        name: sa.name,
        description: sa.description,
        filePath: sa.filePath,
        source: 'system',
        metadata: sa.metadata,
      });
    }

    const filteredProjectConfigs = type
      ? projectConfigs.filter((c) => c.type === type)
      : projectConfigs;

    for (const pc of filteredProjectConfigs) {
      byKey.set(`${pc.type}:${pc.name.toLowerCase()}`, {
        id: pc.id,
        type: pc.type,
        name: pc.name,
        description: pc.description,
        filePath: pc.filePath,
        source: 'project',
        metadata: pc.metadata,
      });
    }

    return [...byKey.values()];
  }
}
