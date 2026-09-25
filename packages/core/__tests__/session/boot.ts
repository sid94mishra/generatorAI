// ────────────────────────────────────────────────────────────────
// Test boot for the session-composer suites: the real core service graph
// over an in-memory migrated DB, with a spy provider that records what each
// conversation was created / resumed with. Same shape as the golden suite.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  closeDB,
  createDB,
  migrateDB,
  DrizzleAgentInteractionRepository,
  DrizzleArtifactRepository,
  DrizzleAutomationExecutionRepository,
  DrizzleAutomationRepository,
  DrizzleChatMessageRepository,
  DrizzleChatRepository,
  DrizzleEventRepository,
  DrizzleIdempotencyKeyRepository,
  DrizzlePlanRepository,
  DrizzleSequenceAllocator,
  DrizzleSessionRepository,
  DrizzleStageRunRepository,
  DrizzleWorkflowRunRepository,
  EntryRepository,
  RegisterRepository,
  SqliteWorkflowDefinitionStore,
  createEngineStores,
  type AppDatabase,
} from '@generatorai/db';
import type { ILogger } from '@generatorai/shared';
import { createCoreServices, type CoreServices } from '../../src/bootstrap/createCoreServices.js';
import { AdmissionController } from '../../src/services/AdmissionController.js';
import type { ChatManagementServiceExtensions } from '../../src/services/ChatManagementService.js';
import type {
  CreateConversationParams,
  IAgentHarness,
  SendPromptOptions,
} from '../../src/domain/ports/IAgentHarness.js';
import type { WorkspaceManager } from '../../src/services/WorkspaceManager.js';
import type { IScriptRunner, IHttpClient } from '../../src/domain/ports/index.js';
import type { GitManager } from '../../src/infrastructure/GitManager.js';
import type { AgentResolver } from '../../src/services/AgentResolver.js';

export interface SpyCall {
  op: 'create' | 'resume';
  conversationId: string;
  params: CreateConversationParams | undefined;
}

export interface SpyHarness extends IAgentHarness {
  calls: SpyCall[];
  prompts: Array<{ conversationId: string; prompt: string; options?: SendPromptOptions }>;
}

export function spyHarness(overrides: Partial<IAgentHarness> = {}): SpyHarness {
  const calls: SpyCall[] = [];
  const prompts: SpyHarness['prompts'] = [];
  const h = {
    calls,
    prompts,
    createConversation: async (p: CreateConversationParams) => {
      calls.push({ op: 'create', conversationId: p.conversationId, params: p });
      return p.conversationId;
    },
    resumeConversation: async (id: string, p?: CreateConversationParams) => {
      calls.push({ op: 'resume', conversationId: id, params: p });
    },
    hasLiveConversation: () => false,
    destroyConversation: async () => undefined,
    deleteConversation: async () => undefined,
    listConversations: async () => [],
    getLastConversationId: async () => null,
    getConversationWarnings: () => [],
    selectAgent: async () => undefined,
    listAgents: async () => [],
    getMessages: async () => [],
    onConversationEvent: () => () => undefined,
    sendPrompt: async (conversationId: string, prompt: string, _a?: unknown, options?: SendPromptOptions) => {
      prompts.push({ conversationId, prompt, ...(options ? { options } : {}) });
    },
    sendPromptAndWait: async (conversationId: string, prompt: string, _a?: unknown, _s?: unknown, options?: SendPromptOptions) => {
      prompts.push({ conversationId, prompt, ...(options ? { options } : {}) });
      return { content: 'A stage answer that is comfortably longer than fifty characters.' };
    },
    abortConversation: async () => undefined,
    initialize: async () => undefined,
    stop: async () => undefined,
    forceStop: async () => undefined,
    shutdown: async () => undefined,
    getClientState: () => 'running',
    ping: async () => true,
    onClientEvent: () => () => undefined,
    capabilities: () => ({
      vision: false,
      reasoning: false,
      reasoningEfforts: [],
      maxParallelTools: 1,
      planMode: false,
      mcpServers: false,
      approvalGating: 'per_call',
      hostTools: 'full',
      structuredOutput: 'none',
      skills: 'none',
      sessionPersistence: false,
      budgetTracking: false,
      computerUse: false,
    }),
    getModels: async () => [],
    ...overrides,
  };
  return h as unknown as SpyHarness;
}

export const quietLogger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as ILogger;

export interface TestEnv {
  db: AppDatabase;
  workDir: string;
  harness: SpyHarness;
  services: CoreServices;
  extensions: ChatManagementServiceExtensions;
  dispose(): void;
}

export function bootCore(opts: {
  harness?: SpyHarness;
  extensions?: ChatManagementServiceExtensions;
  workspaceManager?: WorkspaceManager;
  agentResolver?: AgentResolver;
  db?: AppDatabase;
  workDir?: string;
} = {}): TestEnv {
  const workDir = opts.workDir ?? mkdtempSync(join(tmpdir(), 'gai-sess-'));
  const db = opts.db ?? createDB(':memory:');
  if (!opts.db) migrateDB(db);
  const harness = opts.harness ?? spyHarness();
  const extensions = opts.extensions ?? {};
  const services = createCoreServices({
    logger: quietLogger,
    harness,
    scriptRunner: {} as IScriptRunner,
    httpClient: {} as IHttpClient,
    gitManager: {} as GitManager,
    sequenceAllocator: new DrizzleSequenceAllocator(db),
    sessionRepo: new DrizzleSessionRepository(db),
    eventRepo: new DrizzleEventRepository(db),
    chatMessageRepo: new DrizzleChatMessageRepository(db),
    artifactRepo: new DrizzleArtifactRepository(db),
    chatEntityRepo: new DrizzleChatRepository(db),
    workflowDefinitionStore: new SqliteWorkflowDefinitionStore(db),
    workflowRunRepo: new DrizzleWorkflowRunRepository(db),
    stageRunRepo: new DrizzleStageRunRepository(db),
    automationRepo: new DrizzleAutomationRepository(db),
    automationExecutionRepo: new DrizzleAutomationExecutionRepository(db),
    idempotencyKeyRepo: new DrizzleIdempotencyKeyRepository(db),
    registerRepo: new RegisterRepository(db),
    entryRepo: new EntryRepository(db),
    engineStores: createEngineStores(db),
    toHarnessError: (_provider, raw) => raw,
    workspaceManager:
      opts.workspaceManager ??
      ({
        getExecutionWorkspace: async (id: string) => ({ id, rootPath: join(workDir, 'ws'), browserConfig: {} }),
        findWorkspaceByOwner: async () => null,
      } as unknown as WorkspaceManager),
    admissionController: new AdmissionController(),
    scmFlow: { run: async () => { throw new Error('test: no source control'); } },
    config: { artifactsDir: join(workDir, 'art') },
    chatExtensions: extensions,
    planRepo: new DrizzlePlanRepository(db),
    agentInteractionRepo: new DrizzleAgentInteractionRepository(db),
    ...(opts.agentResolver ? { agentResolver: opts.agentResolver } : {}),
  });
  return {
    db,
    workDir,
    harness,
    services,
    extensions,
    dispose() {
      services.agentInteractionService?.dispose();
      services.automationService.shutdown();
      void services.engine.stop();
      try {
        closeDB(db);
      } catch {
        /* closed */
      }
      rmSync(workDir, { recursive: true, force: true });
    },
  };
}
