// ────────────────────────────────────────────────────────────────
// Run permission mode — pure view logic for the run screen's mode chip.
//
// `GET/PATCH /workflow-runs/:id/permission-mode` flips how a live run's tool
// calls are gated (WorkflowRunPermissionMode in @generatorai/shared). Moving
// towards fewer prompts is LOOSENING and asks for confirmation first; moving
// towards more prompts is always safe.
//
// Tested in src/__tests__/permissionMode.test.ts.
// ────────────────────────────────────────────────────────────────

export type RunPermissionMode = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions';

/** Strictest first — the order the picker lists them in. */
export const RUN_PERMISSION_MODES: readonly RunPermissionMode[] = [
  'plan',
  'default',
  'acceptEdits',
  'bypassPermissions',
];

/** What an older run with no stored mode is evaluated as (server default). */
export const DEFAULT_RUN_PERMISSION_MODE: RunPermissionMode = 'bypassPermissions';

export const RUN_PERMISSION_MODE_LABEL: Record<RunPermissionMode, string> = {
  plan: 'Plan first',
  default: 'Ask',
  acceptEdits: 'Accept edits',
  bypassPermissions: 'Auto-approve',
};

export const RUN_PERMISSION_MODE_DETAIL: Record<RunPermissionMode, string> = {
  plan: 'Every tool call waits for you, so agents show their plan before acting.',
  default: 'Rules decide; anything they do not cover waits for you.',
  acceptEdits: 'File edits go ahead; everything else waits for you.',
  bypassPermissions: 'Every tool call goes ahead without asking.',
};

export function isRunPermissionMode(value: unknown): value is RunPermissionMode {
  return typeof value === 'string' && (RUN_PERMISSION_MODES as readonly string[]).includes(value);
}

/** The mode a `GET` response names, falling back to the server default. */
export function permissionModeOf(response: unknown): RunPermissionMode {
  const mode = response && typeof response === 'object' ? (response as { mode?: unknown }).mode : undefined;
  return isRunPermissionMode(mode) ? mode : DEFAULT_RUN_PERMISSION_MODE;
}

/** 0 = strictest. */
export function strictness(mode: RunPermissionMode): number {
  return RUN_PERMISSION_MODES.indexOf(mode);
}

/** True when `next` lets agents do more without asking than `current`. */
export function isLoosening(current: RunPermissionMode, next: RunPermissionMode): boolean {
  return strictness(next) > strictness(current);
}

/** Chip tone: auto-approve is the one mode that deserves a warning colour. */
export function permissionModeTone(mode: RunPermissionMode): 'neutral' | 'warning' {
  return mode === 'bypassPermissions' ? 'warning' : 'neutral';
}
