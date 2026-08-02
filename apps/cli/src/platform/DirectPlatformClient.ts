// ────────────────────────────────────────────────────────────────
// DirectPlatformClient — in-process ("--local") platform client.
//
// Boots the GeneratorAI SDK in-process so the CLI can run workflows, chats and
// automations WITHOUT a separate server. Implements the core run/chat/workflow/
// streaming surface by delegating to the embedded engine; the long-tail admin
// methods (projects, codebases, webhooks, workspaces, orchestrator file mgmt, …)
// throw an actionable "not available in --local" error via the factory's Proxy.
//
// Typed as `Partial<CLIPlatformClient>` so the methods we DO implement are
// type-checked against the interface, while omissions are allowed and filled
// with throwing stubs by `createDirectClient()`.
// ────────────────────────────────────────────────────────────────

import * as os from 'node:os';
import * as path from 'node:path';
import { createGeneratorAI, type GeneratorAI } from '@generatorai/sdk';
import { createDB, createAllRepositories, closeDB, type AppDatabase } from '@generatorai/db';
import type {
  PlatformType,
  PersistedEvent,
  ChatMessage,
  Chat,
  CreateChatParams,
  ChatStatus,
  WorkflowDefinition,
  WorkflowDefinitionWithStages,
  CreateWorkflowDefinitionParams,
  WorkflowRun,
  WorkflowRunWithStages,
  CreateWorkflowRunParams,
  StageRun,
  ImportWorkflowJson,
} from '@generatorai/shared';
import type { CLIPlatformClient, SSEScope, SSESubscriptionOptions, ReplayResult } from './types.js';

export interface DirectClientOptions {
  /** Harness provider for the embedded engine. Defaults to HARNESS_TYPE env or 'copilot'. */
  provider?: 'copilot' | 'claude-agent';
  /** SQLite path. Defaults to GENERATORAI_DB_PATH or ~/.generatorai/data.db. */
  dbPath?: string;
  artifactsDir?: string;
  templatesDir?: string;
  scriptsDir?: string;
}

function homeDir(...parts: string[]): string {
  return path.join(os.homedir(), '.generatorai', ...parts);
}

export class DirectPlatformClient implements Partial<CLIPlatformClient> {
  readonly platform: PlatformType = 'cli';
  readonly baseUrl = 'local://embedded';

  private ai!: GeneratorAI;
  private db!: AppDatabase;
  private repos!: ReturnType<typeof createAllRepositories>;

  private readonly provider: 'copilot' | 'claude-agent';
  private readonly dbPath: string;
  private readonly artifactsDir: string;
  private readonly templatesDir: string;
  private readonly scriptsDir: string;

  constructor(opts: DirectClientOptions = {}) {
    this.provider =
      opts.provider ?? (process.env['HARNESS_TYPE'] as 'copilot' | 'claude-agent' | undefined) ?? 'copilot';
    this.dbPath = opts.dbPath ?? process.env['GENERATORAI_DB_PATH'] ?? homeDir('data.db');
    this.artifactsDir = opts.artifactsDir ?? process.env['GENERATORAI_ARTIFACTS_DIR'] ?? homeDir('artifacts');
    this.templatesDir = opts.templatesDir ?? process.env['GENERATORAI_TEMPLATES_DIR'] ?? homeDir('templates');
    this.scriptsDir = opts.scriptsDir ?? process.env['GENERATORAI_SCRIPTS_DIR'] ?? homeDir('scripts');
  }

  async initialize(): Promise<void> {
    this.ai = await createGeneratorAI({
      provider: this.provider,
      database: this.dbPath,
      artifactsDir: this.artifactsDir,
      templatesDir: this.templatesDir,
      scriptsDir: this.scriptsDir,
      logger: { level: (process.env['GENERATORAI_LOG_LEVEL'] as 'info') ?? 'warn' },
    });
    await this.ai.initialize();
    // Second (read) connection to the same DB for list/get reads the high-level
    // facades don't expose. SQLite tolerates multiple connections; the engine
    // owns writes, this connection only reads committed state.
    this.db = createDB(this.dbPath);
    this.repos = createAllRepositories(this.db);
  }

  async shutdown(): Promise<void> {
    try {
      await this.ai?.shutdown();
    } finally {
      try {
        if (this.db) closeDB(this.db);
      } catch {
        /* best-effort */
      }
    }
  }

