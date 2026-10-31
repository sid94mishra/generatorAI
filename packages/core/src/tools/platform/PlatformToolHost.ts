// ────────────────────────────────────────────────────────────────
// PlatformToolHost — what the platform tools do, for any caller (D-181).
// `buildPlatformToolSet` wraps these methods as tool definitions for a chat,
// a stage or (through the server's `/platform-tools` route) an external MCP
// client; every binding runs this one implementation.
//
// The limits live HERE, not in a prompt or an approval card (under bypass
// nobody is asked):
//   - scopes: a chat acts for its creating principal (none recorded: the
//     local owner with a device's default grant), a stage for the local owner
//     with that grant, an external caller for its own principal
//   - a chat or stage creates at most `maxChatsPerCaller` chats (default 5),
//     counted from the chats themselves under a per-caller lock; each records
//     its creator in `createdByPrincipal.createdVia` and carries the tag
//     `agent-created`
//   - the permission ceiling: a created chat, a chat prompted or an
//     automation triggered never runs above the caller's own mode; an
//     external caller is capped at acceptEdits, never bypass
//   - a chat cannot prompt or wait for itself; orchestrator workers are
//     driven by their orchestrator only
//   - chat files: read-only, inside that chat's mounts (logical and real
//     path, so a symlink cannot lead out), never `.git`
//   - output caps on every list, transcript and file read
//   - a replayed tool call (same tool call id) answers the first result
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  Agent,
  AttentionFilter,
  AttentionSnapshot,
  Automation,
  AutomationDataset,
  AutomationExecution,
  Chat,
  ChatMessage,
  ChatPermissionMode,
  ChatPrincipal,
  ChatSourceSpec,
  CreateChatParams,
  Project,
  ProjectWithCodebases,
} from '@generatorai/shared';
import type { IChatRepository } from '../../domain/ports/IChatRepository.js';
import { getDefaultChatPermissionMode } from '../../services/agentModePolicy.js';
import { redactAttentionSnapshot } from '../../services/AttentionService.js';
import type { InvocationPrincipal } from '../../services/workflow-invocation/types.js';
import { chatPrincipal, type WorkflowToolTurn } from '../workflows/WorkflowToolHost.js';
import { renderChatForTool, type ChatRenderMode } from './renderChat.js';

/** Who calls the platform tools. */
export type PlatformToolCaller =
  | { kind: 'chat'; chatId: string; sessionId: string }
  | { kind: 'stage'; runId: string; stageRunId: string }
  | { kind: 'external'; principal: InvocationPrincipal; via: 'mcp' | 'http'; clientName?: string | undefined };

/** The turn a tool call belongs to (chats and stages): its mode and the flow keys a blocking wait gives back. */
export type PlatformToolTurn = WorkflowToolTurn;

export interface PlatformToolLimits {
  /** Chats one chat (or stage) may create. */
  maxChatsPerCaller: number;
  /** The longest `wait_for_chat` may block. */
  maxWaitSeconds: number;
  /** `read_chat` text, header included. */
  maxChatChars: number;
  /** `read_chat_file` content per call. */
  maxFileChars: number;
  /** `wait_for_chat` reply text. */
  maxReplyChars: number;
  /** Entries `list_chat_files` returns. */
  maxListEntries: number;
  /** Rows any list returns. */
  maxRows: number;
}

export const DEFAULT_PLATFORM_TOOL_LIMITS: PlatformToolLimits = {
  maxChatsPerCaller: 5,
  maxWaitSeconds: 600,
  maxChatChars: 48_000,
  maxFileChars: 48_000,
  maxReplyChars: 24_000,
  maxListEntries: 500,
  maxRows: 50,
};

/** The chat service slice the tools use (`ChatManagementService`). */
export interface PlatformChatPort {
  createChat(params: CreateChatParams): Promise<Chat>;
  sendPrompt(chatId: string, prompt: string): Promise<void>;
  isTurnActive(chatId: string): boolean;
  getTranscript(chatId: string): Promise<ChatMessage[]>;
  listPendingInteractions(chatId: string): Promise<Array<{ id: string; kind: string }>>;
}

