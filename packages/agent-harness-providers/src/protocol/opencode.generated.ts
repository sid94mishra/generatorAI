// AUTO-GENERATED — do not edit. Run `pnpm generate:schemas` to update.
// Protocol:        opencode
// Source artifact: schemas/opencode/openapi.json@1.18.25
// Captured by:     npx --yes opencode-ai@1.18.25 opencode serve --port <p> && curl -s http://127.0.0.1:<p>/doc  →  openapi.json
// Artifact sha256: dfb7d42a555389f0c662fa2b4a8af1d61633c96710cf54bce3ff2404e2e7d896
// Definitions:     472
//
// The sha256 above is of the upstream file itself. If the pinned dependency
// changes, this hash and the types below change with it, and CI's
// `git diff --exit-code` turns that into a failing build instead of a
// runtime decode error.

export type Event = EventModels_devRefreshed | EventIntegrationUpdated | EventIntegrationConnectionUpdated | EventCatalogUpdated | EventSessionCreated | EventSessionUpdated | EventSessionDeleted | EventMessageUpdated | EventMessageRemoved | EventMessagePartUpdated | EventMessagePartRemoved | EventSessionNextAgentSwitched | EventSessionNextModelSwitched | EventSessionNextMoved | EventSessionNextPrompted | EventSessionNextPromptAdmitted | EventSessionNextContextUpdated | EventSessionNextSynthetic | EventSessionNextShellStarted | EventSessionNextShellEnded | EventSessionNextStepStarted | EventSessionNextStepEnded | EventSessionNextStepFailed | EventSessionNextTextStarted | EventSessionNextTextDelta | EventSessionNextTextEnded | EventSessionNextReasoningStarted | EventSessionNextReasoningDelta | EventSessionNextReasoningEnded | EventSessionNextToolInputStarted | EventSessionNextToolInputDelta | EventSessionNextToolInputEnded | EventSessionNextToolCalled | EventSessionNextToolProgress | EventSessionNextToolSuccess | EventSessionNextToolFailed | EventSessionNextRetried | EventSessionNextCompactionStarted | EventSessionNextCompactionDelta | EventSessionNextCompactionEnded | EventSessionNextRevertStaged | EventSessionNextRevertCleared | EventSessionNextRevertCommitted | EventMessagePartDelta | EventSessionDiff | EventSessionError | EventInstallationUpdated | EventInstallationUpdate_available | EventFileEdited | EventReferenceUpdated | EventPermissionV2Asked | EventPermissionV2Replied | EventPluginAdded | EventProjectDirectoriesUpdated | EventFileWatcherUpdated | EventPtyCreated | EventPtyUpdated | EventPtyExited | EventPtyDeleted | EventQuestionV2Asked | EventQuestionV2Replied | EventQuestionV2Rejected | EventTodoUpdated | EventLspUpdated | EventPermissionAsked | EventPermissionReplied | Event_tui_prompt_append | Event_tui_command_execute | Event_tui_toast_show | Event_tui_session_select | EventMcpToolsChanged | EventMcpBrowserOpenFailed | EventCommandExecuted | EventProjectUpdated | EventSessionStatus | EventSessionIdle | EventQuestionAsked | EventQuestionReplied | EventQuestionRejected | EventSessionCompacted | EventVcsBranchUpdated | EventWorkspaceReady | EventWorkspaceFailed | EventWorkspaceStatus | EventWorktreeReady | EventWorktreeFailed | EventServerConnected | EventGlobalDisposed | EventServerInstanceDisposed;

export type QuestionReplied = {
  sessionID: string;
  requestID: string;
  answers: Array<QuestionAnswer>;
};

export type QuestionRejected = {
  sessionID: string;
  requestID: string;
};

export type OAuth = {
  type: "oauth";
  refresh: string;
  access: string;
  expires: number;
  accountId?: string;
  enterpriseUrl?: string;
};

export type ApiAuth = {
  type: "api";
  key: string;
  metadata?: Record<string, string>;
};

export type WellKnownAuth = {
  type: "wellknown";
  key: string;
  token: string;
};

export type Auth = OAuth | ApiAuth | WellKnownAuth;

export type effect_HttpApiError_BadRequest = {
  _tag: "BadRequest";
};

export type InvalidRequestError = {
  _tag: "InvalidRequestError";
  message: string;
  kind?: string;
  field?: string;
};

export type MoveSessionError = {
  name: "MoveSessionError";
  data: {
    message: string;
  };
};

export type SnapshotFileDiff = {
  file?: string;
  patch?: string;
  additions: number;
  deletions: number;
  status?: "added" | "deleted" | "modified";
};

export type PermissionAction = "allow" | "deny" | "ask";

export type PermissionRule = {
  permission: string;
  pattern: string;
  action: PermissionAction;
};

export type PermissionRuleset = Array<PermissionRule>;

export type Session = {
  id: string;
  slug: string;
  projectID: string;
  workspaceID?: string;
  directory: string;
  path?: string;
  parentID?: string;
  summary?: {
    additions: number;
    deletions: number;
    files: number;
    diffs?: Array<SnapshotFileDiff>;
  };
  cost?: number;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache: {
      read: number;
      write: number;
    };
  };
  share?: {
    url: string;
  };
  title: string;
  agent?: string;
  model?: {
    id: string;
    providerID: string;
    variant?: string;
  };
  version: string;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
    updated: number;
    compacting?: number;
    archived?: number;
  };
  permission?: PermissionRuleset;
  revert?: {
    messageID: string;
    partID?: string;
    snapshot?: string;
    diff?: string;
  };
};

export type OutputFormatText = {
  type: "text";
};

export type JSONSchema = Record<string, unknown>;

export type OutputFormatJsonSchema = {
  type: "json_schema";
  schema: JSONSchema;
  retryCount?: number;
};

export type OutputFormat = OutputFormatText | OutputFormatJsonSchema;

export type UserMessage = {
  id: string;
  sessionID: string;
  role: "user";
  time: {
    created: number;
  };
  format?: OutputFormat;
  summary?: {
    title?: string;
    body?: string;
    diffs: Array<SnapshotFileDiff>;
  };
  agent: string;
  model: {
    providerID: string;
    modelID: string;
    variant?: string;
  };
  system?: string;
  tools?: Record<string, boolean>;
};

export type ProviderAuthError = {
  name: "ProviderAuthError";
  data: {
    providerID: string;
    message: string;
  };
};

export type UnknownError = {
  name: "UnknownError";
  data: {
    message: string;
    ref?: string;
  };
};

export type MessageOutputLengthError = {
  name: "MessageOutputLengthError";
  data: Record<string, unknown>;
};

export type MessageAbortedError = {
  name: "MessageAbortedError";
  data: {
    message: string;
  };
};

export type StructuredOutputError = {
  name: "StructuredOutputError";
  data: {
    message: string;
    retries: number;
  };
};

export type ContextOverflowError = {
  name: "ContextOverflowError";
  data: {
    message: string;
    responseBody?: string;
  };
};

export type ContentFilterError = {
  name: "ContentFilterError";
  data: {
    message: string;
  };
};

export type APIError = {
  name: "APIError";
  data: {
    message: string;
    statusCode?: number;
    isRetryable: boolean;
    responseHeaders?: Record<string, string>;
    responseBody?: string;
    metadata?: Record<string, string>;
  };
};

export type AssistantMessage = {
  id: string;
  sessionID: string;
  role: "assistant";
  time: {
    created: number;
    completed?: number;
  };
  error?: ProviderAuthError | UnknownError | MessageOutputLengthError | MessageAbortedError | StructuredOutputError | ContextOverflowError | ContentFilterError | APIError;
  parentID: string;
  modelID: string;
  providerID: string;
  mode: string;
  agent: string;
  path: {
    cwd: string;
    root: string;
  };
  summary?: boolean;
  cost: number;
  tokens: {
    total?: number;
    input: number;
    output: number;
    reasoning: number;
    cache: {
      read: number;
      write: number;
    };
  };
  structured?: unknown;
  variant?: string;
  finish?: string;
};

export type Message = UserMessage | AssistantMessage;

export type TextPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "text";
  text: string;
  synthetic?: boolean;
  ignored?: boolean;
  time?: {
    start: number;
    end?: number;
  };
  metadata?: Record<string, unknown>;
};

export type SubtaskPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "subtask";
  prompt: string;
  description: string;
  agent: string;
  model?: {
    providerID: string;
    modelID: string;
  };
  command?: string;
};

export type ReasoningPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "reasoning";
  text: string;
  metadata?: Record<string, unknown>;
  time: {
    start: number;
    end?: number;
  };
};

export type FilePartSourceText = {
  value: string;
  start: number;
  end: number;
};

export type FileSource = {
  text: FilePartSourceText;
  type: "file";
  path: string;
};

export type Range = {
  start: {
    line: number;
    character: number;
  };
  end: {
    line: number;
    character: number;
  };
};

export type SymbolSource = {
  text: FilePartSourceText;
  type: "symbol";
  path: string;
  range: Range;
  name: string;
  kind: number;
};

export type ResourceSource = {
  text: FilePartSourceText;
  type: "resource";
  clientName: string;
  uri: string;
};

export type FilePartSource = FileSource | SymbolSource | ResourceSource;

export type FilePart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "file";
  mime: string;
  filename?: string;
  url: string;
  source?: FilePartSource;
};

export type ToolStatePending = {
  status: "pending";
  input: Record<string, unknown>;
  raw: string;
};

export type ToolStateRunning = {
  status: "running";
  input: Record<string, unknown>;
  title?: string;
  metadata?: Record<string, unknown>;
  time: {
    start: number;
  };
};

export type ToolStateCompleted = {
  status: "completed";
  input: Record<string, unknown>;
  output: string;
  title: string;
  metadata: Record<string, unknown>;
  time: {
    start: number;
    end: number;
    compacted?: number;
  };
  attachments?: Array<FilePart>;
};

export type ToolStateError = {
  status: "error";
  input: Record<string, unknown>;
  error: string;
  metadata?: Record<string, unknown>;
  time: {
    start: number;
    end: number;
  };
};

export type ToolState = ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError;

export type ToolPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "tool";
  callID: string;
  tool: string;
  state: ToolState;
  metadata?: Record<string, unknown>;
};

export type StepStartPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-start";
  snapshot?: string;
};

export type StepFinishPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-finish";
  reason: string;
  snapshot?: string;
  cost: number;
  tokens: {
    total?: number;
    input: number;
    output: number;
    reasoning: number;
    cache: {
      read: number;
      write: number;
    };
  };
};

export type SnapshotPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "snapshot";
  snapshot: string;
};

export type PatchPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "patch";
  hash: string;
  files: Array<string>;
};

export type AgentPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "agent";
  name: string;
  source?: {
    value: string;
    start: number;
    end: number;
  };
};

export type RetryPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "retry";
  attempt: number;
  error: APIError;
  time: {
    created: number;
  };
};

export type CompactionPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "compaction";
  auto: boolean;
  overflow?: boolean;
  tail_start_id?: string;
};

export type Part = TextPart | SubtaskPart | ReasoningPart | FilePart | ToolPart | StepStartPart | StepFinishPart | SnapshotPart | PatchPart | AgentPart | RetryPart | CompactionPart;

export type Prompt = {
  text: string;
  files?: Array<PromptFileAttachment>;
  agents?: Array<PromptAgentAttachment>;
};

export type Pty = {
  id: string;
  title: string;
  command: string;
  args: Array<string>;
  cwd: string;
  status: "running" | "exited";
  pid: number;
  exitCode?: number;
};

export type Todo = {
  /** Brief description of the task */
  content: string;
  /** Current status of the task: pending, in_progress, completed, cancelled */
  status: string;
  /** Priority level of the task: high, medium, low */
  priority: string;
};

export type SessionStatus = {
  type: "idle";
} | {
  type: "retry";
  attempt: number;
  message: string;
  action?: {
    reason: string;
    provider: string;
    title: string;
    message: string;
    label: string;
    link?: string;
  };
  next: number;
} | {
  type: "busy";
};

export type QuestionOption = {
  /** Display text (1-5 words, concise) */
  label: string;
  /** Explanation of choice */
  description: string;
};

export type QuestionInfo = {
  /** Complete question */
  question: string;
  /** Very short label (max 30 chars) */
  header: string;
  /** Available choices */
  options: Array<QuestionOption>;
  multiple?: boolean;
  custom?: boolean;
};

export type QuestionTool = {
  messageID: string;
  callID: string;
};

export type QuestionAnswer = Array<string>;

