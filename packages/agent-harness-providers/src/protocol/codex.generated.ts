// AUTO-GENERATED — do not edit. Run `pnpm generate:schemas` to update.
// Protocol:        codex
// Source artifact: schemas/codex/codex_app_server_protocol.schemas.json@0.154.0
// Captured by:     node packages/agent-harness-providers/node_modules/@openai/codex/bin/codex.js app-server generate-json-schema --out <dir>  →  codex_app_server_protocol.schemas.json (the @openai/codex optionalDependency pinned in packages/agent-harness-providers/package.json)
// Artifact sha256: d71ddf3bf5484f8de2799f7a4793c2e66808a9ec1a330e2307accb088ab5948a
// Definitions:     700
//
// The sha256 above is of the upstream file itself. If the pinned dependency
// changes, this hash and the types below change with it, and CI's
// `git diff --exit-code` turns that into a failing build instead of a
// runtime decode error.

/**
 * A path that is guaranteed to be absolute and normalized (though it is not guaranteed to be canonicalized or exist on the filesystem).
 *
 * IMPORTANT: When deserializing an `AbsolutePathBuf`, a base path must be set using [AbsolutePathBufGuard::new]. If no base path is set, the deserialization will fail unless the path being deserialized is already absolute.
 */
export type AbsolutePathBuf = string;

export type AdditionalPermissionProfile = {
  fileSystem?: V2AdditionalFileSystemPermissions | null;
  /** Partial overlay used for per-command permission requests. */
  network?: V2AdditionalNetworkPermissions | null;
};

export type ApplyPatchApprovalParams = {
  /** Use to correlate this with [codex_protocol::protocol::PatchApplyBeginEvent] and [codex_protocol::protocol::PatchApplyEndEvent]. */
  callId: string;
  conversationId: V2ThreadId;
  fileChanges: Record<string, FileChange>;
  /** When set, the agent is asking the user to allow writes under this root for the remainder of the session (unclear if this is honored today). */
  grantRoot?: string | null;
  /** Optional explanatory reason (e.g. request for extra write access). */
  reason?: string | null;
};

export type ApplyPatchApprovalResponse = {
  decision: ReviewDecision;
};

export type AttestationGenerateParams = Record<string, unknown>;

export type AttestationGenerateResponse = {
  /** Opaque client attestation token. */
  token: string;
};

export type ChatgptAuthTokensRefreshParams = {
  /**
   * Workspace/account identifier that Codex was previously using.
   *
   * Clients that manage multiple accounts/workspaces can use this as a hint to refresh the token for the correct workspace.
   *
   * This may be `null` when the prior auth state did not include a workspace identifier (`chatgpt_account_id`).
   */
  previousAccountId?: string | null;
  reason: ChatgptAuthTokensRefreshReason;
};

export type ChatgptAuthTokensRefreshReason = "unauthorized";

export type ChatgptAuthTokensRefreshResponse = {
  accessToken: string;
  chatgptAccountId: string;
  chatgptPlanType?: string | null;
};

export type ClientInfo = {
  name: string;
  title?: string | null;
  version: string;
};

export type ClientNotification = {
  method: "initialized";
};

/** Request from the client to the server. */
export type ClientRequest = {
  id: V2RequestId;
  method: "initialize";
  params: InitializeParams;
} | {
  id: V2RequestId;
  method: "thread/start";
  params: V2ThreadStartParams;
} | {
  id: V2RequestId;
  method: "thread/resume";
  params: V2ThreadResumeParams;
} | {
  id: V2RequestId;
  method: "thread/fork";
  params: V2ThreadForkParams;
} | {
  id: V2RequestId;
  method: "thread/archive";
  params: V2ThreadArchiveParams;
} | {
  id: V2RequestId;
  method: "thread/delete";
  params: V2ThreadDeleteParams;
} | {
  id: V2RequestId;
  method: "thread/unsubscribe";
  params: V2ThreadUnsubscribeParams;
} | {
  id: V2RequestId;
  method: "thread/name/set";
  params: V2ThreadSetNameParams;
} | {
  id: V2RequestId;
  method: "thread/goal/set";
  params: V2ThreadGoalSetParams;
} | {
  id: V2RequestId;
  method: "thread/goal/get";
  params: V2ThreadGoalGetParams;
} | {
  id: V2RequestId;
  method: "thread/goal/clear";
  params: V2ThreadGoalClearParams;
} | {
  id: V2RequestId;
  method: "thread/metadata/update";
  params: V2ThreadMetadataUpdateParams;
} | {
  id: V2RequestId;
  method: "thread/section/move";
  params: V2ThreadSectionMoveParams;
} | {
  id: V2RequestId;
  method: "thread/unarchive";
  params: V2ThreadUnarchiveParams;
} | {
  id: V2RequestId;
  method: "thread/compact/start";
  params: V2ThreadCompactStartParams;
} | {
  id: V2RequestId;
  method: "thread/shellCommand";
  params: V2ThreadShellCommandParams;
} | {
  id: V2RequestId;
  method: "thread/approveGuardianDeniedAction";
  params: V2ThreadApproveGuardianDeniedActionParams;
} | {
  id: V2RequestId;
  method: "thread/rollback";
  params: V2ThreadRollbackParams;
} | {
  id: V2RequestId;
  method: "thread/revert";
  params: V2ThreadRevertParams;
} | {
  id: V2RequestId;
  method: "thread/list";
  params: V2ThreadListParams;
} | {
  id: V2RequestId;
  method: "threadSection/list";
  params: V2ThreadSectionListParams;
} | {
  id: V2RequestId;
  method: "threadSection/create";
  params: V2ThreadSectionCreateParams;
} | {
  id: V2RequestId;
  method: "threadSection/update";
  params: V2ThreadSectionUpdateParams;
} | {
  id: V2RequestId;
  method: "threadSection/delete";
  params: V2ThreadSectionDeleteParams;
} | {
  id: V2RequestId;
  method: "thread/loaded/list";
  params: V2ThreadLoadedListParams;
} | {
  id: V2RequestId;
  method: "thread/read";
  params: V2ThreadReadParams;
} | {
  id: V2RequestId;
  method: "thread/turns/list";
  params: V2ThreadTurnsListParams;
} | {
  id: V2RequestId;
  method: "thread/items/list";
  params: V2ThreadItemsListParams;
} | {
  id: V2RequestId;
  method: "thread/inject_items";
  params: V2ThreadInjectItemsParams;
} | {
  id: V2RequestId;
  method: "skills/list";
  params: V2SkillsListParams;
} | {
  id: V2RequestId;
  method: "skills/extraRoots/set";
  params: V2SkillsExtraRootsSetParams;
} | {
  id: V2RequestId;
  method: "hooks/list";
  params: V2HooksListParams;
} | {
  id: V2RequestId;
  method: "marketplace/add";
  params: V2MarketplaceAddParams;
} | {
  id: V2RequestId;
  method: "marketplace/remove";
  params: V2MarketplaceRemoveParams;
} | {
  id: V2RequestId;
  method: "marketplace/upgrade";
  params: V2MarketplaceUpgradeParams;
} | {
  id: V2RequestId;
  method: "plugin/list";
  params: V2PluginListParams;
} | {
  id: V2RequestId;
  method: "plugin/installed";
  params: V2PluginInstalledParams;
} | {
  id: V2RequestId;
  method: "plugin/reconcile";
  params: V2PluginReconcileParams;
} | {
  id: V2RequestId;
  method: "plugin/read";
  params: V2PluginReadParams;
} | {
  id: V2RequestId;
  method: "plugin/skill/read";
  params: V2PluginSkillReadParams;
} | {
  id: V2RequestId;
  method: "plugin/share/save";
  params: V2PluginShareSaveParams;
} | {
  id: V2RequestId;
  method: "plugin/share/updateTargets";
  params: V2PluginShareUpdateTargetsParams;
} | {
  id: V2RequestId;
  method: "plugin/share/list";
  params: V2PluginShareListParams;
} | {
  id: V2RequestId;
  method: "plugin/share/checkout";
  params: V2PluginShareCheckoutParams;
} | {
  id: V2RequestId;
  method: "plugin/share/delete";
  params: V2PluginShareDeleteParams;
} | {
  id: V2RequestId;
  method: "app/read";
  params: V2AppsReadParams;
} | {
  id: V2RequestId;
  method: "app/list";
  params: V2AppsListParams;
} | {
  id: V2RequestId;
  method: "app/installed";
  params: V2AppsInstalledParams;
} | {
  id: V2RequestId;
  method: "fs/readFile";
  params: V2FsReadFileParams;
} | {
  id: V2RequestId;
  method: "fs/writeFile";
  params: V2FsWriteFileParams;
} | {
  id: V2RequestId;
  method: "fs/createDirectory";
  params: V2FsCreateDirectoryParams;
} | {
  id: V2RequestId;
  method: "fs/getMetadata";
  params: V2FsGetMetadataParams;
} | {
  id: V2RequestId;
  method: "fs/readDirectory";
  params: V2FsReadDirectoryParams;
} | {
  id: V2RequestId;
  method: "fs/remove";
  params: V2FsRemoveParams;
} | {
  id: V2RequestId;
  method: "fs/copy";
  params: V2FsCopyParams;
} | {
  id: V2RequestId;
  method: "fs/watch";
  params: V2FsWatchParams;
} | {
  id: V2RequestId;
  method: "fs/unwatch";
  params: V2FsUnwatchParams;
} | {
  id: V2RequestId;
  method: "skills/config/write";
  params: V2SkillsConfigWriteParams;
} | {
  id: V2RequestId;
  method: "plugin/install";
  params: V2PluginInstallParams;
} | {
  id: V2RequestId;
  method: "plugin/uninstall";
  params: V2PluginUninstallParams;
} | {
  id: V2RequestId;
  method: "turn/start";
  params: V2TurnStartParams;
} | {
  id: V2RequestId;
  method: "turn/steer";
  params: V2TurnSteerParams;
} | {
  id: V2RequestId;
  method: "turn/interrupt";
  params: V2TurnInterruptParams;
} | {
  id: V2RequestId;
  method: "review/start";
  params: V2ReviewStartParams;
} | {
  id: V2RequestId;
  method: "model/list";
  params: V2ModelListParams;
} | {
  id: V2RequestId;
  method: "modelProvider/capabilities/read";
  params: V2ModelProviderCapabilitiesReadParams;
} | {
  id: V2RequestId;
  method: "experimentalFeature/list";
  params: V2ExperimentalFeatureListParams;
} | {
  id: V2RequestId;
  method: "permissionProfile/list";
  params: V2PermissionProfileListParams;
} | {
  id: V2RequestId;
  method: "experimentalFeature/enablement/set";
  params: V2ExperimentalFeatureEnablementSetParams;
} | {
  id: V2RequestId;
  method: "mcpServer/oauth/login";
  params: V2McpServerOauthLoginParams;
} | {
  id: V2RequestId;
  method: "config/mcpServer/reload";
  params?: null;
} | {
  id: V2RequestId;
  method: "mcpServerStatus/list";
  params: V2ListMcpServerStatusParams;
} | {
  id: V2RequestId;
  method: "mcpServer/resource/read";
  params: V2McpResourceReadParams;
} | {
  id: V2RequestId;
  method: "mcpServer/tool/call";
  params: V2McpServerToolCallParams;
} | {
  id: V2RequestId;
  method: "windowsSandbox/setupStart";
  params: V2WindowsSandboxSetupStartParams;
} | {
  id: V2RequestId;
  method: "windowsSandbox/readiness";
  params?: null;
} | {
  id: V2RequestId;
  method: "account/login/start";
  params: V2LoginAccountParams;
} | {
  id: V2RequestId;
  method: "account/login/cancel";
  params: V2CancelLoginAccountParams;
} | {
  id: V2RequestId;
  method: "account/logout";
  params?: null;
} | ({
  id: V2RequestId;
  method: "account/rateLimits/read";
  params?: V2GetAccountRateLimitsParams | null;
}) | {
  id: V2RequestId;
  method: "account/rateLimitResetCredit/consume";
  params: V2ConsumeAccountRateLimitResetCreditParams;
} | ({
  id: V2RequestId;
  method: "account/usage/read";
  params?: V2GetAccountTokenUsageParams | null;
}) | {
  id: V2RequestId;
  method: "account/workspaceMessages/read";
  params?: null;
} | {
  id: V2RequestId;
  method: "account/sendAddCreditsNudgeEmail";
  params: V2SendAddCreditsNudgeEmailParams;
} | {
  id: V2RequestId;
  method: "feedback/upload";
  params: V2FeedbackUploadParams;
} | {
  id: V2RequestId;
  method: "command/exec";
  params: V2CommandExecParams;
} | {
  id: V2RequestId;
  method: "command/exec/write";
  params: V2CommandExecWriteParams;
} | {
  id: V2RequestId;
  method: "command/exec/terminate";
  params: V2CommandExecTerminateParams;
} | {
  id: V2RequestId;
  method: "command/exec/resize";
  params: V2CommandExecResizeParams;
} | {
  id: V2RequestId;
  method: "config/read";
  params: V2ConfigReadParams;
} | {
  id: V2RequestId;
  method: "externalAgentConfig/detect";
  params: V2ExternalAgentConfigDetectParams;
} | {
  id: V2RequestId;
  method: "externalAgentConfig/import";
  params: V2ExternalAgentConfigImportParams;
} | {
  id: V2RequestId;
  method: "externalAgentConfig/import/recordHistory";
  params: V2ExternalAgentConfigImportHistoryRecordParams;
} | {
  id: V2RequestId;
  method: "externalAgentConfig/import/readHistories";
  params?: null;
} | {
  id: V2RequestId;
  method: "config/value/write";
  params: V2ConfigValueWriteParams;
} | {
  id: V2RequestId;
  method: "config/batchWrite";
  params: V2ConfigBatchWriteParams;
} | {
  id: V2RequestId;
  method: "configRequirements/read";
  params?: null;
} | {
  id: V2RequestId;
  method: "account/read";
  params: V2GetAccountParams;
} | {
  id: V2RequestId;
  method: "fuzzyFileSearch";
  params: FuzzyFileSearchParams;
};

export type CommandExecutionApprovalDecision = "accept" | "acceptForSession" | {
  acceptWithExecpolicyAmendment: {
    execpolicy_amendment: Array<string>;
  };
} | {
  applyNetworkPolicyAmendment: {
    network_policy_amendment: NetworkPolicyAmendment;
  };
} | "decline" | "cancel";

/** Distinguishes a command approval from input sent to an existing terminal. */
export type CommandExecutionApprovalKind = "command" | "writeStdin";

export type CommandExecutionRequestApprovalParams = {
  /**
   * Unique identifier for this specific approval callback.
   *
   * For regular shell/unified_exec approvals, this is null.
   *
   * For zsh-exec-bridge subcommand approvals, multiple callbacks can belong to one parent `itemId`, so `approvalId` is a distinct opaque callback id (a UUID) used to disambiguate routing. Stdin approvals also use a distinct callback id; inspect `kind` to distinguish them.
   */
  approvalId?: string | null;
  /** The command to be executed. */
  command?: string | null;
  /** Best-effort parsed command actions for friendly display. */
  commandActions?: Array<V2CommandAction> | null;
  /** The command's working directory. */
  cwd?: V2LegacyAppPathString | null;
  /** Environment in which the command will run. */
  environmentId?: string | null;
  itemId: string;
  /** Kind of action under review. Defaults to `command` for older servers. */
  kind?: CommandExecutionApprovalKind;
  /** Optional context for a managed-network approval prompt. */
  networkApprovalContext?: NetworkApprovalContext | null;
  /** Optional proposed execpolicy amendment to allow similar commands without prompting. */
  proposedExecpolicyAmendment?: Array<string> | null;
  /** Optional proposed network policy amendments (allow/deny host) for future requests. */
  proposedNetworkPolicyAmendments?: Array<NetworkPolicyAmendment> | null;
  /** Optional explanatory reason (e.g. request for network access). */
  reason?: string | null;
  /** Unix timestamp (in milliseconds) when this approval request started. */
  startedAtMs: number;
  threadId: string;
  turnId: string;
};

export type CommandExecutionRequestApprovalResponse = {
  decision: CommandExecutionApprovalDecision;
};

export type DynamicToolCallParams = {
  arguments: unknown;
  callId: string;
  namespace?: string | null;
  threadId: string;
  tool: string;
  turnId: string;
};

export type DynamicToolCallResponse = {
  contentItems: Array<V2DynamicToolCallOutputContentItem>;
  success: boolean;
};

export type ExecCommandApprovalParams = {
  /** Identifier for this specific approval callback. */
  approvalId?: string | null;
  /** Use to correlate this with [codex_protocol::protocol::ExecCommandBeginEvent] and [codex_protocol::protocol::ExecCommandEndEvent]. */
  callId: string;
  command: Array<string>;
  conversationId: V2ThreadId;
  cwd: string;
  parsedCmd: Array<ParsedCommand>;
  reason?: string | null;
};

export type ExecCommandApprovalResponse = {
  decision: ReviewDecision;
};

export type FileChange = {
  content: string;
  type: "add";
} | {
  content: string;
  type: "delete";
} | ({
  move_path?: string | null;
  type: "update";
  unified_diff: string;
});

export type FileChangeApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export type FileChangeRequestApprovalParams = {
  /** [UNSTABLE] When set, the agent is asking the user to allow writes under this root for the remainder of the session (unclear if this is honored today). */
  grantRoot?: string | null;
  itemId: string;
  /** Optional explanatory reason (e.g. request for extra write access). */
  reason?: string | null;
  /** Unix timestamp (in milliseconds) when this approval request started. */
  startedAtMs: number;
  threadId: string;
  turnId: string;
};

export type FileChangeRequestApprovalResponse = {
  decision: FileChangeApprovalDecision;
};

export type FuzzyFileSearchMatchType = "file" | "directory";

export type FuzzyFileSearchParams = {
  cancellationToken?: string | null;
  query: string;
  roots: Array<string>;
};

export type FuzzyFileSearchResponse = {
  files: Array<FuzzyFileSearchResult>;
};

/** Superset of [`codex_file_search::FileMatch`] */
export type FuzzyFileSearchResult = {
  file_name: string;
  indices?: Array<number> | null;
  match_type: FuzzyFileSearchMatchType;
  path: string;
  root: string;
  score: number;
};

export type FuzzyFileSearchSessionCompletedNotification = {
  sessionId: string;
};

export type FuzzyFileSearchSessionUpdatedNotification = {
  files: Array<FuzzyFileSearchResult>;
  query: string;
  sessionId: string;
};

export type GrantedPermissionProfile = {
  fileSystem?: V2AdditionalFileSystemPermissions | null;
  network?: V2AdditionalNetworkPermissions | null;
};

/** Client-declared capabilities negotiated during initialize. */
export type InitializeCapabilities = {
  /** Opt into receiving experimental API methods and fields. */
  experimentalApi?: boolean;
  /** MCP extension settings declared by the app-server client. */
  extensions?: Record<string, unknown> | null;
  /**
   * Legacy opt-in for the `openai/form` MCP extension.
   *
   * New clients should declare `openai/form` in [`Self::extensions`].
   */
  mcpServerOpenaiFormElicitation?: boolean;
  /** Exact notification method names that should be suppressed for this connection (for example `thread/started`). */
  optOutNotificationMethods?: Array<string> | null;
  /** Opt into `attestation/generate` requests for upstream `x-oai-attestation`. */
  requestAttestation?: boolean;
};

export type InitializeParams = {
  capabilities?: InitializeCapabilities | null;
  clientInfo: ClientInfo;
};

export type InitializeResponse = {
  /** Absolute path to the server's $CODEX_HOME directory. */
  codexHome: V2AbsolutePathBuf;
  /** Platform family for the running app-server target, for example `"unix"` or `"windows"`. */
  platformFamily: string;
  /** Operating system for the running app-server target, for example `"macos"`, `"linux"`, or `"windows"`. */
  platformOs: string;
  userAgent: string;
};

/** A response to a request that indicates an error occurred. */
export type JSONRPCError = {
  error: JSONRPCErrorError;
  id: V2RequestId;
};

export type JSONRPCErrorError = {
  code: number;
  data?: unknown;
  message: string;
};

/** Refers to any valid JSON-RPC object that can be decoded off the wire, or encoded to be sent. */
export type JSONRPCMessage = JSONRPCRequest | JSONRPCNotification | JSONRPCResponse | JSONRPCError;

/** A notification which does not expect a response. */
export type JSONRPCNotification = {
  method: string;
  params?: unknown;
};

/** A request that expects a response. */
export type JSONRPCRequest = {
  id: V2RequestId;
  method: string;
  params?: unknown;
  /** Optional W3C Trace Context for distributed tracing. */
  trace?: W3cTraceContext | null;
};

/** A successful (non-error) response to a request. */
export type JSONRPCResponse = {
  id: V2RequestId;
  result: unknown;
};

export type McpElicitationArrayType = "array";

export type McpElicitationBooleanSchema = {
  default?: boolean | null;
  description?: string | null;
  title?: string | null;
  type: McpElicitationBooleanType;
};

export type McpElicitationBooleanType = "boolean";

export type McpElicitationConstOption = {
  const: string;
  title: string;
};

export type McpElicitationEnumSchema = McpElicitationSingleSelectEnumSchema | McpElicitationMultiSelectEnumSchema | McpElicitationLegacyTitledEnumSchema;

export type McpElicitationLegacyTitledEnumSchema = {
  default?: string | null;
  description?: string | null;
  enum: Array<string>;
  enumNames?: Array<string> | null;
  title?: string | null;
  type: McpElicitationStringType;
};

export type McpElicitationMultiSelectEnumSchema = McpElicitationUntitledMultiSelectEnumSchema | McpElicitationTitledMultiSelectEnumSchema;

export type McpElicitationNumberSchema = {
  default?: number | null;
  description?: string | null;
  maximum?: number | null;
  minimum?: number | null;
  title?: string | null;
  type: McpElicitationNumberType;
};

export type McpElicitationNumberType = "number" | "integer";

export type McpElicitationObjectType = "object";

export type McpElicitationPrimitiveSchema = McpElicitationEnumSchema | McpElicitationStringSchema | McpElicitationNumberSchema | McpElicitationBooleanSchema;

/**
 * Typed form schema for MCP `elicitation/create` requests.
 *
 * This matches the `requestedSchema` shape from the MCP 2025-11-25 `ElicitRequestFormParams` schema.
 */
export type McpElicitationSchema = {
  $schema?: string | null;
  properties: Record<string, McpElicitationPrimitiveSchema>;
  required?: Array<string> | null;
  type: McpElicitationObjectType;
};

export type McpElicitationSingleSelectEnumSchema = McpElicitationUntitledSingleSelectEnumSchema | McpElicitationTitledSingleSelectEnumSchema;

export type McpElicitationStringFormat = "email" | "uri" | "date" | "date-time";

export type McpElicitationStringSchema = {
  default?: string | null;
  description?: string | null;
  format?: McpElicitationStringFormat | null;
  maxLength?: number | null;
  minLength?: number | null;
  title?: string | null;
  type: McpElicitationStringType;
};

export type McpElicitationStringType = "string";

export type McpElicitationTitledEnumItems = {
  anyOf: Array<McpElicitationConstOption>;
};

export type McpElicitationTitledMultiSelectEnumSchema = {
  default?: Array<string> | null;
  description?: string | null;
  items: McpElicitationTitledEnumItems;
  maxItems?: number | null;
  minItems?: number | null;
  title?: string | null;
  type: McpElicitationArrayType;
};

export type McpElicitationTitledSingleSelectEnumSchema = {
  default?: string | null;
  description?: string | null;
  oneOf: Array<McpElicitationConstOption>;
  title?: string | null;
  type: McpElicitationStringType;
};

export type McpElicitationUntitledEnumItems = {
  enum: Array<string>;
  type: McpElicitationStringType;
};

export type McpElicitationUntitledMultiSelectEnumSchema = {
  default?: Array<string> | null;
  description?: string | null;
  items: McpElicitationUntitledEnumItems;
  maxItems?: number | null;
  minItems?: number | null;
  title?: string | null;
  type: McpElicitationArrayType;
};

export type McpElicitationUntitledSingleSelectEnumSchema = {
  default?: string | null;
  description?: string | null;
  enum: Array<string>;
  title?: string | null;
  type: McpElicitationStringType;
};

