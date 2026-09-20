import type { HarnessProviderId } from '@generatorai/shared';
// ────────────────────────────────────────────────────────────────
// AgentService — CRUD, validation, import/export and system sync for the
// first-class Agent entity.
//
// Validation REJECTS at save time rather than warning at run time: an agent
// pinned to a model its provider does not serve would otherwise fail a stage
// hours later with no obvious cause.
// ────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type {
  Agent,
  AgentRole,
  AgentScope,
  CreateAgentParams,
  ILogger,
  ResolutionWarning,
  ResolvedAgentProjection,
  UpdateAgentParams,
} from '@generatorai/shared';
import {
  AGENT_INSTRUCTIONS_MAX_BYTES,
  AGENT_SLUG_PATTERN,
  ConflictError,
  NotFoundError,
  ValidationError,
  agentRef as buildRef,
  parseAgentRef,
  slugifyAgentName,
} from '@generatorai/shared';
import type { IAgentRepository, AgentListFilter, AgentUsage } from '../domain/ports/IAgentRepository.js';
import type { ArtifactCatalog } from './ArtifactCatalog.js';
import type { AgentResolver } from './AgentResolver.js';
import { parseAgentMarkdown, serialiseAgentMarkdown } from './agentMarkdown.js';

/** Model catalog probe used to reject impossible model × provider pairs. */
export type ModelCatalogProbe = () => Promise<Array<{ id: string; provider?: string }>>;

export interface AgentServiceDeps {
  agentRepo: IAgentRepository;
  catalog: ArtifactCatalog;
  logger: ILogger;
  /** Optional — when absent, model/provider pairing is not enforced. */
  listModels?: ModelCatalogProbe;
  /** Needed only by `previewDraft`. */
  resolver?: AgentResolver;
  /** Emits `agent.*` so other clients invalidate their caches. */
  emitEvent?: (kind: 'agent.created' | 'agent.updated' | 'agent.deleted', data: Record<string, unknown>) => void;
}

export class AgentService {
  constructor(private deps: AgentServiceDeps) {}

  // ── Read ──

  async list(filter?: AgentListFilter): Promise<Agent[]> {
    return this.deps.agentRepo.list(filter);
  }

  /**
   * Look up by row id OR by portable `scope:slug` ref.
   *
   * Callers overwhelmingly hold a ref — it is what bindings, the CLI and
   * exported workflows carry — so accepting only the id made
   * `GET /agents/system:code-reviewer` a 404 for an agent that plainly exists.
   */
  async get(idOrRef: string): Promise<Agent> {
    const parsed = parseAgentRef(idOrRef);
    if (parsed) {
      const byRef = await this.deps.agentRepo.getByRef(idOrRef);
      if (byRef) return byRef;
      throw new NotFoundError('Agent', idOrRef);
    }
    return this.deps.agentRepo.getById(idOrRef);
  }

  async getByRef(ref: string): Promise<Agent | null> {
    return this.deps.agentRepo.getByRef(ref);
  }

  async usage(ref: string): Promise<AgentUsage> {
    return this.deps.agentRepo.countUsage(ref);
  }