export type GlobalEvent = {
  directory: string;
  project?: string;
  workspace?: string;
  payload: {
    id: string;
    type: "models-dev.refreshed";
    properties: Record<string, unknown>;
  } | {
    id: string;
    type: "integration.updated";
    properties: Record<string, unknown>;
  } | {
    id: string;
    type: "integration.connection.updated";
    properties: {
      integrationID: string;
    };
  } | {
    id: string;
    type: "catalog.updated";
    properties: Record<string, unknown>;
  } | {
    id: string;
    type: "session.created";
    properties: {
      sessionID: string;
      info: Session;
    };
  } | {
    id: string;
    type: "session.updated";
    properties: {
      sessionID: string;
      info: Session;
    };
  } | {
    id: string;
    type: "session.deleted";
    properties: {
      sessionID: string;
      info: Session;
    };
  } | {
    id: string;
    type: "message.updated";
    properties: {
      sessionID: string;
      info: Message;
    };
  } | {
    id: string;
    type: "message.removed";
    properties: {
      sessionID: string;
      messageID: string;
    };
  } | {
    id: string;
    type: "message.part.updated";
    properties: {
      sessionID: string;
      part: Part;
      time: number;
    };
  } | {
    id: string;
    type: "message.part.removed";
    properties: {
      sessionID: string;
      messageID: string;
      partID: string;
    };
  } | {
    id: string;
    type: "session.next.agent.switched";
    properties: {
      timestamp: number;
      sessionID: string;
      messageID: string;
      agent: string;
    };
  } | {
    id: string;
    type: "session.next.model.switched";
    properties: {
      timestamp: number;
      sessionID: string;
      messageID: string;
      model: ModelRef;
    };
  } | {
    id: string;
    type: "session.next.moved";
    properties: {
      timestamp: number;
      sessionID: string;
      location: LocationRef;
      subdirectory?: string;
    };
  } | ({
    id: string;
    type: "session.next.prompted";
    properties: {
      timestamp: number;
      sessionID: string;
      messageID: string;
      prompt: Prompt;
      delivery: "steer" | "queue";
    };
  }) | ({
    id: string;
    type: "session.next.prompt.admitted";
    properties: {
      timestamp: number;
      sessionID: string;
      messageID: string;
      prompt: Prompt;
      delivery: "steer" | "queue";
    };
  }) | {
    id: string;
    type: "session.next.context.updated";
    properties: {
      timestamp: number;
      sessionID: string;
      messageID: string;
      text: string;
    };
  } | {
    id: string;
    type: "session.next.synthetic";
    properties: {
      timestamp: number;
      sessionID: string;
      messageID: string;
      text: string;
    };
  } | {
    id: string;
    type: "session.next.shell.started";
    properties: {
      timestamp: number;
      sessionID: string;
      messageID: string;
      callID: string;
      command: string;
    };
  } | {
    id: string;
    type: "session.next.shell.ended";
    properties: {
      timestamp: number;
      sessionID: string;
      callID: string;
      output: string;
    };
  } | {
    id: string;
    type: "session.next.step.started";
    properties: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      agent: string;
      model: ModelRef;
      snapshot?: string;
    };
  } | {
    id: string;
    type: "session.next.step.ended";
    properties: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      finish: string;
      cost: number;
      tokens: {
        input: number;
        output: number;
        reasoning: number;
        cache: {
          read: number;
          write: number;
        };
      };
      snapshot?: string;
      files?: Array<string>;
    };
  } | {
    id: string;
    type: "session.next.step.failed";
    properties: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      error: SessionErrorUnknown;
    };
  } | {
    id: string;
    type: "session.next.text.started";
    properties: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      textID: string;
    };
  } | {
    id: string;
    type: "session.next.text.delta";
    properties: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      textID: string;
      delta: string;
    };
  } | {
    id: string;
    type: "session.next.text.ended";
    properties: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      textID: string;
      text: string;
    };
  } | {
    id: string;
    type: "session.next.reasoning.started";
    properties: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      reasoningID: string;
      providerMetadata?: LLMProviderMetadata;
    };
  } | {
    id: string;
    type: "session.next.reasoning.delta";
    properties: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      reasoningID: string;
      delta: string;
    };
  } | {
    id: string;
    type: "session.next.reasoning.ended";
    properties: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      reasoningID: string;
      text: string;
      providerMetadata?: LLMProviderMetadata;
    };
  } | {
    id: string;
    type: "session.next.tool.input.started";
    properties: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      callID: string;
      name: string;
    };
  } | {
    id: string;
    type: "session.next.tool.input.delta";
    properties: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      callID: string;
      delta: string;
    };
  } | {
    id: string;
    type: "session.next.tool.input.ended";
    properties: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      callID: string;
      text: string;
    };
  } | {
    id: string;
    type: "session.next.tool.called";
    properties: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      callID: string;
      tool: string;
      input: Record<string, unknown>;
      provider: {
        executed: boolean;
        metadata?: LLMProviderMetadata;
      };
    };
  } | {
    id: string;
    type: "session.next.tool.progress";
    properties: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      callID: string;
      structured: Record<string, unknown>;
      content: Array<LLMToolContent>;
    };
  } | {
    id: string;
    type: "session.next.tool.success";
    properties: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      callID: string;
      structured: Record<string, unknown>;
      content: Array<LLMToolContent>;
      outputPaths?: Array<string>;
      result?: unknown;
      provider: {
        executed: boolean;
        metadata?: LLMProviderMetadata;
      };
    };
  } | {
    id: string;
    type: "session.next.tool.failed";
    properties: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      callID: string;
      error: SessionErrorUnknown;
      result?: unknown;
      provider: {
        executed: boolean;
        metadata?: LLMProviderMetadata;
      };
    };
  } | {
    id: string;
    type: "session.next.retried";
    properties: {
      timestamp: number;
      sessionID: string;
      attempt: number;
      error: SessionNextRetry_error;
    };
  } | ({
    id: string;
    type: "session.next.compaction.started";
    properties: {
      timestamp: number;
      sessionID: string;
      messageID: string;
      reason: "auto" | "manual";
    };
  }) | {
    id: string;
    type: "session.next.compaction.delta";
    properties: {
      timestamp: number;
      sessionID: string;
      messageID: string;
      text: string;
    };
  } | ({
    id: string;
    type: "session.next.compaction.ended";
    properties: {
      timestamp: number;
      sessionID: string;
      messageID: string;
      reason: "auto" | "manual";
      text: string;
      recent: string;
    };
  }) | {
    id: string;
    type: "session.next.revert.staged";
    properties: {
      timestamp: number;
      sessionID: string;
      revert: RevertState;
    };
  } | {
    id: string;
    type: "session.next.revert.cleared";
    properties: {
      timestamp: number;
      sessionID: string;
    };
  } | {
    id: string;
    type: "session.next.revert.committed";
    properties: {
      timestamp: number;
      sessionID: string;
      messageID: string;
    };
  } | {
    id: string;
    type: "message.part.delta";
    properties: {
      sessionID: string;
      messageID: string;
      partID: string;
      field: string;
      delta: string;
    };
  } | {
    id: string;
    type: "session.diff";
    properties: {
      sessionID: string;
      diff: Array<SnapshotFileDiff>;
    };
  } | ({
    id: string;
    type: "session.error";
    properties: {
      sessionID?: string;
      error?: ProviderAuthError | UnknownError | MessageOutputLengthError | MessageAbortedError | StructuredOutputError | ContextOverflowError | ContentFilterError | APIError;
    };
  }) | {
    id: string;
    type: "installation.updated";
    properties: {
      version: string;
    };
  } | {
    id: string;
    type: "installation.update-available";
    properties: {
      version: string;
    };
  } | {
    id: string;
    type: "file.edited";
    properties: {
      file: string;
    };
  } | {
    id: string;
    type: "reference.updated";
    properties: Record<string, unknown>;
  } | {
    id: string;
    type: "permission.v2.asked";
    properties: {
      id: string;
      sessionID: string;
      action: string;
      resources: Array<string>;
      save?: Array<string>;
      metadata?: Record<string, unknown>;
      source?: PermissionV2Source;
    };
  } | {
    id: string;
    type: "permission.v2.replied";
    properties: {
      sessionID: string;
      requestID: string;
      reply: PermissionV2Reply;
    };
  } | {
    id: string;
    type: "plugin.added";
    properties: {
      id: string;
    };
  } | {
    id: string;
    type: "project.directories.updated";
    properties: {
      projectID: string;
    };
  } | ({
    id: string;
    type: "file.watcher.updated";
    properties: {
      file: string;
      event: "add" | "change" | "unlink";
    };
  }) | {
    id: string;
    type: "pty.created";
    properties: {
      info: Pty;
    };
  } | {
    id: string;
    type: "pty.updated";
    properties: {
      info: Pty;
    };
  } | {
    id: string;
    type: "pty.exited";
    properties: {
      id: string;
      exitCode: number;
    };
  } | {
    id: string;
    type: "pty.deleted";
    properties: {
      id: string;
    };
  } | {
    id: string;
    type: "question.v2.asked";
    properties: {
      id: string;
      sessionID: string;
      /** Questions to ask */
      questions: Array<QuestionV2Info>;
      tool?: QuestionV2Tool;
    };
  } | {
    id: string;
    type: "question.v2.replied";
    properties: {
      sessionID: string;
      requestID: string;
      answers: Array<QuestionV2Answer>;
    };
  } | {
    id: string;
    type: "question.v2.rejected";
    properties: {
      sessionID: string;
      requestID: string;
    };
  } | {
    id: string;
    type: "todo.updated";
    properties: {
      sessionID: string;
      todos: Array<Todo>;
    };
  } | {
    id: string;
    type: "lsp.updated";
    properties: Record<string, unknown>;
  } | {
    id: string;
    type: "permission.asked";
    properties: {
      id: string;
      sessionID: string;
      permission: string;
      patterns: Array<string>;
      metadata: Record<string, unknown>;
      always: Array<string>;
      tool?: {
        messageID: string;
        callID: string;
      };
    };
  } | ({
    id: string;
    type: "permission.replied";
    properties: {
      sessionID: string;
      requestID: string;
      reply: "once" | "always" | "reject";
    };
  }) | {
    id: string;
    type: "tui.prompt.append";
    properties: {
      text: string;
    };
  } | ({
    id: string;
    type: "tui.command.execute";
    properties: {
      command: ("session.list" | "session.new" | "session.share" | "session.interrupt" | "session.compact" | "session.page.up" | "session.page.down" | "session.line.up" | "session.line.down" | "session.half.page.up" | "session.half.page.down" | "session.first" | "session.last" | "prompt.clear" | "prompt.submit" | "agent.cycle") | string;
    };
  }) | ({
    id: string;
    type: "tui.toast.show";
    properties: {
      title?: string;
      message: string;
      variant: "info" | "success" | "warning" | "error";
      duration?: number;
    };
  }) | {
    id: string;
    type: "tui.session.select";
    properties: {
      /** Session ID to navigate to */
      sessionID: string;
    };
  } | {
    id: string;
    type: "mcp.tools.changed";
    properties: {
      server: string;
    };
  } | {
    id: string;
    type: "mcp.browser.open.failed";
    properties: {
      mcpName: string;
      url: string;
    };
  } | {
    id: string;
    type: "command.executed";
    properties: {
      name: string;
      sessionID: string;
      arguments: string;
      messageID: string;
    };
  } | {
    id: string;
    type: "project.updated";
    properties: {
      id: string;
      worktree: string;
      vcs?: ProjectVcs;
      name?: string;
      icon?: ProjectIcon;
      commands?: ProjectCommands;
      time: ProjectTime;
      sandboxes: Array<string>;
    };
  } | {
    id: string;
    type: "session.status";
    properties: {
      sessionID: string;
      status: SessionStatus;
    };
  } | {
    id: string;
    type: "session.idle";
    properties: {
      sessionID: string;
    };
  } | {
    id: string;
    type: "question.asked";
    properties: {
      id: string;
      sessionID: string;
      /** Questions to ask */
      questions: Array<QuestionInfo>;
      tool?: QuestionTool;
    };
  } | {
    id: string;
    type: "question.replied";
    properties: {
      sessionID: string;
      requestID: string;
      answers: Array<QuestionAnswer>;
    };
  } | {
    id: string;
    type: "question.rejected";
    properties: {
      sessionID: string;
      requestID: string;
    };
  } | {
    id: string;
    type: "session.compacted";
    properties: {
      sessionID: string;
    };
  } | {
    id: string;
    type: "vcs.branch.updated";
    properties: {
      branch?: string;
    };
  } | {
    id: string;
    type: "workspace.ready";
    properties: {
      name: string;
    };
  } | {
    id: string;
    type: "workspace.failed";
    properties: {
      message: string;
    };
  } | ({
    id: string;
    type: "workspace.status";
    properties: {
      workspaceID: string;
      status: "connected" | "connecting" | "disconnected" | "error";
    };
  }) | {
    id: string;
    type: "worktree.ready";
    properties: {
      name: string;
      branch?: string;
    };
  } | {
    id: string;
    type: "worktree.failed";
    properties: {
      message: string;
    };
  } | {
    id: string;
    type: "server.connected";
    properties: Record<string, unknown>;
  } | {
    id: string;
    type: "global.disposed";
    properties: Record<string, unknown>;
  } | EventServerInstanceDisposed | SyncEventSessionCreated | SyncEventSessionUpdated | SyncEventSessionDeleted | SyncEventMessageUpdated | SyncEventMessageRemoved | SyncEventMessagePartUpdated | SyncEventMessagePartRemoved | SyncEventSessionNextAgentSwitched | SyncEventSessionNextModelSwitched | SyncEventSessionNextMoved | SyncEventSessionNextPrompted | SyncEventSessionNextPromptAdmitted | SyncEventSessionNextContextUpdated | SyncEventSessionNextSynthetic | SyncEventSessionNextShellStarted | SyncEventSessionNextShellEnded | SyncEventSessionNextStepStarted | SyncEventSessionNextStepEnded | SyncEventSessionNextStepFailed | SyncEventSessionNextTextStarted | SyncEventSessionNextTextEnded | SyncEventSessionNextReasoningStarted | SyncEventSessionNextReasoningEnded | SyncEventSessionNextToolInputStarted | SyncEventSessionNextToolInputEnded | SyncEventSessionNextToolCalled | SyncEventSessionNextToolProgress | SyncEventSessionNextToolSuccess | SyncEventSessionNextToolFailed | SyncEventSessionNextRetried | SyncEventSessionNextCompactionStarted | SyncEventSessionNextCompactionEnded | SyncEventSessionNextRevertStaged | SyncEventSessionNextRevertCleared | SyncEventSessionNextRevertCommitted;
};

/** Log level */
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

/** Server configuration for opencode serve and web commands */
export type ServerConfig = {
  port?: number;
  hostname?: string;
  mdns?: boolean;
  mdnsDomain?: string;
  cors?: Array<string>;
};

export type PermissionActionConfig = "ask" | "allow" | "deny";

export type PermissionObjectConfig = Record<string, PermissionActionConfig>;

export type PermissionRuleConfig = PermissionActionConfig | PermissionObjectConfig;

export type PermissionConfig = PermissionActionConfig | {
  read?: PermissionRuleConfig;
  edit?: PermissionRuleConfig;
  glob?: PermissionRuleConfig;
  grep?: PermissionRuleConfig;
  list?: PermissionRuleConfig;
  bash?: PermissionRuleConfig;
  task?: PermissionRuleConfig;
  external_directory?: PermissionRuleConfig;
  todowrite?: PermissionActionConfig;
  question?: PermissionActionConfig;
  webfetch?: PermissionActionConfig;
  websearch?: PermissionActionConfig;
  lsp?: PermissionRuleConfig;
  doom_loop?: PermissionActionConfig;
  skill?: PermissionRuleConfig;
};

export type AgentConfig = {
  model?: string;
  variant?: string;
  temperature?: number;
  top_p?: number;
  prompt?: string;
  tools?: Record<string, boolean>;
  disable?: boolean;
  description?: string;
  mode?: "subagent" | "primary" | "all";
  hidden?: boolean;
  options?: Record<string, unknown>;
  /** Hex color code (e.g., #FF5733) or theme color (e.g., primary) */
  color?: string | ("primary" | "secondary" | "accent" | "success" | "warning" | "error" | "info");
  steps?: number;
  maxSteps?: number;
  permission?: PermissionConfig;
};