export type McpServerElicitationAction = "accept" | "decline" | "cancel";

export type McpServerElicitationRequestParams = {
  _meta?: unknown;
  message: string;
  mode: "form";
  requestedSchema: McpElicitationSchema;
} | {
  _meta?: unknown;
  message: string;
  mode: "openai/form";
  requestedSchema: unknown;
} | {
  _meta?: unknown;
  message: string;
  mode: "openaiForm";
  requestedSchema: unknown;
} | {
  _meta?: unknown;
  elicitationId: string;
  message: string;
  mode: "url";
  url: string;
};

export type McpServerElicitationRequestResponse = {
  /** Optional client metadata for form-mode action handling. */
  _meta?: unknown;
  action: McpServerElicitationAction;
  /**
   * Structured user input for accepted elicitations, mirroring RMCP `CreateElicitationResult`.
   *
   * This is nullable because decline/cancel responses have no content.
   */
  content?: unknown;
};

export type NetworkApprovalContext = {
  host: string;
  protocol: V2NetworkApprovalProtocol;
};

export type NetworkPolicyAmendment = {
  action: NetworkPolicyRuleAction;
  host: string;
};

export type NetworkPolicyRuleAction = "allow" | "deny";

export type ParsedCommand = {
  cmd: string;
  name: string;
  /** (Best effort) Path to the file being read by the command. When possible, this is an absolute path, though when relative, it should be resolved against the `cwd`` that will be used to run the command to derive the absolute path. */
  path: string;
  type: "read";
} | ({
  cmd: string;
  path?: string | null;
  type: "list_files";
}) | ({
  cmd: string;
  path?: string | null;
  query?: string | null;
  type: "search";
}) | {
  cmd: string;
  type: "unknown";
};

export type PermissionGrantScope = "turn" | "session";

export type PermissionsRequestApprovalParams = {
  cwd: V2LegacyAppPathString;
  environmentId?: string | null;
  itemId: string;
  permissions: V2RequestPermissionProfile;
  reason?: string | null;
  /** Unix timestamp (in milliseconds) when this approval request started. */
  startedAtMs: number;
  threadId: string;
  turnId: string;
};

export type PermissionsRequestApprovalResponse = {
  permissions: GrantedPermissionProfile;
  scope?: PermissionGrantScope;
  /** Review every subsequent command in this turn before normal sandboxed execution. */
  strictAutoReview?: boolean | null;
};

export type RequestId = string | number;

/** User's decision in response to an ExecApprovalRequest. */
export type ReviewDecision = "approved" | {
  approved_execpolicy_amendment: {
    proposed_execpolicy_amendment: Array<string>;
  };
} | "approved_for_session" | "approved_mcp_policy_amendment" | {
  network_policy_amendment: {
    network_policy_amendment: NetworkPolicyAmendment;
  };
} | {
  denied: {
    rejection: string;
  };
} | "timed_out" | "abort";

/** Notification sent from the server to the client. */
export type ServerNotification = {
  method: "error";
  params: V2ErrorNotification;
} | {
  method: "thread/started";
  params: V2ThreadStartedNotification;
} | {
  method: "thread/status/changed";
  params: V2ThreadStatusChangedNotification;
} | {
  method: "thread/archived";
  params: V2ThreadArchivedNotification;
} | {
  method: "thread/deleted";
  params: V2ThreadDeletedNotification;
} | {
  method: "thread/unarchived";
  params: V2ThreadUnarchivedNotification;
} | {
  method: "thread/closed";
  params: V2ThreadClosedNotification;
} | {
  method: "thread/reverted";
  params: V2ThreadRevertedNotification;
} | {
  method: "skills/changed";
  params: V2SkillsChangedNotification;
} | {
  method: "thread/name/updated";
  params: V2ThreadNameUpdatedNotification;
} | {
  method: "thread/goal/updated";
  params: V2ThreadGoalUpdatedNotification;
} | {
  method: "thread/goal/cleared";
  params: V2ThreadGoalClearedNotification;
} | {
  method: "thread/queue/changed";
  params: V2ThreadQueueChangedNotification;
} | {
  method: "project/changed";
  params: V2ProjectChangedNotification;
} | {
  method: "thread/project/updated";
  params: V2ThreadProjectUpdatedNotification;
} | {
  method: "thread/environment/connected";
  params: V2EnvironmentConnectionNotification;
} | {
  method: "thread/environment/disconnected";
  params: V2EnvironmentConnectionNotification;
} | {
  method: "thread/settings/updated";
  params: V2ThreadSettingsUpdatedNotification;
} | {
  method: "thread/tokenUsage/updated";
  params: V2ThreadTokenUsageUpdatedNotification;
} | {
  method: "turn/started";
  params: V2TurnStartedNotification;
} | {
  method: "hook/started";
  params: V2HookStartedNotification;
} | {
  method: "turn/completed";
  params: V2TurnCompletedNotification;
} | {
  method: "hook/completed";
  params: V2HookCompletedNotification;
} | {
  method: "turn/diff/updated";
  params: V2TurnDiffUpdatedNotification;
} | {
  method: "turn/plan/updated";
  params: V2TurnPlanUpdatedNotification;
} | {
  method: "item/started";
  params: V2ItemStartedNotification;
} | {
  method: "item/autoApprovalReview/started";
  params: V2ItemGuardianApprovalReviewStartedNotification;
} | {
  method: "item/autoApprovalReview/completed";
  params: V2ItemGuardianApprovalReviewCompletedNotification;
} | {
  method: "autoApprovalReview/strictReviewRequired";
  params: V2StrictReviewRequiredNotification;
} | {
  method: "item/completed";
  params: V2ItemCompletedNotification;
} | {
  method: "item/agentMessage/delta";
  params: V2AgentMessageDeltaNotification;
} | {
  method: "item/plan/delta";
  params: V2PlanDeltaNotification;
} | {
  method: "command/exec/outputDelta";
  params: V2CommandExecOutputDeltaNotification;
} | {
  method: "process/outputDelta";
  params: V2ProcessOutputDeltaNotification;
} | {
  method: "process/exited";
  params: V2ProcessExitedNotification;
} | {
  method: "item/commandExecution/outputDelta";
  params: V2CommandExecutionOutputDeltaNotification;
} | {
  method: "item/commandExecution/terminalInteraction";
  params: V2TerminalInteractionNotification;
} | {
  method: "item/fileChange/outputDelta";
  params: V2FileChangeOutputDeltaNotification;
} | {
  method: "item/fileChange/patchUpdated";
  params: V2FileChangePatchUpdatedNotification;
} | {
  method: "serverRequest/resolved";
  params: V2ServerRequestResolvedNotification;
} | {
  method: "item/mcpToolCall/progress";
  params: V2McpToolCallProgressNotification;
} | {
  method: "mcpServer/oauthLogin/completed";
  params: V2McpServerOauthLoginCompletedNotification;
} | {
  method: "mcpServer/startupStatus/updated";
  params: V2McpServerStatusUpdatedNotification;
} | {
  method: "mcpServer/event/stream/notification";
  params: V2McpServerEventStreamNotification;
} | {
  method: "account/updated";
  params: V2AccountUpdatedNotification;
} | {
  method: "account/rateLimits/updated";
  params: V2AccountRateLimitsUpdatedNotification;
} | {
  method: "app/list/updated";
  params: V2AppListUpdatedNotification;
} | {
  method: "remoteControl/status/changed";
  params: V2RemoteControlStatusChangedNotification;
} | {
  method: "externalAgentConfig/import/progress";
  params: V2ExternalAgentConfigImportProgressNotification;
} | {
  method: "externalAgentConfig/import/completed";
  params: V2ExternalAgentConfigImportCompletedNotification;
} | {
  method: "fs/changed";
  params: V2FsChangedNotification;
} | {
  method: "item/reasoning/summaryTextDelta";
  params: V2ReasoningSummaryTextDeltaNotification;
} | {
  method: "item/reasoning/summaryPartAdded";
  params: V2ReasoningSummaryPartAddedNotification;
} | {
  method: "item/reasoning/textDelta";
  params: V2ReasoningTextDeltaNotification;
} | {
  method: "thread/compacted";
  params: V2ContextCompactedNotification;
} | {
  method: "model/rerouted";
  params: V2ModelReroutedNotification;
} | {
  method: "model/verification";
  params: V2ModelVerificationNotification;
} | {
  method: "modelProvider/authRecoveryStarted";
  params: V2AuthRecoveryNotification;
} | {
  method: "modelProvider/authRecoveryCompleted";
  params: V2AuthRecoveryNotification;
} | {
  method: "turn/moderationMetadata";
  params: V2TurnModerationMetadataNotification;
} | {
  method: "model/safetyBuffering/updated";
  params: V2ModelSafetyBufferingUpdatedNotification;
} | {
  method: "warning";
  params: V2WarningNotification;
} | {
  method: "guardianWarning";
  params: V2GuardianWarningNotification;
} | {
  method: "deprecationNotice";
  params: V2DeprecationNoticeNotification;
} | {
  method: "configWarning";
  params: V2ConfigWarningNotification;
} | {
  method: "fuzzyFileSearch/sessionUpdated";
  params: FuzzyFileSearchSessionUpdatedNotification;
} | {
  method: "fuzzyFileSearch/sessionCompleted";
  params: FuzzyFileSearchSessionCompletedNotification;
} | {
  method: "thread/realtime/started";
  params: V2ThreadRealtimeStartedNotification;
} | {
  method: "thread/realtime/itemAdded";
  params: V2ThreadRealtimeItemAddedNotification;
} | {
  method: "thread/realtime/item/started";
  params: V2ThreadRealtimeItemStartedNotification;
} | {
  method: "thread/realtime/item/transcript/delta";
  params: V2ThreadRealtimeItemTranscriptDeltaNotification;
} | {
  method: "thread/realtime/item/completed";
  params: V2ThreadRealtimeItemCompletedNotification;
} | {
  method: "thread/realtime/transcript/delta";
  params: V2ThreadRealtimeTranscriptDeltaNotification;
} | {
  method: "thread/realtime/transcript/done";
  params: V2ThreadRealtimeTranscriptDoneNotification;
} | {
  method: "thread/realtime/outputAudio/delta";
  params: V2ThreadRealtimeOutputAudioDeltaNotification;
} | {
  method: "thread/realtime/sdp";
  params: V2ThreadRealtimeSdpNotification;
} | {
  method: "thread/realtime/error";
  params: V2ThreadRealtimeErrorNotification;
} | {
  method: "thread/realtime/closed";
  params: V2ThreadRealtimeClosedNotification;
} | {
  method: "windows/worldWritableWarning";
  params: V2WindowsWorldWritableWarningNotification;
} | {
  method: "windowsSandbox/setupCompleted";
  params: V2WindowsSandboxSetupCompletedNotification;
} | {
  method: "account/login/completed";
  params: V2AccountLoginCompletedNotification;
};

/** Request initiated from the server and sent to the client. */
export type ServerRequest = {
  id: V2RequestId;
  method: "item/commandExecution/requestApproval";
  params: CommandExecutionRequestApprovalParams;
} | {
  id: V2RequestId;
  method: "item/fileChange/requestApproval";
  params: FileChangeRequestApprovalParams;
} | {
  id: V2RequestId;
  method: "item/tool/requestUserInput";
  params: ToolRequestUserInputParams;
} | {
  id: V2RequestId;
  method: "mcpServer/elicitation/request";
  params: McpServerElicitationRequestParams;
} | {
  id: V2RequestId;
  method: "item/permissions/requestApproval";
  params: PermissionsRequestApprovalParams;
} | {
  id: V2RequestId;
  method: "item/tool/call";
  params: DynamicToolCallParams;
} | {
  id: V2RequestId;
  method: "account/chatgptAuthTokens/refresh";
  params: ChatgptAuthTokensRefreshParams;
} | {
  id: V2RequestId;
  method: "attestation/generate";
  params: AttestationGenerateParams;
} | {
  id: V2RequestId;
  method: "applyPatchApproval";
  params: ApplyPatchApprovalParams;
} | {
  id: V2RequestId;
  method: "execCommandApproval";
  params: ExecCommandApprovalParams;
};

/** EXPERIMENTAL. Captures a user's answer to a request_user_input question. */
export type ToolRequestUserInputAnswer = {
  answers: Array<string>;
};

/** EXPERIMENTAL. Defines a single selectable option for request_user_input. */
export type ToolRequestUserInputOption = {
  description: string;
  label: string;
};

/** EXPERIMENTAL. Params sent with a request_user_input event. */
export type ToolRequestUserInputParams = {
  /** @deprecated Use `isBlocking` to decide whether the request should block. */
  autoResolutionMs?: number | null;
  isBlocking: boolean;
  itemId: string;
  questions: Array<ToolRequestUserInputQuestion>;
  threadId: string;
  turnId: string;
};

/** EXPERIMENTAL. Represents one request_user_input question and its required options. */
export type ToolRequestUserInputQuestion = {
  header: string;
  id: string;
  isOther?: boolean;
  isSecret?: boolean;
  options?: Array<ToolRequestUserInputOption> | null;
  question: string;
};

/** EXPERIMENTAL. Response payload mapping question ids to answers. */
export type ToolRequestUserInputResponse = {
  answers: Record<string, ToolRequestUserInputAnswer>;
};

export type W3cTraceContext = {
  traceparent?: string | null;
  tracestate?: string | null;
};

/**
 * A path that is guaranteed to be absolute and normalized (though it is not guaranteed to be canonicalized or exist on the filesystem).
 *
 * IMPORTANT: When deserializing an `AbsolutePathBuf`, a base path must be set using [AbsolutePathBufGuard::new]. If no base path is set, the deserialization will fail unless the path being deserialized is already absolute.
 */
export type V2AbsolutePathBuf = string;

export type V2Account = {
  type: "apiKey";
} | ({
  email: string | null;
  planType: V2PlanType;
  type: "chatgpt";
}) | {
  type: "amazonBedrock";
  usesCodexManagedCredentials?: boolean;
};

export type V2AccountLoginCompletedNotification = {
  error?: string | null;
  loginId?: string | null;
  onboardingEntrypoint?: V2DesktopOnboardingEntrypoint | null;
  success: boolean;
};

/**
 * Sparse rolling rate-limit update.
 *
 * Clients should merge available values into the most recent `account/rateLimits/read` response or refetch that snapshot. Nullable account metadata may be unavailable in a rolling update and does not clear a previously observed value.
 */
export type V2AccountRateLimitsUpdatedNotification = {
  rateLimits: V2RateLimitSnapshot;
};

export type V2AccountTokenUsageDailyBucket = {
  startDate: string;
  tokens: number;
};

export type V2AccountTokenUsageSummary = {
  currentStreakDays?: number | null;
  lifetimeTokens?: number | null;
  longestRunningTurnSec?: number | null;
  longestStreakDays?: number | null;
  peakDailyTokens?: number | null;
};

export type V2AccountUpdatedNotification = {
  authMode?: V2AuthMode | null;
  planType?: V2PlanType | null;
};

export type V2ActivePermissionProfile = {
  /** Parent profile identifier from the selected permissions profile's `extends` setting, when present. */
  extends?: string | null;
  /** Identifier from `default_permissions` or the implicit built-in default, such as `:workspace` or a user-defined `[permissions.<id>]` profile. */
  id: string;
};

export type V2AddCreditsNudgeCreditType = "credits" | "usage_limit";

export type V2AddCreditsNudgeEmailStatus = "sent" | "cooldown_active";

export type V2AdditionalContextEntry = {
  kind: V2AdditionalContextKind;
  value: string;
};

export type V2AdditionalContextKind = "untrusted" | "application";

export type V2AdditionalFileSystemPermissions = {
  entries?: Array<V2FileSystemSandboxEntry> | null;
  globScanMaxDepth?: number | null;
  /** This will be removed in favor of `entries`. */
  read?: Array<V2LegacyAppPathString> | null;
  /** This will be removed in favor of `entries`. */
  write?: Array<V2LegacyAppPathString> | null;
};

export type V2AdditionalNetworkPermissions = {
  enabled?: boolean | null;
};

export type V2AgentMessageDelivery = "async";

export type V2AgentMessageDeltaNotification = {
  delta: string;
  itemId: string;
  threadId: string;
  turnId: string;
};

export type V2AgentMessageInputContent = {
  text: string;
  type: "input_text";
} | {
  encrypted_content: string;
  type: "encrypted_content";
};

export type V2AgentPath = string;

export type V2AllowDenyRequirement = "allow" | "deny";

export type V2AnalyticsConfig = {
  enabled?: boolean | null;
};

/** EXPERIMENTAL - app metadata returned by app-list APIs. */
export type V2AppBranding = {
  category?: string | null;
  developer?: string | null;
  isDiscoverableApp: boolean;
  privacyPolicy?: string | null;
  termsOfService?: string | null;
  website?: string | null;
};

export type V2AppConfig = {
  approvals_reviewer?: V2ApprovalsReviewer | null;
  default_tools_approval_mode?: V2AppToolApproval | null;
  default_tools_enabled?: boolean | null;
  destructive_enabled?: boolean | null;
  enabled?: boolean;
  /** Per-account approval settings keyed by link ID. */
  links?: V2AppLinksConfig | null;
  open_world_enabled?: boolean | null;
  tools?: V2AppToolsConfig | null;
};

/** EXPERIMENTAL - app metadata returned by app-list APIs. */
export type V2AppInfo = {
  appMetadata?: V2AppMetadata | null;
  branding?: V2AppBranding | null;
  description?: string | null;
  distributionChannel?: string | null;
  iconAssets?: Record<string, string> | null;
  iconDarkAssets?: Record<string, string> | null;
  id: string;
  installUrl?: string | null;
  isAccessible?: boolean;
  /** Whether this app is enabled in config.toml. Example: ```toml [apps.bad_app] enabled = false ``` */
  isEnabled?: boolean;
  labels?: Record<string, string> | null;
  logoUrl?: string | null;
  logoUrlDark?: string | null;
  name: string;
  pluginDisplayNames?: Array<string>;
};

/** Approval settings for a connected account within an app. */
export type V2AppLinkConfig = {
  approvals_reviewer?: V2ApprovalsReviewer | null;
  default_tools_approval_mode?: V2AppToolApproval | null;
};

/** Account settings for a single app. */
export type V2AppLinksConfig = Record<string, unknown>;

/** EXPERIMENTAL - notification emitted when the app list changes. */
export type V2AppListUpdatedNotification = {
  data: Array<V2AppInfo>;
};

export type V2AppMetadata = {
  categories?: Array<string> | null;
  developer?: string | null;
  firstPartyRequiresInstall?: boolean | null;
  review?: V2AppReview | null;
  screenshots?: Array<V2AppScreenshot> | null;
  seoDescription?: string | null;
  showInComposerWhenUnlinked?: boolean | null;
  subCategories?: Array<string> | null;
  version?: string | null;
  versionId?: string | null;
  versionNotes?: string | null;
};

export type V2AppReview = {
  status: string;
};

export type V2AppScreenshot = {
  fileId?: string | null;
  url?: string | null;
  userPrompt: string;
};

/** EXPERIMENTAL - app metadata summary for plugin responses. */
export type V2AppSummary = {
  category?: string | null;
  description?: string | null;
  id: string;
  installUrl?: string | null;
  name: string;
};

export type V2AppTemplateSummary = {
  canonicalConnectorId?: string | null;
  category?: string | null;
  description?: string | null;
  logoUrl?: string | null;
  logoUrlDark?: string | null;
  materializedAppIds: Array<string>;
  name: string;
  reason?: V2AppTemplateUnavailableReason | null;
  templateId: string;
};

export type V2AppTemplateUnavailableReason = "NOT_CONFIGURED_FOR_WORKSPACE" | "NO_ACTIVE_WORKSPACE";

export type V2AppToolApproval = "auto" | "prompt" | "writes" | "approve";

export type V2AppToolConfig = {
  approval_mode?: V2AppToolApproval | null;
  enabled?: boolean | null;
};

/** EXPERIMENTAL - metadata returned by app/read. */
export type V2AppToolSummary = {
  description: string;
  disabledReason?: string | null;
  isEnabled?: boolean;
  isReadOnly?: boolean;
  name: string;
  title?: string | null;
};

export type V2AppToolsConfig = Record<string, unknown>;

export type V2ApplicationNetworkRequirements = {
  domains: Record<string, V2NetworkDomainPermission>;
  /** When enabled, only explicitly allowed exact domains may be contacted. */
  enabled: boolean;
};

export type V2ApplicationRequirements = {
  network?: V2ApplicationNetworkRequirements | null;
};

/** Configures who approval requests are routed to for review. Examples include sandbox escapes, blocked network access, MCP approval prompts, and ARC escalations. Defaults to `user`. `auto_review` uses a carefully prompted subagent to gather relevant context and apply a risk-based decision framework before approving or denying the request. The legacy value `guardian_subagent` is accepted for compatibility. */
export type V2ApprovalsReviewer = "user" | "auto_review" | "guardian_subagent";

export type V2AppsConfig = {
  _default?: V2AppsDefaultConfig | null;
};

export type V2AppsDefaultConfig = {
  approvals_reviewer?: V2ApprovalsReviewer | null;
  default_tools_approval_mode?: V2AppToolApproval | null;
  destructive_enabled?: boolean;
  enabled?: boolean;
  open_world_enabled?: boolean;
};

/** Read the committed installed connector runtime snapshot. */
export type V2AppsInstalledParams = {
  /** When true and Apps are permitted, refresh and publish the hosted connector runtime tool snapshot first. */
  forceRefresh?: boolean;
  /** Optional loaded thread id used to evaluate effective app configuration. */
  threadId?: string | null;
};

/** The installed connectors in one committed runtime snapshot. */
export type V2AppsInstalledResponse = {
  apps: Array<V2InstalledApp>;
};

/** EXPERIMENTAL - list available apps/connectors. */
export type V2AppsListParams = {
  /** Opaque pagination cursor returned by a previous call. */
  cursor?: string | null;
  /** When true, bypass app caches and fetch the latest data from sources. */
  forceRefetch?: boolean;
  /** Optional page size; defaults to a reasonable server-side value. */
  limit?: number | null;
  /** Optional thread id used to evaluate app feature gating from that thread's config. */
  threadId?: string | null;
};

/** EXPERIMENTAL - app list response. */
export type V2AppsListResponse = {
  data: Array<V2AppInfo>;
  /** Opaque cursor to pass to the next call to continue after the last item. If None, there are no more items to return. */
  nextCursor?: string | null;
};

/** EXPERIMENTAL - read metadata for specific apps/connectors. */
export type V2AppsReadParams = {
  /** App ids to read. The server accepts at most 100 ids and deduplicates repeated ids while preserving their first-request order. */
  appIds: Array<string>;
  /** When true, include display-only public tool summaries in the returned metadata. */
  includeTools?: boolean;
  /** Optional loaded thread id used to evaluate effective app configuration. */
  threadId?: string | null;
};

/** EXPERIMENTAL - app/read response. */
export type V2AppsReadResponse = {
  apps: Array<V2ConnectorMetadata>;
  missingAppIds: Array<string>;
};

export type V2AskForApproval = ("untrusted" | "on-request" | "never") | {
  granular: {
    mcp_elicitations: boolean;
    request_permissions?: boolean;
    rules: boolean;
    sandbox_approval: boolean;
    skill_approval?: boolean;
  };
};

export type V2AsyncUserInputQuestion = {
  options?: Array<string> | null;
  title: string;
};

/** Authentication mode for OpenAI-backed providers. */
export type V2AuthMode = "apikey" | "chatgpt" | "chatgptAuthTokens" | "headers" | "agentIdentity" | "personalAccessToken" | "bedrockApiKey" | "bedrockAccessKeys";

export type V2AuthRecoveryNotification = {
  message: string;
  provider: string;
  threadId: string;
  turnId: string;
};

/** Selects which part of the active context is charged against `model_auto_compact_token_limit`. */
export type V2AutoCompactTokenLimitScope = "total" | "body_after_prefix";

/** [UNSTABLE] Source that produced a terminal approval auto-review decision. */
export type V2AutoReviewDecisionSource = "agent";

export type V2AutoReviewRequirements = {
  ignoreRules?: Array<string> | null;
  requiredOnModels?: Array<string> | null;
};

export type V2BrowserUseAccessApprovalLifetime = "turn" | "thread";

