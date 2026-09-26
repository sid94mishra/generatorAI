// ────────────────────────────────────────────────────────────────
// Non-run status maps (02 §7.3 "separate small maps").
//
// HEALTH: a tone only, rendered as dot + word (connection, computer runtime,
// server health, codebase and workspace preparation).
// CHANGE_KIND: a letter + tone for file changes (working tree, checkpoints,
// pull requests, the changes tree).
// ────────────────────────────────────────────────────────────────

import type { CodebaseStatus } from '../types/Project.js';
import type { MountStatus, WorkspacePrepStatus } from '../types/Workspace.js';
import type { ChangeKindValue, ComputerRuntimeState, ConnectionHealth, ServerHealthStatus } from './unions.js';

export type HealthTone = 'ok' | 'warn' | 'err' | 'idle' | 'run';

export interface HealthMapping {
  tone: HealthTone;
  label: string;
}

const h = (tone: HealthTone, label: string): HealthMapping => ({ tone, label });

export const HEALTH = {
  connection: {
    connected: h('ok', 'Connected'),
    reconnecting: h('warn', 'Reconnecting'),
    disconnected: h('err', 'Disconnected'),
  } satisfies Record<ConnectionHealth, HealthMapping>,
  computerRuntime: {
    ready: h('ok', 'Ready'),
    stopped: h('idle', 'Stopped'),
    degraded: h('warn', 'Degraded'),
    unavailable: h('err', 'Unavailable'),
  } satisfies Record<ComputerRuntimeState, HealthMapping>,
  server: {
    ok: h('ok', 'Healthy'),
    degraded: h('warn', 'Degraded'),
  } satisfies Record<ServerHealthStatus, HealthMapping>,
  /** `cloning` renders as a running badge rather than a dot. */
  codebase: {
    pending: h('idle', 'Pending'),
    cloning: h('run', 'Cloning'),
    ready: h('ok', 'Ready'),
    error: h('err', 'Error'),
    stale: h('warn', 'Stale'),
  } satisfies Record<CodebaseStatus, HealthMapping>,
  workspacePrep: {
    pending: h('idle', 'Pending'),
    preparing: h('run', 'Preparing'),
    ready: h('ok', 'Ready'),
    error: h('err', 'Error'),
  } satisfies Record<WorkspacePrepStatus, HealthMapping>,
  mount: {
    preparing: h('run', 'Preparing'),
    ready: h('ok', 'Ready'),
    error: h('err', 'Error'),
    removed: h('idle', 'Removed'),
  } satisfies Record<MountStatus, HealthMapping>,
} as const;

/** A file-change letter's tone (03-domain §2.2 B-08 and the DockChanges board: M warn, R run). */
export type ChangeKindTone = 'ok' | 'warn' | 'run' | 'fg-3' | 'err';

export interface ChangeKindDef {
  letter: 'A' | 'M' | 'D' | 'R' | 'U' | 'I';
  tone: ChangeKindTone;
  label: string;
}

/** `removed` (pull-request files) renders exactly like `deleted`. */
export const CHANGE_KIND = {
  added: { letter: 'A', tone: 'ok', label: 'Added' },
  modified: { letter: 'M', tone: 'warn', label: 'Modified' },
  deleted: { letter: 'D', tone: 'err', label: 'Deleted' },
  removed: { letter: 'D', tone: 'err', label: 'Deleted' },
  renamed: { letter: 'R', tone: 'run', label: 'Renamed' },
  untracked: { letter: 'U', tone: 'fg-3', label: 'Untracked' },
  ignored: { letter: 'I', tone: 'fg-3', label: 'Ignored' },
} as const satisfies Record<ChangeKindValue, ChangeKindDef>;