export type ProviderConfig = {
  api?: string;
  name?: string;
  env?: Array<string>;
  id?: string;
  npm?: string;
  whitelist?: Array<string>;
  blacklist?: Array<string>;
  options?: {
    apiKey?: string;
    baseURL?: string;
    enterpriseUrl?: string;
    setCacheKey?: boolean;
    /** Timeout in milliseconds for full requests to this provider. Set to false to disable timeout. */
    timeout?: number | false;
    /** Timeout in milliseconds to wait for response headers. Provider integrations may set defaults. Set to false to disable timeout. */
    headerTimeout?: number | false;
    chunkTimeout?: number;
  };
  models?: Record<string, {
    id?: string;
    name?: string;
    family?: string;
    release_date?: string;
    attachment?: boolean;
    reasoning?: boolean;
    temperature?: boolean;
    tool_call?: boolean;
    interleaved?: boolean | ("reasoning" | "reasoning_content" | "reasoning_text") | string | ({
      field: ("reasoning" | "reasoning_content" | "reasoning_text") | string;
    });
    cost?: {
      input: number;
      output: number;
      cache_read?: number;
      cache_write?: number;
      context_over_200k?: {
        input: number;
        output: number;
        cache_read?: number;
        cache_write?: number;
      };
    };
    limit?: {
      context: number;
      input?: number;
      output: number;
    };
    modalities?: {
      input?: Array<"text" | "audio" | "image" | "video" | "pdf">;
      output?: Array<"text" | "audio" | "image" | "video" | "pdf">;
    };
    experimental?: boolean;
    status?: "alpha" | "beta" | "deprecated" | "active";
    provider?: {
      npm?: string;
      api?: string;
    };
    options?: Record<string, unknown>;
    headers?: Record<string, string>;
    /** Variant-specific configuration */
    variants?: Record<string, {
      disabled?: boolean;
    }>;
  }>;
};

export type McpLocalConfig = {
  /** Type of MCP server connection */
  type: "local";
  /** Command and arguments to run the MCP server */
  command: Array<string>;
  cwd?: string;
  environment?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
};

export type McpOAuthConfig = {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  callbackPort?: number;
  redirectUri?: string;
};

export type McpRemoteConfig = {
  /** Type of MCP server connection */
  type: "remote";
  /** URL of the remote MCP server */
  url: string;
  enabled?: boolean;
  headers?: Record<string, string>;
  /** OAuth authentication configuration for the MCP server. Set to false to disable OAuth auto-detection. */
  oauth?: McpOAuthConfig | false;
  timeout?: number;
};

/** @deprecated Always uses stretch layout. */
export type LayoutConfig = "auto" | "stretch";

export type ImageAttachmentConfig = {
  auto_resize?: boolean;
  max_width?: number;
  max_height?: number;
  max_base64_bytes?: number;
};

export type AttachmentConfig = {
  image?: ImageAttachmentConfig;
};

export type Config = {
  $schema?: string;
  shell?: string;
  logLevel?: LogLevel;
  server?: ServerConfig;
  command?: Record<string, {
    template: string;
    description?: string;
    agent?: string;
    model?: string;
    variant?: string;
    subtask?: boolean;
  }>;
  skills?: {
    paths?: Array<string>;
    urls?: Array<string>;
  };
  references?: Record<string, string | ConfigV2ReferenceGit | ConfigV2ReferenceLocal>;
  reference?: Record<string, string | ConfigV2ReferenceGit | ConfigV2ReferenceLocal>;
  watcher?: {
    ignore?: Array<string>;
  };
  snapshot?: boolean;
  plugin?: Array<string | unknown[]>;
  share?: "manual" | "auto" | "disabled";
  autoshare?: boolean;
  /** Automatically update to the latest version. Set to true to auto-update, false to disable, or 'notify' to show update notifications */
  autoupdate?: boolean | "notify";
  disabled_providers?: Array<string>;
  enabled_providers?: Array<string>;
  model?: string;
  small_model?: string;
  default_agent?: string;
  subagent_depth?: number;
  username?: string;
  mode?: {
    build?: AgentConfig;
    plan?: AgentConfig;
  };
  agent?: {
    plan?: AgentConfig;
    build?: AgentConfig;
    general?: AgentConfig;
    explore?: AgentConfig;
    title?: AgentConfig;
    summary?: AgentConfig;
    compaction?: AgentConfig;
  };
  provider?: Record<string, ProviderConfig>;
  mcp?: Record<string, McpLocalConfig | McpRemoteConfig | {
    enabled: boolean;
  }>;
  /** Enable or configure formatters. Omit or set to false to disable, true to enable built-ins, or an object to enable built-ins with overrides. */
  formatter?: boolean | Record<string, {
    disabled?: boolean;
    command?: Array<string>;
    environment?: Record<string, string>;
    extensions?: Array<string>;
  }>;
  /** Enable or configure LSP servers. Omit or set to false to disable, true to enable built-ins, or an object to enable built-ins with overrides. */
  lsp?: boolean | (Record<string, {
    disabled: true;
  } | {
    command: Array<string>;
    extensions?: Array<string>;
    disabled?: boolean;
    env?: Record<string, string>;
    initialization?: Record<string, unknown>;
  }>);
  instructions?: Array<string>;
  layout?: LayoutConfig;
  permission?: PermissionConfig;
  tools?: Record<string, boolean>;
  attachment?: AttachmentConfig;
  enterprise?: {
    url?: string;
  };
  tool_output?: {
    max_lines?: number;
    max_bytes?: number;
  };
  compaction?: {
    auto?: boolean;
    prune?: boolean;
    tail_turns?: number;
    preserve_recent_tokens?: number;
    reserved?: number;
  };
  experimental?: {
    disable_paste_summary?: boolean;
    batch_tool?: boolean;
    openTelemetry?: boolean;
    primary_tools?: Array<string>;
    continue_loop_on_deny?: boolean;
    mcp_timeout?: number;
    policies?: Array<ConfigV2ExperimentalPolicy>;
  };
};

export type Model = {
  id: string;
  providerID: string;
  api: {
    id: string;
    url: string;
    npm: string;
  };
  name: string;
  family?: string;
  capabilities: {
    temperature: boolean;
    reasoning: boolean;
    attachment: boolean;
    toolcall: boolean;
    input: {
      text: boolean;
      audio: boolean;
      image: boolean;
      video: boolean;
      pdf: boolean;
    };
    output: {
      text: boolean;
      audio: boolean;
      image: boolean;
      video: boolean;
      pdf: boolean;
    };
    interleaved: boolean | ({
      field: ("reasoning" | "reasoning_content" | "reasoning_text") | string;
    });
  };
  cost: {
    input: number;
    output: number;
    cache: {
      read: number;
      write: number;
    };
    tiers?: Array<{
      input: number;
      output: number;
      cache: {
        read: number;
        write: number;
      };
      tier: {
        type: "context";
        size: number;
      };
    }>;
    experimentalOver200K?: {
      input: number;
      output: number;
      cache: {
        read: number;
        write: number;
      };
    };
  };
  limit: {
    context: number;
    input?: number;
    output: number;
  };
  status: "alpha" | "beta" | "deprecated" | "active";
  options: Record<string, unknown>;
  headers: Record<string, string>;
  release_date: string;
  variants?: Record<string, Record<string, unknown>>;
};

export type Provider = {
  id: string;
  name: string;
  source: "env" | "config" | "custom" | "api";
  env: Array<string>;
  key?: string;
  options: Record<string, unknown>;
  models: Record<string, Model>;
};

export type ExperimentalCapabilities = {
  backgroundSubagents: boolean;
};

export type ConsoleState = {
  consoleManagedProviders: Array<string>;
  activeOrgName?: string;
  switchableOrgCount: number;
};

export type effect_HttpApiError_InternalServerError = {
  _tag: "InternalServerError";
};

export type ToolListItem = {
  id: string;
  description: string;
  parameters: unknown;
};

export type ToolList = Array<ToolListItem>;

export type ToolIDs = Array<string>;

export type WorktreeError = {
  name: "WorktreeNotGitError" | "WorktreeNameGenerationFailedError" | "WorktreeCreateFailedError" | "WorktreeStartCommandFailedError" | "WorktreeRemoveFailedError" | "WorktreeResetFailedError" | "WorktreeListFailedError";
  data: {
    message: string;
  };
};

export type WorktreeCreateInput = {
  name?: string;
  /** Additional startup script to run after the project's start command */
  startCommand?: string;
};

export type Worktree = {
  name: string;
  branch?: string;
  directory: string;
};

export type WorktreeRemoveInput = {
  directory: string;
};

export type WorktreeResetInput = {
  directory: string;
};

export type ProjectSummary = {
  id: string;
  name?: string;
  worktree: string;
};

export type GlobalSession = {
  id: string;
  slug: string;
  projectID: string;
  workspaceID?: string;
  directory: string;
  path?: string;
  parentID?: string;
  summary?: {
    additions: number;
    deletions: number;
    files: number;
    diffs?: Array<SnapshotFileDiff>;
  };
  cost?: number;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache: {
      read: number;
      write: number;
    };
  };
  share?: {
    url: string;
  };
  title: string;
  agent?: string;
  model?: {
    id: string;
    providerID: string;
    variant?: string;
  };
  version: string;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
    updated: number;
    compacting?: number;
    archived?: number;
  };
  permission?: PermissionRuleset;
  revert?: {
    messageID: string;
    partID?: string;
    snapshot?: string;
    diff?: string;
  };
  project: ProjectSummary | null;
};

export type McpResource = {
  name: string;
  uri: string;
  description?: string;
  mimeType?: string;
  client: string;
};

export type Symbol = {
  name: string;
  kind: number;
  location: {
    uri: string;
    range: Range;
  };
};

export type FileNode = {
  name: string;
  path: string;
  absolute: string;
  type: "file" | "directory";
  ignored: boolean;
};

export type FileContent = {
  type: "text" | "binary";
  content: string;
  diff?: string;
  patch?: {
    oldFileName: string;
    newFileName: string;
    oldHeader?: string;
    newHeader?: string;
    hunks: Array<{
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      lines: Array<string>;
    }>;
    index?: string;
  };
  encoding?: "base64";
  mimeType?: string;
};

export type File = {
  path: string;
  added: number;
  removed: number;
  status: "added" | "deleted" | "modified";
};

export type Path = {
  home: string;
  state: string;
  config: string;
  worktree: string;
  directory: string;
};

export type VcsInfo = {
  branch?: string;
  default_branch?: string;
};

export type VcsFileStatus = {
  file: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified";
};

export type VcsFileDiff = {
  file: string;
  patch?: string;
  additions: number;
  deletions: number;
  status?: "added" | "deleted" | "modified";
};

export type VcsApplyError = {
  name: "VcsApplyError";
  data: {
    message: string;
    reason: "non-git" | "not-clean";
  };
};

export type Command = {
  name: string;
  description?: string;
  agent?: string;
  model?: string;
  source?: "command" | "mcp" | "skill";
  template: string;
  subtask?: boolean;
  hints: Array<string>;
};

export type Agent = {
  name: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  native?: boolean;
  hidden?: boolean;
  topP?: number;
  temperature?: number;
  color?: string;
  permission: PermissionRuleset;
  model?: {
    modelID: string;
    providerID: string;
  };
  variant?: string;
  prompt?: string;
  options: Record<string, unknown>;
  steps?: number;
};

export type LSPStatus = {
  id: string;
  name: string;
  root: string;
  status: "connected" | "error";
};

export type FormatterStatus = {
  name: string;
  extensions: Array<string>;
  enabled: boolean;
};

export type MCPStatusConnected = {
  status: "connected";
};

export type MCPStatusDisabled = {
  status: "disabled";
};

export type MCPStatusFailed = {
  status: "failed";
  error: string;
};

export type MCPStatusNeedsAuth = {
  status: "needs_auth";
};

export type MCPStatusNeedsClientRegistration = {
  status: "needs_client_registration";
  error: string;
};

export type MCPStatus = MCPStatusConnected | MCPStatusDisabled | MCPStatusFailed | MCPStatusNeedsAuth | MCPStatusNeedsClientRegistration;

export type McpUnsupportedOAuthError = {
  error: string;
};

export type McpServerNotFoundError = {
  _tag: "McpServerNotFoundError";
  name: string;
  message: string;
};

export type Project = {
  id: string;
  worktree: string;
  vcs?: ProjectVcs;
  name?: string;
  icon?: ProjectIcon;
  commands?: ProjectCommands;
  time: ProjectTime;
  sandboxes: Array<string>;
};

export type ProjectNotFoundError = {
  _tag: "ProjectNotFoundError";
  projectID: string;
  message: string;
};

export type PtyNotFoundError = {
  _tag: "PtyNotFoundError";
  ptyID: string;
  message: string;
};

export type PtyForbiddenError = {
  _tag: "PtyForbiddenError";
  message: string;
};

export type QuestionRequest = {
  id: string;
  sessionID: string;
  /** Questions to ask */
  questions: Array<QuestionInfo>;
  tool?: QuestionTool;
};

export type QuestionNotFoundError = {
  _tag: "QuestionNotFoundError";
  requestID: string;
  message: string;
};

export type PermissionRequest = {
  id: string;
  sessionID: string;
  permission: string;
  patterns: Array<string>;
  metadata: Record<string, unknown>;
  always: Array<string>;
  tool?: {
    messageID: string;
    callID: string;
  };
};

export type PermissionNotFoundError = {
  _tag: "PermissionNotFoundError";
  requestID: string;
  message: string;
};

export type ProviderAuthMethod = {
  type: "oauth" | "api";
  label: string;
  prompts?: Array<({
    type: "text";
    key: string;
    message: string;
    placeholder?: string;
    when?: {
      key: string;
      op: "eq" | "neq";
      value: string;
    };
  }) | ({
    type: "select";
    key: string;
    message: string;
    options: Array<{
      label: string;
      value: string;
      hint?: string;
    }>;
    when?: {
      key: string;
      op: "eq" | "neq";
      value: string;
    };
  })>;
};

export type ProviderAuthAuthorization = {
  url: string;
  method: "auto" | "code";
  instructions: string;
};