export type V2BrowserUseConfig = {
  allow_history_access?: boolean | null;
  default_origin_policy?: V2BrowserUseOriginPolicyConfig | null;
  origins?: Record<string, V2BrowserUseOriginPolicyConfig> | null;
};

export type V2BrowserUseOriginPolicy = {
  access?: V2AllowDenyRequirement | null;
  accessApprovalLifetime?: V2BrowserUseAccessApprovalLifetime | null;
  autoReview?: V2AllowDenyRequirement | null;
  downloads?: V2AllowDenyRequirement | null;
  fullCdpAccess?: V2AllowDenyRequirement | null;
  persistentApproval?: boolean | null;
  uploads?: V2AllowDenyRequirement | null;
};

export type V2BrowserUseOriginPolicyConfig = {
  access?: V2AllowDenyRequirement | null;
  downloads?: V2AllowDenyRequirement | null;
  full_cdp_access?: V2AllowDenyRequirement | null;
  uploads?: V2AllowDenyRequirement | null;
};

export type V2BrowserUseRequirements = {
  allowGlobalPersistentApproval?: boolean | null;
  allowHistoryAccess?: boolean | null;
  allowWebmcp?: boolean | null;
  defaultOriginPolicy?: V2BrowserUseOriginPolicy | null;
  disableAutoReview?: boolean | null;
  origins?: Record<string, V2BrowserUseOriginPolicy> | null;
};

export type V2ByteRange = {
  end: number;
  start: number;
};

export type V2CancelLoginAccountParams = {
  loginId: string;
};

export type V2CancelLoginAccountResponse = {
  status: V2CancelLoginAccountStatus;
};

export type V2CancelLoginAccountStatus = "canceled" | "notFound";

/** Location used to resolve a selected capability root. */
export type V2CapabilityRootLocation = {
  environmentId: string;
  /** Absolute path for the root in the selected environment. */
  path: string;
  type: "environment";
};

export type V2CliAuthCredentialsStoreMode = "file" | "keyring" | "auto" | "ephemeral";

/**
 * This translation layer make sure that we expose codex error code in camel case.
 *
 * When an upstream HTTP status is available (for example, from the Responses API or a provider), it is forwarded in `httpStatusCode` on the relevant `codexErrorInfo` variant.
 */
export type V2CodexErrorInfo = ("contextWindowExceeded" | "sessionBudgetExceeded" | "usageLimitExceeded" | "rateLimitExceeded" | "serverOverloaded" | "cyberPolicy" | "misalignmentPolicyViolation" | "internalServerError" | "unauthorized" | "badRequest" | "threadRollbackFailed" | "sandboxError" | "other") | ({
  httpConnectionFailed: {
    httpStatusCode?: number | null;
  };
}) | ({
  responseStreamConnectionFailed: {
    httpStatusCode?: number | null;
  };
}) | ({
  responseStreamDisconnected: {
    httpStatusCode?: number | null;
  };
}) | ({
  responseTooManyFailedAttempts: {
    httpStatusCode?: number | null;
  };
}) | {
  activeTurnNotSteerable: {
    turnKind: V2NonSteerableTurnKind;
  };
};

export type V2CodexResponseHandoffMode = "thinking" | "commentary" | "bemTags";

export type V2CollabAgentState = {
  message?: string | null;
  status: V2CollabAgentStatus;
};

export type V2CollabAgentStatus = "pendingInit" | "running" | "interrupted" | "completed" | "errored" | "shutdown" | "notFound";

export type V2CollabAgentTool = "spawnAgent" | "sendInput" | "resumeAgent" | "wait" | "closeAgent" | "sendMessage" | "followupTask" | "interruptAgent" | "listAgents";

export type V2CollabAgentToolCallStatus = "inProgress" | "completed" | "failed" | "interrupted";

/** Collaboration mode for a Codex session. */
export type V2CollaborationMode = {
  mode: V2ModeKind;
  settings: V2Settings;
};

/** EXPERIMENTAL - collaboration mode preset metadata for clients. */
export type V2CollaborationModeMask = {
  mode?: V2ModeKind | null;
  model?: string | null;
  name: string;
  reasoning_effort?: (V2ReasoningEffort | null) | null;
};

export type V2CommandAction = {
  command: string;
  name: string;
  path: V2LegacyAppPathString;
  type: "read";
} | ({
  command: string;
  path?: string | null;
  type: "listFiles";
}) | ({
  command: string;
  path?: string | null;
  query?: string | null;
  type: "search";
}) | {
  command: string;
  type: "unknown";
};

/**
 * Base64-encoded output chunk emitted for a streaming `command/exec` request.
 *
 * These notifications are connection-scoped. If the originating connection closes, the server terminates the process.
 */
export type V2CommandExecOutputDeltaNotification = {
  /** `true` on the final streamed chunk for a stream when `outputBytesCap` truncated later output on that stream. */
  capReached: boolean;
  /** Base64-encoded output bytes. */
  deltaBase64: string;
  /** Client-supplied, connection-scoped `processId` from the original `command/exec` request. */
  processId: string;
  /** Output stream for this chunk. */
  stream: V2CommandExecOutputStream;
};

/** Stream label for `command/exec/outputDelta` notifications. */
export type V2CommandExecOutputStream = "stdout" | "stderr";

/**
 * Run a standalone command (argv vector) in the server sandbox without creating a thread or turn.
 *
 * The final `command/exec` response is deferred until the process exits and is sent only after all `command/exec/outputDelta` notifications for that connection have been emitted.
 */
export type V2CommandExecParams = {
  /** Command argv vector. Empty arrays are rejected. */
  command: Array<string>;
  /** Optional working directory. Defaults to the server cwd. */
  cwd?: string | null;
  /**
   * Disable stdout/stderr capture truncation for this request.
   *
   * Cannot be combined with `outputBytesCap`.
   */
  disableOutputCap?: boolean;
  /**
   * Disable the timeout entirely for this request.
   *
   * Cannot be combined with `timeoutMs`.
   */
  disableTimeout?: boolean;
  /**
   * Optional environment overrides merged into the server-computed environment.
   *
   * Matching names override inherited values. Set a key to `null` to unset an inherited variable.
   */
  env?: Record<string, string | null> | null;
  /**
   * Optional per-stream stdout/stderr capture cap in bytes.
   *
   * When omitted, the server default applies. Cannot be combined with `disableOutputCap`.
   */
  outputBytesCap?: number | null;
  /**
   * Optional client-supplied, connection-scoped process id.
   *
   * Required for `tty`, `streamStdin`, `streamStdoutStderr`, and follow-up `command/exec/write`, `command/exec/resize`, and `command/exec/terminate` calls. When omitted, buffered execution gets an internal id that is not exposed to the client.
   */
  processId?: string | null;
  /**
   * Optional sandbox policy for this command.
   *
   * Uses the same shape as thread/turn execution sandbox configuration and defaults to the user's configured policy when omitted. Cannot be combined with `permissionProfile`.
   */
  sandboxPolicy?: V2SandboxPolicy | null;
  /** Optional initial PTY size in character cells. Only valid when `tty` is true. */
  size?: V2CommandExecTerminalSize | null;
  /**
   * Allow follow-up `command/exec/write` requests to write stdin bytes.
   *
   * Requires a client-supplied `processId`.
   */
  streamStdin?: boolean;
  /**
   * Stream stdout/stderr via `command/exec/outputDelta` notifications.
   *
   * Streamed bytes are not duplicated into the final response and require a client-supplied `processId`.
   */
  streamStdoutStderr?: boolean;
  /**
   * Optional timeout in milliseconds.
   *
   * When omitted, the server default applies. Cannot be combined with `disableTimeout`.
   */
  timeoutMs?: number | null;
  /**
   * Enable PTY mode.
   *
   * This implies `streamStdin` and `streamStdoutStderr`.
   */
  tty?: boolean;
};

/** Resize a running PTY-backed `command/exec` session. */
export type V2CommandExecResizeParams = {
  /** Client-supplied, connection-scoped `processId` from the original `command/exec` request. */
  processId: string;
  /** New PTY size in character cells. */
  size: V2CommandExecTerminalSize;
};

/** Empty success response for `command/exec/resize`. */
export type V2CommandExecResizeResponse = Record<string, unknown>;

/** Final buffered result for `command/exec`. */
export type V2CommandExecResponse = {
  /** Process exit code. */
  exitCode: number;
  /**
   * Buffered stderr capture.
   *
   * Empty when stderr was streamed via `command/exec/outputDelta`.
   */
  stderr: string;
  /**
   * Buffered stdout capture.
   *
   * Empty when stdout was streamed via `command/exec/outputDelta`.
   */
  stdout: string;
};

/** PTY size in character cells for `command/exec` PTY sessions. */
export type V2CommandExecTerminalSize = {
  /** Terminal width in character cells. */
  cols: number;
  /** Terminal height in character cells. */
  rows: number;
};

/** Terminate a running `command/exec` session. */
export type V2CommandExecTerminateParams = {
  /** Client-supplied, connection-scoped `processId` from the original `command/exec` request. */
  processId: string;
};

/** Empty success response for `command/exec/terminate`. */
export type V2CommandExecTerminateResponse = Record<string, unknown>;

/** Write stdin bytes to a running `command/exec` session, close stdin, or both. */
export type V2CommandExecWriteParams = {
  /** Close stdin after writing `deltaBase64`, if present. */
  closeStdin?: boolean;
  /** Optional base64-encoded stdin bytes to write. */
  deltaBase64?: string | null;
  /** Client-supplied, connection-scoped `processId` from the original `command/exec` request. */
  processId: string;
};

/** Empty success response for `command/exec/write`. */
export type V2CommandExecWriteResponse = Record<string, unknown>;

export type V2CommandExecutionOutputDeltaNotification = {
  delta: string;
  itemId: string;
  threadId: string;
  turnId: string;
};

export type V2CommandExecutionSource = "agent" | "userShell" | "unifiedExecStartup" | "unifiedExecInteraction";

export type V2CommandExecutionStatus = "inProgress" | "completed" | "failed" | "declined";

export type V2CommandMigration = {
  name: string;
};

export type V2ComputerUseConfig = {
  default_app_access?: V2AllowDenyRequirement | null;
  macos?: V2ComputerUseMacosConfig | null;
  windows?: V2ComputerUseWindowsConfig | null;
};

export type V2ComputerUseMacosConfig = {
  bundle_ids?: Record<string, V2AllowDenyRequirement> | null;
};

export type V2ComputerUseMacosRequirements = {
  bundleIds?: Record<string, V2AllowDenyRequirement> | null;
};

export type V2ComputerUseRequirements = {
  allowLockedComputerUse?: boolean | null;
  allowPersistentApproval?: boolean | null;
  defaultAppAccess?: V2AllowDenyRequirement | null;
  macos?: V2ComputerUseMacosRequirements | null;
  windows?: V2ComputerUseWindowsRequirements | null;
};

export type V2ComputerUseWindowsConfig = {
  aumids?: Record<string, V2AllowDenyRequirement> | null;
  exes?: Array<V2ComputerUseWindowsExeConfig> | null;
};

export type V2ComputerUseWindowsExeConfig = {
  access: V2AllowDenyRequirement;
  binary_name?: string | null;
  product_name: string;
  publisher_name: string;
};

export type V2ComputerUseWindowsExeRequirement = {
  access: V2AllowDenyRequirement;
  binaryName?: string | null;
  productName: string;
  publisherName: string;
};

export type V2ComputerUseWindowsRequirements = {
  aumids?: Record<string, V2AllowDenyRequirement> | null;
  exes?: Array<V2ComputerUseWindowsExeRequirement> | null;
};

export type V2Config = {
  analytics?: V2AnalyticsConfig | null;
  approval_policy?: V2AskForApproval | null;
  /** [UNSTABLE] Optional default for where approval requests are routed for review. */
  approvals_reviewer?: V2ApprovalsReviewer | null;
  browser_use?: V2BrowserUseConfig | null;
  compact_prompt?: string | null;
  computer_use?: V2ComputerUseConfig | null;
  desktop?: Record<string, unknown> | null;
  developer_instructions?: string | null;
  forced_chatgpt_workspace_id?: V2ForcedChatgptWorkspaceIds | null;
  forced_login_method?: V2ForcedLoginMethod | null;
  instructions?: string | null;
  model?: string | null;
  model_auto_compact_token_limit?: number | null;
  model_auto_compact_token_limit_scope?: V2AutoCompactTokenLimitScope | null;
  model_context_window?: number | null;
  model_provider?: string | null;
  model_reasoning_effort?: V2ReasoningEffort | null;
  model_reasoning_summary?: V2ReasoningSummary | null;
  model_verbosity?: V2Verbosity | null;
  review_model?: string | null;
  sandbox_mode?: V2SandboxMode | null;
  sandbox_workspace_write?: V2SandboxWorkspaceWrite | null;
  service_tier?: string | null;
  tools?: V2ToolsV2 | null;
  web_search?: V2WebSearchMode | null;
};

export type V2ConfigBatchWriteParams = {
  edits: Array<V2ConfigEdit>;
  expectedVersion?: string | null;
  /** Path to the config file to write; defaults to the user's `config.toml` when omitted. */
  filePath?: string | null;
  /** When true, hot-reload updated runtime settings into loaded threads after writing. Session-static model, reasoning-effort, Plan-mode reasoning-effort, service-tier, and personality defaults are not reloaded. */
  reloadUserConfig?: boolean;
};

export type V2ConfigEdit = {
  keyPath: string;
  mergeStrategy: V2MergeStrategy;
  value: unknown;
};

export type V2ConfigLayer = {
  config: unknown;
  disabledReason?: string | null;
  name: V2ConfigLayerSource;
  version: string;
};

export type V2ConfigLayerMetadata = {
  name: V2ConfigLayerSource;
  version: string;
};

export type V2ConfigLayerSource = {
  /** Path to the packaged default configuration file. */
  file: V2AbsolutePathBuf;
  type: "packagedDefaults";
} | {
  domain: string;
  key: string;
  type: "mdm";
} | {
  /** This is the path to the system config.toml file, though it is not guaranteed to exist. */
  file: V2AbsolutePathBuf;
  type: "system";
} | {
  /** Stable identifier for the delivered layer. */
  id: string;
  /** Admin-facing name for the delivered layer. This is surfaced in diagnostics so users know which cloud layer needs administrator attention. */
  name: string;
  type: "enterpriseManaged";
} | ({
  /** This is the path to the user's config.toml file, though it is not guaranteed to exist. */
  file: V2AbsolutePathBuf;
  /** Name of the selected profile-v2 config layered on top of the base user config, when this layer represents one. */
  profile?: string | null;
  type: "user";
}) | {
  dotCodexFolder: V2AbsolutePathBuf;
  type: "project";
} | {
  type: "sessionFlags";
} | {
  file: V2AbsolutePathBuf;
  type: "legacyManagedConfigTomlFromFile";
} | {
  type: "legacyManagedConfigTomlFromMdm";
};

export type V2ConfigReadParams = {
  /** Optional working directory to resolve project config layers. If specified, return the effective config as seen from that directory (i.e., including any project layers between `cwd` and the project/repo root). */
  cwd?: string | null;
  includeLayers?: boolean;
};

export type V2ConfigReadResponse = {
  config: V2Config;
  layers?: Array<V2ConfigLayer> | null;
  origins: Record<string, V2ConfigLayerMetadata>;
};

export type V2ConfigRequirements = {
  additionalDeveloperInstructions?: string | null;
  allowAppshots?: boolean | null;
  allowBrowserAndComputerUse?: boolean | null;
  allowLoginShell?: boolean | null;
  allowManagedHooksOnly?: boolean | null;
  allowRemoteControl?: boolean | null;
  allowedApprovalPolicies?: Array<V2AskForApproval> | null;
  allowedPermissionProfiles?: Record<string, boolean> | null;
  allowedSandboxModes?: Array<V2SandboxMode> | null;
  allowedWebSearchModes?: Array<V2WebSearchMode> | null;
  allowedWindowsSandboxImplementations?: Array<V2WindowsSandboxSetupMode> | null;
  autoReview?: V2AutoReviewRequirements | null;
  browserUse?: V2BrowserUseRequirements | null;
  chatgptBaseUrl?: string | null;
  checkForUpdateOnStartup?: boolean | null;
  cliAuthCredentialsStore?: V2CliAuthCredentialsStoreMode | null;
  computerUse?: V2ComputerUseRequirements | null;
  defaultPermissions?: string | null;
  enforceResidency?: V2ResidencyRequirement | null;
  featureRequirements?: Record<string, boolean> | null;
  feedback?: V2FeedbackRequirements | null;
  inAppBrowser?: V2InAppBrowserRequirements | null;
  logDir?: string | null;
  modelCatalogJson?: string | null;
  models?: V2ModelsRequirements | null;
  sqliteHome?: string | null;
  windowsSandboxPrivateDesktop?: boolean | null;
};

export type V2ConfigRequirementsReadResponse = {
  /** Null if no requirements are configured (e.g. no requirements.toml/MDM entries). */
  requirements?: V2ConfigRequirements | null;
};

export type V2ConfigValueWriteParams = {
  expectedVersion?: string | null;
  /** Path to the config file to write; defaults to the user's `config.toml` when omitted. */
  filePath?: string | null;
  keyPath: string;
  mergeStrategy: V2MergeStrategy;
  value: unknown;
};

export type V2ConfigWarningNotification = {
  /** Optional extra guidance or error details. */
  details?: string | null;
  /** Optional path to the config file that triggered the warning. */
  path?: string | null;
  /** Optional range for the error location inside the config file. */
  range?: V2TextRange | null;
  /** Concise summary of the warning. */
  summary: string;
};

export type V2ConfigWriteResponse = {
  /** Canonical path to the config file that was written. */
  filePath: V2AbsolutePathBuf;
  overriddenMetadata?: V2OverriddenMetadata | null;
  status: V2WriteStatus;
  version: string;
};

/** Reasoning settings interpreted by the backend for the routed model. */
export type V2ConfigurationReasoning = {
  effort: V2ReasoningEffort;
};

export type V2ConfiguredHookHandler = ({
  /** Approximate token threshold for spilling this hook's `additionalContext` to disk. `null` uses 2,500 tokens; `0` disables spilling for this hook. The threshold is evaluated against the original context; a spilled preview also includes recovery metadata. */
  additionalContextLimit?: number | null;
  async: boolean;
  command: string;
  commandWindows?: string | null;
  statusMessage?: string | null;
  timeoutSec?: number | null;
  type: "command";
}) | ({
  input: Record<string, unknown>;
  server: string;
  statusMessage?: string | null;
  timeoutSec?: number | null;
  tool: string;
  type: "mcp_tool";
}) | {
  type: "prompt";
} | {
  type: "agent";
};

export type V2ConfiguredHookMatcherGroup = {
  hooks: Array<V2ConfiguredHookHandler>;
  matcher?: string | null;
};

/** EXPERIMENTAL - metadata returned by app/read. */
export type V2ConnectorMetadata = {
  description?: string | null;
  distributionChannel?: string | null;
  iconUrl?: string | null;
  iconUrlDark?: string | null;
  id: string;
  installUrl?: string | null;
  name: string;
  pluginDisplayNames?: Array<string>;
  toolSummaries?: Array<V2AppToolSummary> | null;
};

export type V2ConsumeAccountRateLimitResetCreditOutcome = "reset" | "nothingToReset" | "noCredit" | "alreadyRedeemed";

export type V2ConsumeAccountRateLimitResetCreditParams = {
  /** Opaque reset-credit identifier to redeem. When omitted, the backend selects the next available credit. */
  creditId?: string | null;
  /** Identifies one logical reset attempt. A UUID is recommended; reuse the same value when retrying that attempt. */
  idempotencyKey: string;
};

export type V2ConsumeAccountRateLimitResetCreditResponse = {
  outcome: V2ConsumeAccountRateLimitResetCreditOutcome;
};

export type V2ContentItem = {
  text: string;
  type: "input_text";
} | ({
  detail?: V2ImageDetail | null;
  image_url: string;
  type: "input_image";
}) | {
  audio_url: string;
  type: "input_audio";
} | {
  text: string;
  type: "output_text";
};

/** Deprecated: Use `ContextCompaction` item type instead. */
export type V2ContextCompactedNotification = {
  threadId: string;
  turnId: string;
};

export type V2ConversationTextRole = "user" | "developer" | "assistant";

export type V2CreditsSnapshot = {
  balance?: string | null;
  hasCredits: boolean;
  unlimited: boolean;
};

/** Requested cyber treatment for a ChatGPT-authenticated Codex turn. Authorization and model-tier restrictions remain server-owned. */
export type V2CyberAccessProgram = "standard" | "daybreakBlue" | "daybreakRed";

export type V2DeprecationNoticeNotification = {
  /** Optional extra guidance, such as migration steps or rationale. */
  details?: string | null;
  /** Concise summary of what is deprecated. */
  summary: string;
};

export type V2DesktopOnboardingEntrypoint = "life_sciences";

export type V2DynamicToolCallOutputContentItem = {
  text: string;
  type: "inputText";
} | {
  imageUrl: string;
  type: "inputImage";
} | {
  audioUrl: string;
  type: "inputAudio";
};

export type V2DynamicToolCallStatus = "inProgress" | "completed" | "failed";

export type V2DynamicToolNamespaceTool = {
  deferLoading?: boolean;
  description: string;
  inputSchema: unknown;
  name: string;
  type: "function";
};

export type V2DynamicToolSpec = {
  deferLoading?: boolean;
  description: string;
  inputSchema: unknown;
  name: string;
  type: "function";
} | {
  description: string;
  name: string;
  tools: Array<V2DynamicToolNamespaceTool>;
  type: "namespace";
};

export type V2EnvironmentConnectionNotification = {
  environmentId: string;
  threadId: string;
};

export type V2ErrorNotification = {
  error: V2TurnError;
  threadId: string;
  turnId: string;
  willRetry: boolean;
};

export type V2ExperimentalFeature = {
  /** Announcement copy shown to users when the feature is introduced. Null when this feature is not in beta. */
  announcement?: string | null;
  /** Whether this feature is enabled by default. */
  defaultEnabled: boolean;
  /** Short summary describing what the feature does. Null when this feature is not in beta. */
  description?: string | null;
  /** User-facing display name shown in the experimental features UI. Null when this feature is not in beta. */
  displayName?: string | null;
  /** Whether this feature is currently enabled in the loaded config. */
  enabled: boolean;
  /** Stable key used in config.toml and CLI flag toggles. */
  name: string;
  /** Lifecycle stage of this feature flag. */
  stage: V2ExperimentalFeatureStage;
};

export type V2ExperimentalFeatureEnablementSetParams = {
  /**
   * Process-wide runtime feature enablement keyed by canonical feature name.
   *
   * Only named features are updated. Omitted features are left unchanged. Send an empty map for a no-op.
   */
  enablement: Record<string, boolean>;
};

export type V2ExperimentalFeatureEnablementSetResponse = {
  /** Feature enablement entries updated by this request. */
  enablement: Record<string, boolean>;
};

export type V2ExperimentalFeatureListParams = {
  /** Opaque pagination cursor returned by a previous call. */
  cursor?: string | null;
  /** Optional page size; defaults to a reasonable server-side value. */
  limit?: number | null;
  /** Optional loaded thread id. Pass this when showing feature state for an existing thread so enablement is computed from that thread's refreshed config, including project-local config for the thread's cwd. */
  threadId?: string | null;
};

export type V2ExperimentalFeatureListResponse = {
  data: Array<V2ExperimentalFeature>;
  /** Opaque cursor to pass to the next call to continue after the last item. If None, there are no more items to return. */
  nextCursor?: string | null;
};

export type V2ExperimentalFeatureStage = "beta" | "underDevelopment" | "stable" | "deprecated" | "removed";

export type V2ExternalAgentConfigDetectParams = {
  /** Zero or more working directories to include for repo-scoped detection. */
  cwds?: Array<string> | null;
  /** If true, include detection under the user's home directory. */
  includeHome?: boolean;
  /** Maximum age in days for detected sessions. Missing values use the default limit. */
  maxSessionAgeDays?: number | null;
  /** Maximum number of sessions to detect. Missing values use the default limit. */
  maxSessions?: number | null;
  /** Optional migration-source selector. Missing or unrecognized values use the default source. */
  migrationSource?: string | null;
  /** Deprecated field retained for compatibility. This field is ignored; use `migrationSource` to select the migration source. */
  source?: string | null;
};