  // ── Workflow Definitions ──
  createDefinition(params: CreateWorkflowDefinitionParams): Promise<WorkflowDefinition> {
    return this.ai.services.workflowDefinitionService.createDefinition(params);
  }
  listDefinitions(): Promise<WorkflowDefinition[]> {
    return this.ai.services.workflowDefinitionService.listDefinitions();
  }
  getDefinition(id: string): Promise<WorkflowDefinitionWithStages> {
    return this.ai.services.workflowDefinitionService.getDefinitionWithStages(id);
  }
  updateDefinition(id: string, params: Partial<CreateWorkflowDefinitionParams>): Promise<WorkflowDefinition> {
    return this.ai.services.workflowDefinitionService.updateDefinition(id, params);
  }
  deleteDefinition(id: string): Promise<void> {
    return this.ai.services.workflowDefinitionService.deleteDefinition(id);
  }
  validateDefinition(id: string): Promise<{ valid: boolean; errors: string[] }> {
    return this.ai.services.workflowDefinitionService.validateDefinition(id);
  }
  importFromTemplate(templateId: string, name?: string): Promise<WorkflowDefinition> {
    return this.ai.services.workflowDefinitionService.importFromTemplate(templateId, name);
  }
  importFromJSON(data: ImportWorkflowJson): Promise<WorkflowDefinitionWithStages> {
    return this.ai.services.workflowDefinitionService.importFromJSON(data);
  }
  async exportDefinition(id: string): Promise<Record<string, unknown>> {
    const tpl = await this.ai.services.workflowDefinitionService.exportAsTemplate(id);
    return tpl as unknown as Record<string, unknown>;
  }

  // ── Workflow Runs ──
  createRun(params: CreateWorkflowRunParams): Promise<WorkflowRun> {
    return this.ai.services.workflowRunService.createRun(params);
  }
  async listRuns(filter?: { definitionId?: string; status?: string }): Promise<WorkflowRun[]> {
    if (filter?.definitionId) return this.repos.workflowRunRepo.getByDefinitionId(filter.definitionId);
    if (filter?.status) return this.repos.workflowRunRepo.getByStatus([filter.status as WorkflowRun['status']]);
    return this.repos.workflowRunRepo.getAll();
  }
  async getRun(id: string): Promise<WorkflowRunWithStages> {
    const run = await this.repos.workflowRunRepo.getById(id);
    const stageRuns = await this.repos.stageRunRepo.getByRunId(id);
    return { ...run, stageRuns };
  }
  startRun(id: string): Promise<void> {
    return this.ai.services.workflowRunService.startRun(id);
  }
  pauseRun(id: string): Promise<void> {
    return this.ai.services.workflowRunService.pauseRun(id);
  }
  resumeRun(id: string): Promise<void> {
    return this.ai.services.workflowRunService.resumeRun(id);
  }
  cancelRun(id: string): Promise<void> {
    return this.ai.services.workflowRunService.cancelRun(id);
  }
  async retryRun(id: string): Promise<void> {
    await this.ai.services.workflowRunService.retryRun(id);
  }
  deleteRun(id: string): Promise<void> {
    return this.ai.services.workflowRunService.deleteRun(id);
  }
  getRunStages(runId: string): Promise<StageRun[]> {
    return this.repos.stageRunRepo.getByRunId(runId);
  }

  // ── HITL ──
  async getPermissionMode(
    runId: string,
  ): Promise<{ runId: string; mode: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan' }> {
    const mode = await this.ai.services.workflowRunService.getPermissionMode(runId);
    return { runId, mode };
  }
  setPermissionMode(
    runId: string,
    mode: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan',
  ): Promise<void> {
    return this.ai.services.workflowRunService.setPermissionMode(runId, mode);
  }
  listPendingInterrupts(runId: string): Promise<StageRun[]> {
    return this.repos.stageRunRepo.findAwaitingInputByRun(runId);
  }
  resumeStage(
    runId: string,
    stageId: string,
    resolution: { approved: boolean; value?: unknown; reason?: string },
  ): Promise<{ ok: boolean; reason?: string }> {
    // HITL approve/reject — survives restart: the row stays `awaiting_input`
    // in the DB (P0#1 recovery leaves it parked), so resume works after a
    // process restart too.
    return this.ai.services.hitlService.resume(stageId, runId, resolution);
  }