export type ProviderAuthError1 = {
  name: "BadRequest" | "ProviderAuthOauthMissing" | "ProviderAuthOauthCodeMissing" | "ProviderAuthOauthCallbackFailed" | "ProviderAuthValidationFailed";
  data: {
    providerID?: string;
    field?: string;
    message?: string;
    kind?: string;
  };
};

export type NotFoundError = {
  name: "NotFoundError";
  data: {
    message: string;
  };
};

export type TextPartInput = {
  id?: string;
  type: "text";
  text: string;
  synthetic?: boolean;
  ignored?: boolean;
  time?: {
    start: number;
    end?: number;
  };
  metadata?: Record<string, unknown>;
};

export type FilePartInput = {
  id?: string;
  type: "file";
  mime: string;
  filename?: string;
  url: string;
  source?: FilePartSource;
};

export type AgentPartInput = {
  id?: string;
  type: "agent";
  name: string;
  source?: {
    value: string;
    start: number;
    end: number;
  };
};

export type SubtaskPartInput = {
  id?: string;
  type: "subtask";
  prompt: string;
  description: string;
  agent: string;
  model?: {
    providerID: string;
    modelID: string;
  };
  command?: string;
};

export type SessionBusyError = {
  _tag: "SessionBusyError";
  sessionID: string;
  message: string;
};

export type EventTuiPromptAppend = {
  type: "tui.prompt.append";
  properties: {
    text: string;
  };
};

export type EventTuiCommandExecute = {
  type: "tui.command.execute";
  properties: {
    command: ("session.list" | "session.new" | "session.share" | "session.interrupt" | "session.compact" | "session.page.up" | "session.page.down" | "session.line.up" | "session.line.down" | "session.half.page.up" | "session.half.page.down" | "session.first" | "session.last" | "prompt.clear" | "prompt.submit" | "agent.cycle") | string;
  };
};

export type EventTuiToastShow = {
  type: "tui.toast.show";
  properties: {
    title?: string;
    message: string;
    variant: "info" | "success" | "warning" | "error";
    duration?: number;
  };
};

export type EventTuiSessionSelect = {
  type: "tui.session.select";
  properties: {
    /** Session ID to navigate to */
    sessionID: string;
  };
};

export type Workspace = {
  id: string;
  type: string;
  name: string;
  branch?: string | null;
  directory?: string | null;
  extra?: unknown | null;
  projectID: string;
  timeUsed: number | "NaN" | "Infinity" | "-Infinity" | ("Infinity" | "-Infinity" | "NaN");
};

export type WorkspaceCreateError = {
  name: "WorkspaceCreateError";
  data: {
    message: string;
  };
};

export type WorkspaceWarpError = {
  name: "WorkspaceWarpError";
  data: {
    message: string;
  };
};

export type UnauthorizedError = {
  _tag: "UnauthorizedError";
  message: string;
};

export type SessionsResponse = {
  data: Array<SessionV2Info>;
  cursor: {
    previous?: string;
    next?: string;
  };
};

export type InvalidCursorError = {
  _tag: "InvalidCursorError";
  message: string;
};

export type SessionActive = {
  type: "running";
};

export type SessionNotFoundError = {
  _tag: "SessionNotFoundError";
  sessionID: string;
  message: string;
};

export type PromptInput = {
  text: string;
  files?: Array<PromptInputFileAttachment>;
  agents?: Array<PromptAgentAttachment>;
};

export type ConflictError = {
  _tag: "ConflictError";
  message: string;
  resource?: string;
};

export type ServiceUnavailableError = {
  _tag: "ServiceUnavailableError";
  message: string;
  service?: string;
};

export type MessageNotFoundError = {
  _tag: "MessageNotFoundError";
  sessionID: string;
  messageID: string;
  message: string;
};

export type UnknownError1 = {
  _tag: "UnknownError";
  message: string;
  ref?: string;
};

export type SessionDurableEvent = SessionNextAgentSwitched | SessionNextModelSwitched | SessionNextMoved | SessionNextPrompted | SessionNextPromptAdmitted | SessionNextContextUpdated | SessionNextSynthetic | SessionNextShellStarted | SessionNextShellEnded | SessionNextStepStarted | SessionNextStepEnded | SessionNextStepFailed | SessionNextTextStarted | SessionNextTextEnded | SessionNextToolInputStarted | SessionNextToolInputEnded | SessionNextToolCalled | SessionNextToolProgress | SessionNextToolSuccess | SessionNextToolFailed | SessionNextReasoningStarted | SessionNextReasoningEnded | SessionNextRetried | SessionNextCompactionStarted | SessionNextCompactionEnded | SessionNextRevertStaged | SessionNextRevertCleared | SessionNextRevertCommitted;

export type SessionHistory = {
  data: Array<SessionDurableEvent>;
  hasMore: boolean;
};

export type SessionDurableEventStream = string;

export type SessionMessagesResponse = {
  data: Array<SessionMessage>;
  cursor: {
    previous?: string;
    next?: string;
  };
};

export type ProviderNotFoundError = {
  _tag: "ProviderNotFoundError";
  providerID: string;
  message: string;
};

export type OutputFormat1 = {
  type: "text";
} | {
  type: "json_schema";
  schema: JSONSchema;
  retryCount?: number;
};

export type session_status = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.status";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    sessionID: string;
    status: SessionStatus;
  };
};

export type question_replied = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "question.replied";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    sessionID: string;
    requestID: string;
    answers: Array<QuestionAnswer>;
  };
};

export type question_rejected = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "question.rejected";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    sessionID: string;
    requestID: string;
  };
};

export type V2Event = Models_devRefreshed | IntegrationUpdated | IntegrationConnectionUpdated | CatalogUpdated | SessionCreated | SessionUpdated | SessionDeleted | MessageUpdated | MessageRemoved | MessagePartUpdated | MessagePartRemoved | SessionNextAgentSwitched | SessionNextModelSwitched | SessionNextMoved | SessionNextPrompted | SessionNextPromptAdmitted | SessionNextContextUpdated | SessionNextSynthetic | SessionNextShellStarted | SessionNextShellEnded | SessionNextStepStarted | SessionNextStepEnded | SessionNextStepFailed | SessionNextTextStarted | SessionNextTextDelta | SessionNextTextEnded | SessionNextReasoningStarted | SessionNextReasoningDelta | SessionNextReasoningEnded | SessionNextToolInputStarted | SessionNextToolInputDelta | SessionNextToolInputEnded | SessionNextToolCalled | SessionNextToolProgress | SessionNextToolSuccess | SessionNextToolFailed | SessionNextRetried | SessionNextCompactionStarted | SessionNextCompactionDelta | SessionNextCompactionEnded | SessionNextRevertStaged | SessionNextRevertCleared | SessionNextRevertCommitted | MessagePartDelta | SessionDiff | SessionError | InstallationUpdated | InstallationUpdate_available | FileEdited | ReferenceUpdated | PermissionV2Asked | PermissionV2Replied | PluginAdded | ProjectDirectoriesUpdated | FileWatcherUpdated | PtyCreated | PtyUpdated | PtyExited | PtyDeleted | QuestionV2Asked | QuestionV2Replied | QuestionV2Rejected | TodoUpdated | LspUpdated | PermissionAsked | PermissionReplied | TuiPromptAppend | TuiCommandExecute | TuiToastShow | TuiSessionSelect | McpToolsChanged | McpBrowserOpenFailed | CommandExecuted | ProjectUpdated | session_status | SessionIdle | QuestionAsked | question_replied | question_rejected | SessionCompacted | VcsBranchUpdated | WorkspaceReady | WorkspaceFailed | WorkspaceStatus | WorktreeReady | WorktreeFailed | ServerConnected | GlobalDisposed;

export type V2EventStream = string;

export type ForbiddenError = {
  _tag: "ForbiddenError";
  message: string;
};

export type ProjectCopyError = {
  name: "ProjectCopyError";
  data: {
    message: string;
    forceRequired?: boolean;
  };
};

export type effect_HttpApiError_Forbidden = {
  _tag: "Forbidden";
};

export type Event_tui_prompt_append = {
  id: string;
  type: "tui.prompt.append";
  properties: {
    text: string;
  };
};

export type Event_tui_command_execute = {
  id: string;
  type: "tui.command.execute";
  properties: {
    command: ("session.list" | "session.new" | "session.share" | "session.interrupt" | "session.compact" | "session.page.up" | "session.page.down" | "session.line.up" | "session.line.down" | "session.half.page.up" | "session.half.page.down" | "session.first" | "session.last" | "prompt.clear" | "prompt.submit" | "agent.cycle") | string;
  };
};

export type Event_tui_toast_show = {
  id: string;
  type: "tui.toast.show";
  properties: {
    title?: string;
    message: string;
    variant: "info" | "success" | "warning" | "error";
    duration?: number;
  };
};

export type Event_tui_session_select = {
  id: string;
  type: "tui.session.select";
  properties: {
    /** Session ID to navigate to */
    sessionID: string;
  };
};

export type CredentialValue = CredentialOAuth | CredentialKey;

export type IntegrationInputs = Record<string, string>;

export type IntegrationMethod = IntegrationOAuthMethod | IntegrationKeyMethod | IntegrationEnvMethod;

export type IntegrationRef = {
  id: string;
  name: string;
};

export type SkillV2Source = SkillV2DirectorySource | SkillV2UrlSource | SkillV2EmbeddedSource;

export type MoveSessionDestination = {
  directory: string;
};

export type ModelRef = {
  id: string;
  providerID: string;
  variant?: string;
};

export type LocationRef = {
  directory: string;
  workspaceID?: string;
};

export type PromptSource = {
  start: number;
  end: number;
  text: string;
};

export type PromptFileAttachment = {
  uri: string;
  mime: string;
  name?: string;
  description?: string;
  source?: PromptSource;
};

export type PromptAgentAttachment = {
  name: string;
  source?: PromptSource;
};

export type SessionErrorUnknown = {
  type: "unknown";
  message: string;
};

export type LLMProviderMetadata = Record<string, Record<string, unknown>>;

export type ToolTextContent = {
  type: "text";
  text: string;
};

export type ToolFileContent = {
  type: "file";
  uri: string;
  mime: string;
  name?: string;
};

export type LLMToolContent = ToolTextContent | ToolFileContent;

export type SessionNextRetry_error = {
  message: string;
  statusCode?: number;
  isRetryable: boolean;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  metadata?: Record<string, string>;
};

export type FileDiff = {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  patch: string;
};

export type RevertState = {
  messageID: string;
  partID?: string;
  snapshot?: string;
  diff?: string;
  files?: Array<FileDiff>;
};

export type PermissionV2Source = {
  type: "tool";
  messageID: string;
  callID: string;
};

export type PermissionV2Reply = "once" | "always" | "reject";

export type QuestionV2Option = {
  /** Display text (1-5 words, concise) */
  label: string;
  /** Explanation of choice */
  description: string;
};

export type QuestionV2Info = {
  /** Complete question */
  question: string;
  /** Very short label (max 30 chars) */
  header: string;
  /** Available choices */
  options: Array<QuestionV2Option>;
  multiple?: boolean;
  custom?: boolean;
};

export type QuestionV2Tool = {
  messageID: string;
  callID: string;
};

export type QuestionV2Answer = Array<string>;

export type ProjectVcs = "git";

export type ProjectIcon = {
  url?: string;
  override?: string;
  color?: string;
};

export type ProjectCommands = {
  /** Startup script to run when creating a new workspace (worktree) */
  start?: string;
};

export type ProjectTime = {
  created: number;
  updated: number;
  initialized?: number;
};

export type EventServerInstanceDisposed = {
  id: string;
  type: "server.instance.disposed";
  properties: {
    directory: string;
  };
};

export type SyncEventSessionCreated = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.created.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      sessionID: string;
      info: Session;
    };
  };
};

export type SyncEventSessionUpdated = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.updated.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      sessionID: string;
      info: Session;
    };
  };
};

export type SyncEventSessionDeleted = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.deleted.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      sessionID: string;
      info: Session;
    };
  };
};

export type SyncEventMessageUpdated = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "message.updated.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      sessionID: string;
      info: Message;
    };
  };
};

export type SyncEventMessageRemoved = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "message.removed.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      sessionID: string;
      messageID: string;
    };
  };
};

export type SyncEventMessagePartUpdated = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "message.part.updated.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      sessionID: string;
      part: Part;
      time: number;
    };
  };
};

export type SyncEventMessagePartRemoved = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "message.part.removed.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      sessionID: string;
      messageID: string;
      partID: string;
    };
  };
};

export type SyncEventSessionNextAgentSwitched = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.agent.switched.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      messageID: string;
      agent: string;
    };
  };
};

export type SyncEventSessionNextModelSwitched = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.model.switched.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      messageID: string;
      model: ModelRef;
    };
  };
};

export type SyncEventSessionNextMoved = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.moved.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      location: LocationRef;
      subdirectory?: string;
    };
  };
};

export type SyncEventSessionNextPrompted = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.prompted.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      messageID: string;
      prompt: Prompt;
      delivery: "steer" | "queue";
    };
  };
};

export type SyncEventSessionNextPromptAdmitted = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.prompt.admitted.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      messageID: string;
      prompt: Prompt;
      delivery: "steer" | "queue";
    };
  };
};

export type SyncEventSessionNextContextUpdated = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.context.updated.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      messageID: string;
      text: string;
    };
  };
};

export type SyncEventSessionNextSynthetic = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.synthetic.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      messageID: string;
      text: string;
    };
  };
};

export type SyncEventSessionNextShellStarted = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.shell.started.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      messageID: string;
      callID: string;
      command: string;
    };
  };
};

export type SyncEventSessionNextShellEnded = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.shell.ended.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      callID: string;
      output: string;
    };
  };
};

export type SyncEventSessionNextStepStarted = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.step.started.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      agent: string;
      model: ModelRef;
      snapshot?: string;
    };
  };
};

export type SyncEventSessionNextStepEnded = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.step.ended.2";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      finish: string;
      cost: number;
      tokens: {
        input: number;
        output: number;
        reasoning: number;
        cache: {
          read: number;
          write: number;
        };
      };
      snapshot?: string;
      files?: Array<string>;
    };
  };
};

export type SyncEventSessionNextStepFailed = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.step.failed.2";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      error: SessionErrorUnknown;
    };
  };
};