export type V2ExternalAgentConfigDetectResponse = {
  connectors?: Array<V2ExternalAgentDetectedConnectorCandidate>;
  items: Array<V2ExternalAgentConfigMigrationItem>;
};

export type V2ExternalAgentConfigImportCompletedNotification = {
  importId: string;
  itemTypeResults: Array<V2ExternalAgentConfigImportTypeResult>;
};

export type V2ExternalAgentConfigImportHistoriesReadResponse = {
  connectors: Array<V2ExternalAgentImportedConnectorCandidate>;
  data: Array<V2ExternalAgentConfigImportHistory>;
};

export type V2ExternalAgentConfigImportHistory = {
  completedAtMs: number;
  failures: Array<V2ExternalAgentConfigImportItemTypeFailure>;
  importId: string;
  providerId?: string | null;
  successes: Array<V2ExternalAgentConfigImportItemTypeSuccess>;
};

export type V2ExternalAgentConfigImportHistoryRecordParams = {
  /** Completed results grouped by imported item type. */
  itemTypeResults: Array<V2ExternalAgentConfigImportHistoryRecordTypeResultParams>;
  /** Opaque provider identifier for the externally completed import. */
  providerId: string;
};

export type V2ExternalAgentConfigImportHistoryRecordResponse = {
  importId: string;
};

export type V2ExternalAgentConfigImportHistoryRecordSuccessParams = {
  cwd?: string | null;
  itemType: V2ExternalAgentConfigMigrationItemType;
  source?: string | null;
  target?: string | null;
  /** Original title for an imported session, when available. */
  title?: string | null;
};

export type V2ExternalAgentConfigImportHistoryRecordTypeResultParams = {
  failures: Array<V2ExternalAgentConfigImportItemTypeFailure>;
  itemType: V2ExternalAgentConfigMigrationItemType;
  successes: Array<V2ExternalAgentConfigImportHistoryRecordSuccessParams>;
};

export type V2ExternalAgentConfigImportItemTypeFailure = {
  cwd?: string | null;
  errorType?: string | null;
  failureStage: string;
  itemType: V2ExternalAgentConfigMigrationItemType;
  message: string;
  source?: string | null;
  subErrorType?: string | null;
};

export type V2ExternalAgentConfigImportItemTypeSuccess = {
  cwd?: string | null;
  itemType: V2ExternalAgentConfigMigrationItemType;
  source?: string | null;
  target?: string | null;
  /** Original title for an imported session; null for other item types. */
  title?: string | null;
};

export type V2ExternalAgentConfigImportParams = {
  migrationItems: Array<V2ExternalAgentConfigMigrationItem>;
  /** Migration-source selector used to produce the migration items. Pass the same value to detection and import; missing or unrecognized values use the default source. */
  migrationSource?: string | null;
  /** Opaque provider identifier supplied by the caller for analytics attribution and import history display. This does not select the migration source. */
  providerId?: string | null;
  /** Optional identifier for the product that initiated the import. */
  source?: string | null;
};

export type V2ExternalAgentConfigImportProgressNotification = {
  importId: string;
  itemTypeResults: Array<V2ExternalAgentConfigImportTypeResult>;
};

export type V2ExternalAgentConfigImportResponse = {
  importId: string;
};

export type V2ExternalAgentConfigImportTypeResult = {
  failures: Array<V2ExternalAgentConfigImportItemTypeFailure>;
  itemType: V2ExternalAgentConfigMigrationItemType;
  successes: Array<V2ExternalAgentConfigImportItemTypeSuccess>;
};

export type V2ExternalAgentConfigMigrationItem = {
  /** Null or empty means home-scoped migration; non-empty means repo-scoped migration. */
  cwd?: string | null;
  description: string;
  details?: V2MigrationDetails | null;
  itemType: V2ExternalAgentConfigMigrationItemType;
};

export type V2ExternalAgentConfigMigrationItemType = "AGENTS_MD" | "CONFIG" | "SKILLS" | "PLUGINS" | "MCP_SERVER_CONFIG" | "SUBAGENTS" | "HOOKS" | "COMMANDS" | "MEMORY" | "SESSIONS";

export type V2ExternalAgentDetectedConnectorCandidate = {
  name: string;
  sessionCount: number;
  source: V2ExternalAgentDetectedConnectorSource;
};

export type V2ExternalAgentDetectedConnectorSource = "remoteMcpServersConfig" | "sessionToolUse";

export type V2ExternalAgentImportedConnectorCandidate = {
  name: string;
  sessionCount: number;
  source: V2ExternalAgentImportedConnectorSource;
};

export type V2ExternalAgentImportedConnectorSource = "remoteMcpServersConfig";

export type V2FeedbackRequirements = {
  enabled?: boolean | null;
};

export type V2FeedbackUploadParams = {
  classification: string;
  extraLogFiles?: Array<string> | null;
  includeLogs?: boolean;
  reason?: string | null;
  tags?: Record<string, string> | null;
  threadId?: string | null;
};

export type V2FeedbackUploadResponse = {
  threadId: string;
};

/**
 * Deprecated legacy notification for `apply_patch` textual output.
 *
 * The server no longer emits this notification.
 */
export type V2FileChangeOutputDeltaNotification = {
  delta: string;
  itemId: string;
  threadId: string;
  turnId: string;
};

export type V2FileChangePatchUpdatedNotification = {
  changes: Array<V2FileUpdateChange>;
  itemId: string;
  threadId: string;
  turnId: string;
};

export type V2FileSystemAccessMode = "read" | "write" | "deny";

export type V2FileSystemPath = {
  path: V2LegacyAppPathString;
  type: "path";
} | {
  pattern: string;
  type: "glob_pattern";
} | {
  type: "special";
  value: V2FileSystemSpecialPath;
};

export type V2FileSystemSandboxEntry = {
  access: V2FileSystemAccessMode;
  path: V2FileSystemPath;
};

export type V2FileSystemSpecialPath = {
  kind: "root";
} | {
  kind: "minimal";
} | ({
  kind: "project_roots";
  subpath?: V2LegacyAppPathString | null;
}) | {
  kind: "tmpdir";
} | {
  kind: "slash_tmp";
} | ({
  kind: "unknown";
  path: string;
  subpath?: V2LegacyAppPathString | null;
});

export type V2FileUpdateChange = {
  diff: string;
  kind: V2PatchChangeKind;
  path: string;
};

/** Backward-compatible API shape for ChatGPT workspace login restrictions. */
export type V2ForcedChatgptWorkspaceIds = string | Array<string>;

export type V2ForcedLoginMethod = "chatgpt" | "api";

/** Filesystem watch notification emitted for `fs/watch` subscribers. */
export type V2FsChangedNotification = {
  /** File or directory paths associated with this event. */
  changedPaths: Array<V2AbsolutePathBuf>;
  /** Watch identifier previously provided to `fs/watch`. */
  watchId: string;
};

/** Copy a file or directory tree on the host filesystem. */
export type V2FsCopyParams = {
  /** Absolute destination path. */
  destinationPath: V2AbsolutePathBuf;
  /** Required for directory copies; ignored for file copies. */
  recursive?: boolean;
  /** Absolute source path. */
  sourcePath: V2AbsolutePathBuf;
};

/** Successful response for `fs/copy`. */
export type V2FsCopyResponse = Record<string, unknown>;

/** Create a directory on the host filesystem. */
export type V2FsCreateDirectoryParams = {
  /** Absolute directory path to create. */
  path: V2AbsolutePathBuf;
  /** Whether parent directories should also be created. Defaults to `true`. */
  recursive?: boolean | null;
};

/** Successful response for `fs/createDirectory`. */
export type V2FsCreateDirectoryResponse = Record<string, unknown>;

/** Request metadata for an absolute path. */
export type V2FsGetMetadataParams = {
  /** Absolute path to inspect. */
  path: V2AbsolutePathBuf;
};

/** Metadata returned by `fs/getMetadata`. */
export type V2FsGetMetadataResponse = {
  /** File creation time in Unix milliseconds when available, otherwise `0`. */
  createdAtMs: number;
  /** Whether the path resolves to a directory. */
  isDirectory: boolean;
  /** Whether the path resolves to a regular file. */
  isFile: boolean;
  /** Whether the path itself is a symbolic link. */
  isSymlink: boolean;
  /** File modification time in Unix milliseconds when available, otherwise `0`. */
  modifiedAtMs: number;
};

/** A directory entry returned by `fs/readDirectory`. */
export type V2FsReadDirectoryEntry = {
  /** Direct child entry name only, not an absolute or relative path. */
  fileName: string;
  /** Whether this entry resolves to a directory. */
  isDirectory: boolean;
  /** Whether this entry resolves to a regular file. */
  isFile: boolean;
};

/** List direct child names for a directory. */
export type V2FsReadDirectoryParams = {
  /** Absolute directory path to read. */
  path: V2AbsolutePathBuf;
};

/** Directory entries returned by `fs/readDirectory`. */
export type V2FsReadDirectoryResponse = {
  /** Direct child entries in the requested directory. */
  entries: Array<V2FsReadDirectoryEntry>;
};

/** Read a file from the host filesystem. */
export type V2FsReadFileParams = {
  /** Absolute path to read. */
  path: V2AbsolutePathBuf;
};

/** Base64-encoded file contents returned by `fs/readFile`. */
export type V2FsReadFileResponse = {
  /** File contents encoded as base64. */
  dataBase64: string;
};

/** Remove a file or directory tree from the host filesystem. */
export type V2FsRemoveParams = {
  /** Whether missing paths should be ignored. Defaults to `true`. */
  force?: boolean | null;
  /** Absolute path to remove. */
  path: V2AbsolutePathBuf;
  /** Whether directory removal should recurse. Defaults to `true`. */
  recursive?: boolean | null;
};

/** Successful response for `fs/remove`. */
export type V2FsRemoveResponse = Record<string, unknown>;

/** Stop filesystem watch notifications for a prior `fs/watch`. */
export type V2FsUnwatchParams = {
  /** Watch identifier previously provided to `fs/watch`. */
  watchId: string;
};

/** Successful response for `fs/unwatch`. */
export type V2FsUnwatchResponse = Record<string, unknown>;

/** Start filesystem watch notifications for an absolute path. */
export type V2FsWatchParams = {
  /** Absolute file or directory path to watch. */
  path: V2AbsolutePathBuf;
  /** Connection-scoped watch identifier used for `fs/unwatch` and `fs/changed`. */
  watchId: string;
};

/** Successful response for `fs/watch`. */
export type V2FsWatchResponse = {
  /** Canonicalized path associated with the watch. */
  path: V2AbsolutePathBuf;
};

/** Write a file on the host filesystem. */
export type V2FsWriteFileParams = {
  /** File contents encoded as base64. */
  dataBase64: string;
  /** Absolute path to write. */
  path: V2AbsolutePathBuf;
};

/** Successful response for `fs/writeFile`. */
export type V2FsWriteFileResponse = Record<string, unknown>;

export type V2FunctionCallOutputBody = string | Array<V2FunctionCallOutputContentItem>;

/** Responses API compatible content items that can be returned by a tool call. This is a subset of ContentItem with the types we support as function call outputs. */
export type V2FunctionCallOutputContentItem = {
  text: string;
  type: "input_text";
} | ({
  detail?: V2ImageDetail | null;
  image_url: string;
  type: "input_image";
}) | {
  audio_url: string;
  type: "input_audio";
} | {
  encrypted_content: string;
  type: "encrypted_content";
};

export type V2GetAccountParams = {
  /**
   * When `true`, requests a proactive token refresh before returning.
   *
   * In managed auth mode this triggers the normal refresh-token flow. In external auth mode this flag is ignored. Clients should refresh tokens themselves and call `account/login/start` with `chatgptAuthTokens`.
   */
  refreshToken?: boolean;
};

/** Usage-read capabilities of the requesting client, never inferred from its experiment arm. */
export type V2GetAccountRateLimitsParams = {
  /** Skip the separate reset-credit detail lookup for background usage polls. The usage response still includes the available count; omitted/false preserves detailed reads. */
  excludeResetCreditDetails?: boolean;
  /** The client supports automatic Luna Reserve fallback. For eligible ChatGPT CLI users, allow the backend to record experiment exposure after ordinary usage is blocked. */
  supportsLunaReserve?: boolean;
};

export type V2GetAccountRateLimitsResponse = {
  /** Account associated with this usage snapshot, when supplied by the backend. */
  accountId?: string | null;
  /** Backend permission for ordinary included usage, validated against the active account. Null means unavailable; clients must not infer recovery from percentages or reset times. */
  ordinaryUsageAllowed?: boolean | null;
  rateLimitResetCredits?: V2RateLimitResetCreditsSummary | null;
  /** Optional backend-owned banner from the same usage read. Its nested keys retain the backend's snake_case contract; an absent banner leaves the client's existing UI unchanged. */
  rateLimitUpsell?: unknown;
  /** Backward-compatible single-bucket view; mirrors the historical payload. */
  rateLimits: V2RateLimitSnapshot;
  /** Multi-bucket view keyed by metered `limit_id` (for example, `codex`). */
  rateLimitsByLimitId?: Record<string, V2RateLimitSnapshot> | null;
};

export type V2GetAccountResponse = {
  account?: V2Account | null;
  requiresOpenaiAuth: boolean;
};

export type V2GetAccountTokenUsageParams = {
  /** When present, read estimated usage for this thread instead of account-wide token activity. */
  threadId?: string | null;
};

export type V2GetAccountTokenUsageResponse = {
  dailyUsageBuckets?: Array<V2AccountTokenUsageDailyBucket> | null;
  summary: V2AccountTokenUsageSummary;
  /** Estimated usage when a thread was requested and its billing route is available. */
  threadUsage?: V2ThreadUsage | null;
};

export type V2GetWorkspaceMessagesResponse = {
  /** Whether the workspace-message backend route is available for this client. */
  featureEnabled: boolean;
  /** Active workspace messages returned by the backend. */
  messages: Array<V2WorkspaceMessage>;
};

export type V2GitInfo = {
  branch?: string | null;
  originUrl?: string | null;
  sha?: string | null;
};

/** [UNSTABLE] Temporary approval auto-review payload used by `item/autoApprovalReview/*` notifications. This shape is expected to change soon. */
export type V2GuardianApprovalReview = {
  rationale?: string | null;
  riskLevel?: V2GuardianRiskLevel | null;
  status: V2GuardianApprovalReviewStatus;
  userAuthorization?: V2GuardianUserAuthorization | null;
};

export type V2GuardianApprovalReviewAction = {
  command: string;
  cwd: V2LegacyAppPathString;
  source: V2GuardianCommandSource;
  type: "command";
} | {
  argv: Array<string>;
  cwd: V2AbsolutePathBuf;
  program: string;
  source: V2GuardianCommandSource;
  type: "execve";
} | {
  approvalId: string;
  cwd: V2LegacyAppPathString;
  processId: string;
  stdin: string;
  type: "writeStdin";
} | {
  cwd: V2LegacyAppPathString;
  files: Array<V2LegacyAppPathString>;
  type: "applyPatch";
} | {
  host: string;
  port: number;
  protocol: V2NetworkApprovalProtocol;
  target: string;
  type: "networkAccess";
} | ({
  connectorId?: string | null;
  connectorName?: string | null;
  server: string;
  toolName: string;
  toolTitle?: string | null;
  type: "mcpToolCall";
}) | ({
  permissions: V2RequestPermissionProfile;
  reason?: string | null;
  type: "requestPermissions";
});

/** [UNSTABLE] Lifecycle state for an approval auto-review. */
export type V2GuardianApprovalReviewStatus = "inProgress" | "approved" | "denied" | "timedOut" | "aborted";

export type V2GuardianCommandSource = "shell" | "unifiedExec";

/** [UNSTABLE] Risk level assigned by approval auto-review. */
export type V2GuardianRiskLevel = "low" | "medium" | "high" | "critical";

/** [UNSTABLE] Authorization level assigned by approval auto-review. */
export type V2GuardianUserAuthorization = "unknown" | "low" | "medium" | "high";

export type V2GuardianWarningNotification = {
  /** Concise guardian warning message for the user. */
  message: string;
  /** Thread target for the guardian warning. */
  threadId: string;
};

export type V2HookCompletedNotification = {
  run: V2HookRunSummary;
  threadId: string;
  turnId?: string | null;
};

export type V2HookErrorInfo = {
  message: string;
  path: string;
};

export type V2HookEventName = "preToolUse" | "permissionRequest" | "postToolUse" | "preCompact" | "postCompact" | "sessionStart" | "sessionEnd" | "userPromptSubmit" | "subagentStart" | "subagentStop" | "stop" | "interrupt";

export type V2HookExecutionMode = "sync" | "async";

export type V2HookHandlerType = "command" | "mcpTool" | "prompt" | "agent";

export type V2HookMetadata = {
  async?: boolean;
  command: string;
  handlerType: "command";
} | {
  handlerType: "mcpTool";
  server: string;
  tool: string;
} | {
  handlerType: "prompt";
} | {
  handlerType: "agent";
};

export type V2HookMigration = {
  name: string;
};

export type V2HookOutputEntry = {
  kind: V2HookOutputEntryKind;
  text: string;
};

export type V2HookOutputEntryKind = "warning" | "stop" | "feedback" | "context" | "error";

export type V2HookPromptFragment = {
  hookRunId: string;
  text: string;
};

export type V2HookRunStatus = "running" | "completed" | "failed" | "blocked" | "stopped";

export type V2HookRunSummary = {
  completedAt?: number | null;
  displayOrder: number;
  durationMs?: number | null;
  entries: Array<V2HookOutputEntry>;
  eventName: V2HookEventName;
  executionMode: V2HookExecutionMode;
  handlerType: V2HookHandlerType;
  id: string;
  scope: V2HookScope;
  source?: V2HookSource;
  sourcePath: V2AbsolutePathBuf;
  startedAt: number;
  status: V2HookRunStatus;
  statusMessage?: string | null;
};

export type V2HookScope = "thread" | "turn";

export type V2HookSource = "system" | "user" | "project" | "mdm" | "sessionFlags" | "plugin" | "cloudRequirements" | "cloudManagedConfig" | "legacyManagedConfigFile" | "legacyManagedConfigMdm" | "unknown";

export type V2HookStartedNotification = {
  run: V2HookRunSummary;
  threadId: string;
  turnId?: string | null;
};

export type V2HookTrustStatus = "managed" | "untrusted" | "trusted" | "modified";

export type V2HooksListEntry = {
  cwd: string;
  errors: Array<V2HookErrorInfo>;
  hooks: Array<V2HookMetadata>;
  warnings: Array<string>;
};

export type V2HooksListParams = {
  /** When empty, defaults to the current session working directory. */
  cwds?: Array<string>;
};

export type V2HooksListResponse = {
  data: Array<V2HooksListEntry>;
};

export type V2ImageDetail = "auto" | "low" | "high" | "original";

export type V2ImageGenerationFailure = ({
  limitId: string;
  resetsAt?: number | null;
  type: "usageLimitExceeded";
});

export type V2InAppBrowserRequirements = {
  allowExternalBrowserSettingsImport?: boolean | null;
};

/** Canonical user-input modality tags advertised by a model. */
export type V2InputModality = "text" | "image" | "audio";

/** Installed connector runtime state. */
export type V2InstalledApp = {
  /** Whether the connector is enabled and has a non-synthetic, model-visible tool allowed by effective MCP and app/tool policy in the committed runtime snapshot. */
  callable: boolean;
  /** Effective enabled state after applying global, workspace, local, and managed configuration at read time. */
  enabled: boolean;
  id: string;
  /** Best-effort name carried by the runtime tool catalog. Canonical app metadata remains owned by `app/read`. */
  runtimeName?: string | null;
};

/**
 * Internal Responses API passthrough metadata copied into underlying chat messages.
 *
 * Responses API strongly types this payload. Do not modify it without first getting API approval and making the corresponding Responses API change.
 */
export type V2InternalChatMessageMetadataPassthrough = {
  turn_id?: string | null;
};

export type V2ItemCompletedNotification = {
  /** Unix timestamp (in milliseconds) when this item lifecycle completed. */
  completedAtMs: number;
  item: V2ThreadItem;
  threadId: string;
  turnId: string;
};

/** [UNSTABLE] Temporary notification payload for approval auto-review. This shape is expected to change soon. */
export type V2ItemGuardianApprovalReviewCompletedNotification = {
  action: V2GuardianApprovalReviewAction;
  /** Unix timestamp (in milliseconds) when this review completed. */
  completedAtMs: number;
  decisionSource: V2AutoReviewDecisionSource;
  review: V2GuardianApprovalReview;
  /** Stable identifier for this review. */
  reviewId: string;
  /** Unix timestamp (in milliseconds) when this review started. */
  startedAtMs: number;
  /**
   * Identifier for the reviewed item or tool call when one exists.
   *
   * In most cases, one review maps to one target item. The exceptions are - execve reviews, where a single command may contain multiple execve calls to review (only possible when using the shell_zsh_fork feature) - stdin reviews, which refer to the existing parent command item and have a separate approval ID in the action payload - network policy reviews, where there is no target item
   *
   * A network call is triggered by a CommandExecution item, so having a target_item_id set to the CommandExecution item would be misleading because the review is about the network call, not the command execution. Therefore, target_item_id is set to None for network policy reviews.
   */
  targetItemId?: string | null;
  threadId: string;
  turnId: string;
};

/** [UNSTABLE] Temporary notification payload for approval auto-review. This shape is expected to change soon. */
export type V2ItemGuardianApprovalReviewStartedNotification = {
  action: V2GuardianApprovalReviewAction;
  review: V2GuardianApprovalReview;
  /** Stable identifier for this review. */
  reviewId: string;
  /** Unix timestamp (in milliseconds) when this review started. */
  startedAtMs: number;
  /**
   * Identifier for the reviewed item or tool call when one exists.
   *
   * In most cases, one review maps to one target item. The exceptions are - execve reviews, where a single command may contain multiple execve calls to review (only possible when using the shell_zsh_fork feature) - stdin reviews, which refer to the existing parent command item and have a separate approval ID in the action payload - network policy reviews, where there is no target item
   *
   * A network call is triggered by a CommandExecution item, so having a target_item_id set to the CommandExecution item would be misleading because the review is about the network call, not the command execution. Therefore, target_item_id is set to None for network policy reviews.
   */
  targetItemId?: string | null;
  threadId: string;
  turnId: string;
};

export type V2ItemStartedNotification = {
  item: V2ThreadItem;
  /** Unix timestamp (in milliseconds) when this item lifecycle started. */
  startedAtMs: number;
  threadId: string;
  turnId: string;
};

export type V2LegacyAppPathString = string;

export type V2ListMcpServerStatusParams = {
  /** Opaque pagination cursor returned by a previous call. */
  cursor?: string | null;
  /** Controls how much MCP inventory data to fetch for each server. Defaults to `Full` when omitted. */
  detail?: V2McpServerStatusDetail | null;
  /** Optional page size; defaults to a server-defined value. */
  limit?: number | null;
  threadId?: string | null;
};

export type V2ListMcpServerStatusResponse = {
  data: Array<V2McpServerStatus>;
  /** Opaque cursor to pass to the next call to continue after the last item. If None, there are no more items to return. */
  nextCursor?: string | null;
};

export type V2LocalShellAction = ({
  command: Array<string>;
  env?: Record<string, string> | null;
  timeout_ms?: number | null;
  type: "exec";
  user?: string | null;
  working_directory?: string | null;
});

export type V2LocalShellStatus = "completed" | "in_progress" | "incomplete";

export type V2LoginAccountParams = {
  apiKey: string;
  type: "apiKey";
} | ({
  appBrand?: V2LoginAppBrand | null;
  codexStreamlinedLogin?: boolean;
  type: "chatgpt";
  useHostedLoginSuccessPage?: boolean;
}) | {
  type: "chatgptDeviceCode";
} | ({
  /** Access token (JWT) supplied by the client. This token is used for backend API requests and email extraction. */
  accessToken: string;
  /** Workspace/account identifier supplied by the client. */
  chatgptAccountId: string;
  /**
   * Optional plan type supplied by the client.
   *
   * When `null`, Codex attempts to derive the plan type from access-token claims. If unavailable, the plan defaults to `unknown`.
   */
  chatgptPlanType?: string | null;
  type: "chatgptAuthTokens";
}) | {
  apiKey: string;
  region: string;
  type: "amazonBedrock";
} | ({
  accessKeyId: string;
  region: string;
  secretAccessKey: string;
  sessionToken?: string | null;
  type: "amazonBedrockAccessKeys";
});