  // ── Chat ──
  createChat(params: CreateChatParams): Promise<Chat> {
    return this.ai.services.chatManagementService.createChat(params);
  }
  listChats(filter?: { status?: string }): Promise<Chat[]> {
    return this.ai.services.chatManagementService.listChats(filter?.status as ChatStatus | undefined);
  }
  getChat(chatId: string): Promise<Chat> {
    return this.repos.chatEntityRepo.getById(chatId);
  }
  archiveChat(chatId: string): Promise<void> {
    return this.ai.services.chatManagementService.archiveChat(chatId);
  }
  deleteChat(chatId: string): Promise<void> {
    return this.ai.services.chatManagementService.deleteChat(chatId);
  }
  sendChatPrompt(
    chatId: string,
    prompt: string,
    attachments?: Array<{ type: 'file'; path: string; displayName?: string }>,
  ): Promise<void> {
    return this.ai.services.chatManagementService.sendPrompt(chatId, prompt, attachments);
  }
  async getChatMessages(chatId: string, limit?: number, offset?: number): Promise<ChatMessage[]> {
    const page = await this.ai.services.chatManagementService.getChatHistoryPage(chatId, limit ?? 50, offset);
    return page.messages;
  }

  // ── Streaming (in-process EventBus) ──
  subscribeToStream(
    scope: SSEScope,
    id: string,
    handler: (event: PersistedEvent) => void,
    _opts?: SSESubscriptionOptions,
  ): () => void {
    const bus = this.ai.services.eventBus;
    switch (scope) {
      case 'run':
        return bus.subscribeToWorkflowRun(id, handler);
      case 'chat':
        return bus.subscribeToChat(id, handler);
      case 'session':
        return bus.subscribe(id, handler);
      case 'global':
      default:
        return bus.subscribeGlobal(handler);
    }
  }
  subscribeToRunEvents(runId: string, handler: (e: PersistedEvent) => void): () => void {
    return this.ai.services.eventBus.subscribeToWorkflowRun(runId, handler);
  }
  subscribeToChatEvents(sessionId: string, handler: (e: PersistedEvent) => void): () => void {
    return this.ai.services.eventBus.subscribeToChat(sessionId, handler);
  }
  async streamReplay(_scope: SSEScope, _id: string, afterSeq: number): Promise<ReplayResult> {
    // In-process there is no dropped-connection gap to replay across; live
    // subscriptions deliver everything. Return an empty replay window.
    return { events: [], lastSequence: afterSeq, hasMore: false };
  }

  // ── Health (synthetic for local mode) ──
  async getHealthInfo(): Promise<Record<string, unknown>> {
    return { status: 'ok', mode: 'local-embedded', harness: this.provider };
  }
  async getHealthConfig(): Promise<Record<string, unknown>> {
    return { mode: 'local-embedded', database: this.dbPath, harness: this.provider };
  }
}

/**
 * Build a fully-typed CLIPlatformClient backed by the in-process engine.
 * Methods the DirectPlatformClient implements are used directly; any other
 * CLIPlatformClient method resolves to a throwing stub with guidance to run a
 * server for the full API surface.
 */
export function createDirectClient(opts: DirectClientOptions = {}): CLIPlatformClient {
  const impl = new DirectPlatformClient(opts);
  return new Proxy(impl, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (value !== undefined) {
        return typeof value === 'function' ? value.bind(target) : value;
      }
      // Do NOT trap `then`/`catch`/`finally` or symbol keys: returning a
      // function for `then` makes the Proxy look like a (broken) thenable, so
      // resolving it through any Promise (e.g. `await getClient()`) would call
      // `.then(...)` and throw. Return undefined so the object is a plain value.
      if (
        typeof prop !== 'string' ||
        prop === 'then' ||
        prop === 'catch' ||
        prop === 'finally'
      ) {
        return undefined;
      }
      // Unimplemented CLIPlatformClient method in --local mode.
      return (..._args: unknown[]) => {
        throw new Error(
          `'${prop}' is not available in --local mode yet. ` +
          `Run against a server (omit --local, or set --server <url>) for the full API.`,
        );
      };
    },
  }) as unknown as CLIPlatformClient;
}