export type SyncEventSessionNextTextStarted = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.text.started.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      textID: string;
    };
  };
};

export type SyncEventSessionNextTextEnded = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.text.ended.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      textID: string;
      text: string;
    };
  };
};

export type SyncEventSessionNextReasoningStarted = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.reasoning.started.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      reasoningID: string;
      providerMetadata?: LLMProviderMetadata;
    };
  };
};

export type SyncEventSessionNextReasoningEnded = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.reasoning.ended.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      reasoningID: string;
      text: string;
      providerMetadata?: LLMProviderMetadata;
    };
  };
};

export type SyncEventSessionNextToolInputStarted = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.tool.input.started.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      callID: string;
      name: string;
    };
  };
};

export type SyncEventSessionNextToolInputEnded = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.tool.input.ended.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      callID: string;
      text: string;
    };
  };
};

export type SyncEventSessionNextToolCalled = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.tool.called.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      callID: string;
      tool: string;
      input: Record<string, unknown>;
      provider: {
        executed: boolean;
        metadata?: LLMProviderMetadata;
      };
    };
  };
};

export type SyncEventSessionNextToolProgress = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.tool.progress.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      callID: string;
      structured: Record<string, unknown>;
      content: Array<LLMToolContent>;
    };
  };
};

export type SyncEventSessionNextToolSuccess = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.tool.success.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      callID: string;
      structured: Record<string, unknown>;
      content: Array<LLMToolContent>;
      outputPaths?: Array<string>;
      result?: unknown;
      provider: {
        executed: boolean;
        metadata?: LLMProviderMetadata;
      };
    };
  };
};

export type SyncEventSessionNextToolFailed = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.tool.failed.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      assistantMessageID: string;
      callID: string;
      error: SessionErrorUnknown;
      result?: unknown;
      provider: {
        executed: boolean;
        metadata?: LLMProviderMetadata;
      };
    };
  };
};

export type SyncEventSessionNextRetried = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.retried.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      attempt: number;
      error: SessionNextRetry_error;
    };
  };
};

export type SyncEventSessionNextCompactionStarted = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.compaction.started.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      messageID: string;
      reason: "auto" | "manual";
    };
  };
};

export type SyncEventSessionNextCompactionEnded = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.compaction.ended.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      messageID: string;
      reason: "auto" | "manual";
      text: string;
      recent: string;
    };
  };
};

export type SyncEventSessionNextRevertStaged = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.revert.staged.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      revert: RevertState;
    };
  };
};

export type SyncEventSessionNextRevertCleared = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.revert.cleared.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
    };
  };
};

export type SyncEventSessionNextRevertCommitted = {
  type: "sync";
  id: string;
  syncEvent: {
    type: "session.next.revert.committed.1";
    id: string;
    seq: number;
    aggregateID: string;
    data: {
      timestamp: number;
      sessionID: string;
      messageID: string;
    };
  };
};

export type ConfigV2ReferenceGit = {
  repository: string;
  branch?: string;
  description?: string;
  hidden?: boolean;
};

export type ConfigV2ReferenceLocal = {
  path: string;
  description?: string;
  hidden?: boolean;
};

export type PolicyEffect = "allow" | "deny";

export type ConfigV2ExperimentalPolicy = {
  action: "provider.use";
  effect: PolicyEffect;
  resource: string;
};

export type ProjectDirectories = Array<{
  directory: string;
  strategy?: string;
}>;

export type PtyTicketConnectToken = {
  ticket: string;
  expires_in: number;
};

export type WorkspaceEventConnectionStatus = {
  workspaceID: string;
  status: "connected" | "connecting" | "disconnected" | "error";
};

export type LocationInfo = {
  directory: string;
  workspaceID?: string;
  project: {
    id: string;
    directory: string;
  };
};

export type ProviderRequest = {
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

export type AgentColor = string | ("primary" | "secondary" | "accent" | "success" | "warning" | "error" | "info");

export type PermissionV2Effect = "allow" | "deny" | "ask";

export type PermissionV2Rule = {
  action: string;
  resource: string;
  effect: PermissionV2Effect;
};

export type PermissionV2Ruleset = Array<PermissionV2Rule>;

export type AgentV2Info = {
  id: string;
  model?: ModelRef;
  request: ProviderRequest;
  system?: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  hidden: boolean;
  color?: AgentColor;
  steps?: number;
  permissions: PermissionV2Ruleset;
};

export type SessionV2Info = {
  id: string;
  parentID?: string;
  projectID: string;
  agent?: string;
  model?: ModelRef;
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: {
      read: number;
      write: number;
    };
  };
  time: {
    created: number;
    updated: number;
    archived?: number;
  };
  title: string;
  location: LocationRef;
  subpath?: string;
  revert?: RevertState;
};

export type PromptInputFileAttachment = {
  uri: string;
  name?: string;
  description?: string;
  source?: PromptSource;
};

export type SessionInputAdmitted = {
  admittedSeq: number;
  id: string;
  sessionID: string;
  prompt: Prompt;
  delivery: "steer" | "queue";
  timeCreated: number;
  promotedSeq?: number;
};

export type SessionMessageAgentSwitched = {
  id: string;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
  };
  type: "agent-switched";
  agent: string;
};

export type SessionMessageModelSwitched = {
  id: string;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
  };
  type: "model-switched";
  model: ModelRef;
};

export type SessionMessageUser = {
  id: string;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
  };
  text: string;
  files?: Array<PromptFileAttachment>;
  agents?: Array<PromptAgentAttachment>;
  type: "user";
};

export type SessionMessageSynthetic = {
  id: string;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
  };
  sessionID: string;
  text: string;
  type: "synthetic";
};

export type SessionMessageSystem = {
  id: string;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
  };
  type: "system";
  text: string;
};

export type SessionMessageShell = {
  id: string;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
    completed?: number;
  };
  type: "shell";
  callID: string;
  command: string;
  output: string;
};

export type SessionMessageAssistantText = {
  type: "text";
  id: string;
  text: string;
};

export type SessionMessageAssistantReasoning = {
  type: "reasoning";
  id: string;
  text: string;
  providerMetadata?: LLMProviderMetadata;
  time?: {
    created: number;
    completed?: number;
  };
};

export type SessionMessageToolStatePending = {
  status: "pending";
  input: string;
};

export type SessionMessageToolStateRunning = {
  status: "running";
  input: Record<string, unknown>;
  structured: Record<string, unknown>;
  content: Array<LLMToolContent>;
};

export type SessionMessageToolStateCompleted = {
  status: "completed";
  input: Record<string, unknown>;
  attachments?: Array<PromptFileAttachment>;
  content: Array<LLMToolContent>;
  outputPaths?: Array<string>;
  structured: Record<string, unknown>;
  result?: unknown;
};

export type SessionMessageToolStateError = {
  status: "error";
  input: Record<string, unknown>;
  content: Array<LLMToolContent>;
  structured: Record<string, unknown>;
  error: SessionErrorUnknown;
  result?: unknown;
};

export type SessionMessageAssistantTool = {
  type: "tool";
  id: string;
  name: string;
  provider?: {
    executed: boolean;
    metadata?: LLMProviderMetadata;
    resultMetadata?: LLMProviderMetadata;
  };
  state: SessionMessageToolStatePending | SessionMessageToolStateRunning | SessionMessageToolStateCompleted | SessionMessageToolStateError;
  time: {
    created: number;
    ran?: number;
    completed?: number;
    pruned?: number;
  };
};

export type SessionMessageAssistant = {
  id: string;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
    completed?: number;
  };
  type: "assistant";
  agent: string;
  model: ModelRef;
  content: Array<SessionMessageAssistantText | SessionMessageAssistantReasoning | SessionMessageAssistantTool>;
  snapshot?: {
    start?: string;
    end?: string;
    files?: Array<string>;
  };
  finish?: string;
  cost?: number;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache: {
      read: number;
      write: number;
    };
  };
  error?: SessionErrorUnknown;
};

export type SessionMessageCompaction = {
  type: "compaction";
  reason: "auto" | "manual";
  summary: string;
  recent: string;
  id: string;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
  };
};

export type SessionMessage = SessionMessageAgentSwitched | SessionMessageModelSwitched | SessionMessageUser | SessionMessageSynthetic | SessionMessageSystem | SessionMessageShell | SessionMessageAssistant | SessionMessageCompaction;

export type SessionNextAgentSwitched = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.agent.switched";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    agent: string;
  };
};

export type SessionNextModelSwitched = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.model.switched";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    model: ModelRef;
  };
};

export type SessionNextMoved = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.moved";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    location: LocationRef;
    subdirectory?: string;
  };
};

export type SessionNextPrompted = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.prompted";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    prompt: Prompt;
    delivery: "steer" | "queue";
  };
};

export type SessionNextPromptAdmitted = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.prompt.admitted";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    prompt: Prompt;
    delivery: "steer" | "queue";
  };
};

export type SessionNextContextUpdated = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.context.updated";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    text: string;
  };
};

export type SessionNextSynthetic = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.synthetic";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    text: string;
  };
};

export type SessionNextShellStarted = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.shell.started";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    callID: string;
    command: string;
  };
};

export type SessionNextShellEnded = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.shell.ended";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    callID: string;
    output: string;
  };
};

export type SessionNextStepStarted = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.step.started";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    agent: string;
    model: ModelRef;
    snapshot?: string;
  };
};

export type SessionNextStepEnded = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.step.ended";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    finish: string;
    cost: number;
    tokens: {
      input: number;
      output: number;
      reasoning: number;
      cache: {
        read: number;
        write: number;
      };
    };
    snapshot?: string;
    files?: Array<string>;
  };
};

export type SessionNextStepFailed = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.step.failed";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    error: SessionErrorUnknown;
  };
};

export type SessionNextTextStarted = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.text.started";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    textID: string;
  };
};

export type SessionNextTextEnded = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.text.ended";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    textID: string;
    text: string;
  };
};

export type SessionNextToolInputStarted = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.tool.input.started";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    callID: string;
    name: string;
  };
};

export type SessionNextToolInputEnded = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.tool.input.ended";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    callID: string;
    text: string;
  };
};

export type SessionNextToolCalled = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.tool.called";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    callID: string;
    tool: string;
    input: Record<string, unknown>;
    provider: {
      executed: boolean;
      metadata?: LLMProviderMetadata;
    };
  };
};

export type SessionNextToolProgress = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.tool.progress";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    callID: string;
    structured: Record<string, unknown>;
    content: Array<LLMToolContent>;
  };
};

export type SessionNextToolSuccess = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.tool.success";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    callID: string;
    structured: Record<string, unknown>;
    content: Array<LLMToolContent>;
    outputPaths?: Array<string>;
    result?: unknown;
    provider: {
      executed: boolean;
      metadata?: LLMProviderMetadata;
    };
  };
};

export type SessionNextToolFailed = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.tool.failed";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    callID: string;
    error: SessionErrorUnknown;
    result?: unknown;
    provider: {
      executed: boolean;
      metadata?: LLMProviderMetadata;
    };
  };
};

export type SessionNextReasoningStarted = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.reasoning.started";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    reasoningID: string;
    providerMetadata?: LLMProviderMetadata;
  };
};

export type SessionNextReasoningEnded = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.reasoning.ended";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    reasoningID: string;
    text: string;
    providerMetadata?: LLMProviderMetadata;
  };
};

export type SessionNextRetried = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.retried";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    attempt: number;
    error: SessionNextRetry_error;
  };
};

export type SessionNextCompactionStarted = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.compaction.started";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    reason: "auto" | "manual";
  };
};

export type SessionNextCompactionEnded = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.compaction.ended";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    reason: "auto" | "manual";
    text: string;
    recent: string;
  };
};

export type SessionNextRevertStaged = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.revert.staged";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    revert: RevertState;
  };
};

export type SessionNextRevertCleared = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.revert.cleared";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
  };
};

export type SessionNextRevertCommitted = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.revert.committed";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    messageID: string;
  };
};

export type ModelApi = {
  id: string;
  type: "aisdk";
  package: string;
  url?: string;
  settings?: Record<string, unknown>;
} | {
  id: string;
  type: "native";
  url?: string;
  settings: Record<string, unknown>;
};

export type ModelCapabilities = {
  tools: boolean;
  input: Array<string>;
  output: Array<string>;
};

export type ModelCost = {
  tier?: {
    type: "context";
    size: number;
  };
  input: number;
  output: number;
  cache: {
    read: number;
    write: number;
  };
};

export type ModelV2Info = {
  id: string;
  providerID: string;
  family?: string;
  name: string;
  api: ModelApi;
  capabilities: ModelCapabilities;
  request: {
    headers: Record<string, string>;
    body: Record<string, unknown>;
    variant?: string;
  };
  variants: Array<{
    id: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }>;
  time: {
    released: number;
  };
  cost: Array<ModelCost>;
  status: "alpha" | "beta" | "deprecated" | "active";
  enabled: boolean;
  limit: {
    context: number;
    input?: number;
    output: number;
  };
};

export type ProviderAISDK = {
  type: "aisdk";
  package: string;
  url?: string;
  settings?: Record<string, unknown>;
};

export type ProviderNative = {
  type: "native";
  url?: string;
  settings: Record<string, unknown>;
};

export type ProviderApi = ProviderAISDK | ProviderNative;

export type ProviderV2Info = {
  id: string;
  integrationID?: string;
  name: string;
  disabled?: boolean;
  api: ProviderApi;
  request: ProviderRequest;
};

export type IntegrationWhen = {
  key: string;
  op: "eq" | "neq";
  value: string;
};

export type IntegrationTextPrompt = {
  type: "text";
  key: string;
  message: string;
  placeholder?: string;
  when?: IntegrationWhen;
};

export type IntegrationSelectPrompt = {
  type: "select";
  key: string;
  message: string;
  options: Array<{
    label: string;
    value: string;
    hint?: string;
  }>;
  when?: IntegrationWhen;
};

export type IntegrationOAuthMethod = {
  id: string;
  type: "oauth";
  label: string;
  prompts?: Array<IntegrationTextPrompt | IntegrationSelectPrompt>;
};

export type IntegrationKeyMethod = {
  type: "key";
  label?: string;
};

export type IntegrationEnvMethod = {
  type: "env";
  names: Array<string>;
};

export type ConnectionCredentialInfo = {
  type: "credential";
  id: string;
  label: string;
};

