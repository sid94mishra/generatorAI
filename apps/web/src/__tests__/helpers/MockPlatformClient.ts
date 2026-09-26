// ────────────────────────────────────────────────────────────────
// MockPlatformClient — In-memory mock of IPlatformClient for tests
// ────────────────────────────────────────────────────────────────

import type {
  IPlatformClient,
  ChatMessage,
  Artifact,
  PersistedEvent,
  EventSubscriptionOptions,
  Chat,
  CreateChatParams,
  WorkflowRun,
  WorkflowRunWithStages,
  InvocationFiles,
} from '@generatorai/shared';
import type {
  InvocationPlan,
  InvocationRequest,
  InvocationResult,
  RunCommand,
  WorkflowDefinitionRecord,
  WorkflowDefinitionSummary,
  WorkflowGraph,
  WorkflowGraphInput,
  WorkflowTemplate,
} from '@generatorai/workflow-spec';
import { LifecycleSchema } from '@generatorai/workflow-spec';
import { vi } from 'vitest';

export function createMockChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'user',
    content: 'Hello world',
    timestamp: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function createMockArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'artifact-1',
    sessionId: 'session-1',
    name: 'output.ts',
    path: '/workspace/output.ts',
    mimeType: 'text/typescript',
    size: 1024,
    direction: 'outbound',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** A minimal valid graph (parsed form). */
export function createMockGraph(name = 'Definition A', overrides: Partial<WorkflowGraph> = {}): WorkflowGraph {
  return {
    formatVersion: 2,
    workflow: { name, session: {}, variables: [], hooks: [], lifecycle: LifecycleSchema.parse({}), tags: [] },
    stages: [],
    edges: [],
    ...overrides,
  };
}

export function createMockDefinition(
  overrides: Partial<WorkflowDefinitionRecord> = {},
  name = 'Definition A',
): WorkflowDefinitionRecord {
  return {
    id: 'def-a',
    status: 'draft',
    revision: 1,
    currentVersionId: null,
    hasUnpublishedChanges: false,
    archivedAt: null,
    needsAttention: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    graph: createMockGraph(name),
    ...overrides,
  };
}

export function createMockTemplate(overrides: Partial<WorkflowTemplate> = {}): WorkflowTemplate {
  return {
    id: 'code-generation',
    category: 'code-generation',
    graph: createMockGraph('Code Generation'),
    ...overrides,
  };
}

export class MockPlatformClient implements IPlatformClient {
  readonly platform = 'web' as const;

  messages: ChatMessage[] = [];
  artifacts: Artifact[] = [];
  templates: WorkflowTemplate[] = [createMockTemplate()];

  initialize = vi.fn(async () => {});
  shutdown = vi.fn(async () => {});

  sendPrompt = vi.fn(async () => {});

  getChatHistory = vi.fn(async (sessionId: string): Promise<ChatMessage[]> => {
    return this.messages.filter((m) => m.sessionId === sessionId);
  });

  getWorkflowTemplates = vi.fn(async (): Promise<WorkflowTemplate[]> => {
    return [...this.templates];
  });

  getArtifacts = vi.fn(async (sessionId: string): Promise<Artifact[]> => {
    return this.artifacts.filter((a) => a.sessionId === sessionId);
  });

  downloadArtifact = vi.fn(async (artifactId: string) => {
    return {
      data: Buffer.from('mock-data'),
      mimeType: 'text/plain',
      name: 'test.txt',
    };
  });

  subscribeToEvents = vi.fn(
    (_sessionId: string, _handler: (event: PersistedEvent) => void, _options?: EventSubscriptionOptions) => {
      return () => {}; // unsubscribe
    },
  );

  selectDirectory = vi.fn(async () => null);

  // ── v2: Chat Operations ──

  createChat = vi.fn(async (_params: CreateChatParams): Promise<Chat> => {
    throw new Error('Not implemented in mock');
  });

  listChats = vi.fn(async (_filter?: { status?: string }): Promise<Chat[]> => {
    return [];
  });

  getChat = vi.fn(async (_chatId: string): Promise<Chat> => {
    throw new Error('Not implemented in mock');
  });

  archiveChat = vi.fn(async (_chatId: string): Promise<void> => {});

  updateChat = vi.fn(async (_chatId: string, _updates: Partial<Pick<Chat, 'model' | 'harnessConfig'>>): Promise<Chat> => {
    throw new Error('Not implemented in mock');
  });

  deleteChat = vi.fn(async (_chatId: string): Promise<void> => {});

  sendChatPrompt = vi.fn(
    async (
      _chatId: string,
      _prompt: string,
      _attachments?: Array<{ type: 'file'; path: string; displayName?: string }>,
    ): Promise<void> => {},
  );

  getChatMessages = vi.fn(async (_chatId: string, _limit?: number, _offset?: number): Promise<ChatMessage[]> => {
    return [];
  });

  // ── Workflow definitions (v2 documents) ──

  createDefinition = vi.fn(async (_graph: WorkflowGraphInput): Promise<WorkflowDefinitionRecord> => {
    throw new Error('Not implemented in mock');
  });

  listDefinitions = vi.fn(async (): Promise<WorkflowDefinitionSummary[]> => {
    return [];
  });

  getDefinition = vi.fn(async (_id: string): Promise<WorkflowDefinitionRecord> => {
    throw new Error('Not implemented in mock');
  });

  saveDefinitionGraph = vi.fn(
    async (_id: string, _graph: WorkflowGraphInput, _expectedRevision: number): Promise<WorkflowDefinitionRecord> => {
      throw new Error('Not implemented in mock');
    },
  );

  deleteDefinition = vi.fn(async (_id: string): Promise<{ deleted: true } | { archived: true; runs: number }> => ({
    deleted: true,
  }));

  // ── v2: Workflow Run Operations ──

  invokeWorkflow = vi.fn(
    async (_request: InvocationRequest, _opts?: { idempotencyKey?: string; files?: InvocationFiles }): Promise<InvocationResult> => {
      throw new Error('Not implemented in mock');
    },
  );

  planWorkflowInvocation = vi.fn(async (_request: InvocationRequest): Promise<InvocationPlan> => {
    throw new Error('Not implemented in mock');
  });

  listRuns = vi.fn(async (_filter?: { definitionId?: string; status?: string }): Promise<WorkflowRun[]> => {
    return [];
  });

  getRun = vi.fn(async (_id: string): Promise<WorkflowRunWithStages> => {
    throw new Error('Not implemented in mock');
  });

  runCommand = vi.fn(async (_runId: string, _command: RunCommand): Promise<void> => {});
  listLoopIterations = vi.fn(async (_runId: string, _instanceId: string) => [] as never[]);
  getScriptAllowlist = vi.fn(async () => ({ commands: [] as string[], defaults: [] as string[], extras: [] as string[] }));
  deleteRun = vi.fn(async (_id: string): Promise<void> => {});

  // ── HITL Operations ──
  getPermissionMode = vi.fn(async (_runId: string) => ({
    runId: _runId,
    mode: 'default' as const,
  }));
  setPermissionMode = vi.fn(async (_runId: string, _mode: string): Promise<void> => {});
}