export type V2LoginAccountResponse = {
  type: "apiKey";
} | {
  /** URL the client should open in a browser to initiate the OAuth flow. */
  authUrl: string;
  loginId: string;
  type: "chatgpt";
} | {
  loginId: string;
  type: "chatgptDeviceCode";
  /** One-time code the user must enter after signing in. */
  userCode: string;
  /** URL the client should open in a browser to complete device code authorization. */
  verificationUrl: string;
} | {
  type: "chatgptAuthTokens";
} | {
  type: "amazonBedrock";
};

export type V2LoginAppBrand = "codex" | "chatgpt";

export type V2LogoutAccountResponse = Record<string, unknown>;

export type V2ManagedHooksRequirements = {
  Interrupt?: Array<V2ConfiguredHookMatcherGroup>;
  PermissionRequest: Array<V2ConfiguredHookMatcherGroup>;
  PostCompact: Array<V2ConfiguredHookMatcherGroup>;
  PostToolUse: Array<V2ConfiguredHookMatcherGroup>;
  PreCompact: Array<V2ConfiguredHookMatcherGroup>;
  PreToolUse: Array<V2ConfiguredHookMatcherGroup>;
  SessionEnd?: Array<V2ConfiguredHookMatcherGroup>;
  SessionStart: Array<V2ConfiguredHookMatcherGroup>;
  Stop: Array<V2ConfiguredHookMatcherGroup>;
  SubagentStart: Array<V2ConfiguredHookMatcherGroup>;
  SubagentStop: Array<V2ConfiguredHookMatcherGroup>;
  UserPromptSubmit: Array<V2ConfiguredHookMatcherGroup>;
  managedDir?: string | null;
  windowsManagedDir?: string | null;
};

export type V2MarketplaceAddParams = {
  refName?: string | null;
  source: string;
  sparsePaths?: Array<string> | null;
};

export type V2MarketplaceAddResponse = {
  alreadyAdded: boolean;
  installedRoot: V2AbsolutePathBuf;
  marketplaceName: string;
};

export type V2MarketplaceInterface = {
  displayName?: string | null;
};

export type V2MarketplaceLoadErrorInfo = {
  marketplacePath: V2AbsolutePathBuf;
  message: string;
};

export type V2MarketplaceRemoveParams = {
  marketplaceName: string;
};

export type V2MarketplaceRemoveResponse = {
  installedRoot?: V2AbsolutePathBuf | null;
  marketplaceName: string;
};

export type V2MarketplaceUpgradeErrorInfo = {
  marketplaceName: string;
  message: string;
};

export type V2MarketplaceUpgradeParams = {
  marketplaceName?: string | null;
};

export type V2MarketplaceUpgradeResponse = {
  errors: Array<V2MarketplaceUpgradeErrorInfo>;
  selectedMarketplaces: Array<string>;
  upgradedRoots: Array<V2AbsolutePathBuf>;
};

export type V2McpAuthStatus = "unknown" | "unsupported" | "notLoggedIn" | "bearerToken" | "oAuth";

export type V2McpResourceReadParams = {
  connectorId?: string | null;
  /** Originating MCP tool call used to select the resource's app. */
  originCallId?: string | null;
  server: string;
  threadId?: string | null;
  uri: string;
};

export type V2McpResourceReadResponse = {
  contents: Array<V2ResourceContent>;
  /** Originating call when the server applied app-specific resource scoping. */
  originCallId?: string | null;
};

export type V2McpServerConnectionStatus = "notStarted" | "starting" | "connected" | "authenticationRequired" | "failed" | "cancelled" | "disabled";

export type V2McpServerEventNotification = {
  method: string;
  params: unknown;
};

export type V2McpServerEventStreamNotification = {
  notification: V2McpServerEventNotification;
  subscriptionId: string;
};

/** Presentation metadata advertised by an initialized MCP server. */
export type V2McpServerInfo = {
  description?: string | null;
  icons?: Array<unknown> | null;
  name: string;
  title?: string | null;
  version: string;
  websiteUrl?: string | null;
};

export type V2McpServerMigration = {
  name: string;
};

export type V2McpServerOauthClientRegistration = "auto" | "cimd" | "dcr";

export type V2McpServerOauthLoginCompletedNotification = {
  error?: string | null;
  name: string;
  success: boolean;
  threadId?: string | null;
};

export type V2McpServerOauthLoginParams = {
  /** Registration strategy for this login only; omission selects automatic discovery. */
  clientRegistration?: V2McpServerOauthClientRegistration | null;
  name: string;
  scopes?: Array<string> | null;
  threadId?: string | null;
  timeoutSecs?: number | null;
};

export type V2McpServerOauthLoginResponse = {
  authorizationUrl: string;
};

export type V2McpServerRefreshResponse = Record<string, unknown>;

export type V2McpServerStartupFailureReason = "reauthenticationRequired";

export type V2McpServerStartupState = "starting" | "ready" | "failed" | "cancelled";

export type V2McpServerStatus = {
  authStatus: V2McpAuthStatus;
  name: string;
  pluginId?: string | null;
  resourceTemplates: Array<V2ResourceTemplate>;
  resources: Array<V2Resource>;
  /** Current thread-runtime connection state; null when unavailable or the configuration changed. */
  runtimeStatus?: V2McpServerConnectionStatus | null;
  serverInfo?: V2McpServerInfo | null;
  tools: Record<string, V2Tool>;
  /** Tool discovery failed and no catalog was returned. Null when a catalog is returned, including cached or empty catalogs. */
  toolsError?: string | null;
};

export type V2McpServerStatusDetail = "full" | "toolsAndAuthOnly";

export type V2McpServerStatusUpdatedNotification = {
  error?: string | null;
  failureReason?: V2McpServerStartupFailureReason | null;
  name: string;
  status: V2McpServerStartupState;
  threadId?: string | null;
};

export type V2McpServerToolCallParams = {
  _meta?: unknown;
  arguments?: unknown;
  server: string;
  threadId: string;
  tool: string;
};

export type V2McpServerToolCallResponse = {
  _meta?: unknown;
  content: Array<unknown>;
  isError?: boolean | null;
  structuredContent?: unknown;
};

export type V2McpToolCallAppContext = {
  actionName?: string | null;
  appName?: string | null;
  connectorId: string;
  linkId?: string | null;
  resourceUri?: string | null;
};

export type V2McpToolCallError = {
  message: string;
};

export type V2McpToolCallProgressNotification = {
  itemId: string;
  message: string;
  threadId: string;
  turnId: string;
};

export type V2McpToolCallResult = {
  _meta?: unknown;
  content: Array<unknown>;
  structuredContent?: unknown;
};

export type V2McpToolCallStatus = "inProgress" | "completed" | "failed";

export type V2MemoryCitation = {
  entries: Array<V2MemoryCitationEntry>;
  threadIds: Array<string>;
};

export type V2MemoryCitationEntry = {
  lineEnd: number;
  lineStart: number;
  note: string;
  path: string;
};

export type V2MergeStrategy = "replace" | "upsert";

/**
 * Classifies an assistant message as interim commentary or final answer text.
 *
 * Providers do not emit this consistently, so callers must treat `None` as "phase unknown" and keep compatibility behavior for legacy models.
 */
export type V2MessagePhase = "commentary" | "final_answer";

export type V2MigrationDetails = {
  commands?: Array<V2CommandMigration>;
  hooks?: Array<V2HookMigration>;
  mcpServers?: Array<V2McpServerMigration>;
  memory?: Array<string>;
  plugins?: Array<V2PluginsMigration>;
  sessions?: Array<V2SessionMigration>;
  skills?: Array<V2SkillMigration>;
  subagents?: Array<V2SubagentMigration>;
};

export type V2MisalignmentErrorDetails = {
  /** A substantive localized explanation is required before offering continuation. */
  detailedExplanation?: string | null;
  /** Open-ended classification; clients must accept categories added by Responses. */
  errorType?: string | null;
  /** Instruction to submit as the next turn's user input if continuation is confirmed. */
  steer?: V2MisalignmentSteer | null;
};

export type V2MisalignmentSteer = {
  message: string;
};

/** Initial collaboration mode to use when the TUI starts. */
export type V2ModeKind = "plan" | "default";

export type V2Model = {
  /** Deprecated: use `serviceTiers` instead. */
  additionalSpeedTiers?: Array<string>;
  availabilityNux?: V2ModelAvailabilityNux | null;
  defaultReasoningEffort: V2ReasoningEffort;
  /** Catalog default service tier id for this model, when one is configured. */
  defaultServiceTier?: string | null;
  description: string;
  displayName: string;
  hidden: boolean;
  id: string;
  inputModalities?: Array<V2InputModality>;
  isDefault: boolean;
  model: string;
  modelSpecialty?: string | null;
  /** Multi-agent runtime declared by this model, when available. */
  multiAgentVersion?: V2MultiAgentVersion | null;
  serviceTiers?: Array<V2ModelServiceTier>;
  supportedReasoningEfforts: Array<V2ReasoningEffortOption>;
  supportsPersonality?: boolean;
  upgrade?: string | null;
  upgradeInfo?: V2ModelUpgradeInfo | null;
};

export type V2ModelAvailabilityNux = {
  message: string;
};

export type V2ModelListParams = {
  /** Opaque pagination cursor returned by a previous call. */
  cursor?: string | null;
  /** When true, include models that are hidden from the default picker list. */
  includeHidden?: boolean | null;
  /** Optional page size; defaults to a reasonable server-side value. */
  limit?: number | null;
};

export type V2ModelListResponse = {
  data: Array<V2Model>;
  /** Opaque cursor to pass to the next call to continue after the last item. If None, there are no more items to return. */
  nextCursor?: string | null;
};

export type V2ModelProviderCapabilitiesReadParams = Record<string, unknown>;

export type V2ModelProviderCapabilitiesReadResponse = {
  imageGeneration: boolean;
  namespaceTools: boolean;
  webSearch: boolean;
};

export type V2ModelRerouteReason = "highRiskCyberActivity";

export type V2ModelReroutedNotification = {
  fromModel: string;
  reason: V2ModelRerouteReason;
  threadId: string;
  toModel: string;
  turnId: string;
};

export type V2ModelSafetyBufferingUpdatedNotification = {
  fasterModel?: string | null;
  model: string;
  reasons: Array<string>;
  showBufferingUi: boolean;
  threadId: string;
  turnId: string;
  useCases: Array<string>;
};

export type V2ModelServiceTier = {
  description: string;
  id: string;
  name: string;
};

export type V2ModelUpgradeInfo = {
  migrationMarkdown?: string | null;
  model: string;
  modelLink?: string | null;
  /** Informational Unix timestamp for this upgrade's scheduled retirement, if known. */
  retirementAt?: number | null;
  upgradeCopy?: string | null;
};

export type V2ModelVerification = "trustedAccessForCyber";

export type V2ModelVerificationNotification = {
  threadId: string;
  turnId: string;
  verifications: Array<V2ModelVerification>;
};

export type V2ModelsRequirements = {
  newThread?: V2NewThreadModelDefaults | null;
};

/** Controls the effective multi-agent delegation instructions for a turn. `custom` means the configured mode hint defines the policy instead of a built-in policy. */
export type V2MultiAgentMode = ("explicitRequestOnly" | "proactive") | {
  custom: string;
};

/** Multi-agent runtime supported by a model. */
export type V2MultiAgentVersion = "disabled" | "v1" | "v2";

export type V2NetworkAccess = "restricted" | "enabled";

export type V2NetworkApprovalProtocol = "http" | "https" | "socks5Tcp" | "socks5Udp";

export type V2NetworkDomainPermission = "allow" | "deny";

export type V2NetworkRequirements = {
  allowLocalBinding?: boolean | null;
  /** Legacy compatibility view derived from `unix_sockets`. */
  allowUnixSockets?: Array<string> | null;
  allowUpstreamProxy?: boolean | null;
  /** Legacy compatibility view derived from `domains`. */
  allowedDomains?: Array<string> | null;
  dangerouslyAllowAllUnixSockets?: boolean | null;
  dangerouslyAllowNonLoopbackProxy?: boolean | null;
  /** Legacy compatibility view derived from `domains`. */
  deniedDomains?: Array<string> | null;
  /** Canonical network permission map for `experimental_network`. */
  domains?: Record<string, V2NetworkDomainPermission> | null;
  enabled?: boolean | null;
  httpPort?: number | null;
  /** When true, only managed allowlist entries are respected while managed network enforcement is active. */
  managedAllowedDomainsOnly?: boolean | null;
  socksPort?: number | null;
  /** Canonical unix socket permission map for `experimental_network`. */
  unixSockets?: Record<string, V2NetworkUnixSocketPermission> | null;
};

export type V2NetworkUnixSocketPermission = "allow" | "deny";

export type V2NewThreadModelDefaults = {
  model?: string | null;
  modelReasoningEffort?: V2ReasoningEffort | null;
  serviceTier?: string | null;
};

export type V2NonSteerableTurnKind = "review" | "compact";

export type V2NullableGetAccountRateLimitsParams = V2GetAccountRateLimitsParams | null;

export type V2NullableGetAccountTokenUsageParams = V2GetAccountTokenUsageParams | null;

export type V2OverriddenMetadata = {
  effectiveValue: unknown;
  message: string;
  overridingLayer: V2ConfigLayerMetadata;
};

export type V2PatchApplyStatus = "inProgress" | "completed" | "failed" | "declined";

export type V2PatchChangeKind = {
  type: "add";
} | {
  type: "delete";
} | ({
  move_path?: string | null;
  type: "update";
});

export type V2PathUri = string;

export type V2PermissionProfileListParams = {
  /** Opaque pagination cursor returned by a previous call. */
  cursor?: string | null;
  /** Optional working directory to resolve project config layers. */
  cwd?: string | null;
  /** Optional page size; defaults to the full result set. */
  limit?: number | null;
};

export type V2PermissionProfileListResponse = {
  data: Array<V2PermissionProfileSummary>;
  /** Opaque cursor to pass to the next call to continue after the last item. If None, there are no more items to return. */
  nextCursor?: string | null;
};

export type V2PermissionProfileSummary = {
  /** Whether the effective requirements allow selecting this profile. */
  allowed: boolean;
  /** Optional user-facing description for display in clients. */
  description?: string | null;
  /** Available permission profile identifier. */
  id: string;
};

export type V2Personality = "none" | "friendly" | "pragmatic";

/** EXPERIMENTAL - proposed plan streaming deltas for plan items. Clients should not assume concatenated deltas match the completed plan item content. */
export type V2PlanDeltaNotification = {
  delta: string;
  itemId: string;
  threadId: string;
  turnId: string;
};

export type V2PlanType = "free" | "go" | "plus" | "pro" | "prolite" | "team" | "self_serve_business_prolite" | "self_serve_business_usage_based" | "business" | "ent26" | "enterprise_cbp_automation" | "enterprise_cbp_usage_based" | "enterprise" | "edu" | "edu_plus" | "edu_pro" | "unknown";

export type V2PluginAuthPolicy = "ON_INSTALL" | "ON_USE";

export type V2PluginAvailability = "DISABLED_BY_ADMIN" | "AVAILABLE";

export type V2PluginDetail = {
  appTemplates: Array<V2AppTemplateSummary>;
  apps: Array<V2AppSummary>;
  description?: string | null;
  hooks: Array<V2PluginHookSummary>;
  marketplaceName: string;
  marketplacePath?: V2AbsolutePathBuf | null;
  mcpServers: Array<string>;
  scheduledTasks?: Array<V2ScheduledTaskSummary> | null;
  shareUrl?: string | null;
  skills: Array<V2SkillSummary>;
  summary: V2PluginSummary;
};

export type V2PluginDisabledReason = "disabled_by_admin" | "plan_not_eligible" | "required_app_unavailable" | "unknown";

export type V2PluginHookSummary = {
  eventName: V2HookEventName;
  key: string;
};

export type V2PluginInstallParams = {
  /** Client-generated identifier used to correlate one installation attempt. */
  installAttemptId?: string | null;
  marketplacePath?: V2AbsolutePathBuf | null;
  pluginName: string;
  remoteMarketplaceName?: string | null;
};

export type V2PluginInstallPolicy = "NOT_AVAILABLE" | "AVAILABLE" | "INSTALLED_BY_DEFAULT";

export type V2PluginInstallPolicySource = "WORKSPACE_SETTING" | "IMPLICIT_CANONICAL_APP";

export type V2PluginInstallResponse = {
  appsNeedingAuth: Array<V2AppSummary>;
  authPolicy: V2PluginAuthPolicy;
};

export type V2PluginInstalledParams = {
  /** Optional working directories used to discover repo marketplaces. */
  cwds?: Array<V2AbsolutePathBuf> | null;
  /** Additional uninstalled plugin names that should be returned when present locally. This is used by mention surfaces that intentionally expose install entrypoints. */
  installSuggestionPluginNames?: Array<string> | null;
};

export type V2PluginInstalledResponse = {
  marketplaceLoadErrors?: Array<V2MarketplaceLoadErrorInfo>;
  marketplaces: Array<V2PluginMarketplaceEntry>;
};

export type V2PluginInterface = {
  brandColor?: string | null;
  capabilities: Array<string>;
  category?: string | null;
  /** Local composer icon path, resolved from the installed plugin package. */
  composerIcon?: V2AbsolutePathBuf | null;
  /** Remote composer icon URL from the plugin catalog. */
  composerIconUrl?: string | null;
  /** Starter prompts for the plugin. Capped at 3 entries with a maximum of 128 characters per entry. */
  defaultPrompt?: Array<string> | null;
  developerName?: string | null;
  displayName?: string | null;
  /** Local logo path, resolved from the installed plugin package. */
  logo?: V2AbsolutePathBuf | null;
  /** Local dark-mode logo path, resolved from the installed plugin package. */
  logoDark?: V2AbsolutePathBuf | null;
  /** Remote logo URL from the plugin catalog. */
  logoUrl?: string | null;
  /** Remote dark-mode logo URL from the plugin catalog. */
  logoUrlDark?: string | null;
  longDescription?: string | null;
  privacyPolicyUrl?: string | null;
  /** Remote screenshot URLs from the plugin catalog. */
  screenshotUrls: Array<string>;
  /** Local screenshot paths, resolved from the installed plugin package. */
  screenshots: Array<V2AbsolutePathBuf>;
  shortDescription?: string | null;
  termsOfServiceUrl?: string | null;
  websiteUrl?: string | null;
};

export type V2PluginListMarketplaceKind = "local" | "vertical" | "workspace-directory" | "shared-with-me" | "created-by-me-remote";

export type V2PluginListParams = {
  /** Optional working directories used to discover repo marketplaces. When omitted, only home-scoped marketplaces and the official curated marketplace are considered. */
  cwds?: Array<V2AbsolutePathBuf> | null;
  /** Whether the client requests a fresh remote plugin catalog fetch. */
  forceRefetch?: boolean;
  /** Optional marketplace kind filter. When omitted, only local marketplaces are queried, plus the default remote catalog when enabled by feature flag. */
  marketplaceKinds?: Array<V2PluginListMarketplaceKind> | null;
};

export type V2PluginListResponse = {
  featuredPluginIds?: Array<string>;
  marketplaceLoadErrors?: Array<V2MarketplaceLoadErrorInfo>;
  marketplaces: Array<V2PluginMarketplaceEntry>;
};

export type V2PluginMarketplaceEntry = {
  interface?: V2MarketplaceInterface | null;
  name: string;
  /** Local marketplace file path when the marketplace is backed by a local file. Remote-only catalog marketplaces do not have a local path. */
  path?: V2AbsolutePathBuf | null;
  plugins: Array<V2PluginSummary>;
};

export type V2PluginReadParams = {
  marketplacePath?: V2AbsolutePathBuf | null;
  pluginName: string;
  remoteMarketplaceName?: string | null;
};

export type V2PluginReadResponse = {
  plugin: V2PluginDetail;
};

/** Runtime categories affected by this change, not just capabilities currently present. Flags describe declarations before runtime policy filtering. Updates OR the old and new bundle flags; enablement changes and cached reinstalls use the cached bundle; removals retain the old bundle's flags. */
export type V2PluginReconcileChangedPlugin = {
  hasApps: boolean;
  hasHooks: boolean;
  hasMcps: boolean;
  /** Whether either bundle declares skill roots; not a validated inventory of enabled skills. */
  hasSkills: boolean;
  /** Local plugin ID (`name@marketplace`), matching `PluginSummary.id`. */
  id: string;
};

export type V2PluginReconcileParams = {
  /** Optional client-provided reason recorded with the reconciliation attempt. */
  reason?: string | null;
};

/** Bundle and installed-state changes observed by this pass, not a runtime-readiness acknowledgement or a cumulative diff since the client's last request. Other metadata-only changes are not listed. */
export type V2PluginReconcileResponse = {
  /** Plugins affected by bundle changes, enablement changes, or removals. Installed-state changes compare against the previous cached snapshot, including cached reinstalls. Removal hints survive cache cleanup failures; unchanged plugins are omitted. */
  changedPlugins: Array<V2PluginReconcileChangedPlugin>;
  /** Subset of failures for which the requested bundle could not be materialized. A previously cached version may still be available. */
  failedMaterializationRemotePluginIds: Array<string>;
  /** Backend remote plugin IDs whose bundle or identity update failed. */
  failedRemotePluginIds: Array<string>;
};

export type V2PluginSearchResult = {
  marketplaceName: string;
  marketplacePath?: V2AbsolutePathBuf | null;
  plugin: V2PluginSummary;
};

export type V2PluginSearchScope = "global" | "workspace" | "personal";

export type V2PluginShareCheckoutParams = {
  remotePluginId: string;
};

export type V2PluginShareCheckoutResponse = {
  marketplaceName: string;
  marketplacePath: V2AbsolutePathBuf;
  pluginId: string;
  pluginName: string;
  pluginPath: V2AbsolutePathBuf;
  remotePluginId: string;
  remoteVersion?: string | null;
};

export type V2PluginShareContext = {
  canPublishToWorkspace?: boolean | null;
  creatorAccountUserId?: string | null;
  creatorName?: string | null;
  discoverability?: V2PluginShareDiscoverability | null;
  remotePluginId: string;
  /** Version of the remote shared plugin release when available. */
  remoteVersion?: string | null;
  sharePrincipals?: Array<V2PluginSharePrincipal> | null;
  shareUrl?: string | null;
};

export type V2PluginShareDeleteParams = {
  remotePluginId: string;
};

export type V2PluginShareDeleteResponse = Record<string, unknown>;

export type V2PluginShareDiscoverability = "LISTED" | "UNLISTED" | "PRIVATE";

export type V2PluginShareListItem = {
  localPluginPath?: V2AbsolutePathBuf | null;
  plugin: V2PluginSummary;
};

export type V2PluginShareListParams = Record<string, unknown>;

export type V2PluginShareListResponse = {
  data: Array<V2PluginShareListItem>;
};

export type V2PluginSharePrincipal = {
  name: string;
  principalId: string;
  principalType: V2PluginSharePrincipalType;
  role: V2PluginSharePrincipalRole;
};

export type V2PluginSharePrincipalRole = "reader" | "editor" | "owner";

export type V2PluginSharePrincipalType = "user" | "group" | "workspace";

export type V2PluginShareSaveParams = {
  discoverability?: V2PluginShareDiscoverability | null;
  pluginPath: V2AbsolutePathBuf;
  remotePluginId?: string | null;
  shareTargets?: Array<V2PluginShareTarget> | null;
};

export type V2PluginShareSaveResponse = {
  canPublishToWorkspace?: boolean | null;
  remotePluginId: string;
  shareUrl: string;
};

export type V2PluginShareTarget = {
  principalId: string;
  principalType: V2PluginSharePrincipalType;
  role: V2PluginShareTargetRole;
};

export type V2PluginShareTargetRole = "reader" | "editor";

export type V2PluginShareUpdateDiscoverability = "UNLISTED" | "PRIVATE" | "LISTED";

export type V2PluginShareUpdateTargetsParams = {
  discoverability: V2PluginShareUpdateDiscoverability;
  remotePluginId: string;
  shareTargets: Array<V2PluginShareTarget>;
};