export type ConnectionEnvInfo = {
  type: "env";
  name: string;
};

export type ConnectionInfo = ConnectionCredentialInfo | ConnectionEnvInfo;

export type IntegrationInfo = {
  id: string;
  name: string;
  methods: Array<IntegrationMethod>;
  connections: Array<ConnectionInfo>;
};

export type IntegrationAttempt = {
  attemptID: string;
  url: string;
  instructions: string;
  mode: "auto" | "code";
  time: {
    created: number | "NaN" | "Infinity" | "-Infinity" | ("Infinity" | "-Infinity" | "NaN");
    expires: number | "NaN" | "Infinity" | "-Infinity" | ("Infinity" | "-Infinity" | "NaN");
  };
};

export type IntegrationAttemptStatus = ({
  status: "pending";
  time: {
    created: number | "NaN" | "Infinity" | "-Infinity" | ("Infinity" | "-Infinity" | "NaN");
    expires: number | "NaN" | "Infinity" | "-Infinity" | ("Infinity" | "-Infinity" | "NaN");
  };
}) | ({
  status: "complete";
  time: {
    created: number | "NaN" | "Infinity" | "-Infinity" | ("Infinity" | "-Infinity" | "NaN");
    expires: number | "NaN" | "Infinity" | "-Infinity" | ("Infinity" | "-Infinity" | "NaN");
  };
}) | ({
  status: "failed";
  message: string;
  time: {
    created: number | "NaN" | "Infinity" | "-Infinity" | ("Infinity" | "-Infinity" | "NaN");
    expires: number | "NaN" | "Infinity" | "-Infinity" | ("Infinity" | "-Infinity" | "NaN");
  };
}) | ({
  status: "expired";
  time: {
    created: number | "NaN" | "Infinity" | "-Infinity" | ("Infinity" | "-Infinity" | "NaN");
    expires: number | "NaN" | "Infinity" | "-Infinity" | ("Infinity" | "-Infinity" | "NaN");
  };
});

export type PermissionV2Request = {
  id: string;
  sessionID: string;
  action: string;
  resources: Array<string>;
  save?: Array<string>;
  metadata?: Record<string, unknown>;
  source?: PermissionV2Source;
};

export type PermissionSavedInfo = {
  id: string;
  projectID: string;
  action: string;
  resource: string;
};

export type FileSystemEntry = {
  path: string;
  type: "file" | "directory";
};

export type CommandV2Info = {
  name: string;
  template: string;
  description?: string;
  agent?: string;
  model?: ModelRef;
  subtask?: boolean;
};

export type SkillV2Info = {
  name: string;
  description?: string;
  slash?: boolean;
  location: string;
  content: string;
};

export type Models_devRefreshed = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "models-dev.refreshed";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: Record<string, unknown>;
};

export type IntegrationUpdated = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "integration.updated";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: Record<string, unknown>;
};

export type IntegrationConnectionUpdated = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "integration.connection.updated";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    integrationID: string;
  };
};

export type CatalogUpdated = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "catalog.updated";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: Record<string, unknown>;
};

export type SessionCreated = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.created";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    sessionID: string;
    info: Session;
  };
};

export type SessionUpdated = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.updated";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    sessionID: string;
    info: Session;
  };
};

export type SessionDeleted = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.deleted";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    sessionID: string;
    info: Session;
  };
};

export type MessageUpdated = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "message.updated";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    sessionID: string;
    info: Message;
  };
};

export type MessageRemoved = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "message.removed";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    sessionID: string;
    messageID: string;
  };
};

export type MessagePartUpdated = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "message.part.updated";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    sessionID: string;
    part: Part;
    time: number;
  };
};

export type MessagePartRemoved = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "message.part.removed";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    sessionID: string;
    messageID: string;
    partID: string;
  };
};

export type SessionNextTextDelta = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.text.delta";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    textID: string;
    delta: string;
  };
};

export type SessionNextReasoningDelta = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.reasoning.delta";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    reasoningID: string;
    delta: string;
  };
};

export type SessionNextToolInputDelta = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.tool.input.delta";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    callID: string;
    delta: string;
  };
};

export type SessionNextCompactionDelta = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.next.compaction.delta";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    text: string;
  };
};

export type MessagePartDelta = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "message.part.delta";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    sessionID: string;
    messageID: string;
    partID: string;
    field: string;
    delta: string;
  };
};

export type SessionDiff = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.diff";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    sessionID: string;
    diff: Array<SnapshotFileDiff>;
  };
};

export type SessionError = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.error";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    sessionID?: string;
    error?: ProviderAuthError | UnknownError | MessageOutputLengthError | MessageAbortedError | StructuredOutputError | ContextOverflowError | ContentFilterError | APIError;
  };
};

export type InstallationUpdated = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "installation.updated";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    version: string;
  };
};

export type InstallationUpdate_available = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "installation.update-available";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    version: string;
  };
};

export type FileEdited = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "file.edited";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    file: string;
  };
};

export type ReferenceUpdated = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "reference.updated";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: Record<string, unknown>;
};

export type PermissionV2Asked = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "permission.v2.asked";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    id: string;
    sessionID: string;
    action: string;
    resources: Array<string>;
    save?: Array<string>;
    metadata?: Record<string, unknown>;
    source?: PermissionV2Source;
  };
};

export type PermissionV2Replied = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "permission.v2.replied";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    sessionID: string;
    requestID: string;
    reply: PermissionV2Reply;
  };
};

export type PluginAdded = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "plugin.added";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    id: string;
  };
};

export type ProjectDirectoriesUpdated = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "project.directories.updated";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    projectID: string;
  };
};

export type FileWatcherUpdated = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "file.watcher.updated";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    file: string;
    event: "add" | "change" | "unlink";
  };
};

export type PtyCreated = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "pty.created";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    info: Pty;
  };
};

export type PtyUpdated = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "pty.updated";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    info: Pty;
  };
};

export type PtyExited = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "pty.exited";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    id: string;
    exitCode: number;
  };
};

export type PtyDeleted = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "pty.deleted";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    id: string;
  };
};

export type QuestionV2Asked = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "question.v2.asked";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    id: string;
    sessionID: string;
    /** Questions to ask */
    questions: Array<QuestionV2Info>;
    tool?: QuestionV2Tool;
  };
};

export type QuestionV2Replied = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "question.v2.replied";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    sessionID: string;
    requestID: string;
    answers: Array<QuestionV2Answer>;
  };
};

export type QuestionV2Rejected = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "question.v2.rejected";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    sessionID: string;
    requestID: string;
  };
};

export type TodoUpdated = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "todo.updated";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    sessionID: string;
    todos: Array<Todo>;
  };
};

export type LspUpdated = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "lsp.updated";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: Record<string, unknown>;
};

export type PermissionAsked = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "permission.asked";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    id: string;
    sessionID: string;
    permission: string;
    patterns: Array<string>;
    metadata: Record<string, unknown>;
    always: Array<string>;
    tool?: {
      messageID: string;
      callID: string;
    };
  };
};

export type PermissionReplied = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "permission.replied";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    sessionID: string;
    requestID: string;
    reply: "once" | "always" | "reject";
  };
};

export type TuiPromptAppend = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "tui.prompt.append";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    text: string;
  };
};

export type TuiCommandExecute = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "tui.command.execute";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    command: ("session.list" | "session.new" | "session.share" | "session.interrupt" | "session.compact" | "session.page.up" | "session.page.down" | "session.line.up" | "session.line.down" | "session.half.page.up" | "session.half.page.down" | "session.first" | "session.last" | "prompt.clear" | "prompt.submit" | "agent.cycle") | string;
  };
};

export type TuiToastShow = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "tui.toast.show";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    title?: string;
    message: string;
    variant: "info" | "success" | "warning" | "error";
    duration?: number;
  };
};

export type TuiSessionSelect = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "tui.session.select";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    /** Session ID to navigate to */
    sessionID: string;
  };
};

export type McpToolsChanged = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "mcp.tools.changed";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    server: string;
  };
};

export type McpBrowserOpenFailed = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "mcp.browser.open.failed";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    mcpName: string;
    url: string;
  };
};

export type CommandExecuted = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "command.executed";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    name: string;
    sessionID: string;
    arguments: string;
    messageID: string;
  };
};

export type ProjectUpdated = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "project.updated";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    id: string;
    worktree: string;
    vcs?: ProjectVcs;
    name?: string;
    icon?: ProjectIcon;
    commands?: ProjectCommands;
    time: ProjectTime;
    sandboxes: Array<string>;
  };
};

export type SessionIdle = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.idle";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    sessionID: string;
  };
};

export type QuestionAsked = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "question.asked";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    id: string;
    sessionID: string;
    /** Questions to ask */
    questions: Array<QuestionInfo>;
    tool?: QuestionTool;
  };
};

export type SessionCompacted = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "session.compacted";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    sessionID: string;
  };
};

export type VcsBranchUpdated = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "vcs.branch.updated";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    branch?: string;
  };
};

export type WorkspaceReady = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "workspace.ready";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    name: string;
  };
};

export type WorkspaceFailed = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "workspace.failed";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    message: string;
  };
};

export type WorkspaceStatus = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "workspace.status";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    workspaceID: string;
    status: "connected" | "connecting" | "disconnected" | "error";
  };
};

export type WorktreeReady = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "worktree.ready";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    name: string;
    branch?: string;
  };
};

export type WorktreeFailed = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "worktree.failed";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: {
    message: string;
  };
};

export type ServerConnected = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "server.connected";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: Record<string, unknown>;
};

export type GlobalDisposed = {
  id: string;
  metadata?: Record<string, unknown>;
  type: "global.disposed";
  durable?: {
    aggregateID: string;
    seq: number;
    version: number;
  };
  location?: LocationRef;
  data: Record<string, unknown>;
};

export type QuestionV2Request = {
  id: string;
  sessionID: string;
  /** Questions to ask */
  questions: Array<QuestionV2Info>;
  tool?: QuestionV2Tool;
};

export type QuestionV2Reply = {
  /** User answers in order of questions (each answer is an array of selected labels) */
  answers: Array<QuestionV2Answer>;
};

export type ReferenceLocalSource = {
  type: "local";
  path: string;
  description?: string;
  hidden?: boolean;
};

export type ReferenceGitSource = {
  type: "git";
  repository: string;
  branch?: string;
  description?: string;
  hidden?: boolean;
};

export type ReferenceSource = ReferenceLocalSource | ReferenceGitSource;

export type ReferenceInfo = {
  name: string;
  path: string;
  description?: string;
  hidden?: boolean;
  source: ReferenceSource;
};

export type ProjectCopyCopy = {
  directory: string;
};

export type EventModels_devRefreshed = {
  id: string;
  type: "models-dev.refreshed";
  properties: Record<string, unknown>;
};

export type EventIntegrationUpdated = {
  id: string;
  type: "integration.updated";
  properties: Record<string, unknown>;
};

export type EventIntegrationConnectionUpdated = {
  id: string;
  type: "integration.connection.updated";
  properties: {
    integrationID: string;
  };
};

export type EventCatalogUpdated = {
  id: string;
  type: "catalog.updated";
  properties: Record<string, unknown>;
};

export type EventSessionCreated = {
  id: string;
  type: "session.created";
  properties: {
    sessionID: string;
    info: Session;
  };
};

export type EventSessionUpdated = {
  id: string;
  type: "session.updated";
  properties: {
    sessionID: string;
    info: Session;
  };
};

export type EventSessionDeleted = {
  id: string;
  type: "session.deleted";
  properties: {
    sessionID: string;
    info: Session;
  };
};

export type EventMessageUpdated = {
  id: string;
  type: "message.updated";
  properties: {
    sessionID: string;
    info: Message;
  };
};

export type EventMessageRemoved = {
  id: string;
  type: "message.removed";
  properties: {
    sessionID: string;
    messageID: string;
  };
};

export type EventMessagePartUpdated = {
  id: string;
  type: "message.part.updated";
  properties: {
    sessionID: string;
    part: Part;
    time: number;
  };
};

export type EventMessagePartRemoved = {
  id: string;
  type: "message.part.removed";
  properties: {
    sessionID: string;
    messageID: string;
    partID: string;
  };
};

export type EventSessionNextAgentSwitched = {
  id: string;
  type: "session.next.agent.switched";
  properties: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    agent: string;
  };
};

export type EventSessionNextModelSwitched = {
  id: string;
  type: "session.next.model.switched";
  properties: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    model: ModelRef;
  };
};

export type EventSessionNextMoved = {
  id: string;
  type: "session.next.moved";
  properties: {
    timestamp: number;
    sessionID: string;
    location: LocationRef;
    subdirectory?: string;
  };
};

export type EventSessionNextPrompted = {
  id: string;
  type: "session.next.prompted";
  properties: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    prompt: Prompt;
    delivery: "steer" | "queue";
  };
};

export type EventSessionNextPromptAdmitted = {
  id: string;
  type: "session.next.prompt.admitted";
  properties: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    prompt: Prompt;
    delivery: "steer" | "queue";
  };
};

export type EventSessionNextContextUpdated = {
  id: string;
  type: "session.next.context.updated";
  properties: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    text: string;
  };
};

export type EventSessionNextSynthetic = {
  id: string;
  type: "session.next.synthetic";
  properties: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    text: string;
  };
};

export type EventSessionNextShellStarted = {
  id: string;
  type: "session.next.shell.started";
  properties: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    callID: string;
    command: string;
  };
};

export type EventSessionNextShellEnded = {
  id: string;
  type: "session.next.shell.ended";
  properties: {
    timestamp: number;
    sessionID: string;
    callID: string;
    output: string;
  };
};

export type EventSessionNextStepStarted = {
  id: string;
  type: "session.next.step.started";
  properties: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    agent: string;
    model: ModelRef;
    snapshot?: string;
  };
};

export type EventSessionNextStepEnded = {
  id: string;
  type: "session.next.step.ended";
  properties: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    finish: string;
    cost: number;
    tokens: {
      input: number;
      output: number;
      reasoning: number;
      cache: {
        read: number;
        write: number;
      };
    };
    snapshot?: string;
    files?: Array<string>;
  };
};

export type EventSessionNextStepFailed = {
  id: string;
  type: "session.next.step.failed";
  properties: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    error: SessionErrorUnknown;
  };
};

export type EventSessionNextTextStarted = {
  id: string;
  type: "session.next.text.started";
  properties: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    textID: string;
  };
};

