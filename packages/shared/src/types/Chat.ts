// ────────────────────────────────────────────────────────────────
// Chat — First-class top-level domain entity
// 1 Chat → 1 Session → 1 Harness Conversation
// ────────────────────────────────────────────────────────────────

import type { HarnessConfig } from './Workflow.js';
import type { BrowserConfig } from './BrowserSession.js';
import type { AgentMode } from './AgentMode.js';
import type { AgentOverrides, ResolvedAgentProjection } from './Agent.js';
import type { ChatSourceSpec, WorkspacePrepStatus } from './Workspace.js';

/**
 * Chat-scoped permission policy. Mirrors the harness permission modes so the
 * value can be threaded straight through to the adapter.
 */
export type ChatPermissionMode = 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan';

export const DEFAULT_CHAT_PERMISSION_MODE: ChatPermissionMode = 'bypassPermissions';

/** Chat lifecycle status */
export type ChatStatus = 'active' | 'archived';

/** A local folder path linked to a chat at creation time */
export interface ChatLocalFolder {
  url: string;
  alias: string;
}

/** Orchestrator background-task lifecycle status (a spawned worker chat). */
export type BackgroundTaskStatus =
  | 'spawned'
  | 'running'
  | 'needs_review'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Metadata attached to a chat that was spawned as a background agent task by
 * an orchestrator chat. Present only on worker chats (parentChatId set).
 */
export interface BackgroundTaskMeta {
  /** The orchestrator chat that spawned this worker. */
  orchestratorChatId: string;
  /** Human-readable, short, unique-ish name given by the orchestrator. */
  taskName: string;
  /** Zero-based index within the spawning wave (for stable ordering). */
  taskIndex?: number;
  /** Current lifecycle status of this background task. */
  status: BackgroundTaskStatus;
}

/** Chat domain entity */
export interface Chat {
  id: string;
  name: string;
  description?: string;
  sessionId: string;
  model?: string;
  /** Agent harness configuration (provider-agnostic) */
  harnessConfig?: Partial<HarnessConfig>;
  /** Project ID — scopes this chat to a project (null = global) */
  projectId?: string;
  /** Linked codebase IDs from the project */
  codebaseIds?: string[];
  /** Whether a worktree was created for this chat */
  createWorktree?: boolean;
  /** Workspace ID — links to the execution workspace for this chat */
  workspaceId?: string;
  /** Local folder paths linked at creation (legacy; superseded by `sources`) */
  gitRepositories?: ChatLocalFolder[];
  /**
   * The mount plan this chat was created with (or last updated to). The
   * workspace's mounts are derived from it; kept so an unarchived chat can be
   * re-prepared and so the UI can show what is linked.
   */
  sources?: ChatSourceSpec[];
  /** Alias of the primary mount (the agent's cwd). */
  primarySource?: string;
  /**
   * Readiness of the chat's workspace mounts. Populated on API responses;
   * `pending` / `preparing` means the first prompt will wait.
   */
  workspacePrep?: { status: WorkspacePrepStatus; error?: string };
  tags: string[];
  status: ChatStatus;
  /** Integrated Browser configuration (per-chat opt-in). */
  browserConfig?: BrowserConfig;
  /**
   * Orchestrator mode — when true, this chat runs the orchestrator system
   * prompt and gets the background-agent tool set (spawn/check/send/list).
   */
  orchestratorMode?: boolean;
  /** Set on WORKER chats: the orchestrator chat that spawned this one. */
  parentChatId?: string;
  /** Set on WORKER chats: background-task metadata. */
  backgroundTask?: BackgroundTaskMeta;
  /** The chat this one was forked from (a conversation branch, not a worker). */
  forkedFromChatId?: string;
  /** The turn of `forkedFromChatId` the fork branched after. */
  forkedAtTurnId?: string;
  /**
   * Transcript digest a SYNTHETIC rewind/fork left behind for the provider
   * (one without native branching): prepended to the next prompt once, then
   * cleared. Server-internal; never sent to clients.
   */
  conversationSeed?: string;
  /**
   * Sticky per-chat default agent mode. The composer can override it per turn.
   * Defaults to 'auto'.
   */
  defaultAgentMode?: AgentMode;
  /**
   * Chat-scoped permission policy. Defaults to 'bypassPermissions', which
   * preserves the historical fully-autonomous behaviour (no prompts).
   */
  permissionMode?: ChatPermissionMode;
  /** Portable `scope:slug` ref of the agent driving this chat. */
  agentRef?: string;
  /** Resolution cache for `agentRef`. May be stale/orphaned. */
  agentId?: string;
  /** Agent version at bind time. Part of the conversation binding key. */
  agentVersion?: number;
  /** Additive capability delta layered on top of the bound agent. */
  agentOverrides?: AgentOverrides;
  /** Frozen, redacted projection captured at session creation (audit + replay). */
  agentSnapshot?: ResolvedAgentProjection;
  createdAt: Date;
  updatedAt: Date;
}

/** Parameters for creating a new Chat */
export interface CreateChatParams {
  name: string;
  description?: string;
  model?: string;
  /** Agent harness configuration (provider-agnostic) */
  harnessConfig?: Partial<HarnessConfig>;
  /** Project ID — scopes this chat to a project */
  projectId?: string;
  /** Linked codebase IDs from the project */
  codebaseIds?: string[];
  /** Whether to create a worktree for code changes */
  createWorktree?: boolean;
  /** Whether to use a worktree (alias for createWorktree, used by workspace management) */
  useWorktree?: boolean;
  /** Local folder paths to link at creation (legacy; mapped onto `sources`) */
  gitRepositories?: ChatLocalFolder[];
  /**
   * What the agent works on: project codebases and/or local folders, each
   * mounted in place or as a worktree, optionally on a chosen branch.
   */
  sources?: ChatSourceSpec[];
  /** Alias of the primary mount; defaults to the first source. */
  primary?: string;
  tags?: string[];
  /** Integrated Browser configuration (per-chat opt-in). */
  browserConfig?: BrowserConfig;
  /** Enable orchestrator mode (inject orchestrator prompt + background-agent tools). */
  orchestratorMode?: boolean;
  /** Set when this chat is a spawned worker: the orchestrator chat id. */
  parentChatId?: string;
  /** Set when this chat is a spawned worker: background-task metadata. */
  backgroundTask?: BackgroundTaskMeta;
  /** Sticky per-chat default agent mode ('auto' when omitted). */
  defaultAgentMode?: AgentMode;
  /** Chat-scoped permission policy ('bypassPermissions' when omitted). */
  permissionMode?: ChatPermissionMode;
  /**
   * Reuse an EXISTING execution workspace instead of creating a new one.
   * Used by orchestrator workers so their file changes land in the shared
   * (orchestrator's) workspace. When set, workspace + worktree creation is
   * skipped and the working directory is that workspace's root.
   */
  workspaceId?: string;
  /** Portable `scope:slug` ref of the agent that should drive this chat. */
  agentRef?: string;
  /** Additive capability delta layered on top of the bound agent. */
  agentOverrides?: AgentOverrides;
  /** Set by `forkChat`: the source chat and turn. Never accepted from the API. */
  forkedFromChatId?: string;
  forkedAtTurnId?: string;
}