export type V2PluginShareUpdateTargetsResponse = {
  discoverability: V2PluginShareDiscoverability;
  principals: Array<V2PluginSharePrincipal>;
};

export type V2PluginSkillReadParams = {
  remoteMarketplaceName: string;
  remotePluginId: string;
  skillName: string;
};

export type V2PluginSkillReadResponse = {
  contents?: string | null;
};

export type V2PluginSource = {
  path: V2AbsolutePathBuf;
  type: "local";
} | ({
  path?: string | null;
  refName?: string | null;
  sha?: string | null;
  type: "git";
  url: string;
}) | ({
  package: string;
  /** Optional HTTPS registry URL. Authentication stays in the user's npm config. */
  registry?: string | null;
  type: "npm";
  /** Optional npm version or version range. */
  version?: string | null;
}) | {
  type: "remote";
};

export type V2PluginSummary = {
  authPolicy: V2PluginAuthPolicy;
  /** Availability state for installing and using the plugin. */
  availability?: V2PluginAvailability;
  /** Why the remote plugin is unavailable, when provided by plugin-service. */
  disabledReason?: V2PluginDisabledReason | null;
  /** Raw plugin-service plan identifiers eligible to install the plugin. */
  eligiblePlanTypes?: Array<string> | null;
  enabled: boolean;
  id: string;
  installPolicy: V2PluginInstallPolicy;
  installPolicySource?: V2PluginInstallPolicySource | null;
  installed: boolean;
  /** Unix timestamp in seconds when the remote plugin was installed, when available. */
  installedAt?: number | null;
  interface?: V2PluginInterface | null;
  keywords?: Array<string>;
  /** Version of the locally materialized plugin package when available. */
  localVersion?: string | null;
  mustShowInstallationInterstitial?: boolean | null;
  name: string;
  /** Backend remote plugin identifier when available. */
  remotePluginId?: string | null;
  /** Remote sharing context associated with this plugin when available. */
  shareContext?: V2PluginShareContext | null;
  source: V2PluginSource;
  /** Version advertised by the remote marketplace backend when available. */
  version?: string | null;
};

export type V2PluginUninstallParams = {
  pluginId: string;
};

export type V2PluginUninstallResponse = Record<string, unknown>;

export type V2PluginsMigration = {
  marketplaceName: string;
  pluginNames: Array<string>;
};

/** Final process exit notification for `process/spawn`. */
export type V2ProcessExitedNotification = {
  /** Process exit code. */
  exitCode: number;
  /** Client-supplied, connection-scoped `processHandle` from `process/spawn`. */
  processHandle: string;
  /**
   * Buffered stderr capture.
   *
   * Empty when stderr was streamed via `process/outputDelta`.
   */
  stderr: string;
  /**
   * Whether stderr reached `outputBytesCap`.
   *
   * In streaming mode, stderr is empty and cap state is also reported on the final stderr `process/outputDelta` notification.
   */
  stderrCapReached: boolean;
  /**
   * Buffered stdout capture.
   *
   * Empty when stdout was streamed via `process/outputDelta`.
   */
  stdout: string;
  /**
   * Whether stdout reached `outputBytesCap`.
   *
   * In streaming mode, stdout is empty and cap state is also reported on the final stdout `process/outputDelta` notification.
   */
  stdoutCapReached: boolean;
};

/** Base64-encoded output chunk emitted for a streaming `process/spawn` request. */
export type V2ProcessOutputDeltaNotification = {
  /** True on the final streamed chunk for this stream when output was truncated by `outputBytesCap`. */
  capReached: boolean;
  /** Base64-encoded output bytes. */
  deltaBase64: string;
  /** Client-supplied, connection-scoped `processHandle` from `process/spawn`. */
  processHandle: string;
  /** Output stream this chunk belongs to. */
  stream: V2ProcessOutputStream;
};

/** Stream label for `process/outputDelta` notifications. */
export type V2ProcessOutputStream = "stdout" | "stderr";

/** PTY size in character cells for `process/spawn` PTY sessions. */
export type V2ProcessTerminalSize = {
  /** Terminal width in character cells. */
  cols: number;
  /** Terminal height in character cells. */
  rows: number;
};

export type V2Project = {
  createdAt: number;
  id: string;
  metadata: Record<string, string>;
  name: string;
  position: number;
  /** Newest non-archived member thread's recency, in Unix seconds; null when none exist. */
  recencyAt?: number | null;
  roots: Array<V2ProjectRoot>;
  updatedAt: number;
};

export type V2ProjectChangeType = "created" | "updated" | "deleted";

export type V2ProjectChangedNotification = {
  changeType: V2ProjectChangeType;
  projectId: string;
};

export type V2ProjectRoot = {
  path: V2AbsolutePathBuf;
};

export type V2ProjectSortKey = "position" | "recencyAt";

export type V2QueuedSubmission = {
  clientUserMessageId: string;
  id: string;
  input: Array<V2UserInput>;
};

export type V2RateLimitReachedType = "rate_limit_reached" | "workspace_owner_credits_depleted" | "workspace_member_credits_depleted" | "workspace_owner_usage_limit_reached" | "workspace_member_usage_limit_reached";

export type V2RateLimitResetCredit = {
  /** Backend-provided display description for this credit, or `null` when unavailable. */
  description?: string | null;
  /** Unix timestamp in seconds when the credit expires, or `null` if it does not expire. */
  expiresAt?: number | null;
  /** Unix timestamp in seconds when the credit was granted. */
  grantedAt: number;
  /** Opaque backend identifier for this reset credit. */
  id: string;
  resetType: V2RateLimitResetType;
  status: V2RateLimitResetCreditStatus;
  /** Backend-provided display title for this credit, or `null` when unavailable. */
  title?: string | null;
};

export type V2RateLimitResetCreditStatus = "available" | "redeeming" | "redeemed" | "unknown";

export type V2RateLimitResetCreditsSummary = {
  availableCount: number;
  /**
   * Detail rows for available reset credits, when the backend provides them.
   *
   * `null` means only `availableCount` is known, while an empty array means details were fetched and no available credits were returned. The backend may cap this list, so its length can be less than `availableCount`.
   */
  credits?: Array<V2RateLimitResetCredit> | null;
};

export type V2RateLimitResetType = "codexRateLimits" | "unknown";

export type V2RateLimitSnapshot = {
  credits?: V2CreditsSnapshot | null;
  individualLimit?: V2SpendControlLimitSnapshot | null;
  limitId?: string | null;
  limitName?: string | null;
  /** Normal model whose display name and reasoning options describe this quota alias. */
  normalModelSlug?: string | null;
  planType?: V2PlanType | null;
  primary?: V2RateLimitWindow | null;
  rateLimitReachedType?: V2RateLimitReachedType | null;
  secondary?: V2RateLimitWindow | null;
  /** Backend-reported spend-control state. `None` is unavailable, not a sparse-update recovery. */
  spendControlReached?: boolean | null;
};

export type V2RateLimitWindow = {
  resetsAt?: number | null;
  usedPercent: number;
  windowDurationMins?: number | null;
};

/** Internal-only notification containing the exact usage from one upstream Responses API completion. */
export type V2RawResponseCompletedNotification = {
  responseId: string;
  threadId: string;
  turnId: string;
  usage?: V2TokenUsageBreakdown | null;
  usageMetadata?: V2ResponseUsageMetadata | null;
};

export type V2RawResponseItemCompletedNotification = {
  item: V2ResponseItem;
  threadId: string;
  turnId: string;
};

export type V2RealtimeConversationVersion = "v1" | "v2" | "v3";

export type V2RealtimeOutputModality = "text" | "audio";

export type V2RealtimeVoice = "alloy" | "arbor" | "ash" | "ballad" | "breeze" | "cedar" | "coral" | "cove" | "echo" | "ember" | "juniper" | "maple" | "marin" | "sage" | "shimmer" | "sol" | "spruce" | "vale" | "verse";

export type V2RealtimeVoicesList = {
  defaultV1: V2RealtimeVoice;
  defaultV2: V2RealtimeVoice;
  v1: Array<V2RealtimeVoice>;
  v2: Array<V2RealtimeVoice>;
};

/** A non-empty reasoning effort value advertised by the model. */
export type V2ReasoningEffort = string;

export type V2ReasoningEffortOption = {
  description: string;
  reasoningEffort: V2ReasoningEffort;
};

export type V2ReasoningItemContent = {
  text: string;
  type: "reasoning_text";
} | {
  text: string;
  type: "text";
};

export type V2ReasoningItemReasoningSummary = {
  text: string;
  type: "summary_text";
};

/** A summary of the reasoning performed by the model. This can be useful for debugging and understanding the model's reasoning process. See https://platform.openai.com/docs/guides/reasoning?api-mode=responses#reasoning-summaries */
export type V2ReasoningSummary = ("auto" | "concise" | "detailed") | "none";

export type V2ReasoningSummaryPartAddedNotification = {
  itemId: string;
  summaryIndex: number;
  threadId: string;
  turnId: string;
};

export type V2ReasoningSummaryTextDeltaNotification = {
  delta: string;
  itemId: string;
  summaryIndex: number;
  threadId: string;
  turnId: string;
};

export type V2ReasoningTextDeltaNotification = {
  contentIndex: number;
  delta: string;
  itemId: string;
  threadId: string;
  turnId: string;
};

export type V2RemoteControlConnectionStatus = "disabled" | "connecting" | "connected" | "errored";

export type V2RemoteControlDisableParams = {
  ephemeral?: boolean;
};

export type V2RemoteControlEnableParams = {
  ephemeral?: boolean;
};

/** Current remote-control connection status and remote identity exposed to clients. */
export type V2RemoteControlStatusChangedNotification = {
  environmentId?: string | null;
  installationId: string;
  serverName: string;
  status: V2RemoteControlConnectionStatus;
};

export type V2RequestId = string | number;

export type V2RequestPermissionProfile = {
  fileSystem?: V2AdditionalFileSystemPermissions | null;
  network?: V2AdditionalNetworkPermissions | null;
};

export type V2ResidencyRequirement = "us";

/** A known resource that the server is capable of reading. */
export type V2Resource = {
  _meta?: unknown;
  annotations?: unknown;
  description?: string | null;
  icons?: Array<unknown> | null;
  mimeType?: string | null;
  name: string;
  size?: number | null;
  title?: string | null;
  uri: string;
};

/** Contents returned when reading a resource from an MCP server. */
export type V2ResourceContent = ({
  _meta?: unknown;
  mimeType?: string | null;
  text: string;
  /** The URI of this resource. */
  uri: string;
}) | ({
  _meta?: unknown;
  blob: string;
  mimeType?: string | null;
  /** The URI of this resource. */
  uri: string;
});

/** A template description for resources available on the server. */
export type V2ResourceTemplate = {
  annotations?: unknown;
  description?: string | null;
  mimeType?: string | null;
  name: string;
  title?: string | null;
  uriTemplate: string;
};

export type V2ResponseItem = ({
  content: Array<V2ContentItem>;
  id?: string | null;
  internal_chat_message_metadata_passthrough?: V2InternalChatMessageMetadataPassthrough | null;
  phase?: V2MessagePhase | null;
  role: string;
  type: "message";
}) | ({
  author: string;
  content: Array<V2AgentMessageInputContent>;
  id?: string | null;
  internal_chat_message_metadata_passthrough?: V2InternalChatMessageMetadataPassthrough | null;
  recipient: string;
  type: "agent_message";
}) | ({
  content?: Array<V2ReasoningItemContent> | null;
  encrypted_content?: string | null;
  id?: string | null;
  internal_chat_message_metadata_passthrough?: V2InternalChatMessageMetadataPassthrough | null;
  summary: Array<V2ReasoningItemReasoningSummary>;
  type: "reasoning";
}) | ({
  action: V2LocalShellAction;
  /** Set when using the Responses API. */
  call_id?: string | null;
  /** Legacy id field retained for compatibility with older payloads. */
  id?: string | null;
  internal_chat_message_metadata_passthrough?: V2InternalChatMessageMetadataPassthrough | null;
  status: V2LocalShellStatus;
  type: "local_shell_call";
}) | ({
  arguments: string;
  call_id: string;
  encrypted_function_args?: Array<string> | null;
  id?: string | null;
  internal_chat_message_metadata_passthrough?: V2InternalChatMessageMetadataPassthrough | null;
  name: string;
  namespace?: string | null;
  type: "function_call";
}) | ({
  arguments: unknown;
  call_id?: string | null;
  execution: string;
  id?: string | null;
  internal_chat_message_metadata_passthrough?: V2InternalChatMessageMetadataPassthrough | null;
  status?: string | null;
  type: "tool_search_call";
}) | ({
  call_id?: string | null;
  id?: string | null;
  internal_chat_message_metadata_passthrough?: V2InternalChatMessageMetadataPassthrough | null;
  name?: string | null;
  namespace?: string | null;
  output: V2FunctionCallOutputBody;
  type: "function_call_output";
}) | ({
  call_id: string;
  id?: string | null;
  input: string;
  internal_chat_message_metadata_passthrough?: V2InternalChatMessageMetadataPassthrough | null;
  name: string;
  namespace?: string | null;
  status?: string | null;
  type: "custom_tool_call";
}) | ({
  call_id: string;
  id?: string | null;
  internal_chat_message_metadata_passthrough?: V2InternalChatMessageMetadataPassthrough | null;
  name?: string | null;
  output: V2FunctionCallOutputBody;
  type: "custom_tool_call_output";
}) | ({
  call_id?: string | null;
  execution: string;
  id?: string | null;
  internal_chat_message_metadata_passthrough?: V2InternalChatMessageMetadataPassthrough | null;
  status: string;
  tools: Array<unknown>;
  type: "tool_search_output";
}) | ({
  action?: V2ResponsesApiWebSearchAction | null;
  id?: string | null;
  internal_chat_message_metadata_passthrough?: V2InternalChatMessageMetadataPassthrough | null;
  status?: string | null;
  type: "web_search_call";
}) | ({
  id?: string | null;
  internal_chat_message_metadata_passthrough?: V2InternalChatMessageMetadataPassthrough | null;
  result: string;
  revised_prompt?: string | null;
  status: string;
  type: "image_generation_call";
}) | ({
  encrypted_content: string;
  id?: string | null;
  internal_chat_message_metadata_passthrough?: V2InternalChatMessageMetadataPassthrough | null;
  type: "compaction";
}) | {
  reasoning: V2ConfigurationReasoning;
  type: "configuration_update";
} | {
  type: "compaction_trigger";
} | ({
  encrypted_content?: string | null;
  id?: string | null;
  internal_chat_message_metadata_passthrough?: V2InternalChatMessageMetadataPassthrough | null;
  type: "context_compaction";
}) | {
  type: "other";
};

/** Usage metadata reported for one upstream response. */
export type V2ResponseUsageMetadata = {
  amount?: string | null;
  metadata?: unknown;
};

export type V2ResponsesApiWebSearchAction = ({
  queries?: Array<string> | null;
  query?: string | null;
  type: "search";
}) | ({
  type: "open_page";
  url?: string | null;
}) | ({
  pattern?: string | null;
  type: "find_in_page";
  url?: string | null;
}) | {
  type: "other";
};

export type V2ReviewDelivery = "inline" | "detached";

export type V2ReviewStartParams = {
  /** Where to run the review: inline (default) on the current thread or detached on a new thread (returned in `reviewThreadId`). Detached delivery is deprecated and emits `deprecationNotice`. Use `thread/start` followed by an inline review for a separate review thread. */
  delivery?: V2ReviewDelivery | null;
  target: V2ReviewTarget;
  threadId: string;
};

export type V2ReviewStartResponse = {
  /**
   * Identifies the thread where the review runs.
   *
   * For inline reviews, this is the original thread id. For detached reviews, this is the id of the new review thread.
   */
  reviewThreadId: string;
  turn: V2Turn;
};

export type V2ReviewTarget = {
  type: "uncommittedChanges";
} | {
  branch: string;
  type: "baseBranch";
} | ({
  sha: string;
  /** Optional human-readable label (e.g., commit subject) for UIs. */
  title?: string | null;
  type: "commit";
}) | {
  instructions: string;
  type: "custom";
};

export type V2SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export type V2SandboxPolicy = {
  type: "dangerFullAccess";
} | {
  networkAccess?: boolean;
  type: "readOnly";
} | {
  networkAccess?: V2NetworkAccess;
  type: "externalSandbox";
} | {
  excludeSlashTmp?: boolean;
  excludeTmpdirEnvVar?: boolean;
  networkAccess?: boolean;
  type: "workspaceWrite";
  writableRoots?: Array<V2AbsolutePathBuf>;
};

export type V2SandboxWorkspaceWrite = {
  exclude_slash_tmp?: boolean;
  exclude_tmpdir_env_var?: boolean;
  network_access?: boolean;
  writable_roots?: Array<string>;
};

export type V2ScheduledTaskSchedule = ({
  days?: Array<V2ScheduledTaskWeekday> | null;
  intervalHours: number;
  type: "hourly";
}) | {
  time: string;
  type: "daily";
} | {
  time: string;
  type: "weekdays";
} | {
  days: Array<V2ScheduledTaskWeekday>;
  time: string;
  type: "weekly";
};

export type V2ScheduledTaskSummary = {
  key: string;
  name: string;
  prompt: string;
  schedule: V2ScheduledTaskSchedule;
};

export type V2ScheduledTaskWeekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

/** A user-selected root that can expose one or more runtime capabilities. */
export type V2SelectedCapabilityRoot = {
  /** Stable identifier supplied by the capability selection platform. */
  id: string;
  /** Where the selected root can be resolved. */
  location: V2CapabilityRootLocation;
};

export type V2SendAddCreditsNudgeEmailParams = {
  creditType: V2AddCreditsNudgeCreditType;
};

export type V2SendAddCreditsNudgeEmailResponse = {
  status: V2AddCreditsNudgeEmailStatus;
};

export type V2ServerDiagnosticsGauge = {
  name: string;
  value: number;
};

export type V2ServerDiagnosticsProcess = {
  id: number;
  physicalFootprintBytes?: number | null;
  residentMemoryBytes?: number | null;
};

export type V2ServerRequestResolvedNotification = {
  requestId: V2RequestId;
  threadId: string;
};

export type V2SessionMigration = {
  cwd: string;
  path: string;
  title?: string | null;
};

export type V2SessionSource = ("cli" | "vscode" | "exec" | "appServer" | "unknown") | {
  custom: string;
} | {
  subAgent: V2SubAgentSource;
};

/** Settings for a collaboration mode. */
export type V2Settings = {
  developer_instructions?: string | null;
  model: string;
  reasoning_effort?: V2ReasoningEffort | null;
};

export type V2SkillDependencies = {
  tools: Array<V2SkillToolDependency>;
};

export type V2SkillErrorInfo = {
  message: string;
  path: string;
};

export type V2SkillInterface = {
  brandColor?: string | null;
  defaultPrompt?: string | null;
  displayName?: string | null;
  iconLarge?: V2AbsolutePathBuf | null;
  /** Remote large icon URL from the plugin catalog. */
  iconLargeUrl?: string | null;
  iconSmall?: V2AbsolutePathBuf | null;
  /** Remote small icon URL from the plugin catalog. */
  iconSmallUrl?: string | null;
  shortDescription?: string | null;
};

export type V2SkillMetadata = {
  dependencies?: V2SkillDependencies | null;
  description: string;
  enabled: boolean;
  interface?: V2SkillInterface | null;
  name: string;
  path: V2AbsolutePathBuf;
  /** Owning plugin ID, matching `PluginSummary.id`, when known. */
  pluginId?: string | null;
  scope: V2SkillScope;
  /** Legacy short_description from SKILL.md. Prefer SKILL.json interface.short_description. */
  shortDescription?: string | null;
};

export type V2SkillMigration = {
  name: string;
};

export type V2SkillScope = "user" | "repo" | "system" | "admin";

export type V2SkillSummary = {
  description: string;
  enabled: boolean;
  interface?: V2SkillInterface | null;
  name: string;
  path?: V2AbsolutePathBuf | null;
  shortDescription?: string | null;
};

export type V2SkillToolDependency = {
  command?: string | null;
  description?: string | null;
  transport?: string | null;
  type: string;
  url?: string | null;
  value: string;
};

/**
 * Notification emitted when watched local skill files change.
 *
 * Treat this as an invalidation signal and re-run `skills/list` with the client's current parameters when refreshed skill metadata is needed.
 */
export type V2SkillsChangedNotification = Record<string, unknown>;

export type V2SkillsConfigWriteParams = {
  enabled: boolean;
  /** Name-based selector. */
  name?: string | null;
  /** Path-based selector. */
  path?: V2AbsolutePathBuf | null;
};

export type V2SkillsConfigWriteResponse = {
  effectiveEnabled: boolean;
};

export type V2SkillsExtraRootsSetParams = {
  extraRoots: Array<V2AbsolutePathBuf>;
};

export type V2SkillsExtraRootsSetResponse = Record<string, unknown>;

export type V2SkillsListEntry = {
  cwd: string;
  errors: Array<V2SkillErrorInfo>;
  skills: Array<V2SkillMetadata>;
};

export type V2SkillsListParams = {
  /** When empty, defaults to the current session working directory. */
  cwds?: Array<string>;
  /** When true, bypass the skills cache and re-scan skills from disk. */
  forceReload?: boolean;
};

export type V2SkillsListResponse = {
  data: Array<V2SkillsListEntry>;
};

export type V2SortDirection = "asc" | "desc";

export type V2SpendControlLimitSnapshot = {
  limit: string;
  remainingPercent: number;
  resetsAt: number;
  used: string;
};

export type V2StrictReviewRequiredNotification = {
  /** Unix timestamp (in milliseconds) when this review started. */
  startedAtMs: number;
  threadId: string;
  turnId: string;
};

export type V2SubAgentActivityKind = "started" | "interacted" | "interrupted" | "completed";

export type V2SubAgentSource = ("review" | "compact" | "memory_consolidation") | ({
  thread_spawn: {
    agent_nickname?: string | null;
    agent_path?: V2AgentPath | null;
    agent_role?: string | null;
    depth: number;
    parent_thread_id: V2ThreadId;
  };
}) | {
  other: string;
};

export type V2SubagentMigration = {
  name: string;
};

export type V2TerminalInteractionNotification = {
  itemId: string;
  processId: string;
  stdin: string;
  threadId: string;
  turnId: string;
};

export type V2TextElement = {
  /** Byte range in the parent `text` buffer that this element occupies. */
  byteRange: V2ByteRange;
  /** Optional human-readable placeholder for the element, displayed in the UI. */
  placeholder?: string | null;
};

export type V2TextPosition = {
  /** 1-based column number (in Unicode scalar values). */
  column: number;
  /** 1-based line number. */
  line: number;
};

export type V2TextRange = {
  end: V2TextPosition;
  start: V2TextPosition;
};

export type V2Thread = {
  /** Optional random unique nickname assigned to an AgentControl-spawned sub-agent. */
  agentNickname?: string | null;
  /** Optional role (agent_role) assigned to an AgentControl-spawned sub-agent. */
  agentRole?: string | null;
  /** Version of the CLI that created the thread. */
  cliVersion: string;
  /** Unix timestamp (in seconds) when the thread was created. */
  createdAt: number;
  /** Working directory captured for the thread. */
  cwd: V2AbsolutePathBuf;
  /** Whether the thread is ephemeral and should not be materialized on disk. */
  ephemeral: boolean;
  /** Source thread id when this thread was created by forking another thread. */
  forkedFromId?: string | null;
  /** Optional Git metadata captured when the thread was created. */
  gitInfo?: V2GitInfo | null;
  /** Persisted thread history contract selected when this thread was created. */
  historyMode?: V2ThreadHistoryMode;
  /** Identifier for this thread. Codex-generated thread IDs are UUIDv7. */
  id: string;
  /** Current configured model when loaded, otherwise the latest persisted model. Null when unavailable. This is not per-turn execution telemetry. */
  model?: string | null;
  /** Model provider used for this thread (for example, 'openai'). */
  modelProvider: string;
  /** Optional user-facing thread title. */
  name?: string | null;
  /** Originator recorded when the thread was created, independent of its current client or executor. Null when the recorded originator is unavailable. */
  originator?: string | null;
  /** The ID of the parent thread. This will only be set if this thread is a subagent. */
  parentThreadId?: string | null;
  /** [UNSTABLE] Path to the thread on disk. */
  path?: string | null;
  /** Usually the first user message in the thread, if available. */
  preview: string;
  /** Canonical project assignment owned by app-server, if any. */
  projectId: string | null;
  /** Current configured reasoning effort when loaded, otherwise the latest persisted effort. Null when unset or unavailable. This is not per-turn execution telemetry. */
  reasoningEffort?: V2ReasoningEffort | null;
  /** Unix timestamp (in seconds) used for thread recency ordering. */
  recencyAt?: number | null;
  /** The independently persisted section selected for this thread, if any. */
  section?: V2ThreadSection | null;
  /** Unix timestamp in seconds when the thread entered its current section. */
  sectionEnteredAt?: number | null;
  /** Session id shared by threads that belong to the same session tree. */
  sessionId: string;
  /** Origin of the thread (CLI, VSCode, codex exec, codex app-server, etc.). */
  source: V2SessionSource;
  /** Current runtime status for the thread. */
  status: V2ThreadStatus;
  /** Optional analytics source classification for this thread. */
  threadSource?: V2ThreadSource | null;
  /** Only populated on `thread/resume`, `thread/rollback`, `thread/fork`, and `thread/read` (when `includeTurns` is true) responses. For all other responses and notifications returning a Thread, the turns field will be an empty list. */
  turns: Array<V2Turn>;
  /** Unix timestamp (in seconds) when the thread was last updated. */
  updatedAt: number;
};

