// ────────────────────────────────────────────────────────────────
// Status unions that have no server-side type of their own.
//
// The status map (./maps.ts) must be exhaustive over every status value a
// client can render, so a union it keys on has to live somewhere shared can
// import. The server's unions already live in ../types; these are the
// client-side ones (stream blocks, the optimistic run status) plus the review
// thread status that used to be declared separately in packages/review and
// apps/web. packages/client-core, packages/review and apps/web import them from
// here instead of redeclaring them (D-18, 02-design-system-spec.md §7.2).
// ────────────────────────────────────────────────────────────────

import type { WorkflowRunStatus } from '../types/WorkflowRun.js';

/**
 * A workflow run as a client sees it: the server lifecycle plus `pending`, the
 * optimistic state between "Run" and the server's first `created` event.
 */
export type RunStatus = WorkflowRunStatus | 'pending';

/** Chat turn stream status (client-core `StreamState.status`). */
export type StreamStatus = 'idle' | 'pending' | 'streaming' | 'thinking' | 'complete' | 'error';

/** A tool call block in the transcript. Failure is carried by `error: true`, not the status. */
export type ToolCallStatus = 'running' | 'complete';

/** A hook invocation reported on the stream. */
export type HookInvocationStatus = 'running' | 'ok' | 'failed';

/** An AskUserQuestion block. */
export type QuestionStatus = 'pending' | 'answered' | 'expired';

/** A tool-permission prompt block. */
export type PermissionStatus = 'pending' | 'allowed' | 'denied' | 'expired';

/** A widget block in the transcript (a subset of `WidgetInstanceStatus`). */
export type WidgetBlockStatus = 'active' | 'closed' | 'error';

/**
 * Review-thread lifecycle.
 *   draft      — composed, not yet queued for the agent
 *   pending    — queued, will be sent with the next batch
 *   submitted  — sent to the agent
 *   addressed  — the agent reported a change for it
 *   resolved   — explicitly closed by the user
 *   outdated   — the anchor could no longer be located after a change
 */
export type ReviewThreadStatus = 'draft' | 'pending' | 'submitted' | 'addressed' | 'resolved' | 'outdated';

/** Live connection to the server (web `connectionStore`). */
export type ConnectionHealth = 'connected' | 'reconnecting' | 'disconnected';

/** Computer-use driver runtime state (`GET /api/workspaces/:id/computer/runtime`). */
export type ComputerRuntimeState = 'ready' | 'stopped' | 'degraded' | 'unavailable';

/** Server `/health` status. */
export type ServerHealthStatus = 'ok' | 'degraded';

/** File change kinds across the working tree, checkpoints and pull requests. */
export type ChangeKindValue = 'added' | 'modified' | 'deleted' | 'removed' | 'renamed' | 'untracked' | 'ignored';