export type EventSessionNextTextDelta = {
  id: string;
  type: "session.next.text.delta";
  properties: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    textID: string;
    delta: string;
  };
};

export type EventSessionNextTextEnded = {
  id: string;
  type: "session.next.text.ended";
  properties: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    textID: string;
    text: string;
  };
};

export type EventSessionNextReasoningStarted = {
  id: string;
  type: "session.next.reasoning.started";
  properties: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    reasoningID: string;
    providerMetadata?: LLMProviderMetadata;
  };
};

export type EventSessionNextReasoningDelta = {
  id: string;
  type: "session.next.reasoning.delta";
  properties: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    reasoningID: string;
    delta: string;
  };
};

export type EventSessionNextReasoningEnded = {
  id: string;
  type: "session.next.reasoning.ended";
  properties: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    reasoningID: string;
    text: string;
    providerMetadata?: LLMProviderMetadata;
  };
};

export type EventSessionNextToolInputStarted = {
  id: string;
  type: "session.next.tool.input.started";
  properties: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    callID: string;
    name: string;
  };
};

export type EventSessionNextToolInputDelta = {
  id: string;
  type: "session.next.tool.input.delta";
  properties: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    callID: string;
    delta: string;
  };
};

export type EventSessionNextToolInputEnded = {
  id: string;
  type: "session.next.tool.input.ended";
  properties: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    callID: string;
    text: string;
  };
};

export type EventSessionNextToolCalled = {
  id: string;
  type: "session.next.tool.called";
  properties: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    callID: string;
    tool: string;
    input: Record<string, unknown>;
    provider: {
      executed: boolean;
      metadata?: LLMProviderMetadata;
    };
  };
};

export type EventSessionNextToolProgress = {
  id: string;
  type: "session.next.tool.progress";
  properties: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    callID: string;
    structured: Record<string, unknown>;
    content: Array<LLMToolContent>;
  };
};

export type EventSessionNextToolSuccess = {
  id: string;
  type: "session.next.tool.success";
  properties: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    callID: string;
    structured: Record<string, unknown>;
    content: Array<LLMToolContent>;
    outputPaths?: Array<string>;
    result?: unknown;
    provider: {
      executed: boolean;
      metadata?: LLMProviderMetadata;
    };
  };
};

export type EventSessionNextToolFailed = {
  id: string;
  type: "session.next.tool.failed";
  properties: {
    timestamp: number;
    sessionID: string;
    assistantMessageID: string;
    callID: string;
    error: SessionErrorUnknown;
    result?: unknown;
    provider: {
      executed: boolean;
      metadata?: LLMProviderMetadata;
    };
  };
};

export type EventSessionNextRetried = {
  id: string;
  type: "session.next.retried";
  properties: {
    timestamp: number;
    sessionID: string;
    attempt: number;
    error: SessionNextRetry_error;
  };
};

export type EventSessionNextCompactionStarted = {
  id: string;
  type: "session.next.compaction.started";
  properties: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    reason: "auto" | "manual";
  };
};

export type EventSessionNextCompactionDelta = {
  id: string;
  type: "session.next.compaction.delta";
  properties: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    text: string;
  };
};

export type EventSessionNextCompactionEnded = {
  id: string;
  type: "session.next.compaction.ended";
  properties: {
    timestamp: number;
    sessionID: string;
    messageID: string;
    reason: "auto" | "manual";
    text: string;
    recent: string;
  };
};

export type EventSessionNextRevertStaged = {
  id: string;
  type: "session.next.revert.staged";
  properties: {
    timestamp: number;
    sessionID: string;
    revert: RevertState;
  };
};

export type EventSessionNextRevertCleared = {
  id: string;
  type: "session.next.revert.cleared";
  properties: {
    timestamp: number;
    sessionID: string;
  };
};

export type EventSessionNextRevertCommitted = {
  id: string;
  type: "session.next.revert.committed";
  properties: {
    timestamp: number;
    sessionID: string;
    messageID: string;
  };
};

export type EventMessagePartDelta = {
  id: string;
  type: "message.part.delta";
  properties: {
    sessionID: string;
    messageID: string;
    partID: string;
    field: string;
    delta: string;
  };
};

export type EventSessionDiff = {
  id: string;
  type: "session.diff";
  properties: {
    sessionID: string;
    diff: Array<SnapshotFileDiff>;
  };
};

export type EventSessionError = {
  id: string;
  type: "session.error";
  properties: {
    sessionID?: string;
    error?: ProviderAuthError | UnknownError | MessageOutputLengthError | MessageAbortedError | StructuredOutputError | ContextOverflowError | ContentFilterError | APIError;
  };
};

export type EventInstallationUpdated = {
  id: string;
  type: "installation.updated";
  properties: {
    version: string;
  };
};

export type EventInstallationUpdate_available = {
  id: string;
  type: "installation.update-available";
  properties: {
    version: string;
  };
};

export type EventFileEdited = {
  id: string;
  type: "file.edited";
  properties: {
    file: string;
  };
};

export type EventReferenceUpdated = {
  id: string;
  type: "reference.updated";
  properties: Record<string, unknown>;
};

export type EventPermissionV2Asked = {
  id: string;
  type: "permission.v2.asked";
  properties: {
    id: string;
    sessionID: string;
    action: string;
    resources: Array<string>;
    save?: Array<string>;
    metadata?: Record<string, unknown>;
    source?: PermissionV2Source;
  };
};

export type EventPermissionV2Replied = {
  id: string;
  type: "permission.v2.replied";
  properties: {
    sessionID: string;
    requestID: string;
    reply: PermissionV2Reply;
  };
};

export type EventPluginAdded = {
  id: string;
  type: "plugin.added";
  properties: {
    id: string;
  };
};

export type EventProjectDirectoriesUpdated = {
  id: string;
  type: "project.directories.updated";
  properties: {
    projectID: string;
  };
};

export type EventFileWatcherUpdated = {
  id: string;
  type: "file.watcher.updated";
  properties: {
    file: string;
    event: "add" | "change" | "unlink";
  };
};

export type EventPtyCreated = {
  id: string;
  type: "pty.created";
  properties: {
    info: Pty;
  };
};

export type EventPtyUpdated = {
  id: string;
  type: "pty.updated";
  properties: {
    info: Pty;
  };
};

export type EventPtyExited = {
  id: string;
  type: "pty.exited";
  properties: {
    id: string;
    exitCode: number;
  };
};

export type EventPtyDeleted = {
  id: string;
  type: "pty.deleted";
  properties: {
    id: string;
  };
};

export type EventQuestionV2Asked = {
  id: string;
  type: "question.v2.asked";
  properties: {
    id: string;
    sessionID: string;
    /** Questions to ask */
    questions: Array<QuestionV2Info>;
    tool?: QuestionV2Tool;
  };
};

export type EventQuestionV2Replied = {
  id: string;
  type: "question.v2.replied";
  properties: {
    sessionID: string;
    requestID: string;
    answers: Array<QuestionV2Answer>;
  };
};

export type EventQuestionV2Rejected = {
  id: string;
  type: "question.v2.rejected";
  properties: {
    sessionID: string;
    requestID: string;
  };
};

export type EventTodoUpdated = {
  id: string;
  type: "todo.updated";
  properties: {
    sessionID: string;
    todos: Array<Todo>;
  };
};

export type EventLspUpdated = {
  id: string;
  type: "lsp.updated";
  properties: Record<string, unknown>;
};

export type EventPermissionAsked = {
  id: string;
  type: "permission.asked";
  properties: {
    id: string;
    sessionID: string;
    permission: string;
    patterns: Array<string>;
    metadata: Record<string, unknown>;
    always: Array<string>;
    tool?: {
      messageID: string;
      callID: string;
    };
  };
};

export type EventPermissionReplied = {
  id: string;
  type: "permission.replied";
  properties: {
    sessionID: string;
    requestID: string;
    reply: "once" | "always" | "reject";
  };
};

export type EventMcpToolsChanged = {
  id: string;
  type: "mcp.tools.changed";
  properties: {
    server: string;
  };
};

export type EventMcpBrowserOpenFailed = {
  id: string;
  type: "mcp.browser.open.failed";
  properties: {
    mcpName: string;
    url: string;
  };
};

export type EventCommandExecuted = {
  id: string;
  type: "command.executed";
  properties: {
    name: string;
    sessionID: string;
    arguments: string;
    messageID: string;
  };
};

export type EventProjectUpdated = {
  id: string;
  type: "project.updated";
  properties: {
    id: string;
    worktree: string;
    vcs?: ProjectVcs;
    name?: string;
    icon?: ProjectIcon;
    commands?: ProjectCommands;
    time: ProjectTime;
    sandboxes: Array<string>;
  };
};

export type EventSessionStatus = {
  id: string;
  type: "session.status";
  properties: {
    sessionID: string;
    status: SessionStatus;
  };
};

export type EventSessionIdle = {
  id: string;
  type: "session.idle";
  properties: {
    sessionID: string;
  };
};

export type EventQuestionAsked = {
  id: string;
  type: "question.asked";
  properties: {
    id: string;
    sessionID: string;
    /** Questions to ask */
    questions: Array<QuestionInfo>;
    tool?: QuestionTool;
  };
};

export type EventQuestionReplied = {
  id: string;
  type: "question.replied";
  properties: {
    sessionID: string;
    requestID: string;
    answers: Array<QuestionAnswer>;
  };
};

export type EventQuestionRejected = {
  id: string;
  type: "question.rejected";
  properties: {
    sessionID: string;
    requestID: string;
  };
};

export type EventSessionCompacted = {
  id: string;
  type: "session.compacted";
  properties: {
    sessionID: string;
  };
};

export type EventVcsBranchUpdated = {
  id: string;
  type: "vcs.branch.updated";
  properties: {
    branch?: string;
  };
};

export type EventWorkspaceReady = {
  id: string;
  type: "workspace.ready";
  properties: {
    name: string;
  };
};

export type EventWorkspaceFailed = {
  id: string;
  type: "workspace.failed";
  properties: {
    message: string;
  };
};

export type EventWorkspaceStatus = {
  id: string;
  type: "workspace.status";
  properties: {
    workspaceID: string;
    status: "connected" | "connecting" | "disconnected" | "error";
  };
};

export type EventWorktreeReady = {
  id: string;
  type: "worktree.ready";
  properties: {
    name: string;
    branch?: string;
  };
};

export type EventWorktreeFailed = {
  id: string;
  type: "worktree.failed";
  properties: {
    message: string;
  };
};

export type EventServerConnected = {
  id: string;
  type: "server.connected";
  properties: Record<string, unknown>;
};

export type EventGlobalDisposed = {
  id: string;
  type: "global.disposed";
  properties: Record<string, unknown>;
};

export type CredentialOAuth = {
  type: "oauth";
  methodID: string;
  refresh: string;
  access: string;
  expires: number;
  metadata?: Record<string, unknown>;
};

export type CredentialKey = {
  type: "key";
  key: string;
  metadata?: Record<string, unknown>;
};

export type SkillV2DirectorySource = {
  type: "directory";
  path: string;
};

export type SkillV2UrlSource = {
  type: "url";
  url: string;
};

export type SkillV2EmbeddedSource = {
  type: "embedded";
  skill: SkillV2Info;
};

export type BadRequestError = {
  name: "BadRequest";
  data: {
    message: string;
    kind?: "Params" | "Headers" | "Query" | "Body" | "Payload";
  };
};

/**
 * Every operation the pinned OpenAPI document declares: HTTP method, path
 * template, and whether the success response is a `text/event-stream`.
 *
 * `sse` is the load-bearing column — reading a JSON endpoint as a stream
 * (or the reverse) is exactly the mistake this table makes impossible to
 * hold for long, because upstream flipping it fails CI's `git diff`.
 */
