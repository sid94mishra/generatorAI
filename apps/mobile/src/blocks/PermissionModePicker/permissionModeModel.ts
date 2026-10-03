// MB-47 PermissionModePicker model (03 MB-47; P04 run permission modes): the four modes a run may start with,
// strictest first, their words, and which change loosens a live run (asked first). Bypass needs `admin:settings`
// (the server's `canBypassPermissions`); everything else is open to every paired device. Pure, unit-tested.
import { RUN_PERMISSION_MODES, type RunPermissionMode } from '@generatorai/workflow-spec';

export { RUN_PERMISSION_MODES, type RunPermissionMode };

export const PERMISSION_MODE_LABEL: Record<RunPermissionMode, string> = {
  plan: 'Plan',
  default: 'Default',
  acceptEdits: 'Accept edits',
  bypassPermissions: 'Bypass',
};

export const PERMISSION_MODE_DETAIL: Record<RunPermissionMode, string> = {
  plan: 'Read-only, plans first',
  default: 'Asks before edits',
  acceptEdits: 'Edits without asking',
  bypassPermissions: 'Every tool call goes ahead',
};

export const BYPASS_SCOPE = 'admin:settings';

export function isRunPermissionMode(value: unknown): value is RunPermissionMode {
  return typeof value === 'string' && (RUN_PERMISSION_MODES as readonly string[]).includes(value);
}

/** 0 = strictest. */
export function strictness(mode: RunPermissionMode): number {
  return RUN_PERMISSION_MODES.indexOf(mode);
}

/** True when `next` lets agents do more without asking than `current`. */
export function isLoosening(current: RunPermissionMode, next: RunPermissionMode): boolean {
  return strictness(next) > strictness(current);
}

export function canBypass(scopes: readonly string[]): boolean {
  return scopes.includes(BYPASS_SCOPE);
}
