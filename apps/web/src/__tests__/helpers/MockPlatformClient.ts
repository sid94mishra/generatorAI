// ────────────────────────────────────────────────────────────────
// MockPlatformClient — In-memory mock of IPlatformClient for tests
// ────────────────────────────────────────────────────────────────

import type {
  IPlatformClient,
  Session,
  SessionWithWorkflows,
  Workflow,
  ChatMessage,
  Artifact,
  CreateSessionParams,
  PersistedEvent,
  WorkflowTemplateSummary,
  EventSubscriptionOptions,
  Chat,
  CreateChatParams,
  WorkflowDefinition,
  WorkflowDefinitionWithStages,
  CreateWorkflowDefinitionParams,
  WorkflowRun,
  WorkflowRunWithStages,
  CreateWorkflowRunParams,
} from '@generatorai/shared';
import { vi } from 'vitest';

export function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'Test Session',
    status: 'created',
    tags: [],
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function createMockWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'workflow-1',
    sessionId: 'session-1',
    templateId: 'code-generation',
    name: 'Code Generation',
    order: 0,
    status: 'pending',
    variables: {},
    hookOverrides: {},
    currentStep: 0,
    totalSteps: 3,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

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

export function createMockTemplate(overrides: Partial<WorkflowTemplateSummary> = {}): WorkflowTemplateSummary {
  return {
    id: 'code-generation',
    name: 'Code Generation',
    description: 'Generate code from a description',
    category: 'generation',
    version: '1.0.0',
    requiresCodebase: false,
    variables: [
      {
        name: 'language',
        label: 'Language',
        type: 'select',
        required: true,
        options: ['typescript', 'python', 'go'],
      },
      {
        name: 'description',
        label: 'Description',
        type: 'text',
        required: true,
      },
    ],
    ...overrides,
  };
}

export class MockPlatformClient implements IPlatformClient {
  readonly platform = 'web' as const;

  sessions: Session[] = [createMockSession()];
  workflows: Workflow[] = [createMockWorkflow()];
  messages: ChatMessage[] = [];
  artifacts: Artifact[] = [];
  templates: WorkflowTemplateSummary[] = [createMockTemplate()];

  initialize = vi.fn(async () => {});
  shutdown = vi.fn(async () => {});

  createSession = vi.fn(async (params: CreateSessionParams): Promise<Session> => {
    const session = createMockSession({
      id: `session-${Date.now()}`,
      name: params.name,
      description: params.description,
    });
    this.sessions.push(session);
    return session;
  });

  getSession = vi.fn(async (sessionId: string): Promise<SessionWithWorkflows> => {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return {
      ...session,
      workflows: this.workflows.filter((w) => w.sessionId === sessionId),
    };
  });

  getSessions = vi.fn(async (): Promise<Session[]> => {
    return [...this.sessions];
  });

  deleteSession = vi.fn(async (sessionId: string): Promise<void> => {
    this.sessions = this.sessions.filter((s) => s.id !== sessionId);
  });

  startSession = vi.fn(async () => {});
  pauseSession = vi.fn(async () => {});
  resumeSession = vi.fn(async () => {});
  cancelSession = vi.fn(async () => {});

  getWorkflows = vi.fn(async (sessionId: string): Promise<Workflow[]> => {
    return this.workflows.filter((w) => w.sessionId === sessionId);
  });

  pauseWorkflow = vi.fn(async () => {});
  resumeWorkflow = vi.fn(async () => {});

  sendPrompt = vi.fn(async () => {});

  getChatHistory = vi.fn(async (sessionId: string): Promise<ChatMessage[]> => {
    return this.messages.filter((m) => m.sessionId === sessionId);
  });

  getWorkflowTemplates = vi.fn(async (): Promise<WorkflowTemplateSummary[]> => {
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

  // ── v2: Workflow Definition Operations ──

  createDefinition = vi.fn(async (_params: CreateWorkflowDefinitionParams): Promise<WorkflowDefinition> => {
    throw new Error('Not implemented in mock');
  });

  listDefinitions = vi.fn(async (): Promise<WorkflowDefinition[]> => {
    return [];
  });

  getDefinition = vi.fn(async (_id: string): Promise<WorkflowDefinitionWithStages> => {
    throw new Error('Not implemented in mock');
  });

  updateDefinition = vi.fn(
    async (_id: string, _params: Partial<CreateWorkflowDefinitionParams>): Promise<WorkflowDefinition> => {
      throw new Error('Not implemented in mock');
    },
  );

  deleteDefinition = vi.fn(async (_id: string): Promise<void> => {});

  // ── v2: Workflow Run Operations ──

  createRun = vi.fn(async (_params: CreateWorkflowRunParams): Promise<WorkflowRun> => {
    throw new Error('Not implemented in mock');
  });

  listRuns = vi.fn(async (_filter?: { definitionId?: string; status?: string }): Promise<WorkflowRun[]> => {
    return [];
  });

  getRun = vi.fn(async (_id: string): Promise<WorkflowRunWithStages> => {
    throw new Error('Not implemented in mock');
  });

  startRun = vi.fn(async (_id: string): Promise<void> => {});
  pauseRun = vi.fn(async (_id: string): Promise<void> => {});
  resumeRun = vi.fn(async (_id: string): Promise<void> => {});
  cancelRun = vi.fn(async (_id: string): Promise<void> => {});
  retryRun = vi.fn(async (id: string): Promise<{ runId: string }> => ({ runId: id }));
  deleteRun = vi.fn(async (_id: string): Promise<void> => {});
  pauseStageRun = vi.fn(async (_runId: string, _stageId: string): Promise<void> => {});
  resumeStageRun = vi.fn(async (_runId: string, _stageId: string): Promise<void> => {});
  retryStageRun = vi.fn(async (_runId: string, _stageId: string): Promise<void> => {});
  cancelStageRun = vi.fn(async (_runId: string, _stageId: string): Promise<void> => {});

  // ── HITL Operations ──
  getPermissionMode = vi.fn(async (_runId: string) => ({
    runId: _runId,
    mode: 'default' as const,
  }));
  setPermissionMode = vi.fn(async (_runId: string, _mode: string): Promise<void> => {});
  listPendingInterrupts = vi.fn(async (_runId: string) => []);
  resumeStage = vi.fn(async (_runId: string, _stageId: string, _resolution: { approved: boolean; value?: unknown; reason?: string }) => ({ ok: true }));
}