export type V2ThreadActiveFlag = "waitingOnApproval" | "waitingOnUserInput";

export type V2ThreadApproveGuardianDeniedActionParams = {
  /** Serialized `codex_protocol::protocol::GuardianAssessmentEvent`. */
  event: unknown;
  threadId: string;
};

export type V2ThreadApproveGuardianDeniedActionResponse = Record<string, unknown>;

export type V2ThreadArchiveParams = {
  threadId: string;
};

export type V2ThreadArchiveResponse = Record<string, unknown>;

export type V2ThreadArchivedNotification = {
  threadId: string;
};

export type V2ThreadClosedNotification = {
  threadId: string;
};

export type V2ThreadCompactStartParams = {
  threadId: string;
};

export type V2ThreadCompactStartResponse = Record<string, unknown>;

export type V2ThreadDeleteParams = {
  threadId: string;
};

export type V2ThreadDeleteResponse = Record<string, unknown>;

export type V2ThreadDeletedNotification = {
  threadId: string;
};

/** An environment selected by a loaded thread, independent of connection status. */
export type V2ThreadEnvironment = {
  cwd: V2LegacyAppPathString;
  environmentId: string;
  runtimeWorkspaceRoots: Array<V2LegacyAppPathString>;
};

/** Extra app-server data for a thread. */
export type V2ThreadExtra = Record<string, unknown>;

/**
 * There are two ways to fork a thread: 1. By thread_id: load the thread from disk by thread_id and fork it into a new thread. 2. By path: load the thread from disk by path and fork it into a new thread.
 *
 * If using a non-empty path, the thread_id param will be ignored. Empty string path values are treated as absent.
 *
 * Prefer using thread_id whenever possible.
 */
export type V2ThreadForkParams = {
  approvalPolicy?: V2AskForApproval | null;
  /** Override where approval requests are routed for review on this thread and subsequent turns. */
  approvalsReviewer?: V2ApprovalsReviewer | null;
  baseInstructions?: string | null;
  config?: Record<string, unknown> | null;
  cwd?: string | null;
  developerInstructions?: string | null;
  ephemeral?: boolean;
  /** When true, return only thread metadata and live fork state without populating `thread.turns`. This is useful when the client plans to call `thread/turns/list` immediately after forking. Full-history hydration is deprecated for paginated threads; use this with `thread/turns/list` and `thread/items/list` instead. */
  excludeTurns?: boolean;
  /**
   * Optional last turn id to fork through, inclusive.
   *
   * When specified, turns after `last_turn_id` are omitted from the fork. The referenced turn cannot be in progress.
   */
  lastTurnId?: string | null;
  /** Configuration overrides for the forked thread, if any. */
  model?: string | null;
  modelProvider?: string | null;
  sandbox?: V2SandboxMode | null;
  serviceTier?: string | null;
  threadId: string;
  /** Optional client-supplied analytics source classification for this forked thread. */
  threadSource?: V2ThreadSource | null;
};

export type V2ThreadForkResponse = {
  approvalPolicy: V2AskForApproval;
  /** Reviewer currently used for approval requests on this thread. */
  approvalsReviewer: V2ApprovalsReviewer;
  cwd: V2AbsolutePathBuf;
  /** Environment-native paths to instruction source files currently loaded for this thread. */
  instructionSources?: Array<V2LegacyAppPathString>;
  model: string;
  modelProvider: string;
  reasoningEffort?: V2ReasoningEffort | null;
  /** Legacy sandbox policy retained for compatibility. Experimental clients should prefer `activePermissionProfile` for profile provenance. */
  sandbox: V2SandboxPolicy;
  serviceTier?: string | null;
  thread: V2Thread;
};

export type V2ThreadGoal = {
  createdAt: number;
  objective: string;
  status: V2ThreadGoalStatus;
  threadId: string;
  timeUsedSeconds: number;
  tokenBudget?: number | null;
  tokensUsed: number;
  updatedAt: number;
};

export type V2ThreadGoalClearParams = {
  threadId: string;
};

export type V2ThreadGoalClearResponse = {
  cleared: boolean;
};

export type V2ThreadGoalClearedNotification = {
  threadId: string;
};

export type V2ThreadGoalGetParams = {
  threadId: string;
};

export type V2ThreadGoalGetResponse = {
  goal?: V2ThreadGoal | null;
};

export type V2ThreadGoalSetParams = {
  objective?: string | null;
  status?: V2ThreadGoalStatus | null;
  threadId: string;
  tokenBudget?: number | null;
};

export type V2ThreadGoalSetResponse = {
  goal: V2ThreadGoal;
};

export type V2ThreadGoalStatus = "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";

export type V2ThreadGoalUpdatedNotification = {
  goal: V2ThreadGoal;
  threadId: string;
  turnId?: string | null;
};

export type V2ThreadHistoryMode = "legacy" | "paginated";

export type V2ThreadId = string;

export type V2ThreadInjectItemsParams = {
  /** Raw Responses API items to append to the thread's model-visible history. */
  items: Array<unknown>;
  threadId: string;
};

export type V2ThreadInjectItemsResponse = Record<string, unknown>;

export type V2ThreadItem = ({
  clientId?: string | null;
  content: Array<V2UserInput>;
  id: string;
  type: "userMessage";
}) | {
  fragments: Array<V2HookPromptFragment>;
  id: string;
  type: "hookPrompt";
} | ({
  delivery?: V2AgentMessageDelivery | null;
  id: string;
  memoryCitation?: V2MemoryCitation | null;
  phase?: V2MessagePhase | null;
  questions?: Array<V2AsyncUserInputQuestion> | null;
  text: string;
  type: "agentMessage";
}) | ({
  id: string;
  name: string;
  namespace?: string | null;
  output: V2FunctionCallOutputBody;
  type: "functionCallOutput";
}) | {
  id: string;
  text: string;
  type: "plan";
} | {
  content?: Array<string>;
  id: string;
  summary?: Array<string>;
  type: "reasoning";
} | ({
  /** The command's output, aggregated from stdout and stderr. */
  aggregatedOutput?: string | null;
  /** The command to be executed. */
  command: string;
  /** A best-effort parsing of the command to understand the action(s) it will perform. This returns a list of CommandAction objects because a single shell command may be composed of many commands piped together. */
  commandActions: Array<V2CommandAction>;
  /** The command's working directory. */
  cwd: V2LegacyAppPathString;
  /** The duration of the command execution in milliseconds. */
  durationMs?: number | null;
  /** The command's exit code. */
  exitCode?: number | null;
  id: string;
  /** Trusted first-party plugin id when this command resolves to one plugin script. */
  pluginId?: string | null;
  /** Identifier for the underlying PTY process (when available). */
  processId?: string | null;
  /** Safe plugin-relative path when this command resolves to one plugin script. */
  scriptPath?: string | null;
  source?: V2CommandExecutionSource;
  status: V2CommandExecutionStatus;
  type: "commandExecution";
}) | {
  changes: Array<V2FileUpdateChange>;
  id: string;
  status: V2PatchApplyStatus;
  type: "fileChange";
} | ({
  appContext?: V2McpToolCallAppContext | null;
  arguments: unknown;
  /** The duration of the MCP tool call in milliseconds. */
  durationMs?: number | null;
  error?: V2McpToolCallError | null;
  id: string;
  /** Deprecated: use `appContext.resourceUri` instead. */
  mcpAppResourceUri?: string | null;
  pluginId?: string | null;
  readOnlyHint?: boolean | null;
  result?: V2McpToolCallResult | null;
  server: string;
  status: V2McpToolCallStatus;
  tool: string;
  type: "mcpToolCall";
}) | ({
  arguments: unknown;
  contentItems?: Array<V2DynamicToolCallOutputContentItem> | null;
  /** The duration of the dynamic tool call in milliseconds. */
  durationMs?: number | null;
  id: string;
  namespace?: string | null;
  status: V2DynamicToolCallStatus;
  success?: boolean | null;
  tool: string;
  type: "dynamicToolCall";
}) | ({
  /** Last known status of the target agents, when available. */
  agentsStates: Record<string, V2CollabAgentState>;
  /** Unique identifier for this collab tool call. */
  id: string;
  /** Model requested for the spawned agent, when applicable. */
  model?: string | null;
  /** Prompt text sent as part of the collab tool call, when available. */
  prompt?: string | null;
  /** Reasoning effort requested for the spawned agent, when applicable. */
  reasoningEffort?: V2ReasoningEffort | null;
  /** Thread ID of the receiving agent, when applicable. In case of spawn operation, this corresponds to the newly spawned agent. */
  receiverThreadIds: Array<string>;
  /** Thread ID of the agent issuing the collab request. */
  senderThreadId: string;
  /** Current status of the collab tool call. */
  status: V2CollabAgentToolCallStatus;
  /** Name of the collab tool that was invoked. */
  tool: V2CollabAgentTool;
  type: "collabAgentToolCall";
}) | {
  agentPath: string;
  agentThreadId: string;
  id: string;
  kind: V2SubAgentActivityKind;
  type: "subAgentActivity";
} | ({
  action?: V2WebSearchAction | null;
  id: string;
  query: string;
  /**
   * Structured search results returned out-of-band by standalone web search.
   *
   * These stay as opaque JSON at the extension/app-server boundary so new result fields and result types can pass through without a Codex release.
   */
  results?: Array<unknown> | null;
  type: "webSearch";
}) | {
  id: string;
  path: V2LegacyAppPathString;
  type: "imageView";
} | {
  durationMs: number;
  id: string;
  type: "sleep";
} | ({
  failure?: V2ImageGenerationFailure | null;
  id: string;
  result: string;
  revisedPrompt?: string | null;
  savedPath?: V2AbsolutePathBuf | null;
  status: string;
  transparentBackground?: boolean | null;
  type: "imageGeneration";
}) | {
  id: string;
  review: string;
  type: "enteredReviewMode";
} | {
  id: string;
  review: string;
  type: "exitedReviewMode";
} | {
  id: string;
  type: "contextCompaction";
};

export type V2ThreadItemEntry = {
  item: V2ThreadItem;
  /** Turn containing this item. */
  turnId: string;
};

export type V2ThreadItemsListParams = {
  /** Opaque cursor to pass to the next call to continue after the last item. */
  cursor?: string | null;
  /** Optional item page size. */
  limit?: number | null;
  /** Optional item pagination direction; defaults to ascending. */
  sortDirection?: V2SortDirection | null;
  threadId: string;
  /** Optional turn id to filter by. When omitted, returns items across the thread. */
  turnId?: string | null;
};

export type V2ThreadItemsListResponse = {
  /** Opaque cursor to pass as `cursor` when reversing `sortDirection`. This is only populated when the page contains at least one item. */
  backwardsCursor?: string | null;
  data: Array<V2ThreadItemEntry>;
  /** Opaque cursor to pass to the next call to continue after the last item. if None, there are no more items to return. */
  nextCursor?: string | null;
};

export type V2ThreadListCwdFilter = string | Array<string>;

export type V2ThreadListParams = {
  /** Optional archived filter; when set to true, only archived threads are returned. If false or null, only non-archived threads are returned. */
  archived?: boolean | null;
  /** Opaque pagination cursor returned by a previous call. */
  cursor?: string | null;
  /** Optional cwd filter or filters; when set, only threads whose session cwd exactly matches one of these paths are returned. */
  cwd?: V2ThreadListCwdFilter | null;
  /** Optional page size; defaults to a reasonable server-side value. */
  limit?: number | null;
  /** Optional provider filter; when set, only sessions recorded under these providers are returned. When present but empty, includes all providers. */
  modelProviders?: Array<string> | null;
  /** Optional originator allowlist, matching any supplied value exactly. Supported by hosted backends only; the local app-server rejects a nonempty list. Omitted or empty lists leave originators unrestricted. */
  originators?: Array<string> | null;
  /** Optional substring filter for the extracted thread title. */
  searchTerm?: string | null;
  /** Omit to include every section, set to `null` for unsectioned threads, or provide a section ID to return only threads in that section. */
  sectionId?: string | null;
  /** Optional sort direction; defaults to descending (newest first). */
  sortDirection?: V2SortDirection | null;
  /** Optional sort key; defaults to created_at. */
  sortKey?: V2ThreadSortKey | null;
  /** Optional source filter; when set, only sessions from these source kinds are returned. When omitted or empty, defaults to interactive sources. */
  sourceKinds?: Array<V2ThreadSourceKind> | null;
  /** If true, return from the state DB without scanning JSONL rollouts to repair thread metadata. Omitted or false preserves scan-and-repair behavior. */
  useStateDbOnly?: boolean;
};

export type V2ThreadListResponse = {
  /** Opaque cursor to pass as `cursor` when reversing `sortDirection`. This is only populated when the page contains at least one thread. Use it with the opposite `sortDirection`; for timestamp sorts it anchors at the start of the page timestamp so same-second updates are not skipped. */
  backwardsCursor?: string | null;
  data: Array<V2Thread>;
  /** Opaque cursor to pass to the next call to continue after the last item. if None, there are no more items to return. */
  nextCursor?: string | null;
};

export type V2ThreadLoadedListParams = {
  /** Opaque pagination cursor returned by a previous call. */
  cursor?: string | null;
  /** Optional page size; defaults to no limit. */
  limit?: number | null;
};

export type V2ThreadLoadedListResponse = {
  /** Thread ids for sessions currently loaded in memory. */
  data: Array<string>;
  /** Opaque cursor to pass to the next call to continue after the last item. if None, there are no more items to return. */
  nextCursor?: string | null;
};

export type V2ThreadMemoryMode = "enabled" | "disabled";

export type V2ThreadMetadataGitInfoUpdateParams = {
  /** Omit to leave the stored branch unchanged, set to `null` to clear it, or provide a non-empty string to replace it. */
  branch?: string | null;
  /** Omit to leave the stored origin URL unchanged, set to `null` to clear it, or provide a non-empty string to replace it. */
  originUrl?: string | null;
  /** Omit to leave the stored commit unchanged, set to `null` to clear it, or provide a non-empty string to replace it. */
  sha?: string | null;
};

export type V2ThreadMetadataUpdateParams = {
  /** Patch the stored Git metadata for this thread. Omit a field to leave it unchanged, set it to `null` to clear it, or provide a string to replace the stored value. */
  gitInfo?: V2ThreadMetadataGitInfoUpdateParams | null;
  threadId: string;
};

export type V2ThreadMetadataUpdateResponse = {
  thread: V2Thread;
};

export type V2ThreadNameUpdatedNotification = {
  threadId: string;
  threadName?: string | null;
};

export type V2ThreadProjectUpdatedNotification = {
  projectId: string | null;
  threadId: string;
};

export type V2ThreadQueueChangedNotification = {
  threadId: string;
};

export type V2ThreadReadParams = {
  /** When true, include turns and their items from rollout history. Full-history hydration is deprecated for paginated threads; prefer a metadata-only read and page with `thread/turns/list` and `thread/items/list`. */
  includeTurns?: boolean;
  threadId: string;
};

export type V2ThreadReadResponse = {
  thread: V2Thread;
};

/** EXPERIMENTAL - thread realtime audio chunk. */
export type V2ThreadRealtimeAudioChunk = {
  data: string;
  itemId?: string | null;
  numChannels: number;
  sampleRate: number;
  samplesPerChannel?: number | null;
};

/** EXPERIMENTAL - how an existing agent item appears in a realtime conversation. */
export type V2ThreadRealtimeBemItemPresentation = {
  type: "wholeItem";
} | {
  type: "inlineMarkdown";
} | {
  index: number;
  type: "inlineVisualization";
};

/** EXPERIMENTAL - emitted when thread realtime transport closes. */
export type V2ThreadRealtimeClosedNotification = {
  reason?: string | null;
  threadId: string;
};

/** EXPERIMENTAL - emitted when thread realtime encounters an error. */
export type V2ThreadRealtimeErrorNotification = {
  message: string;
  threadId: string;
};

/** EXPERIMENTAL - role-bearing text item included when a realtime V3 session starts. */
export type V2ThreadRealtimeInitialItem = {
  role: V2ConversationTextRole;
  text: string;
};

/** EXPERIMENTAL - a thread-scoped realtime item in the canonical timeline. */
export type V2ThreadRealtimeItem = {
  type: "realtimeSessionStarted";
} | {
  role: V2ThreadRealtimeTranscriptRole;
  text: string;
  type: "transcriptSegment";
} | {
  item_id: string;
  presentation: V2ThreadRealtimeBemItemPresentation;
  turn_id: string;
  type: "bemItemPromoted";
} | {
  outcome: V2ThreadRealtimeSessionOutcome;
  type: "realtimeSessionClosed";
};

/** EXPERIMENTAL - raw non-audio thread realtime item emitted by the backend. */
export type V2ThreadRealtimeItemAddedNotification = {
  item: unknown;
  threadId: string;
};

/** EXPERIMENTAL - a realtime timeline item published after canonical commit. */
export type V2ThreadRealtimeItemCompletedNotification = {
  item: V2ThreadRealtimeItem;
  threadId: string;
};

/** EXPERIMENTAL - a realtime timeline item started before its content streams. */
export type V2ThreadRealtimeItemStartedNotification = {
  item: V2ThreadRealtimeItem;
  threadId: string;
};

/** EXPERIMENTAL - text appended to an active realtime transcript item. */
export type V2ThreadRealtimeItemTranscriptDeltaNotification = {
  delta: string;
  itemId: string;
  threadId: string;
};

/** EXPERIMENTAL - streamed output audio emitted by thread realtime. */
export type V2ThreadRealtimeOutputAudioDeltaNotification = {
  audio: V2ThreadRealtimeAudioChunk;
  threadId: string;
};

/** EXPERIMENTAL - emitted with the remote SDP for a WebRTC realtime session. */
export type V2ThreadRealtimeSdpNotification = {
  sdp: string;
  threadId: string;
};

export type V2ThreadRealtimeSessionOutcome = "ended" | "failed";

/** EXPERIMENTAL - transport used by thread realtime. */
export type V2ThreadRealtimeStartTransport = {
  type: "websocket";
} | {
  /** SDP offer generated by a WebRTC RTCPeerConnection after configuring audio and the realtime events data channel. */
  sdp: string;
  type: "webrtc";
} | {
  /** Identifier of a realtime call already created and negotiated by the client. */
  callId: string;
  type: "existingCall";
};

/** EXPERIMENTAL - emitted when thread realtime startup is accepted. */
export type V2ThreadRealtimeStartedNotification = {
  realtimeSessionId?: string | null;
  threadId: string;
  version: V2RealtimeConversationVersion;
};

/** EXPERIMENTAL - flat transcript delta emitted whenever realtime transcript text changes. */
export type V2ThreadRealtimeTranscriptDeltaNotification = {
  /** Live transcript delta from the realtime event. */
  delta: string;
  role: string;
  threadId: string;
};

/** EXPERIMENTAL - final transcript text emitted when realtime completes a transcript part. */
export type V2ThreadRealtimeTranscriptDoneNotification = {
  role: string;
  /** Final complete text for the transcript part. */
  text: string;
  threadId: string;
};

export type V2ThreadRealtimeTranscriptRole = "user" | "assistant";

export type V2ThreadResumeInitialTurnsPageParams = {
  /** How much item detail to include for each returned turn; defaults to summary. */
  itemsView?: V2TurnItemsView | null;
  /** Optional turn page size. */
  limit?: number | null;
  /** Optional turn pagination direction; defaults to descending. */
  sortDirection?: V2SortDirection | null;
};

/**
 * There are three ways to resume a thread: 1. By thread_id: load the thread from disk by thread_id and resume it. 2. By history: instantiate the thread from memory and resume it. 3. By path: load the thread from disk by path and resume it.
 *
 * For non-running threads, the precedence is: history > non-empty path > thread_id. If using history or a non-empty path for a non-running thread, the thread_id param will be ignored.
 *
 * If thread_id identifies a running thread, app-server rejoins that thread and treats a non-empty path as a consistency check against the active rollout path. Empty string path values are treated as absent.
 *
 * Prefer using thread_id whenever possible.
 */
export type V2ThreadResumeParams = {
  approvalPolicy?: V2AskForApproval | null;
  /** Override where approval requests are routed for review on this thread and subsequent turns. */
  approvalsReviewer?: V2ApprovalsReviewer | null;
  baseInstructions?: string | null;
  config?: Record<string, unknown> | null;
  cwd?: string | null;
  developerInstructions?: string | null;
  /** When true, return only thread metadata and live-resume state without populating `thread.turns`. This is useful when the client plans to call `thread/turns/list` immediately after resuming. Full-history hydration is deprecated for paginated threads; use this with `thread/turns/list` and `thread/items/list` instead. */
  excludeTurns?: boolean;
  /** Configuration overrides for the resumed thread, if any. */
  model?: string | null;
  modelProvider?: string | null;
  personality?: V2Personality | null;
  sandbox?: V2SandboxMode | null;
  serviceTier?: string | null;
  threadId: string;
};

export type V2ThreadResumeResponse = {
  approvalPolicy: V2AskForApproval;
  /** Reviewer currently used for approval requests on this thread. */
  approvalsReviewer: V2ApprovalsReviewer;
  cwd: V2AbsolutePathBuf;
  /** Environment-native paths to instruction source files currently loaded for this thread. */
  instructionSources?: Array<V2LegacyAppPathString>;
  /**
   * Opaque cursor for hydrating paginated items backwards.
   *
   * Pass this as `cursor` to `thread/items/list` with `sortDirection: "desc"`. The first page includes the item identified by the cursor.
   */
  itemsBackwardsCursor?: string | null;
  model: string;
  modelProvider: string;
  reasoningEffort?: V2ReasoningEffort | null;
  /** Legacy sandbox policy retained for compatibility. Experimental clients should prefer `activePermissionProfile` for profile provenance. */
  sandbox: V2SandboxPolicy;
  serviceTier?: string | null;
  thread: V2Thread;
  /**
   * Opaque cursor for hydrating paginated turns backwards.
   *
   * Pass this as `cursor` to `thread/turns/list` with `sortDirection: "desc"`. The first page includes the turn identified by the cursor.
   */
  turnsBackwardsCursor?: string | null;
};

/**
 * Replace a paginated thread's durable history with the prefix before one turn.
 *
 * This only changes persisted conversation history. It does not revert local file changes.
 */
export type V2ThreadRevertParams = {
  /** Turn excluded from the replacement history, together with every later turn. */
  beforeTurnId: string;
  threadId: string;
};

export type V2ThreadRevertResponse = {
  /**
   * Opaque cursor for hydrating paginated items backwards.
   *
   * Pass this as `cursor` to `thread/items/list` with `sortDirection: "desc"`. The first page includes the item identified by the cursor.
   */
  itemsBackwardsCursor?: string | null;
  /** Updated loaded thread metadata. `turns` is always empty; hydrate retained history through `thread/turns/list`. */
  thread: V2Thread;
  /**
   * Opaque cursor for hydrating paginated turns backwards.
   *
   * Pass this as `cursor` to `thread/turns/list` with `sortDirection: "desc"`. The first page includes the turn identified by the cursor.
   */
  turnsBackwardsCursor?: string | null;
};