  /**
   * Agents selectable at a binding site: project scope shadows global, which
   * shadows system, on slug collision.
   */
  async listSelectable(projectId?: string): Promise<Agent[]> {
    const all = await this.deps.agentRepo.list({ enabledOnly: true });
    const bySlug = new Map<string, Agent>();
    const rank: Record<AgentScope, number> = { system: 0, global: 1, project: 2 };
    for (const a of all) {
      if (a.scope === 'project' && a.projectId !== (projectId ?? '')) continue;
      const current = bySlug.get(a.slug);
      if (!current || rank[a.scope] > rank[current.scope]) bySlug.set(a.slug, a);
    }
    return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── Write ──

  async create(params: CreateAgentParams): Promise<{ agent: Agent; warnings: ResolutionWarning[] }> {
    const scope: AgentScope = params.scope ?? 'global';
    if (scope === 'project' && !params.projectId) {
      throw new ValidationError('A project-scoped agent requires a projectId');
    }
    const projectId = scope === 'project' ? params.projectId! : '';
    const slug = params.slug ?? slugifyAgentName(params.name);

    const now = new Date();
    const agent: Agent = {
      id: randomUUID(),
      scope,
      projectId,
      slug,
      ref: buildRef(scope, slug),
      name: params.name,
      description: params.description,
      instructions: params.instructions,
      role: params.role ?? 'agent',
      projection: params.projection ?? 'append',
      ...(params.icon ? { icon: params.icon } : {}),
      ...(params.color ? { color: params.color } : {}),
      tags: params.tags ?? [],
      enabled: params.enabled ?? true,
      skillIds: params.skillIds ?? [],
      mcpServerIds: params.mcpServerIds ?? [],
      tools: params.tools ?? {},
      runtime: params.runtime ?? {},
      ...(params.orchestration ? { orchestration: params.orchestration } : {}),
      version: 1,
      ...(params.sourcePath ? { sourcePath: params.sourcePath } : {}),
      createdAt: now,
      updatedAt: now,
    };

    const warnings = await this.validate(agent, null);
    const created = await this.deps.agentRepo.create(agent);
    this.deps.emitEvent?.('agent.created', {
      agentId: created.id,
      ref: created.ref,
      name: created.name,
      scope: created.scope,
    });
    return { agent: created, warnings };
  }

  async update(
    idOrRef: string,
    params: UpdateAgentParams,
  ): Promise<{ agent: Agent; warnings: ResolutionWarning[] }> {
    const existing = await this.get(idOrRef);
    const id = existing.id;

    const nextScope = params.scope ?? existing.scope;
    const nextSlug = params.slug ?? existing.slug;
    const nextRole = params.role ?? existing.role;

    // A stage/chat binds by `scope:slug`; changing either silently breaks every
    // binding, so refuse while the agent is in use.
    if ((nextScope !== existing.scope || nextSlug !== existing.slug)) {
      const usage = await this.deps.agentRepo.countUsage(existing.ref);
      if (usage.chats.length + usage.stages.length + usage.workflows.length > 0) {
        throw new ConflictError(
          `Cannot change the scope or slug of '${existing.ref}' while it is bound to ` +
            `${usage.chats.length} chat(s), ${usage.stages.length} stage(s) and ${usage.workflows.length} workflow(s)`,
        );
      }
    }

    if (nextRole !== existing.role && existing.role === 'agent') {
      const usage = await this.deps.agentRepo.countUsage(existing.ref);
      if (usage.stages.length > 0) {
        throw new ConflictError(
          `Cannot turn '${existing.ref}' into an orchestrator while ${usage.stages.length} workflow stage(s) bind it. Duplicate it instead.`,
        );
      }
    }

    const merged: Agent = {
      ...existing,
      ...params,
      scope: nextScope,
      projectId: nextScope === 'project' ? (params.projectId ?? existing.projectId) : '',
      slug: nextSlug,
      ref: buildRef(nextScope, nextSlug),
      role: nextRole,
      version: existing.version + 1,
      updatedAt: new Date(),
    } as Agent;

    const warnings = await this.validate(merged, existing);
    const updated = await this.deps.agentRepo.update(id, merged);
    this.deps.emitEvent?.('agent.updated', {
      agentId: updated.id,
      ref: updated.ref,
      name: updated.name,
      version: updated.version,
    });
    return { agent: updated, warnings };
  }

  /**
   * Hard-delete when unbound. With bindings, `force` soft-deletes
   * (`enabled = false`) so existing chats keep replaying from their snapshot
   * and new sessions degrade with an `AGENT_NOT_FOUND` warning.
   */
  async delete(idOrRef: string, force = false): Promise<{ soft: boolean }> {
    const existing = await this.get(idOrRef);
    const id = existing.id;
    const usage = await this.deps.agentRepo.countUsage(existing.ref);
    const bound = usage.chats.length + usage.stages.length + usage.workflows.length;

    if (bound > 0 && !force) {
      throw new ConflictError(
        `Agent '${existing.ref}' is bound to ${usage.chats.length} chat(s), ` +
          `${usage.stages.length} stage(s) and ${usage.workflows.length} workflow(s). ` +
          `Re-run with force to disable it instead.`,
      );
    }

    if (bound > 0) {
      await this.deps.agentRepo.update(id, { enabled: false });
      this.deps.emitEvent?.('agent.deleted', { agentId: id, ref: existing.ref, soft: true });
      return { soft: true };
    }

    await this.deps.agentRepo.delete(id);
    this.deps.emitEvent?.('agent.deleted', { agentId: id, ref: existing.ref, soft: false });
    return { soft: false };
  }

  // ── Validation ──

  /**
   * Throws on anything that must never persist; returns warnings for things
   * that degrade gracefully (a skill deleted after the agent referenced it).
   */
  async validate(agent: Agent, previous: Agent | null): Promise<ResolutionWarning[]> {
    const warnings: ResolutionWarning[] = [];

    if (!AGENT_SLUG_PATTERN.test(agent.slug)) {
      throw new ValidationError(
        `Invalid slug '${agent.slug}'. Use 2-64 lowercase letters, digits and hyphens.`,
      );
    }
    if (agent.description.trim().length < 10) {
      throw new ValidationError(
        'Description must be at least 10 characters — it is what tells the model when to use this agent',
      );
    }
    if (Buffer.byteLength(agent.instructions, 'utf-8') > AGENT_INSTRUCTIONS_MAX_BYTES) {
      throw new ValidationError(
        `Instructions exceed the ${AGENT_INSTRUCTIONS_MAX_BYTES / 1024} KB limit`,
      );
    }

    if (agent.role === 'orchestrator') {
      agent.tools = { ...agent.tools, orchestration: true };
      const refs = agent.orchestration?.teamAgentRefs ?? [];
      if (refs.includes(agent.ref)) {
        throw new ValidationError('An orchestrator cannot include itself in its own team');
      }
      for (const ref of refs) {
        if (!parseAgentRef(ref)) {
          throw new ValidationError(`Invalid team agent ref '${ref}'`);
        }
        const member = await this.deps.agentRepo.getByRef(ref);
        if (!member) {
          warnings.push({ code: 'TEAM_AGENT_NOT_FOUND', params: { ref } });
          continue;
        }
        if (member.role === 'orchestrator') {
          throw new ValidationError(
            `Team member '${ref}' is itself an orchestrator; nested orchestration is not supported`,
          );
        }
      }
    } else if (agent.orchestration) {
      throw new ValidationError('Only orchestrator agents may declare an orchestration policy');
    }

    // Invariant: `gpt-*` models are Copilot-only and `claude-*` are Claude-only.
    // A save-time reject beats a run-time stage failure.
    if (agent.runtime.model && agent.runtime.harnessType && this.deps.listModels) {
      try {
        const models = await this.deps.listModels();
        const hit = models.find((m) => m.id === agent.runtime.model);
        if (hit?.provider && hit.provider !== agent.runtime.harnessType) {
          throw new ValidationError(
            `Model '${agent.runtime.model}' belongs to provider '${hit.provider}', not '${agent.runtime.harnessType}'`,
          );
        }
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        // Catalog unavailable (offline / unauthenticated) — do not block a save.
        this.deps.logger.warn(`[AgentService] Model catalog probe failed: ${String(err)}`);
      }
    }

    const projectId = agent.scope === 'project' ? agent.projectId : undefined;
    if (agent.skillIds.length > 0) {
      const skills = await this.deps.catalog.listSkills(projectId);
      const known = new Set(skills.map((s) => s.id));
      for (const id of agent.skillIds) {
        if (!known.has(id)) warnings.push({ code: 'SKILL_NOT_FOUND', params: { id } });
      }
    }
    if (agent.mcpServerIds.length > 0) {
      const servers = await this.deps.catalog.listMcpServers(projectId);
      const known = new Set(servers.map((s) => s.id));
      for (const id of agent.mcpServerIds) {
        if (!known.has(id)) warnings.push({ code: 'MCP_SERVER_NOT_FOUND', params: { id } });
      }
    }

    void previous;
    return warnings;
  }

  /**
   * Resolve an UNSAVED draft so the editor can show effective capabilities
   * (the 5-skills-plus-2 union) before the agent exists.
   */
  async previewDraft(
    draft: Record<string, unknown>,
    opts: {
      projectId?: string;
      harnessType: HarnessProviderId;
      scope: 'chat' | 'stage' | 'worker';
      overrides?: Record<string, unknown>;
    },
  ): Promise<ResolvedAgentProjection> {
    if (!this.deps.resolver) {
      throw new ValidationError('AgentResolver is not wired into AgentService');
    }
    const now = new Date();
    const scope: AgentScope = opts.projectId ? 'project' : 'global';
    const slug = (draft['slug'] as string | undefined) ?? slugifyAgentName((draft['name'] as string) ?? 'draft');
    const inlineAgent: Agent = {
      id: 'draft',
      scope,
      projectId: opts.projectId ?? '',
      slug,
      ref: buildRef(scope, slug),
      name: (draft['name'] as string) ?? 'Draft agent',
      description: (draft['description'] as string) ?? '',
      instructions: (draft['instructions'] as string) ?? '',
      role: (draft['role'] as Agent['role']) ?? 'agent',
      projection: (draft['projection'] as Agent['projection']) ?? 'append',
      tags: (draft['tags'] as string[]) ?? [],
      enabled: true,
      skillIds: (draft['skillIds'] as string[]) ?? [],
      mcpServerIds: (draft['mcpServerIds'] as string[]) ?? [],
      tools: (draft['tools'] as Agent['tools']) ?? {},
      runtime: (draft['runtime'] as Agent['runtime']) ?? {},
      ...(draft['orchestration'] ? { orchestration: draft['orchestration'] as Agent['orchestration'] } : {}),
      version: 0,
      createdAt: now,
      updatedAt: now,
    };

    return this.deps.resolver.resolve({
      inlineAgent,
      ...(opts.overrides ? { overrides: opts.overrides as never } : {}),
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      harnessType: opts.harnessType,
      scope: opts.scope,
    });
  }

  // ── Import / export ──
  async importFromMarkdown(
    markdown: string,
    opts: { scope: 'global' | 'project'; projectId?: string; overwrite?: boolean },
  ): Promise<{ agent: Agent; warnings: ResolutionWarning[] }> {
    const parsed = parseAgentMarkdown(markdown);
    const projectId = opts.scope === 'project' ? opts.projectId : undefined;

    const skills = await this.deps.catalog.listSkills(projectId);
    const skillByName = new Map(skills.map((s) => [s.name.toLowerCase(), s.id]));
    const servers = await this.deps.catalog.listMcpServers(projectId);
    const serverByName = new Map(servers.map((s) => [s.name.toLowerCase(), s.id]));

    const warnings: ResolutionWarning[] = [];
    const skillIds: string[] = [];
    for (const n of parsed.skillNames) {
      const id = skillByName.get(n.toLowerCase());
      if (id) skillIds.push(id);
      else warnings.push({ code: 'SKILL_NOT_FOUND', params: { id: n } });
    }
    const mcpServerIds: string[] = [];
    for (const n of parsed.mcpServerNames) {
      const id = serverByName.get(n.toLowerCase());
      if (id) mcpServerIds.push(id);
      else warnings.push({ code: 'MCP_SERVER_NOT_FOUND', params: { id: n } });
    }

    const slug = parsed.slug ?? slugifyAgentName(parsed.name);
    const existing = await this.deps.agentRepo.getByRef(buildRef(opts.scope, slug));
    const params: CreateAgentParams = {
      scope: opts.scope,
      ...(projectId ? { projectId } : {}),
      slug,
      name: parsed.name,
      description: parsed.description,
      instructions: parsed.instructions,
      role: parsed.role,
      projection: parsed.projection,
      ...(parsed.icon ? { icon: parsed.icon } : {}),
      ...(parsed.color ? { color: parsed.color } : {}),
      tags: parsed.tags,
      skillIds,
      mcpServerIds,
      tools: parsed.tools,
      runtime: parsed.runtime,
      ...(parsed.role === 'orchestrator'
        ? { orchestration: { teamAgentRefs: parsed.teamAgentRefs } }
        : {}),
    };

    if (existing) {
      if (!opts.overwrite) {
        throw new ConflictError(`An agent with ref '${existing.ref}' already exists`);
      }
      const result = await this.update(existing.id, params);
      return { agent: result.agent, warnings: [...warnings, ...result.warnings] };
    }
    const result = await this.create(params);
    return { agent: result.agent, warnings: [...warnings, ...result.warnings] };
  }

  async exportToMarkdown(idOrRef: string): Promise<string> {
    const agent = await this.get(idOrRef);
    const projectId = agent.scope === 'project' ? agent.projectId : undefined;
    const [skills, servers] = await Promise.all([
      this.deps.catalog.listSkills(projectId),
      this.deps.catalog.listMcpServers(projectId),
    ]);
    const skillNames = agent.skillIds
      .map((sid) => skills.find((s) => s.id === sid)?.name)
      .filter((n): n is string => !!n);
    // Names only — an exported document never carries server credentials.
    const mcpServerNames = agent.mcpServerIds
      .map((mid) => servers.find((s) => s.id === mid)?.name)
      .filter((n): n is string => !!n);
    return serialiseAgentMarkdown(agent, { skillNames, mcpServerNames });
  }

  // ── System sync ──

  /**
   * Upsert the bundled `*.agent.md` files under `<systemArtifactsDir>/agents`.
   * A file that disappears leaves its row DISABLED rather than deleted, so
   * existing bindings degrade gracefully instead of dangling.
   */
  async syncSystemAgents(systemArtifactsDir: string): Promise<number> {
    const dir = join(systemArtifactsDir, 'agents');
    const dirStat = await stat(dir).catch(() => null);
    if (!dirStat?.isDirectory()) {
      this.deps.logger.info(`[AgentService] No system agents directory at ${dir}`);
      return 0;
    }

    const root = resolve(dir);
    const seen = new Set<string>();
    let count = 0;

    // `withFileTypes` so symlinks are visible and skipped: a symlinked agent
    // file could point anywhere on disk.
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const parent = (entry as unknown as { parentPath?: string; path?: string }).parentPath
        ?? (entry as unknown as { path?: string }).path
        ?? root;
      const filePath = resolve(join(parent, entry.name));
      const rel = relative(root, filePath);
      if (rel.startsWith('..') || rel.startsWith(sep) || rel.includes(`..${sep}`)) continue;
      if (!entry.name.endsWith('.md')) continue;

      try {
        const raw = await readFile(filePath, 'utf-8');
        const parsed = parseAgentMarkdown(raw);
        const slug = parsed.slug ?? slugifyAgentName(parsed.name);
        seen.add(slug);

        const skills = await this.deps.catalog.listSkills();
        const skillByName = new Map(skills.map((s) => [s.name.toLowerCase(), s.id]));
        const servers = await this.deps.catalog.listMcpServers();
        const serverByName = new Map(servers.map((s) => [s.name.toLowerCase(), s.id]));

        const skillIds = parsed.skillNames
          .map((n) => skillByName.get(n.toLowerCase()))
          .filter((v): v is string => !!v);
        const mcpServerIds = parsed.mcpServerNames
          .map((n) => serverByName.get(n.toLowerCase()))
          .filter((v): v is string => !!v);

        const ref = buildRef('system', slug);
        const existing = await this.deps.agentRepo.getByRef(ref);
        const now = new Date();
        const shape = {
          scope: 'system' as const,
          projectId: '',
          slug,
          ref,
          name: parsed.name,
          description: parsed.description,
          instructions: parsed.instructions,
          role: parsed.role,
          projection: parsed.projection,
          ...(parsed.icon ? { icon: parsed.icon } : {}),
          ...(parsed.color ? { color: parsed.color } : {}),
          tags: parsed.tags,
          enabled: true,
          skillIds,
          mcpServerIds,
          tools: parsed.tools,
          runtime: parsed.runtime,
          ...(parsed.role === 'orchestrator'
            ? { orchestration: { teamAgentRefs: parsed.teamAgentRefs } }
            : {}),
          sourcePath: filePath,
        };

        if (existing) {
          await this.deps.agentRepo.update(existing.id, shape);
        } else {
          await this.deps.agentRepo.create({
            id: randomUUID(),
            ...shape,
            version: 1,
            createdAt: now,
            updatedAt: now,
          });
        }
        count++;
      } catch (err) {
        this.deps.logger.warn(`[AgentService] Skipping ${filePath}: ${String(err)}`);
      }
    }

    const systemAgents = await this.deps.agentRepo.list({ scope: 'system' });
    for (const a of systemAgents) {
      if (!seen.has(a.slug) && a.enabled) {
        await this.deps.agentRepo.update(a.id, { enabled: false });
      }
    }

    this.deps.logger.info(`[AgentService] Synced ${count} system agent(s) from ${dir}`);
    return count;
  }
}

export type { AgentRole, AgentUsage };