export interface PlatformToolHostDeps {
  chats: PlatformChatPort;
  chatRepo: Pick<IChatRepository, 'getById' | 'listPage'>;
  projects?: { listProjects(filter?: { status?: 'active' | 'archived' }): Promise<Project[]>; getProjectWithCodebases(id: string): Promise<ProjectWithCodebases> } | undefined;
  agents?: { listSelectable(projectId?: string): Promise<Agent[]> } | undefined;
  automations?:
    | {
        listAutomations(projectId?: string): Promise<Automation[]>;
        getAutomation(id: string): Promise<Automation>;
        triggerManual(id: string, opts?: { dataset?: AutomationDataset }): Promise<AutomationExecution>;
      }
    | undefined;
  attention?: { getSnapshot(filter?: AttentionFilter): AttentionSnapshot } | undefined;
  /** The directories a chat's workspace exposes (its mounts; the first is the agent's cwd). */
  chatDirectories?: ((workspaceId: string) => Promise<Array<{ alias: string; dir: string }>>) | undefined;
  limits?: Partial<PlatformToolLimits> | undefined;
  /** The web app origin, for links ('' = relative). */
  appUrl?: string | undefined;
  now?: () => number;
  /** How often `wait_for_chat` looks (ms). */
  pollMs?: number;
}

/** A refusal the tool returns to the model (never thrown past the handler). */
export class PlatformToolRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PlatformToolRefusal';
  }
}

/** The tag every agent-created chat carries. */
export const AGENT_CREATED_TAG = 'agent-created';

const MODE_RANK: Record<ChatPermissionMode, number> = { plan: 0, default: 1, acceptEdits: 2, bypassPermissions: 3 };
const asMode = (m: unknown): ChatPermissionMode | undefined => (typeof m === 'string' && m in MODE_RANK ? (m as ChatPermissionMode) : undefined);
const lower = (a: ChatPermissionMode, b: ChatPermissionMode | undefined): ChatPermissionMode => (b && MODE_RANK[b] < MODE_RANK[a] ? b : a);

/** The trusted side of one call. */
interface Resolved {
  principal: InvocationPrincipal;
  scopes: ReadonlySet<string> | 'all';
  /** The highest mode anything this caller starts may run in. */
  ceiling: ChatPermissionMode;
  creator: NonNullable<ChatPrincipal['createdVia']>;
  /** The calling chat (it may not prompt or wait for itself). */
  selfChatId?: string;
  /** The calling chat's project: the default for chats it creates. */
  projectId?: string;
}

const REPLAY_TTL_MS = 10 * 60_000;

export class PlatformToolHost {
  readonly limits: PlatformToolLimits;
  private readonly now: () => number;
  private readonly pollMs: number;
  private readonly locks = new Map<string, Promise<void>>();
  private readonly replays = new Map<string, { at: number; result: Promise<unknown> }>();

  constructor(private readonly deps: PlatformToolHostDeps) {
    this.limits = { ...DEFAULT_PLATFORM_TOOL_LIMITS, ...(deps.limits ?? {}) };
    this.now = deps.now ?? Date.now;
    this.pollMs = deps.pollMs ?? 500;
  }

  // ── caller ───────────────────────────────────────────────────

  private async resolve(caller: PlatformToolCaller, turn: PlatformToolTurn | undefined): Promise<Resolved> {
    const posture = getDefaultChatPermissionMode();
    if (caller.kind === 'external') {
      return {
        principal: caller.principal,
        scopes: caller.principal.kind === 'system' ? 'all' : new Set(caller.principal.scopes),
        // D-181: an external agent never bypasses, whatever it holds.
        ceiling: lower(posture, 'acceptEdits'),
        creator: { kind: 'external', id: `${caller.via}:${caller.principal.id}` },
      };
    }
    if (caller.kind === 'stage') {
      // A stage acts for the local owner with a device's default grant (not the engine's every-scope principal).
      const principal = chatPrincipal(undefined);
      return {
        principal,
        scopes: new Set(principal.scopes),
        ceiling: asMode(turn?.permissionMode) ?? 'default',
        creator: { kind: 'stage', id: caller.stageRunId },
      };
    }
    const chat = await this.deps.chatRepo.getById(caller.chatId).catch(() => null);
    if (!chat) throw new PlatformToolRefusal('NOT_FOUND', `No chat ${caller.chatId}`);
    if (chat.parentChatId) throw new PlatformToolRefusal('FORBIDDEN', 'Orchestrator workers cannot use the platform tools');
    const principal = chatPrincipal(chat.createdByPrincipal);
    return {
      principal,
      scopes: principal.kind === 'system' ? 'all' : new Set(principal.scopes),
      ceiling: lower(asMode(chat.permissionMode) ?? posture, asMode(turn?.permissionMode)),
      creator: { kind: 'chat', id: caller.chatId },
      selfChatId: caller.chatId,
      ...(chat.projectId ? { projectId: chat.projectId } : {}),
    };
  }

  private need(c: Resolved, scope: string, why: string): void {
    if (c.scopes === 'all' || c.scopes.has(scope)) return;
    throw new PlatformToolRefusal('FORBIDDEN_SCOPE', `${why} needs the ${scope} scope, which the principal this agent acts for does not hold`);
  }