export type V2ThreadRevertedNotification = {
  threadId: string;
};

/** DEPRECATED: `thread/rollback` will be removed soon. */
export type V2ThreadRollbackParams = {
  /**
   * The number of turns to drop from the end of the thread. Must be >= 1.
   *
   * This only modifies the thread's history and does not revert local file changes that have been made by the agent. Clients are responsible for reverting these changes.
   */
  numTurns: number;
  threadId: string;
};

export type V2ThreadRollbackResponse = {
  /**
   * The updated thread after applying the rollback, with `turns` populated.
   *
   * The ThreadItems stored in each Turn are lossy since we explicitly do not persist all agent interactions, such as command executions. This is the same behavior as `thread/resume`.
   */
  thread: V2Thread;
};

export type V2ThreadSearchResult = {
  snippet: string;
  thread: V2Thread;
};

export type V2ThreadSearchSortKey = "created_at" | "updated_at" | "recency_at";

/** An independently persisted, user-visible thread section. */
export type V2ThreadSection = {
  /** Optional appearance synchronized across clients. */
  appearance?: V2ThreadSectionAppearance | null;
  /** Opaque UUIDv7 identity that remains stable when the section is renamed. */
  id: string;
  /** The current user-visible section name. */
  name: string;
};

/** Extensible visual presentation for a custom thread section. */
export type V2ThreadSectionAppearance = {
  color?: string | null;
  icon?: string | null;
};

/** Parameters for creating an independently persisted thread section. */
export type V2ThreadSectionCreateParams = {
  appearance?: V2ThreadSectionAppearance | null;
  /** The user-visible name of the section. */
  name: string;
};

/** The independently persisted section created by the server. */
export type V2ThreadSectionCreateResponse = {
  section: V2ThreadSection;
};

/** Parameters for deleting an independently persisted thread section. */
export type V2ThreadSectionDeleteParams = {
  /** The stable, server-generated identity of the section to delete. */
  sectionId: string;
};

/** Successful deletion does not return additional section data. */
export type V2ThreadSectionDeleteResponse = Record<string, unknown>;

/** Parameters for listing independently persisted thread sections. */
export type V2ThreadSectionListParams = {
  /** Opaque pagination cursor returned by a previous call. */
  cursor?: string | null;
  /** Maximum number of sections to return. */
  limit?: number | null;
};

/** One page of independently persisted thread sections. */
export type V2ThreadSectionListResponse = {
  data: Array<V2ThreadSection>;
  /** Opaque cursor for the next page, or `null` when no sections remain. */
  nextCursor?: string | null;
};

/** Parameters for moving a thread within a server-owned section ordering. */
export type V2ThreadSectionMoveParams = {
  /** Existing thread to insert before; omission or null appends to the section. */
  beforeThreadId?: string | null;
  /** Destination section, or `null` to remove the thread from its section. */
  sectionId: string | null;
  /** Thread to move into, within, or out of a section. */
  threadId: string;
};

export type V2ThreadSectionMoveResponse = Record<string, unknown>;

/** Parameters for updating an independently persisted thread section. */
export type V2ThreadSectionUpdateParams = {
  /** Omit to preserve appearance, use `null` to clear it, or provide a replacement. */
  appearance?: V2ThreadSectionAppearance | null;
  /** The updated user-visible name of the section. */
  name: string;
  /** The stable, server-generated identity of the section to update. */
  sectionId: string;
};

/** The independently persisted section after its name is updated. */
export type V2ThreadSectionUpdateResponse = {
  section: V2ThreadSection;
};

export type V2ThreadSetNameParams = {
  name: string;
  threadId: string;
};

export type V2ThreadSetNameResponse = Record<string, unknown>;

export type V2ThreadSettings = {
  activePermissionProfile?: V2ActivePermissionProfile | null;
  approvalPolicy: V2AskForApproval;
  approvalsReviewer: V2ApprovalsReviewer;
  collaborationMode: V2CollaborationMode;
  cwd: V2AbsolutePathBuf;
  effort?: V2ReasoningEffort | null;
  model: string;
  modelProvider: string;
  personality?: V2Personality | null;
  sandboxPolicy: V2SandboxPolicy;
  serviceTier?: string | null;
  summary?: V2ReasoningSummary | null;
};

export type V2ThreadSettingsUpdatedNotification = {
  threadId: string;
  threadSettings: V2ThreadSettings;
};

export type V2ThreadShellCommandParams = {
  /** Shell command string evaluated by the thread's configured shell. Unlike `command/exec`, this intentionally preserves shell syntax such as pipes, redirects, and quoting. This runs unsandboxed with full access rather than inheriting the thread sandbox policy. */
  command: string;
  threadId: string;
  /** Maximum execution time in milliseconds. Defaults to one hour when omitted or null. Must be non-negative; zero requests an immediate timeout, not unlimited execution. Does not affect the immediate RPC acknowledgement. */
  timeoutMs?: number | null;
};

export type V2ThreadShellCommandResponse = Record<string, unknown>;

export type V2ThreadSortKey = "created_at" | "updated_at" | "recency_at" | "section_position";

export type V2ThreadSource = string;

export type V2ThreadSourceKind = "cli" | "vscode" | "exec" | "appServer" | "subAgent" | "subAgentReview" | "subAgentCompact" | "subAgentThreadSpawn" | "subAgentOther" | "unknown";

export type V2ThreadStartParams = {
  approvalPolicy?: V2AskForApproval | null;
  /** Override where approval requests are routed for review on this thread and subsequent turns. */
  approvalsReviewer?: V2ApprovalsReviewer | null;
  baseInstructions?: string | null;
  config?: Record<string, unknown> | null;
  cwd?: string | null;
  developerInstructions?: string | null;
  ephemeral?: boolean | null;
  model?: string | null;
  modelProvider?: string | null;
  personality?: V2Personality | null;
  sandbox?: V2SandboxMode | null;
  serviceName?: string | null;
  serviceTier?: string | null;
  sessionStartSource?: V2ThreadStartSource | null;
  /** Optional client-supplied analytics source classification for this thread. */
  threadSource?: V2ThreadSource | null;
};

export type V2ThreadStartResponse = {
  approvalPolicy: V2AskForApproval;
  /** Reviewer currently used for approval requests on this thread. */
  approvalsReviewer: V2ApprovalsReviewer;
  cwd: V2AbsolutePathBuf;
  /** Environment-native paths to instruction source files currently loaded for this thread. */
  instructionSources?: Array<V2LegacyAppPathString>;
  model: string;
  modelProvider: string;
  reasoningEffort?: V2ReasoningEffort | null;
  /** Legacy sandbox policy retained for compatibility. Experimental clients should prefer `activePermissionProfile` for profile provenance. */
  sandbox: V2SandboxPolicy;
  serviceTier?: string | null;
  thread: V2Thread;
};

export type V2ThreadStartSource = "startup" | "clear";

export type V2ThreadStartedNotification = {
  thread: V2Thread;
};

export type V2ThreadStatus = {
  type: "notLoaded";
} | {
  type: "idle";
} | {
  type: "systemError";
} | {
  activeFlags: Array<V2ThreadActiveFlag>;
  type: "active";
};

export type V2ThreadStatusChangedNotification = {
  status: V2ThreadStatus;
  threadId: string;
};

/** EXPERIMENTAL - one item or turn boundary in canonical rollout order. */
export type V2ThreadTimelineEntry = {
  item: V2ThreadItem;
  position: number;
  turnId: string;
  type: "item";
} | {
  item: V2ThreadRealtimeItem;
  position: number;
  type: "realtime";
} | ({
  position: number;
  started_at?: number | null;
  turn_id: string;
  type: "turnStarted";
}) | ({
  completed_at?: number | null;
  duration_ms?: number | null;
  error?: V2TurnError | null;
  position: number;
  started_at?: number | null;
  status: V2TurnStatus;
  turn_id: string;
  type: "turnCompleted";
});

export type V2ThreadTokenUsage = {
  last: V2TokenUsageBreakdown;
  modelContextWindow?: number | null;
  total: V2TokenUsageBreakdown;
};

export type V2ThreadTokenUsageUpdatedNotification = {
  threadId: string;
  tokenUsage: V2ThreadTokenUsage;
  turnId: string;
};

export type V2ThreadTurnsListParams = {
  /** Opaque cursor to pass to the next call to continue after the last turn. */
  cursor?: string | null;
  /** How much item detail to include for each returned turn; defaults to summary. */
  itemsView?: V2TurnItemsView | null;
  /** Optional turn page size. */
  limit?: number | null;
  /** Optional turn pagination direction; defaults to descending. */
  sortDirection?: V2SortDirection | null;
  threadId: string;
};

export type V2ThreadTurnsListResponse = {
  /** Opaque cursor to pass as `cursor` when reversing `sortDirection`. This is only populated when the page contains at least one turn. Use it with the opposite `sortDirection` to include the anchor turn again and catch updates to that turn. */
  backwardsCursor?: string | null;
  data: Array<V2Turn>;
  /** Opaque cursor to pass to the next call to continue after the last turn. if None, there are no more turns to return. */
  nextCursor?: string | null;
};

export type V2ThreadUnarchiveParams = {
  threadId: string;
};

export type V2ThreadUnarchiveResponse = {
  thread: V2Thread;
};

export type V2ThreadUnarchivedNotification = {
  threadId: string;
};

export type V2ThreadUnsubscribeParams = {
  threadId: string;
};

export type V2ThreadUnsubscribeResponse = {
  status: V2ThreadUnsubscribeStatus;
};

export type V2ThreadUnsubscribeStatus = "notLoaded" | "notSubscribed" | "unsubscribed";

export type V2ThreadUsage = {
  estimatedUsageCreditsMicros: number;
  estimatedUsageUsdMicros?: number | null;
  groups: Array<V2ThreadUsageBreakdownGroup>;
  threadId: string;
};

export type V2ThreadUsageBreakdownGroup = {
  cachedInputTokens?: number | null;
  estimatedUsageCreditsMicros: number;
  inputTokens?: number | null;
  model?: string | null;
  netNewInputTokens?: number | null;
  outputTokens?: number | null;
  reasoningEffort?: string | null;
  speed?: string | null;
  totalTokens?: number | null;
};

export type V2TokenUsageBreakdown = {
  cacheWriteInputTokens?: number;
  cachedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

/** Definition for a tool the client can call. */
export type V2Tool = {
  _meta?: unknown;
  annotations?: unknown;
  description?: string | null;
  icons?: Array<unknown> | null;
  inputSchema: unknown;
  name: string;
  outputSchema?: unknown;
  title?: string | null;
};

export type V2ToolsV2 = {
  web_search?: V2WebSearchToolConfig | null;
};

export type V2Turn = {
  /** Unix timestamp (in seconds) when the turn completed. */
  completedAt?: number | null;
  /** Duration between turn start and completion in milliseconds, if known. */
  durationMs?: number | null;
  /** Only populated when the Turn's status is failed. */
  error?: V2TurnError | null;
  /** Identifier for this turn. Codex-generated turn IDs are UUIDv7. */
  id: string;
  /** Thread items currently included in this turn payload. */
  items: Array<V2ThreadItem>;
  /** Describes how much of `items` has been loaded for this turn. */
  itemsView?: V2TurnItemsView;
  /** Unix timestamp (in seconds) when the turn started. */
  startedAt?: number | null;
  status: V2TurnStatus;
};

export type V2TurnCompletedNotification = {
  threadId: string;
  turn: V2Turn;
};

/** Notification that the turn-level unified diff has changed. Contains the latest aggregated diff across all file changes in the turn. */
export type V2TurnDiffUpdatedNotification = {
  diff: string;
  threadId: string;
  turnId: string;
};

export type V2TurnEnvironmentParams = {
  cwd: V2LegacyAppPathString;
  environmentId: string;
  /** Environment-native runtime workspace roots. Omitted defaults to `cwd`. */
  runtimeWorkspaceRoots?: Array<V2LegacyAppPathString> | null;
};

export type V2TurnError = {
  additionalDetails?: string | null;
  codexErrorInfo?: V2CodexErrorInfo | null;
  message: string;
  /** Optional public explanation and continuation instruction for a misalignment block. */
  misalignment?: V2MisalignmentErrorDetails | null;
};

export type V2TurnInterruptParams = {
  threadId: string;
  turnId: string;
};

export type V2TurnInterruptResponse = Record<string, unknown>;

export type V2TurnItemsView = "notLoaded" | "summary" | "full";

export type V2TurnModerationMetadataNotification = {
  metadata: unknown;
  threadId: string;
  turnId: string;
};

export type V2TurnPlanStep = {
  status: V2TurnPlanStepStatus;
  step: string;
};

export type V2TurnPlanStepStatus = "pending" | "inProgress" | "completed";

export type V2TurnPlanUpdatedNotification = {
  explanation?: string | null;
  plan: Array<V2TurnPlanStep>;
  threadId: string;
  turnId: string;
};

export type V2TurnStartParams = {
  /** Override the approval policy for this turn and subsequent turns. */
  approvalPolicy?: V2AskForApproval | null;
  /** Override where approval requests are routed for review on this turn and subsequent turns. */
  approvalsReviewer?: V2ApprovalsReviewer | null;
  clientUserMessageId?: string | null;
  /** Override the working directory for this turn and subsequent turns. */
  cwd?: string | null;
  /** Override the reasoning effort for this turn and subsequent turns. */
  effort?: V2ReasoningEffort | null;
  input: Array<V2UserInput>;
  /** Override the model for this turn and subsequent turns. */
  model?: string | null;
  /** Optional JSON Schema used to constrain the final assistant message for this turn. */
  outputSchema?: unknown;
  /** Override the personality for this turn and subsequent turns. */
  personality?: V2Personality | null;
  /** Override the sandbox policy for this turn and subsequent turns. */
  sandboxPolicy?: V2SandboxPolicy | null;
  /** Override the service tier for this turn and subsequent turns. */
  serviceTier?: string | null;
  /** Override the service tier only when this request starts a new turn. Use "default" for standard speed. Omitted or null inherits the thread's tier. Does not change the thread's tier or a turn being steered. */
  serviceTierForTurn?: string | null;
  /** Override the reasoning summary for this turn and subsequent turns. */
  summary?: V2ReasoningSummary | null;
  threadId: string;
  toolOutput?: V2TurnToolOutput | null;
  /** Optional source classification for the caller that starts this turn. Ignored when this request steers an already-active turn. */
  turnTrigger?: string | null;
};

export type V2TurnStartResponse = {
  turn: V2Turn;
};

export type V2TurnStartedNotification = {
  threadId: string;
  turn: V2Turn;
};

export type V2TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";

export type V2TurnSteerParams = {
  clientUserMessageId?: string | null;
  /** Required active turn id precondition. The request fails when it does not match the currently active turn. */
  expectedTurnId: string;
  input: Array<V2UserInput>;
  threadId: string;
};

export type V2TurnSteerResponse = {
  turnId: string;
};

export type V2TurnToolOutput = {
  name: string;
  namespace?: string | null;
  output: V2FunctionCallOutputBody;
};

export type V2TurnsPage = {
  backwardsCursor?: string | null;
  data: Array<V2Turn>;
  nextCursor?: string | null;
};

export type V2UserInput = {
  text: string;
  /** UI-defined spans within `text` used to render or persist special elements. */
  text_elements?: Array<V2TextElement>;
  type: "text";
} | ({
  detail?: V2ImageDetail | null;
  type: "image";
  url: string;
}) | ({
  detail?: V2ImageDetail | null;
  path: string;
  type: "localImage";
}) | {
  type: "audio";
  url: string;
} | {
  path: string;
  type: "localAudio";
} | {
  name: string;
  path: string;
  type: "skill";
} | {
  name: string;
  path: string;
  type: "mention";
};

/** Controls output length/detail on GPT-5 models via the Responses API. Serialized with lowercase values to match the OpenAI API. */
export type V2Verbosity = "low" | "medium" | "high";

export type V2WarningNotification = {
  /** Concise warning message for the user. */
  message: string;
  /** Optional thread target when the warning applies to a specific thread. */
  threadId?: string | null;
};

export type V2WebSearchAction = ({
  queries?: Array<string> | null;
  query?: string | null;
  type: "search";
}) | ({
  type: "openPage";
  url?: string | null;
}) | ({
  pattern?: string | null;
  type: "findInPage";
  url?: string | null;
}) | {
  type: "other";
};

export type V2WebSearchContextSize = "low" | "medium" | "high";

export type V2WebSearchLocation = {
  city?: string | null;
  country?: string | null;
  region?: string | null;
  timezone?: string | null;
};

export type V2WebSearchMode = "disabled" | "cached" | "indexed" | "live";

export type V2WebSearchToolConfig = {
  allowed_domains?: Array<string> | null;
  context_size?: V2WebSearchContextSize | null;
  location?: V2WebSearchLocation | null;
};

export type V2WindowsSandboxReadiness = "ready" | "notConfigured" | "updateRequired";

export type V2WindowsSandboxReadinessResponse = {
  status: V2WindowsSandboxReadiness;
};

export type V2WindowsSandboxSetupCompletedNotification = {
  error?: string | null;
  mode: V2WindowsSandboxSetupMode;
  success: boolean;
};

export type V2WindowsSandboxSetupMode = "elevated" | "unelevated";

export type V2WindowsSandboxSetupStartParams = {
  cwd?: V2AbsolutePathBuf | null;
  mode: V2WindowsSandboxSetupMode;
};

export type V2WindowsSandboxSetupStartResponse = {
  started: boolean;
};

export type V2WindowsWorldWritableWarningNotification = {
  extraCount: number;
  failedScan: boolean;
  samplePaths: Array<string>;
};

export type V2WorkspaceMessage = {
  /** Unix timestamp (in seconds) when the message was archived. */
  archivedAt?: number | null;
  /** Unix timestamp (in seconds) when the message was created. */
  createdAt?: number | null;
  messageBody: string;
  messageId: string;
  messageType: V2WorkspaceMessageType;
};

export type V2WorkspaceMessageType = "headline" | "announcement" | "unknown";

export type V2WriteStatus = "ok" | "okOverridden";

/**
 * Every JSON-RPC method name the artifact declares, grouped by the union
 * that carries it. Derived from the `method` tag on each union variant, so
 * a method renamed upstream changes this table and CI's `git diff` fails.
 */
export const CODEX_METHODS = {
  ClientNotification: [
    "initialized",
  ],
  ClientRequest: [
    "account/login/cancel",
    "account/login/start",
    "account/logout",
    "account/rateLimitResetCredit/consume",
    "account/rateLimits/read",
    "account/read",
    "account/sendAddCreditsNudgeEmail",
    "account/usage/read",
    "account/workspaceMessages/read",
    "app/installed",
    "app/list",
    "app/read",
    "command/exec",
    "command/exec/resize",
    "command/exec/terminate",
    "command/exec/write",
    "config/batchWrite",
    "config/mcpServer/reload",
    "config/read",
    "config/value/write",
    "configRequirements/read",
    "experimentalFeature/enablement/set",
    "experimentalFeature/list",
    "externalAgentConfig/detect",
    "externalAgentConfig/import",
    "externalAgentConfig/import/readHistories",
    "externalAgentConfig/import/recordHistory",
    "feedback/upload",
    "fs/copy",
    "fs/createDirectory",
    "fs/getMetadata",
    "fs/readDirectory",
    "fs/readFile",
    "fs/remove",
    "fs/unwatch",
    "fs/watch",
    "fs/writeFile",
    "fuzzyFileSearch",
    "hooks/list",
    "initialize",
    "marketplace/add",
    "marketplace/remove",
    "marketplace/upgrade",
    "mcpServer/oauth/login",
    "mcpServer/resource/read",
    "mcpServer/tool/call",
    "mcpServerStatus/list",
    "model/list",
    "modelProvider/capabilities/read",
    "permissionProfile/list",
    "plugin/install",
    "plugin/installed",
    "plugin/list",
    "plugin/read",
    "plugin/reconcile",
    "plugin/share/checkout",
    "plugin/share/delete",
    "plugin/share/list",
    "plugin/share/save",
    "plugin/share/updateTargets",
    "plugin/skill/read",
    "plugin/uninstall",
    "review/start",
    "skills/config/write",
    "skills/extraRoots/set",
    "skills/list",
    "thread/approveGuardianDeniedAction",
    "thread/archive",
    "thread/compact/start",
    "thread/delete",
    "thread/fork",
    "thread/goal/clear",
    "thread/goal/get",
    "thread/goal/set",
    "thread/inject_items",
    "thread/items/list",
    "thread/list",
    "thread/loaded/list",
    "thread/metadata/update",
    "thread/name/set",
    "thread/read",
    "thread/resume",
    "thread/revert",
    "thread/rollback",
    "thread/section/move",
    "thread/shellCommand",
    "thread/start",
    "thread/turns/list",
    "thread/unarchive",
    "thread/unsubscribe",
    "threadSection/create",
    "threadSection/delete",
    "threadSection/list",
    "threadSection/update",
    "turn/interrupt",
    "turn/start",
    "turn/steer",
    "windowsSandbox/readiness",
    "windowsSandbox/setupStart",
  ],
  ServerNotification: [
    "account/login/completed",
    "account/rateLimits/updated",
    "account/updated",
    "app/list/updated",
    "autoApprovalReview/strictReviewRequired",
    "command/exec/outputDelta",
    "configWarning",
    "deprecationNotice",
    "error",
    "externalAgentConfig/import/completed",
    "externalAgentConfig/import/progress",
    "fs/changed",
    "fuzzyFileSearch/sessionCompleted",
    "fuzzyFileSearch/sessionUpdated",
    "guardianWarning",
    "hook/completed",
    "hook/started",
    "item/agentMessage/delta",
    "item/autoApprovalReview/completed",
    "item/autoApprovalReview/started",
    "item/commandExecution/outputDelta",
    "item/commandExecution/terminalInteraction",
    "item/completed",
    "item/fileChange/outputDelta",
    "item/fileChange/patchUpdated",
    "item/mcpToolCall/progress",
    "item/plan/delta",
    "item/reasoning/summaryPartAdded",
    "item/reasoning/summaryTextDelta",
    "item/reasoning/textDelta",
    "item/started",
    "mcpServer/event/stream/notification",
    "mcpServer/oauthLogin/completed",
    "mcpServer/startupStatus/updated",
    "model/rerouted",
    "model/safetyBuffering/updated",
    "model/verification",
    "modelProvider/authRecoveryCompleted",
    "modelProvider/authRecoveryStarted",
    "process/exited",
    "process/outputDelta",
    "project/changed",
    "remoteControl/status/changed",
    "serverRequest/resolved",
    "skills/changed",
    "thread/archived",
    "thread/closed",
    "thread/compacted",
    "thread/deleted",
    "thread/environment/connected",
    "thread/environment/disconnected",
    "thread/goal/cleared",
    "thread/goal/updated",
    "thread/name/updated",
    "thread/project/updated",
    "thread/queue/changed",
    "thread/realtime/closed",
    "thread/realtime/error",
    "thread/realtime/item/completed",
    "thread/realtime/item/started",
    "thread/realtime/item/transcript/delta",
    "thread/realtime/itemAdded",
    "thread/realtime/outputAudio/delta",
    "thread/realtime/sdp",
    "thread/realtime/started",
    "thread/realtime/transcript/delta",
    "thread/realtime/transcript/done",
    "thread/reverted",
    "thread/settings/updated",
    "thread/started",
    "thread/status/changed",
    "thread/tokenUsage/updated",
    "thread/unarchived",
    "turn/completed",
    "turn/diff/updated",
    "turn/moderationMetadata",
    "turn/plan/updated",
    "turn/started",
    "warning",
    "windows/worldWritableWarning",
    "windowsSandbox/setupCompleted",
  ],
  ServerRequest: [
    "account/chatgptAuthTokens/refresh",
    "applyPatchApproval",
    "attestation/generate",
    "execCommandApproval",
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/permissions/requestApproval",
    "item/tool/call",
    "item/tool/requestUserInput",
    "mcpServer/elicitation/request",
  ],
} as const;

/** Union of every method name in the pinned artifact. */
export type CodexMethodName =
  (typeof CODEX_METHODS)[keyof typeof CODEX_METHODS][number];
