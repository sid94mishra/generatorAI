// ────────────────────────────────────────────────────────────────
// Session composition types (P02, G2 §3.1).
//
// A chat and a workflow stage are two OWNERS of the same kind of agent
// session. Everything that decides what the model can see and do is built
// by one composer from a `SessionSpec`; the owner decides only what to say
// to the model and when (the chat turn loop, the stage script).
// ────────────────────────────────────────────────────────────────

import type { AgentMode, AgentToolPolicy } from '@generatorai/shared';
import type { HookBridge } from '../../domain/ports/IHookBridge.js';
import type { HarnessPermissionMode } from '../../domain/ports/IAgentHarness.js';
import type { CustomToolRegistry } from '../../tools/CustomToolRegistry.js';
import type { IMcpHub } from '../../mcp/IMcpHub.js';
import type { WorkspaceManager } from '../WorkspaceManager.js';
import type { BrowserService } from '../BrowserService.js';
import type { ComputerService } from '../ComputerService.js';
import type { WidgetService } from '../WidgetService.js';
import type { IWidgetRegistry } from '../../domain/ports/IWidgetRegistry.js';
import type { OrchestratorService } from '../orchestrator/OrchestratorService.js';
import type { AgentResolver } from '../AgentResolver.js';
import type { AgentStagingService } from '../AgentStagingService.js';
import type { SystemArtifactService } from '../SystemArtifactService.js';
import type { AgentInteractionService } from '../AgentInteractionService.js';
import type { PlanService } from '../PlanService.js';

/** Who a session belongs to. */
export type SessionOwner =
  | {
      kind: 'chat';
      chatId: string;
      sessionId: string;
      /** Set on orchestrator workers: unattended, never orchestrators themselves. */
      parentChatId?: string;
    }
  | {
      kind: 'stage';
      stageRunId: string;
      workflowRunId: string;
      workflowDefinitionId: string;
      sessionId: string;
    };

/** The string an owner registers browser/computer/tool sessions under. */
export function ownerTag(owner: SessionOwner): string {
  return owner.kind === 'chat' ? `chat:${owner.chatId}` : `stage:${owner.stageRunId}`;
}

/** The id the owner's other services key it by (chat id / stage run id). */
export function ownerId(owner: SessionOwner): string {
  return owner.kind === 'chat' ? owner.chatId : owner.stageRunId;
}

/**
 * The platform services the composer binds into a session. One object,
 * shared BY REFERENCE by `ChatManagementService` and the composer, because
 * the composition roots wire several of these late (after the core graph is
 * built). Everything is optional: a service that is not wired simply
 * contributes nothing.
 */
export interface SessionComposerDeps {
  /** Custom/extension tools surfaced to every session (TOL-01). */
  customToolRegistry?: CustomToolRegistry;
  /** MCP hub: disable flags and `secretref:` resolution (TOL-06, W48). */
  mcpHub?: IMcpHub;
  /**
   * Synchronous hook bridge per conversation (HKS-01). Return `undefined`
   * to run without intercepts.
   */
  buildHookBridge?: (args: { owner: SessionOwner; sessionId: string; conversationId: string }) => HookBridge | undefined;
  /**
   * Resolves a `secretref:` pointer to its value (provider API keys). Returns
   * null when the secret store has no value for it.
   */
  resolveSecretRef?: (ref: string) => Promise<string | null>;
  workspaceManager?: WorkspaceManager;
  browserService?: BrowserService;
  computerService?: ComputerService;
  widgetService?: WidgetService;
  widgetRegistry?: IWidgetRegistry;
  /** Absolute base URL widget iframes fetch assets from ('' = same origin). */
  widgetAssetsBase?: string;
  orchestratorService?: OrchestratorService;
  agentResolver?: AgentResolver;
  agentStaging?: AgentStagingService;
  systemArtifacts?: SystemArtifactService;
  agentInteractionService?: AgentInteractionService;
  planService?: PlanService;
}

/**
 * A non-fatal fact about the composed session the user should see: a
 * capability the provider cannot deliver, an MCP server that was dropped.
 * Owners emit these as `harness.session_info {infoType: code}` (C-11).
 */
export interface ComposeWarning {
  code:
    | 'mcp_dropped'
    | 'computer_use_blocked_bypass'
    | 'skills_unsupported'
    | 'skills_process_global'
    | 'permission_gating_exec_and_patch'
    | 'host_tools_start_only'
    | 'host_tools_unsupported'
    | 'agent_resolution';
  message: string;
  params?: Record<string, unknown>;
}

/** Composition failed in a way the owner must surface (the stage fails). */
export class ComposeError extends Error {
  constructor(
    readonly code:
      | 'agent_not_found'
      | 'agent_disabled'
      | 'workspace_missing'
      | 'secret_unresolved'
      | 'PERMISSION_GATING_UNSUPPORTED',
    message: string,
  ) {
    super(message);
    this.name = 'ComposeError';
  }
}

/**
 * Per-turn context the gates report against. Keyed by conversation id in
 * the `TurnContextRegistry`, so a gate raised on a shared conversation is
 * filed against the owner of the turn in flight, not the owner the
 * conversation was created for.
 */
/**
 * The owner's tool policy, stamped on every turn it sends (P02 review R6). A
 * shared conversation keeps the tools of the owner that created it, so what
 * a turn may use is decided per call from the owner actually in flight.
 */
export interface TurnPolicy {
  /**
   * `switch`: the deployment switch decides (chats); `opted_in`: allowed
   * unless the turn runs on bypass (PD-5, re-read every turn); `off`: never.
   */
  computerUse: 'switch' | 'opted_in' | 'off';
  /** The owner's own agent tool groups. */
  groups?: AgentToolPolicy | undefined;
}

export interface TurnContext {
  owner: SessionOwner;
  sessionId: string;
  turnId: string;
  agentMode: AgentMode;
  /** Effective harness permission mode for this turn (pinned at send time). */
  permissionMode: HarnessPermissionMode;
  /** Plans surfaced during this turn, for transcript persistence. */
  planIds: string[];
  /** Question and permission gates opened during this turn. */
  interactionIds: string[];
  /** Ordinal shared by tool calls, text segments and cards. */
  nextSequence: number;
  /** planId | interactionId → the ordinal that card was issued. */
  cardSequence: Map<string, number>;
  /** The owner's tool policy; absent means the compose-time binding decides. */
  policy?: TurnPolicy | undefined;
}