  private link(p: string): string {
    return `${this.deps.appUrl ?? ''}${p}`;
  }

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const chained = prev.then(() => mine);
    this.locks.set(key, chained);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chained) this.locks.delete(key);
    }
  }

  /** A replayed tool call (same id, same caller, same tool) answers the first call's result. */
  private replay<T>(c: Resolved, tool: string, toolCallId: string | undefined, fn: () => Promise<T>): Promise<T> {
    if (!toolCallId) return fn();
    const now = this.now();
    for (const [k, v] of this.replays) if (now - v.at > REPLAY_TTL_MS) this.replays.delete(k);
    const key = `${c.creator.kind}:${c.creator.id}:${tool}:${toolCallId}`;
    const hit = this.replays.get(key);
    if (hit) return hit.result as Promise<T>;
    const result = fn();
    this.replays.set(key, { at: now, result });
    // A failed call may be retried.
    result.catch(() => this.replays.delete(key));
    return result;
  }

  private async chatOf(chatId: string): Promise<Chat> {
    if (!chatId) throw new PlatformToolRefusal('VALIDATION_ERROR', 'chatId is required');
    const chat = await this.deps.chatRepo.getById(chatId).catch(() => null);
    if (!chat) throw new PlatformToolRefusal('NOT_FOUND', `No chat ${chatId}`);
    return chat;
  }

  // ── chats ────────────────────────────────────────────────────

  async listChats(caller: PlatformToolCaller, args: { query?: string; projectId?: string; limit?: number; includeArchived?: boolean }): Promise<unknown> {
    const c = await this.resolve(caller, undefined);
    this.need(c, 'read:chats', 'Listing chats');
    const limit = clampInt(args.limit, 1, this.limits.maxRows, 20);
    const page = await this.deps.chatRepo.listPage({
      filter: {
        ...(args.includeArchived ? {} : { status: 'active' as const }),
        ...(args.projectId ? { projectIds: [args.projectId] } : {}),
        ...(args.query ? { q: args.query.slice(0, 200) } : {}),
      },
      sort: 'activity',
      limit,
    });
    return {
      total: page.total,
      chats: page.rows.map(({ chat, activity }) => ({
        id: chat.id,
        name: chat.name,
        status: chat.status,
        ...(chat.projectId ? { projectId: chat.projectId } : {}),
        ...(chat.agentRef ? { agentRef: chat.agentRef } : {}),
        running: this.deps.chats.isTurnActive(chat.id),
        lastActivityAt: activity.lastActivityAt.toISOString(),
        ...(activity.lastTurn ? { lastTurn: activity.lastTurn.status } : {}),
        ...(chat.tags.length ? { tags: chat.tags } : {}),
        link: this.link(`/chats/${chat.id}`),
      })),
    };
  }

  async readChat(caller: PlatformToolCaller, args: { chatId: string; mode?: ChatRenderMode }): Promise<unknown> {
    const c = await this.resolve(caller, undefined);
    this.need(c, 'read:chats', 'Reading a chat');
    const chat = await this.chatOf(args.chatId);
    const mode: ChatRenderMode = args.mode === 'full' ? 'full' : 'recent';
    const messages = await this.deps.chats.getTranscript(chat.id);
    const rendered = renderChatForTool(chat, messages, { mode, asOf: new Date(this.now()), maxChars: this.limits.maxChatChars });
    return {
      chatId: chat.id,
      name: chat.name,
      mode,
      running: this.deps.chats.isTurnActive(chat.id),
      totalTurns: rendered.totalTurns,
      turnsIncluded: rendered.turnsIncluded,
      link: this.link(`/chats/${chat.id}`),
      text: rendered.text,
    };
  }

  async createChat(
    caller: PlatformToolCaller,
    args: { name: string; prompt?: string; projectId?: string; agentRef?: string; permissionMode?: string },
    call: { toolCallId?: string; turn?: PlatformToolTurn | undefined } = {},
  ): Promise<unknown> {
    const c = await this.resolve(caller, call.turn);
    this.need(c, 'write:chats', 'Creating a chat');
    const name = (args.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!name) throw new PlatformToolRefusal('VALIDATION_ERROR', 'name is required');
    return this.replay(c, 'create_chat', call.toolCallId, () =>
      // Counted and created under one lock per caller, so parallel calls cannot pass the cap together.
      this.withLock(`create:${c.creator.kind}:${c.creator.id}`, async () => {
        if (c.creator.kind !== 'external') {
          const made = await this.createdBy(c.creator);
          if (made >= this.limits.maxChatsPerCaller) {
            throw new PlatformToolRefusal(
              'CHAT_LIMIT',
              `This ${c.creator.kind} has already created ${made} chats, the most it may (${this.limits.maxChatsPerCaller}). Reuse one with send_to_chat.`,
            );
          }
        }
        const projectId = args.projectId || c.projectId;
        const sources = projectId ? await this.projectSources(projectId) : undefined;
        const requested = asMode(args.permissionMode);
        if (args.permissionMode && !requested) throw new PlatformToolRefusal('VALIDATION_ERROR', `Unknown permissionMode "${args.permissionMode}"`);
        const permissionMode = lower(c.ceiling, requested);
        const createdByPrincipal: ChatPrincipal = {
          kind: c.principal.kind,
          id: c.principal.id,
          scopes: [...c.principal.scopes],
          createdVia: c.creator,
        };
        const chat = await this.deps.chats.createChat({
          name,
          ...(projectId ? { projectId } : {}),
          ...(sources?.length ? { sources } : {}),
          ...(args.agentRef ? { agentRef: args.agentRef } : {}),
          permissionMode,
          tags: [AGENT_CREATED_TAG],
          harnessConfig: { availableTools: ['*'], streaming: true },
          createdByPrincipal,
        });
        const prompt = (args.prompt ?? '').trim();
        const status = prompt ? await this.dispatch(chat.id, prompt) : 'idle';
        return { chatId: chat.id, name: chat.name, permissionMode, status, ...(projectId ? { projectId } : {}), link: this.link(`/chats/${chat.id}`) };
      }),
    );
  }

  /** How many chats this creator made (archived ones count too). */
  private async createdBy(creator: NonNullable<ChatPrincipal['createdVia']>): Promise<number> {
    const page = await this.deps.chatRepo.listPage({ filter: { tags: [AGENT_CREATED_TAG], includeWorkers: true }, sort: 'created', limit: 10_000 });
    return page.rows.filter(({ chat }) => chat.createdByPrincipal?.createdVia?.kind === creator.kind && chat.createdByPrincipal.createdVia.id === creator.id).length;
  }

  /** A project chat works on every codebase of the project, each in its own worktree (never the checkout in place). */
  private async projectSources(projectId: string): Promise<ChatSourceSpec[]> {
    if (!this.deps.projects) throw new PlatformToolRefusal('UNAVAILABLE', 'Projects are not available in this process');
    const project = await this.deps.projects.getProjectWithCodebases(projectId).catch(() => null);
    if (!project) throw new PlatformToolRefusal('NOT_FOUND', `No project ${projectId}`);
    return project.codebases.map((cb) => ({ kind: 'codebase' as const, codebaseId: cb.id, mode: 'worktree' as const }));
  }

  async sendToChat(caller: PlatformToolCaller, args: { chatId: string; prompt: string }, call: { toolCallId?: string; turn?: PlatformToolTurn | undefined } = {}): Promise<unknown> {
    const c = await this.resolve(caller, call.turn);
    this.need(c, 'write:chats', 'Prompting a chat');
    if (c.selfChatId && args.chatId === c.selfChatId) throw new PlatformToolRefusal('SELF', 'A chat cannot send a prompt to itself');
    const prompt = (args.prompt ?? '').trim();
    if (!prompt) throw new PlatformToolRefusal('VALIDATION_ERROR', 'prompt is required');
    const chat = await this.chatOf(args.chatId);
    if (chat.status !== 'active') throw new PlatformToolRefusal('ARCHIVED', `Chat ${chat.id} is archived`);
    if (chat.parentChatId) throw new PlatformToolRefusal('FORBIDDEN', 'An orchestrator worker takes prompts from its orchestrator only');
    const mode = asMode(chat.permissionMode) ?? getDefaultChatPermissionMode();
    if (MODE_RANK[mode] > MODE_RANK[c.ceiling]) {
      throw new PlatformToolRefusal(
        'PERMISSION_CEILING',
        `Chat "${chat.name}" runs in ${mode}, above what this agent may start (${c.ceiling}). A person can lower the chat's mode in GeneratorAI, or create a new chat.`,
        { chatPermissionMode: mode, ceiling: c.ceiling },
      );
    }
    return this.replay(c, 'send_to_chat', call.toolCallId, async () => ({
      chatId: chat.id,
      status: await this.dispatch(chat.id, prompt),
      link: this.link(`/chats/${chat.id}`),
    }));
  }

  /**
   * Start a turn and return once it runs (or the send failed). The turn
   * itself is not awaited: `wait_for_chat` follows it.
   */
  private async dispatch(chatId: string, prompt: string): Promise<'started' | 'queued'> {
    let failure: unknown;
    let settled = false;
    void this.deps.chats.sendPrompt(chatId, prompt).then(
      () => {
        settled = true;
      },
      (err: unknown) => {
        failure = err;
        settled = true;
      },
    );
    const until = this.now() + 3_000;
    while (!settled && !this.deps.chats.isTurnActive(chatId) && this.now() < until) await sleep(Math.min(this.pollMs, 50));
    if (failure !== undefined) {
      const code = (failure as { code?: unknown } | null)?.code;
      throw new PlatformToolRefusal(typeof code === 'string' ? code : 'SEND_FAILED', failure instanceof Error ? failure.message : String(failure));
    }
    return this.deps.chats.isTurnActive(chatId) || settled ? 'started' : 'queued';
  }

  async waitForChat(caller: PlatformToolCaller, args: { chatId: string; timeoutSeconds?: number }, call: { turn?: PlatformToolTurn | undefined } = {}): Promise<unknown> {
    const c = await this.resolve(caller, call.turn);
    this.need(c, 'read:chats', 'Waiting for a chat');
    if (c.selfChatId && args.chatId === c.selfChatId) throw new PlatformToolRefusal('SELF', 'A chat cannot wait for itself');
    const chat = await this.chatOf(args.chatId);
    const ms = clampInt(args.timeoutSeconds, 0, this.limits.maxWaitSeconds, 60) * 1000;
    const deadline = this.now() + ms;
    // A turn just sent may not have started yet: give it a moment before calling the chat idle.
    const graceUntil = this.now() + Math.min(ms, 5_000);
    let pending: Array<{ id: string; kind: string }> = [];
    // Waiting gives back the caller's turn permit, so the chat it waits for can run (ECON-R7).
    const takeBack = ms > 0 ? call.turn?.yieldKeys?.() : undefined;
    try {
      for (;;) {
        pending = await this.deps.chats.listPendingInteractions(chat.id).catch(() => []);
        const active = this.deps.chats.isTurnActive(chat.id);
        if (pending.length > 0) break;
        if (!active && (this.now() >= graceUntil || !(await this.awaitsReply(chat.id)))) break;
        if (this.now() >= deadline) break;
        await sleep(Math.min(this.pollMs, Math.max(1, deadline - this.now())));
      }
    } finally {
      await takeBack?.();
    }
    const running = this.deps.chats.isTurnActive(chat.id);
    const status = pending.length > 0 ? 'needs_you' : running ? 'running' : 'idle';
    const reply = await this.lastReply(chat.id);
    return {
      chatId: chat.id,
      status,
      ...(pending.length > 0
        ? { waitingOn: pending.map((p) => p.kind), note: 'The chat waits for a person to answer in GeneratorAI; agents cannot answer it.' }
        : {}),
      ...(status === 'running' ? { note: 'Still running: call wait_for_chat again.' } : {}),
      ...(reply ?? { reply: null }),
      link: this.link(`/chats/${chat.id}`),
    };
  }

  /** The chat's last row is a prompt nobody answered yet. */
  private async awaitsReply(chatId: string): Promise<boolean> {
    const messages = await this.deps.chats.getTranscript(chatId).catch(() => []);
    const last = [...messages].reverse().find((m) => m.role === 'user' || m.role === 'assistant');
    return last?.role === 'user';
  }

  private async lastReply(chatId: string): Promise<{ reply: string; replyAt: string; partial?: boolean; truncated?: boolean } | null> {
    const messages = await this.deps.chats.getTranscript(chatId).catch(() => []);
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role !== 'assistant') continue;
      const text = m.content ?? '';
      const truncated = text.length > this.limits.maxReplyChars;
      return {
        reply: truncated ? `${text.slice(0, this.limits.maxReplyChars)}\n…[truncated]` : text,
        replyAt: new Date(m.timestamp).toISOString(),
        ...(m.metadata?.partial ? { partial: true } : {}),
        ...(truncated ? { truncated: true } : {}),
      };
    }
    return null;
  }

  // ── projects, agents ─────────────────────────────────────────

  async listProjects(caller: PlatformToolCaller): Promise<unknown> {
    const c = await this.resolve(caller, undefined);
    this.need(c, 'read:projects', 'Listing projects');
    if (!this.deps.projects) throw new PlatformToolRefusal('UNAVAILABLE', 'Projects are not available in this process');
    const projects = await this.deps.projects.listProjects({ status: 'active' });
    return {
      projects: projects.slice(0, this.limits.maxRows).map((p) => ({ id: p.id, name: p.name, ...(p.description ? { description: clip(p.description, 400) } : {}) })),
      ...(projects.length > this.limits.maxRows ? { truncated: true } : {}),
    };
  }

  async getProject(caller: PlatformToolCaller, args: { projectId: string }): Promise<unknown> {
    const c = await this.resolve(caller, undefined);
    this.need(c, 'read:projects', 'Reading a project');
    if (!this.deps.projects) throw new PlatformToolRefusal('UNAVAILABLE', 'Projects are not available in this process');
    const p = await this.deps.projects.getProjectWithCodebases(args.projectId).catch(() => null);
    if (!p) throw new PlatformToolRefusal('NOT_FOUND', `No project ${args.projectId}`);
    return {
      id: p.id,
      name: p.name,
      ...(p.description ? { description: clip(p.description, 2_000) } : {}),
      status: p.status,
      codebases: p.codebases.map((cb) => ({
        id: cb.id,
        alias: cb.alias,
        type: cb.type,
        ...(cb.url ? { url: cb.url } : {}),
        ...(cb.defaultBranch ? { defaultBranch: cb.defaultBranch } : {}),
        status: cb.status,
      })),
      link: this.link(`/projects/${p.id}`),
    };
  }

  async listAgents(caller: PlatformToolCaller, args: { projectId?: string }): Promise<unknown> {
    const c = await this.resolve(caller, undefined);
    this.need(c, 'read:workflows', 'Listing agents');
    if (!this.deps.agents) throw new PlatformToolRefusal('UNAVAILABLE', 'Agents are not available in this process');
    const agents = await this.deps.agents.listSelectable(args.projectId || c.projectId);
    return {
      agents: agents.slice(0, this.limits.maxRows).map((a) => ({ ref: a.ref, name: a.name, role: a.role, scope: a.scope, description: clip(a.description, 400) })),
      ...(agents.length > this.limits.maxRows ? { truncated: true } : {}),
    };
  }

  // ── automations ──────────────────────────────────────────────

  async listAutomations(caller: PlatformToolCaller, args: { projectId?: string }): Promise<unknown> {
    const c = await this.resolve(caller, undefined);
    this.need(c, 'read:workflows', 'Listing automations');
    if (!this.deps.automations) throw new PlatformToolRefusal('UNAVAILABLE', 'Automations are not available in this process');
    const list = await this.deps.automations.listAutomations(args.projectId || undefined);
    return {
      automations: list.slice(0, this.limits.maxRows).map((a) => ({
        id: a.id,
        name: a.name,
        ...(a.description ? { description: clip(a.description, 400) } : {}),
        enabled: a.enabled,
        triggerType: a.triggerType,
        ...(a.cronExpression ? { cronExpression: a.cronExpression } : {}),
        workflowCount: a.workflowIds.length,
        permissionMode: a.permissionMode,
        needsData: !!a.dataSchema && !a.defaultDataset,
        ...(a.projectId ? { projectId: a.projectId } : {}),
        ...(a.lastRunAt ? { lastRunAt: new Date(a.lastRunAt).toISOString() } : {}),
        ...(a.nextRunAt ? { nextRunAt: new Date(a.nextRunAt).toISOString() } : {}),
      })),
      ...(list.length > this.limits.maxRows ? { truncated: true } : {}),
    };
  }

  async triggerAutomation(
    caller: PlatformToolCaller,
    args: { automationId: string; data?: unknown },
    call: { toolCallId?: string; turn?: PlatformToolTurn | undefined } = {},
  ): Promise<unknown> {
    const c = await this.resolve(caller, call.turn);
    this.need(c, 'exec:agent', 'Triggering an automation');
    if (!this.deps.automations) throw new PlatformToolRefusal('UNAVAILABLE', 'Automations are not available in this process');
    const automation = await this.deps.automations.getAutomation(args.automationId).catch(() => null);
    if (!automation) throw new PlatformToolRefusal('NOT_FOUND', `No automation ${args.automationId}`);
    const mode = asMode(automation.permissionMode) ?? 'default';
    if (MODE_RANK[mode] > MODE_RANK[c.ceiling]) {
      throw new PlatformToolRefusal(
        'PERMISSION_CEILING',
        `Automation "${automation.name}" runs in ${mode}, above what this agent may start (${c.ceiling}). A person can run it in GeneratorAI.`,
        { automationPermissionMode: mode, ceiling: c.ceiling },
      );
    }
    const dataset = datasetOf(args.data);
    return this.replay(c, 'trigger_automation', call.toolCallId, async () => {
      const execution = await this.deps.automations!.triggerManual(automation.id, dataset ? { dataset } : undefined);
      return { executionId: execution.id, automationId: automation.id, status: execution.status, link: this.link(`/automations/${automation.id}`) };
    });
  }

  // ── activity ─────────────────────────────────────────────────

  async listNeedsYou(caller: PlatformToolCaller, args: { projectId?: string }): Promise<unknown> {
    const c = await this.resolve(caller, undefined);
    this.need(c, 'read:activity', 'Listing what needs a person');
    if (!this.deps.attention) throw new PlatformToolRefusal('UNAVAILABLE', 'The activity feed is not available in this process');
    const snapshot = redactAttentionSnapshot(
      this.deps.attention.getSnapshot(args.projectId ? { projectId: args.projectId } : {}),
      c.scopes === 'all' ? null : [...c.scopes],
    );
    return {
      needsYou: snapshot.needsYou.slice(0, this.limits.maxRows).map((item) => ({
        entity: item.entity,
        id: item.entityId,
        title: item.title,
        since: item.since,
        ...(item.project ? { project: item.project.name } : {}),
        ...(item.parent ? { parent: item.parent.title } : {}),
        ...(item.ask ? { ask: { kind: item.ask.kind, summary: item.ask.summary, ...(item.ask.detail ? { detail: clip(item.ask.detail, 400) } : {}) } } : {}),
        link: this.link(item.href),
      })),
      counts: { needsYou: snapshot.counts.needsYou, running: snapshot.counts.running },
      note: 'Only a person answers these, in GeneratorAI.',
    };
  }

  // ── chat files ───────────────────────────────────────────────

  private async chatDirs(c: Resolved, chatId: string): Promise<{ chat: Chat; dirs: Array<{ alias: string; dir: string }> }> {
    this.need(c, 'read:chats', 'Reading a chat\'s files');
    this.need(c, 'read:files', 'Reading a chat\'s files');
    const chat = await this.chatOf(chatId);
    if (!chat.workspaceId || !this.deps.chatDirectories) throw new PlatformToolRefusal('NO_WORKSPACE', `Chat ${chat.id} has no workspace`);
    const dirs = await this.deps.chatDirectories(chat.workspaceId);
    if (dirs.length === 0) throw new PlatformToolRefusal('NO_WORKSPACE', `Chat ${chat.id} has no files`);
    return { chat, dirs };
  }

  async listChatFiles(caller: PlatformToolCaller, args: { chatId: string; path?: string; recursive?: boolean }): Promise<unknown> {
    const c = await this.resolve(caller, undefined);
    const { chat, dirs } = await this.chatDirs(c, args.chatId);
    const target = await resolveInside(dirs, args.path ?? '');
    const stat = await fs.stat(target.full).catch(() => null);
    if (!stat) throw new PlatformToolRefusal('NOT_FOUND', `No such path: ${args.path ?? ''}`);
    if (!stat.isDirectory()) throw new PlatformToolRefusal('NOT_A_DIRECTORY', `${args.path} is a file: use read_chat_file`);
    const entries: Array<{ path: string; type: 'file' | 'dir'; size?: number }> = [];
    let truncated = false;
    const walk = async (abs: string, rel: string, depth: number): Promise<void> => {
      const items = await fs.readdir(abs, { withFileTypes: true }).catch(() => []);
      items.sort((a, b) => a.name.localeCompare(b.name));
      for (const item of items) {
        if (item.name === '.git') continue;
        if (entries.length >= this.limits.maxListEntries) {
          truncated = true;
          return;
        }
        const childRel = rel ? `${rel}/${item.name}` : item.name;
        const shown = target.prefix ? `${target.prefix}/${childRel}` : childRel;
        if (item.isDirectory()) {
          entries.push({ path: shown, type: 'dir' });
          if (args.recursive && depth < 12 && item.name !== 'node_modules') await walk(path.join(abs, item.name), childRel, depth + 1);
        } else if (item.isFile()) {
          const size = (await fs.stat(path.join(abs, item.name)).catch(() => null))?.size;
          entries.push({ path: shown, type: 'file', ...(size !== undefined ? { size } : {}) });
        }
      }
    };
    await walk(target.full, target.rel, 0);
    return {
      chatId: chat.id,
      ...(dirs.length > 1 ? { mounts: dirs.map((d) => d.alias) } : {}),
      path: target.prefix ? [target.prefix, target.rel].filter(Boolean).join('/') : target.rel,
      entries,
      ...(truncated ? { truncated: true } : {}),
    };
  }

  async readChatFile(caller: PlatformToolCaller, args: { chatId: string; path: string; offset?: number }): Promise<unknown> {
    const c = await this.resolve(caller, undefined);
    if (!args.path) throw new PlatformToolRefusal('VALIDATION_ERROR', 'path is required');
    const { chat, dirs } = await this.chatDirs(c, args.chatId);
    const target = await resolveInside(dirs, args.path);
    const stat = await fs.stat(target.full).catch(() => null);
    if (!stat) throw new PlatformToolRefusal('NOT_FOUND', `No such file: ${args.path}`);
    if (!stat.isFile()) throw new PlatformToolRefusal('NOT_A_FILE', `${args.path} is a directory: use list_chat_files`);
    const offset = clampInt(args.offset, 0, Number.MAX_SAFE_INTEGER, 0);
    // Read what the cap needs (UTF-8: at most 4 bytes a character), not a whole large file.
    const want = Math.min(stat.size, (offset + this.limits.maxFileChars) * 4);
    const handle = await fs.open(target.full, 'r');
    let buf: Buffer;
    try {
      buf = Buffer.alloc(want);
      const { bytesRead } = await handle.read(buf, 0, want, 0);
      buf = buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
    if (buf.subarray(0, 8_192).includes(0)) return { chatId: chat.id, path: args.path, size: stat.size, binary: true, content: null };
    const text = buf.toString('utf8');
    const content = text.slice(offset, offset + this.limits.maxFileChars);
    const end = offset + content.length;
    const more = end < text.length || want < stat.size;
    return {
      chatId: chat.id,
      path: args.path,
      size: stat.size,
      offset,
      content,
      ...(more ? { truncated: true, nextOffset: end } : {}),
    };
  }
}

