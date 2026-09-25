// ────────────────────────────────────────────────────────────────
// Test Helper — creates a mock Container and Express app for supertest
// ────────────────────────────────────────────────────────────────

import type { AppConfig, ILogger, AgentEvent } from '@generatorai/shared';
import type { Container } from '../../src/composition-root.js';
import { createApp } from '../../src/app.js';
import { createTestSecurityContext } from './testSecurity.js';
import { vi } from 'vitest';
import { EventBus } from '@generatorai/core';
// CLN-12 — DurableStreamManager + StreamSubscriptions imports removed.

/**
 * Creates a minimal ILogger stub for tests.
 */
function createTestLogger(): ILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as ILogger;
}

/**
 * Default test AppConfig — all values set to safe test defaults.
 */
export function createTestConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    port: 0,
    dbPath: ':memory:',
    workspacesDir: '/tmp/test-workspaces',
    artifactsDir: '/tmp/test-artifacts',
    templatesDir: './templates',
    maxConcurrentSessions: 5,
    logLevel: 'error',
    copilot: {
      cliPath: null,
      defaultModel: 'gpt-4.1',
      useStdio: false,
      defaultTimeoutMs: 5000,
      autoRestart: false,
    },
    streaming: {
      enabled: true,
      heartbeatIntervalMs: 30_000,
      maxReplayEvents: 100,
    },
    security: {
      // SEC-02 — explicit origin; '*' is rejected at startup with credentials:true.
      corsOrigins: ['http://localhost:5173'],
      allowedCommands: ['git', 'node'],
      maxScriptTimeoutMs: 5000,
      maxOutputBufferBytes: 1024,
    },
    otel: {
      enabled: false,
      endpoint: 'http://localhost:4318',
      serviceName: 'generatorai-test',
      sampleRate: 1.0,
      metricsExportIntervalMs: 60_000,
    },
    sandbox: {
      enabled: false,
      provider: 'docker',
      image: 'generatorai-sandbox:latest',
      autoDestroy: true,
      idleTimeoutMs: 300_000,
      maxConcurrent: 5,
    },
    // DB-04 — retention disabled in tests; sweeper intervals would
    // otherwise keep the event loop alive and race with in-memory DBs.
    retention: {
      enabled: false,
      eventPayloadTtlDays: 90,
      sweepIntervalMs: 6 * 60 * 60 * 1000,
      maxDeletePerSweep: 50_000,
    },
    ...overrides,
  } as AppConfig;
}

/** A minimal valid v2 workflow document (one agent stage). */
export function testGraph(name: string) {
  return {
    formatVersion: 2 as const,
    workflow: { name, variables: [], hooks: [], tags: [] },
    stages: [{ kind: 'agent' as const, key: 'build', name: 'Build', prompts: [{ label: 'main', text: 'Do the work' }] }],
    edges: [],
  };
}

/** A draft definition record as the service returns it. */
export function testDefinitionRecord() {
  const now = new Date().toISOString();
  return {
    id: 'def-1',
    status: 'draft' as const,
    revision: 1,
    currentVersionId: null,
    hasUnpublishedChanges: true,
    archivedAt: null,
    needsAttention: [],
    createdAt: now,
    updatedAt: now,
    graph: testGraph('Test Workflow'),
  };
}