export const OPENCODE_OPERATIONS = {
  "app.agents": { method: "GET", path: "/agent", sse: false },
  "app.log": { method: "POST", path: "/log", sse: false },
  "app.skills": { method: "GET", path: "/skill", sse: false },
  "auth.remove": { method: "DELETE", path: "/auth/{providerID}", sse: false },
  "auth.set": { method: "PUT", path: "/auth/{providerID}", sse: false },
  "command.list": { method: "GET", path: "/command", sse: false },
  "config.get": { method: "GET", path: "/config", sse: false },
  "config.providers": { method: "GET", path: "/config/providers", sse: false },
  "config.update": { method: "PATCH", path: "/config", sse: false },
  "event.subscribe": { method: "GET", path: "/event", sse: true },
  "experimental.capabilities.get": { method: "GET", path: "/experimental/capabilities", sse: false },
  "experimental.console.get": { method: "GET", path: "/experimental/console", sse: false },
  "experimental.console.listOrgs": { method: "GET", path: "/experimental/console/orgs", sse: false },
  "experimental.console.switchOrg": { method: "POST", path: "/experimental/console/switch", sse: false },
  "experimental.controlPlane.moveSession": { method: "POST", path: "/experimental/control-plane/move-session", sse: false },
  "experimental.projectCopy.generateName": { method: "POST", path: "/experimental/project/{projectID}/copy/generate-name", sse: false },
  "experimental.resource.list": { method: "GET", path: "/experimental/resource", sse: false },
  "experimental.session.background": { method: "POST", path: "/experimental/session/{sessionID}/background", sse: false },
  "experimental.session.list": { method: "GET", path: "/experimental/session", sse: false },
  "experimental.workspace.adapter.list": { method: "GET", path: "/experimental/workspace/adapter", sse: false },
  "experimental.workspace.create": { method: "POST", path: "/experimental/workspace", sse: false },
  "experimental.workspace.list": { method: "GET", path: "/experimental/workspace", sse: false },
  "experimental.workspace.remove": { method: "DELETE", path: "/experimental/workspace/{id}", sse: false },
  "experimental.workspace.status": { method: "GET", path: "/experimental/workspace/status", sse: false },
  "experimental.workspace.syncList": { method: "POST", path: "/experimental/workspace/sync-list", sse: false },
  "experimental.workspace.warp": { method: "POST", path: "/experimental/workspace/warp", sse: false },
  "file.list": { method: "GET", path: "/file", sse: false },
  "file.read": { method: "GET", path: "/file/content", sse: false },
  "file.status": { method: "GET", path: "/file/status", sse: false },
  "find.files": { method: "GET", path: "/find/file", sse: false },
  "find.symbols": { method: "GET", path: "/find/symbol", sse: false },
  "find.text": { method: "GET", path: "/find", sse: false },
  "formatter.status": { method: "GET", path: "/formatter", sse: false },
  "global.config.get": { method: "GET", path: "/global/config", sse: false },
  "global.config.update": { method: "PATCH", path: "/global/config", sse: false },
  "global.dispose": { method: "POST", path: "/global/dispose", sse: false },
  "global.event": { method: "GET", path: "/global/event", sse: true },
  "global.health": { method: "GET", path: "/global/health", sse: false },
  "global.upgrade": { method: "POST", path: "/global/upgrade", sse: false },
  "instance.dispose": { method: "POST", path: "/instance/dispose", sse: false },
  "lsp.status": { method: "GET", path: "/lsp", sse: false },
  "mcp.add": { method: "POST", path: "/mcp", sse: false },
  "mcp.auth.authenticate": { method: "POST", path: "/mcp/{name}/auth/authenticate", sse: false },
  "mcp.auth.callback": { method: "POST", path: "/mcp/{name}/auth/callback", sse: false },
  "mcp.auth.remove": { method: "DELETE", path: "/mcp/{name}/auth", sse: false },
  "mcp.auth.start": { method: "POST", path: "/mcp/{name}/auth", sse: false },
  "mcp.connect": { method: "POST", path: "/mcp/{name}/connect", sse: false },
  "mcp.disconnect": { method: "POST", path: "/mcp/{name}/disconnect", sse: false },
  "mcp.status": { method: "GET", path: "/mcp", sse: false },
  "part.delete": { method: "DELETE", path: "/session/{sessionID}/message/{messageID}/part/{partID}", sse: false },
  "part.update": { method: "PATCH", path: "/session/{sessionID}/message/{messageID}/part/{partID}", sse: false },
  "path.get": { method: "GET", path: "/path", sse: false },
  "permission.list": { method: "GET", path: "/permission", sse: false },
  "permission.reply": { method: "POST", path: "/permission/{requestID}/reply", sse: false },
  "permission.respond": { method: "POST", path: "/session/{sessionID}/permissions/{permissionID}", sse: false },
  "project.current": { method: "GET", path: "/project/current", sse: false },
  "project.directories": { method: "GET", path: "/project/{projectID}/directories", sse: false },
  "project.initGit": { method: "POST", path: "/project/git/init", sse: false },
  "project.list": { method: "GET", path: "/project", sse: false },
  "project.update": { method: "PATCH", path: "/project/{projectID}", sse: false },
  "provider.auth": { method: "GET", path: "/provider/auth", sse: false },
  "provider.list": { method: "GET", path: "/provider", sse: false },
  "provider.oauth.authorize": { method: "POST", path: "/provider/{providerID}/oauth/authorize", sse: false },
  "provider.oauth.callback": { method: "POST", path: "/provider/{providerID}/oauth/callback", sse: false },
  "pty.connect": { method: "GET", path: "/pty/{ptyID}/connect", sse: false },
  "pty.connectToken": { method: "POST", path: "/pty/{ptyID}/connect-token", sse: false },
  "pty.create": { method: "POST", path: "/pty", sse: false },
  "pty.get": { method: "GET", path: "/pty/{ptyID}", sse: false },
  "pty.list": { method: "GET", path: "/pty", sse: false },
  "pty.remove": { method: "DELETE", path: "/pty/{ptyID}", sse: false },
  "pty.shells": { method: "GET", path: "/pty/shells", sse: false },
  "pty.update": { method: "PUT", path: "/pty/{ptyID}", sse: false },
  "question.list": { method: "GET", path: "/question", sse: false },
  "question.reject": { method: "POST", path: "/question/{requestID}/reject", sse: false },
  "question.reply": { method: "POST", path: "/question/{requestID}/reply", sse: false },
  "session.abort": { method: "POST", path: "/session/{sessionID}/abort", sse: false },
  "session.children": { method: "GET", path: "/session/{sessionID}/children", sse: false },
  "session.command": { method: "POST", path: "/session/{sessionID}/command", sse: false },
  "session.create": { method: "POST", path: "/session", sse: false },
  "session.delete": { method: "DELETE", path: "/session/{sessionID}", sse: false },
  "session.deleteMessage": { method: "DELETE", path: "/session/{sessionID}/message/{messageID}", sse: false },
  "session.diff": { method: "GET", path: "/session/{sessionID}/diff", sse: false },
  "session.fork": { method: "POST", path: "/session/{sessionID}/fork", sse: false },
  "session.get": { method: "GET", path: "/session/{sessionID}", sse: false },
  "session.init": { method: "POST", path: "/session/{sessionID}/init", sse: false },
  "session.list": { method: "GET", path: "/session", sse: false },
  "session.message": { method: "GET", path: "/session/{sessionID}/message/{messageID}", sse: false },
  "session.messages": { method: "GET", path: "/session/{sessionID}/message", sse: false },
  "session.prompt": { method: "POST", path: "/session/{sessionID}/message", sse: false },
  "session.prompt_async": { method: "POST", path: "/session/{sessionID}/prompt_async", sse: false },
  "session.revert": { method: "POST", path: "/session/{sessionID}/revert", sse: false },
  "session.share": { method: "POST", path: "/session/{sessionID}/share", sse: false },
  "session.shell": { method: "POST", path: "/session/{sessionID}/shell", sse: false },
  "session.status": { method: "GET", path: "/session/status", sse: false },
  "session.summarize": { method: "POST", path: "/session/{sessionID}/summarize", sse: false },
  "session.todo": { method: "GET", path: "/session/{sessionID}/todo", sse: false },
  "session.unrevert": { method: "POST", path: "/session/{sessionID}/unrevert", sse: false },
  "session.unshare": { method: "DELETE", path: "/session/{sessionID}/share", sse: false },
  "session.update": { method: "PATCH", path: "/session/{sessionID}", sse: false },
  "sync.history.list": { method: "POST", path: "/sync/history", sse: false },
  "sync.replay": { method: "POST", path: "/sync/replay", sse: false },
  "sync.start": { method: "POST", path: "/sync/start", sse: false },
  "sync.steal": { method: "POST", path: "/sync/steal", sse: false },
  "tool.ids": { method: "GET", path: "/experimental/tool/ids", sse: false },
  "tool.list": { method: "GET", path: "/experimental/tool", sse: false },
  "tui.appendPrompt": { method: "POST", path: "/tui/append-prompt", sse: false },
  "tui.clearPrompt": { method: "POST", path: "/tui/clear-prompt", sse: false },
  "tui.control.next": { method: "GET", path: "/tui/control/next", sse: false },
  "tui.control.response": { method: "POST", path: "/tui/control/response", sse: false },
  "tui.executeCommand": { method: "POST", path: "/tui/execute-command", sse: false },
  "tui.openHelp": { method: "POST", path: "/tui/open-help", sse: false },
  "tui.openModels": { method: "POST", path: "/tui/open-models", sse: false },
  "tui.openSessions": { method: "POST", path: "/tui/open-sessions", sse: false },
  "tui.openThemes": { method: "POST", path: "/tui/open-themes", sse: false },
  "tui.publish": { method: "POST", path: "/tui/publish", sse: false },
  "tui.selectSession": { method: "POST", path: "/tui/select-session", sse: false },
  "tui.showToast": { method: "POST", path: "/tui/show-toast", sse: false },
  "tui.submitPrompt": { method: "POST", path: "/tui/submit-prompt", sse: false },
  "v2.agent.list": { method: "GET", path: "/api/agent", sse: false },
  "v2.command.list": { method: "GET", path: "/api/command", sse: false },
  "v2.credential.remove": { method: "DELETE", path: "/api/credential/{credentialID}", sse: false },
  "v2.credential.update": { method: "PATCH", path: "/api/credential/{credentialID}", sse: false },
  "v2.event.subscribe": { method: "GET", path: "/api/event", sse: true },
  "v2.fs.find": { method: "GET", path: "/api/fs/find", sse: false },
  "v2.fs.list": { method: "GET", path: "/api/fs/list", sse: false },
  "v2.fs.read": { method: "GET", path: "/api/fs/read/*", sse: false },
  "v2.health.get": { method: "GET", path: "/api/health", sse: false },
  "v2.integration.attempt.cancel": { method: "DELETE", path: "/api/integration/attempt/{attemptID}", sse: false },
  "v2.integration.attempt.complete": { method: "POST", path: "/api/integration/attempt/{attemptID}/complete", sse: false },
  "v2.integration.attempt.status": { method: "GET", path: "/api/integration/attempt/{attemptID}", sse: false },
  "v2.integration.connect.key": { method: "POST", path: "/api/integration/{integrationID}/connect/key", sse: false },
  "v2.integration.connect.oauth": { method: "POST", path: "/api/integration/{integrationID}/connect/oauth", sse: false },
  "v2.integration.get": { method: "GET", path: "/api/integration/{integrationID}", sse: false },
  "v2.integration.list": { method: "GET", path: "/api/integration", sse: false },
  "v2.location.get": { method: "GET", path: "/api/location", sse: false },
  "v2.model.list": { method: "GET", path: "/api/model", sse: false },
  "v2.permission.request.list": { method: "GET", path: "/api/permission/request", sse: false },
  "v2.permission.saved.list": { method: "GET", path: "/api/permission/saved", sse: false },
  "v2.permission.saved.remove": { method: "DELETE", path: "/api/permission/saved/{id}", sse: false },
  "v2.projectCopy.create": { method: "POST", path: "/experimental/project/{projectID}/copy", sse: false },
  "v2.projectCopy.refresh": { method: "POST", path: "/experimental/project/{projectID}/copy/refresh", sse: false },
  "v2.projectCopy.remove": { method: "DELETE", path: "/experimental/project/{projectID}/copy", sse: false },
  "v2.provider.get": { method: "GET", path: "/api/provider/{providerID}", sse: false },
  "v2.provider.list": { method: "GET", path: "/api/provider", sse: false },
  "v2.pty.connect": { method: "GET", path: "/api/pty/{ptyID}/connect", sse: false },
  "v2.pty.connectToken": { method: "POST", path: "/api/pty/{ptyID}/connect-token", sse: false },
  "v2.pty.create": { method: "POST", path: "/api/pty", sse: false },
  "v2.pty.get": { method: "GET", path: "/api/pty/{ptyID}", sse: false },
  "v2.pty.list": { method: "GET", path: "/api/pty", sse: false },
  "v2.pty.remove": { method: "DELETE", path: "/api/pty/{ptyID}", sse: false },
  "v2.pty.update": { method: "PUT", path: "/api/pty/{ptyID}", sse: false },
  "v2.question.request.list": { method: "GET", path: "/api/question/request", sse: false },
  "v2.reference.list": { method: "GET", path: "/api/reference", sse: false },
  "v2.session.active": { method: "GET", path: "/api/session/active", sse: false },
  "v2.session.compact": { method: "POST", path: "/api/session/{sessionID}/compact", sse: false },
  "v2.session.context": { method: "GET", path: "/api/session/{sessionID}/context", sse: false },
  "v2.session.create": { method: "POST", path: "/api/session", sse: false },
  "v2.session.events": { method: "GET", path: "/api/session/{sessionID}/event", sse: true },
  "v2.session.get": { method: "GET", path: "/api/session/{sessionID}", sse: false },
  "v2.session.history": { method: "GET", path: "/api/session/{sessionID}/history", sse: false },
  "v2.session.interrupt": { method: "POST", path: "/api/session/{sessionID}/interrupt", sse: false },
  "v2.session.list": { method: "GET", path: "/api/session", sse: false },
  "v2.session.message": { method: "GET", path: "/api/session/{sessionID}/message/{messageID}", sse: false },
  "v2.session.messages": { method: "GET", path: "/api/session/{sessionID}/message", sse: false },
  "v2.session.permission.create": { method: "POST", path: "/api/session/{sessionID}/permission", sse: false },
  "v2.session.permission.get": { method: "GET", path: "/api/session/{sessionID}/permission/{requestID}", sse: false },
  "v2.session.permission.list": { method: "GET", path: "/api/session/{sessionID}/permission", sse: false },
  "v2.session.permission.reply": { method: "POST", path: "/api/session/{sessionID}/permission/{requestID}/reply", sse: false },
  "v2.session.prompt": { method: "POST", path: "/api/session/{sessionID}/prompt", sse: false },
  "v2.session.question.list": { method: "GET", path: "/api/session/{sessionID}/question", sse: false },
  "v2.session.question.reject": { method: "POST", path: "/api/session/{sessionID}/question/{requestID}/reject", sse: false },
  "v2.session.question.reply": { method: "POST", path: "/api/session/{sessionID}/question/{requestID}/reply", sse: false },
  "v2.session.revert.clear": { method: "POST", path: "/api/session/{sessionID}/revert/clear", sse: false },
  "v2.session.revert.commit": { method: "POST", path: "/api/session/{sessionID}/revert/commit", sse: false },
  "v2.session.revert.stage": { method: "POST", path: "/api/session/{sessionID}/revert/stage", sse: false },
  "v2.session.switchAgent": { method: "POST", path: "/api/session/{sessionID}/agent", sse: false },
  "v2.session.switchModel": { method: "POST", path: "/api/session/{sessionID}/model", sse: false },
  "v2.session.wait": { method: "POST", path: "/api/session/{sessionID}/wait", sse: false },
  "v2.skill.list": { method: "GET", path: "/api/skill", sse: false },
  "vcs.apply": { method: "POST", path: "/vcs/apply", sse: false },
  "vcs.diff": { method: "GET", path: "/vcs/diff", sse: false },
  "vcs.diff.raw": { method: "GET", path: "/vcs/diff/raw", sse: false },
  "vcs.get": { method: "GET", path: "/vcs", sse: false },
  "vcs.status": { method: "GET", path: "/vcs/status", sse: false },
  "worktree.create": { method: "POST", path: "/experimental/worktree", sse: false },
  "worktree.list": { method: "GET", path: "/experimental/worktree", sse: false },
  "worktree.remove": { method: "DELETE", path: "/experimental/worktree", sse: false },
  "worktree.reset": { method: "POST", path: "/experimental/worktree/reset", sse: false },
} as const;

/** Operation ids present in the pinned document. */
export type OpencodeOperationId = keyof typeof OPENCODE_OPERATIONS;