// ── helpers ────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
  return Math.min(Math.max(n, min), max);
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** `data` for an automation with a data schema: an array of row objects, or `{format, data}` as the trigger route takes. */
function datasetOf(data: unknown): AutomationDataset | undefined {
  if (data === undefined || data === null) return undefined;
  if (Array.isArray(data)) return { format: 'json_array', data: JSON.stringify(data) };
  if (typeof data === 'object') {
    const d = data as { format?: unknown; data?: unknown };
    if ((d.format === 'json_array' || d.format === 'csv' || d.format === 'jsonl') && typeof d.data === 'string') return { format: d.format, data: d.data };
  }
  throw new PlatformToolRefusal('VALIDATION_ERROR', 'data must be an array of row objects, or {format: "json_array"|"csv"|"jsonl", data: string}');
}

const inside = (root: string, p: string): boolean => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/**
 * A tool path inside a chat's directories. `<alias>/<rest>` addresses a
 * mount by its alias; anything else is relative to the first (the agent's
 * cwd). Absolute paths, `..` out of the mount, `.git` and symlinks that lead
 * out are refused. Separators may be `/` or `\` on every OS.
 */
export async function resolveInside(
  dirs: ReadonlyArray<{ alias: string; dir: string }>,
  requested: string,
): Promise<{ full: string; rel: string; prefix: string }> {
  const raw = requested.trim();
  if (path.isAbsolute(raw) || path.win32.isAbsolute(raw) || raw.startsWith('/') || raw.startsWith('\\')) {
    throw new PlatformToolRefusal('PATH_OUTSIDE', 'Use a path relative to the chat\'s workspace');
  }
  const parts = raw.split(/[\\/]+/).filter((p) => p && p !== '.');
  if (parts.some((p) => p === '.git')) throw new PlatformToolRefusal('PATH_OUTSIDE', '.git is not readable');
  // With one mount every path is relative to it; with several, a leading alias picks the mount.
  let mount = dirs[0]!;
  const byAlias = dirs.length > 1 && parts.length > 0 ? dirs.find((d) => d.alias === parts[0]) : undefined;
  if (byAlias) {
    mount = byAlias;
    parts.shift();
  }
  const prefix = dirs.length > 1 ? mount.alias : '';
  const root = path.resolve(mount.dir);
  const full = path.resolve(root, ...parts);
  if (!inside(root, full)) throw new PlatformToolRefusal('PATH_OUTSIDE', `${requested} is outside the chat's workspace`);
  // The real path too: a symlink inside the mount must not lead out of it.
  const realRoot = await fs.realpath(root).catch(() => root);
  const realFull = await fs.realpath(full).catch(() => null);
  if (realFull && !inside(realRoot, realFull)) throw new PlatformToolRefusal('PATH_OUTSIDE', `${requested} leads outside the chat's workspace`);
  return { full, rel: path.relative(root, full).split(path.sep).join('/'), prefix };
}

/** A refusal as the model sees it: `{ok: false, code, error}`. */
export function platformToolError(err: unknown): Record<string, unknown> {
  if (err instanceof PlatformToolRefusal) return { ok: false, code: err.code, error: err.message, ...err.extra };
  const code = (err as { code?: unknown } | null)?.code;
  return { ok: false, ...(typeof code === 'string' ? { code } : {}), error: err instanceof Error ? err.message : String(err) };
}