function testDefinitionSummary() {
  const r = testDefinitionRecord();
  return {
    id: r.id,
    name: r.graph.workflow.name,
    projectId: null,
    status: r.status,
    revision: r.revision,
    currentVersionId: null,
    tags: [],
    stageCount: 1,
    needsAttention: false,
    archivedAt: null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Comprehensive mock for Container with all services stubbed.
 * Each service method returns a sensible default; use vi.fn() to spy or override.
 */
export function createMockContainer(configOverrides?: Partial<AppConfig>): Container {
  const config = createTestConfig(configOverrides);
  const logger = createTestLogger();
  const eventBus = new EventBus();

  const artifactService = {
    getSessionArtifacts: vi.fn().mockResolvedValue([
      { id: 'art-1', sessionId: 'sess-1', name: 'output.ts', path: '/tmp/output.ts', mimeType: 'text/typescript', size: 100 },
    ]),
    getArtifact: vi.fn().mockResolvedValue(null),
    createArtifact: vi.fn().mockResolvedValue({
      id: 'art-2',
      sessionId: 'sess-1',
      name: 'upload.txt',
      path: '/tmp/upload.txt',
      mimeType: 'text/plain',
      size: 50,
    }),
  };

  const errorHandler = {
    handle: vi.fn(),
  };

  const copilot = {
    initialize: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    forceStop: vi.fn().mockResolvedValue(undefined),
    getClientState: vi.fn().mockReturnValue('running'),
    ping: vi.fn().mockResolvedValue(true),
    shutdown: vi.fn().mockResolvedValue(undefined),
    getModels: vi.fn().mockResolvedValue([
      { id: 'gpt-4.1', name: 'GPT-4.1' },
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
    ]),
    createConversation: vi.fn().mockResolvedValue('conv-1'),
    resumeConversation: vi.fn().mockResolvedValue(undefined),
    listConversations: vi.fn().mockResolvedValue(['conv-1']),
    getMessages: vi.fn().mockResolvedValue([]),
    sendPromptStreaming: vi.fn(),
    sendPromptAndWait: vi.fn(),
    cancelConversation: vi.fn().mockResolvedValue(undefined),
    destroyConversation: vi.fn().mockResolvedValue(undefined),
    onClientEvent: vi.fn().mockReturnValue(() => {}),
  };

  const templateRegistry = {
    getAllWorkflowTemplates: vi.fn().mockReturnValue([
      { id: 'code-gen', category: 'generation', graph: testGraph('Code Generation') },
      { id: 'code-review', category: 'review', graph: testGraph('Code Review') },
    ]),
    getWorkflowTemplate: vi.fn().mockImplementation((id: string) => {
      if (id === 'code-gen') return { id: 'code-gen', category: 'generation', graph: testGraph('Code Generation') };
      return undefined;
    }),
    getTemplateCount: vi.fn().mockReturnValue(2),
    loadWorkflowTemplates: vi.fn().mockResolvedValue(undefined),
  };

  const hookExecutor = {
    executePhase: vi.fn().mockResolvedValue(undefined),
  };

  // WorkflowScriptLoader mock — the opt-in gate now lives in the loader
  // itself (`WorkflowScriptLoader.assertEnabled`), not just the upload
  // route, so route tests that flip GENERATORAI_ALLOW_SCRIPT_UPLOAD=true
  // need `isEnabled()` to agree, or `workflowScriptLoader.isEnabled()`
  // throws on `undefined` and every "enabled" case 502s instead of
  // exercising real route logic. Defaults to enabled; tests that need the
  // loader-disabled path can override via container.workflowScriptLoader.
  const workflowScriptLoader = {
    isEnabled: vi.fn().mockReturnValue(true),
    getAllMetadata: vi.fn().mockReturnValue([]),
    getScript: vi.fn().mockReturnValue(undefined),
    reloadAll: vi.fn().mockResolvedValue([]),
    reloadScript: vi.fn().mockResolvedValue({
      metadata: { id: 'test-script', name: 'Test Script', filePath: '/tmp/test.workflow.mjs', lastModified: new Date(), variables: [], stageCount: 1, profileCount: 0, tags: [] },
      graph: testGraph('Test Script'),
      profiles: [],
      handlerNames: [],
    }),
    saveScript: vi.fn().mockResolvedValue({
      metadata: { id: 'test-script', name: 'Test Script', filePath: '/tmp/test.workflow.mjs', lastModified: new Date(), variables: [], stageCount: 1, profileCount: 0, tags: [] },
      graph: testGraph('Test Script'),
      profiles: [],
      handlerNames: [],
    }),
    validateScriptFile: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
  };

  // ── v2 Service Mocks ──

  const chatManagementService = {
    // No turn in flight by default — the busy guard on POST /prompt asks this
    // before dispatching, and a mock that omits it would 409 every prompt.
    isTurnActive: vi.fn().mockReturnValue(false),
    createChat: vi.fn().mockResolvedValue({
      id: 'chat-1',
      sessionId: 'sess-1',
      name: 'Test Chat',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    listChats: vi.fn().mockResolvedValue([
      { id: 'chat-1', sessionId: 'sess-1', name: 'Test Chat', status: 'active', createdAt: new Date(), updatedAt: new Date() },
    ]),
    getChat: vi.fn().mockResolvedValue({
      id: 'chat-1',
      sessionId: 'sess-1',
      name: 'Test Chat',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    archiveChat: vi.fn().mockResolvedValue(undefined),
    deleteChat: vi.fn().mockResolvedValue(undefined),
    sendPrompt: vi.fn().mockResolvedValue(undefined),
    // PLN-01 — the plan-decision route must delegate here rather than
    // resolving the gate itself (see chats-e2e "Plan decision" suite).
    decidePlan: vi.fn().mockResolvedValue({ ok: true }),
    // Same for the question gate: only the service emits
    // `chat.question.answered`, which is what survives a reload.
    answerQuestion: vi.fn().mockResolvedValue({ ok: true }),
    getChatHistory: vi.fn().mockResolvedValue([
      { id: 'msg-1', sessionId: 'sess-1', role: 'user', content: 'Hello', timestamp: new Date() },
      { id: 'msg-2', sessionId: 'sess-1', role: 'assistant', content: 'Hi there!', timestamp: new Date() },
    ]),
    // `/api/health` reports which chats have an in-flight turn.
    getStreamingChatIds: vi.fn().mockReturnValue([]),
    // The prompt route refuses to send while a human gate is open (PLN-01).
    listPendingInteractions: vi.fn().mockResolvedValue([]),
    // `/api/chats/:id/messages` is paginated and sets X-Total-Count etc.
    getChatHistoryPage: vi.fn().mockResolvedValue({
      messages: [
        { id: 'msg-1', sessionId: 'sess-1', role: 'user', content: 'Hello', timestamp: new Date() },
        { id: 'msg-2', sessionId: 'sess-1', role: 'assistant', content: 'Hi there!', timestamp: new Date() },
      ],
      total: 2,
      hasMore: false,
      offset: 0,
      limit: 50,
    }),
  };

  // Definitions are whole v2 documents: routes read and write the graph.
  const workflowDefinitionService = {
    list: vi.fn().mockResolvedValue({ items: [testDefinitionSummary()] }),
    get: vi.fn().mockResolvedValue(testDefinitionRecord()),
    create: vi.fn().mockResolvedValue(testDefinitionRecord()),
    createFromSpec: vi.fn().mockResolvedValue(testDefinitionRecord()),
    saveGraph: vi.fn().mockResolvedValue({ ...testDefinitionRecord(), revision: 2 }),
    publish: vi.fn().mockResolvedValue({ ...testDefinitionRecord(), status: 'published', currentVersionId: 'ver-1' }),
    listVersions: vi.fn().mockResolvedValue([]),
    getVersion: vi.fn().mockResolvedValue(undefined),
    validate: vi.fn().mockReturnValue({ valid: true, issues: [] }),
    exportGraph: vi.fn().mockResolvedValue(JSON.stringify(testGraph('Test Workflow'))),
    import: vi.fn().mockResolvedValue(testDefinitionRecord()),
    importTemplate: vi.fn().mockResolvedValue(testDefinitionRecord()),
    delete: vi.fn().mockResolvedValue({ deleted: true }),
    resolveVersionForRun: vi.fn().mockResolvedValue('ver-1'),
  };

  // The pinned graph of each run's definition version.
  const runDefinitionReader = {
    get: vi.fn().mockResolvedValue(testGraph('Test Workflow')),
    stage: vi.fn(),
  };

  const workflowRunService = {
    createRun: vi.fn().mockResolvedValue({
      id: 'run-1',
      workflowDefinitionId: 'def-1',
      definitionVersionId: 'ver-1',
      name: 'Test Run',
      status: 'created',
      sessionMode: 'auto',
      variables: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    startRun: vi.fn().mockResolvedValue(undefined),
    pauseRun: vi.fn().mockResolvedValue(undefined),
    resumeRun: vi.fn().mockResolvedValue(undefined),
    cancelRun: vi.fn().mockResolvedValue(undefined),
    deleteRun: vi.fn().mockResolvedValue(undefined),
    onStageCompleted: vi.fn().mockResolvedValue(undefined),
    onStageFailed: vi.fn().mockResolvedValue(undefined),
    // retryRun creates a NEW run (W23 lineage) — the route must start
    // *that* one, not the ancestor it was called with.
    retryRun: vi.fn().mockResolvedValue({
      id: 'run-retry-1',
      workflowDefinitionId: 'def-1',
      definitionVersionId: 'ver-1',
      name: 'Test Run (retry)',
      status: 'created',
      sessionMode: 'auto',
      variables: {},
      ancestorRunId: 'run-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  };

  const dagScheduler = {
    buildDAGForRun: vi.fn().mockResolvedValue(undefined),
    reconcileRun: vi.fn().mockResolvedValue(undefined),
  };

  const stageExecutionService = {
    executeStage: vi.fn().mockResolvedValue(undefined),
    pauseStage: vi.fn().mockResolvedValue(undefined),
    resumeStage: vi.fn().mockResolvedValue(undefined),
    cancelStage: vi.fn().mockResolvedValue(undefined),
  };

  const sessionAllocator = {
    allocateSession: vi.fn().mockResolvedValue({
      id: 'sess-alloc-1',
      conversationId: 'conv-alloc-1',
    }),
    releaseSession: vi.fn().mockResolvedValue(undefined),
    releaseAll: vi.fn().mockResolvedValue(undefined),
  };

  const chatEntityRepo = {
    create: vi.fn(),
    // Return a realistic chat record by default so GET /chats/:id tests don't
    // receive an empty body. Individual tests can override with mockResolvedValueOnce.
    getById: vi.fn().mockResolvedValue({
      id: 'chat-1',
      sessionId: 'sess-1',
      name: 'Test Chat',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    getAll: vi.fn().mockResolvedValue([]),
    getByStatus: vi.fn().mockResolvedValue([]),
    countByStatus: vi.fn().mockResolvedValue(0),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const workflowRunRepo = {
    create: vi.fn(),
    getById: vi.fn().mockResolvedValue({
      id: 'run-1',
      workflowDefinitionId: 'def-1',
      definitionVersionId: 'ver-1',
      name: 'Test Run',
      status: 'running',
      sessionMode: 'auto',
      variables: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    getAll: vi.fn().mockResolvedValue([]),
    getByDefinitionId: vi.fn().mockResolvedValue([]),
    getByStatus: vi.fn().mockResolvedValue([]),
    countByStatus: vi.fn().mockResolvedValue(0),
    update: vi.fn(),
    updateStatus: vi.fn(),
    delete: vi.fn(),
  };

  const stageRunRepo = {
    create: vi.fn(),
    getById: vi.fn(),
    getByRunId: vi.fn().mockResolvedValue([]),
    getByStatus: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    updateStatus: vi.fn(),
    incrementRetryCount: vi.fn(),
    resetForRetry: vi.fn(),
    batchUpdateStatus: vi.fn(),
    delete: vi.fn(),
    deleteByRunId: vi.fn(),
  };

  // WorkflowOrchestrator mock — startRun route calls getRunWorkspaceDir/
  // getRunArtifactsDir before firing workflowRunService.startRun, so the
  // mock needs these present or the route returns 502.
  const workflowOrchestrator = {
    getRunWorkspaceDir: vi.fn().mockResolvedValue('/tmp/test-workspaces/run-1'),
    getRunArtifactsDir: vi.fn().mockResolvedValue('/tmp/test-artifacts/run-1'),
    orchestrateRun: vi.fn().mockResolvedValue(undefined),
  };

  const harnessProxy = {
    harnessType: 'copilot',
    getActiveHarness: vi.fn().mockReturnValue(copilot),
  };

  // `/api/health` reads the registry to report the primary harness.
  const harnessRegistry = {
    primary: 'copilot',
    getStatuses: vi.fn().mockResolvedValue([]),
  };

  return {
    config,
    logger,
    eventBus,
    workflowOrchestrator,
    harnessProxy,
    harnessRegistry,
    artifactService,
    errorHandler,
    harness: copilot,
    templateRegistry,
    hookExecutor,
    workflowScriptLoader,
    // v2
    chatManagementService,
    planService: {
      findById: vi.fn().mockResolvedValue({
        id: 'plan-1',
        chatId: 'chat-1',
        title: 'Test Plan',
        status: 'awaiting_review',
        currentRevision: 1,
        revisions: [{ revision: 1, content: '# Plan', authoredBy: 'agent' }],
      }),
      listByChat: vi.fn().mockResolvedValue([]),
      recordDecision: vi.fn().mockResolvedValue(undefined),
      listComments: vi.fn().mockResolvedValue([]),
    },
    workflowDefinitionService,
    runDefinitionReader,
    workflowRunService,
    dagScheduler,
    stageExecutionService,
    sessionAllocator,
    chatEntityRepo,
    // The chat LIST route enriches each row with a one-line preview of its
    // newest message, in one batched query. Without this double the route
    // answers 502 and the failure reads like a route bug.
    chatMessageRepo: {
      latestBySessionIds: vi.fn().mockResolvedValue(new Map()),
    },
    workflowRunRepo,
    stageRunRepo,
    // Route tests still go through the real auth middleware; this context
    // resolves every request to a full-scope local principal so a route that
    // forgets its scope policy still fails closed here.
    security: createTestSecurityContext(),
    relayHostBroker: null,
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as unknown as Container;
}

/**
 * Creates a fully configured Express app backed by mock services.
 * Returns the app and mock container for inspection/assertion.
 */
export function createTestApp(configOverrides?: Partial<AppConfig>) {
  const container = createMockContainer(configOverrides);
  const app = createApp(container);
  return { app, container };
}
