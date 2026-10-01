// ────────────────────────────────────────────────────────────────
// Feature gating by granted scope.
//
// Every capability in Phase 5 (terminal, browser, widgets, voice, uploads)
// is behind a scope a paired mobile device does NOT hold by default. This
// module answers one question: given what this device was granted, is a
// feature available — and if not, what do we tell the user?
//
// ── Why a gate instead of just letting it 403 ────────────────────
// A tab that opens and then fails is worse than a tab that is honest about
// being unavailable. The user cannot tell a permissions problem from a bug,
// and "the terminal is broken" is the conclusion they reach.
//
// Pure logic, no React, so the whole matrix is testable.
// ────────────────────────────────────────────────────────────────

export type MobileFeature =
  | 'terminal'
  | 'browser'
  | 'computer'
  | 'voice'
  | 'fileUpload'
  | 'runStart'
  | 'scriptRun'
  | 'runControl'
  | 'workflowEdit'
  | 'projectEdit'
  | 'codebaseLinkLocal'
  | 'capabilityAdmin'
  | 'deviceAdmin';

export interface FeatureRequirement {
  /** Every scope that must be present. */
  scopes: readonly string[];
  /** Shown when the feature is unavailable. Written for a person. */
  reason: string;
  /**
   * True when the user can plausibly obtain this by granting a scope from a
   * trusted device. False when it is unavailable for a structural reason
   * that no permission can fix.
   */
  grantable: boolean;
}

export const FEATURE_REQUIREMENTS: Record<MobileFeature, FeatureRequirement> = {
  terminal: {
    scopes: ['exec:terminal'],
    reason:
      'Terminal access lets this device run commands on your machine. It is withheld until you grant it explicitly from a trusted device.',
    grantable: true,
  },
  browser: {
    scopes: ['exec:browser'],
    reason:
      'Browser control lets this device drive the agent’s browser. It is withheld until you grant it explicitly from a trusted device.',
    grantable: true,
  },
  computer: {
    // `/workspaces/:id/computer` reads AND writes are `exec:computer` in the
    // route policy — kept apart from `exec:agent` so answering an agent's
    // question never implies access to the desktop. Not an `admin:*` scope,
    // so a device may request it (DeviceService.requestScopes).
    scopes: ['exec:computer'],
    reason:
      'Watching and approving computer use lets this device see and act on your desktop. It is withheld until you grant it explicitly from a trusted device.',
    grantable: true,
  },
  voice: {
    // Speech-to-text posts audio to the chat pipeline, so it rides on the
    // same scope as sending a message.
    scopes: ['write:chats'],
    reason: 'Voice input needs permission to send messages.',
    grantable: true,
  },
  fileUpload: {
    scopes: ['write:files'],
    reason: 'Uploading files needs file-write permission, which is not granted by default.',
    grantable: true,
  },
  runStart: {
    // `POST /workflow-invocations` (a new run, or a fork of a finished one)
    // is a run-time act: `exec:agent` + `read:workflows`, which a default
    // paired phone holds (packages/auth/src/routePolicy.ts, PD-6).
    scopes: ['exec:agent', 'read:workflows'],
    reason: 'Starting runs needs permission to run agents on this device.',
    grantable: true,
  },
  scriptRun: {
    // A script target materializes a definition, so the invocation service
    // also demands `write:workflows` for it.
    scopes: ['write:workflows', 'exec:agent'],
    reason: 'Running a script creates a workflow from it, which needs workflow-edit permission.',
    grantable: true,
  },
  runControl: {
    // The route policy for `/workflow-runs` and `/automations` writes is
    // `write:workflows` AND `exec:agent` (packages/auth/src/routePolicy.ts).
    // Gating on the first alone rendered buttons that could still 403.
    scopes: ['write:workflows', 'exec:agent'],
    reason:
      'Pausing and cancelling runs needs workflow-edit permission. Approving a blocked stage does not — you can still do that here.',
    grantable: true,
  },
  workflowEdit: {
    scopes: ['write:workflows'],
    reason: 'Editing workflows is done on the desktop or web app.',
    grantable: true,
  },
  projectEdit: {
    // Create / rename / archive projects, add a codebase by git URL, change
    // project settings and project artifacts. Everything here is typed on
    // the phone and resolved on the host, so the scope is the only barrier.
    scopes: ['write:projects'],
    reason:
      'Creating, renaming and archiving projects and adding repositories needs project-edit permission.',
    grantable: true,
  },
  codebaseLinkLocal: {
    scopes: ['write:projects'],
    reason:
      'Linking a local folder points at a path on the machine running GeneratorAI, which this device cannot browse. Add a repository by its git URL instead.',
    // Structural: even with the scope, a phone cannot pick a host path.
    grantable: false,
  },
  capabilityAdmin: {
    // `/system` and `/agents` writes are `admin:settings` in the route policy.
    scopes: ['admin:settings'],
    reason:
      'Turning MCP servers on or off and editing agents changes how the agent behaves for every connected client, so it needs settings-admin permission.',
    grantable: true,
  },
  deviceAdmin: {
    scopes: ['admin:devices'],
    reason: 'Pairing and revoking other devices is done from a trusted device.',
    grantable: true,
  },
};

export interface FeatureAvailability {
  available: boolean;
  /** Scopes required but not held. Empty when available. */
  missing: string[];
  reason: string | null;
  grantable: boolean;
}

export function checkFeature(
  feature: MobileFeature,
  grantedScopes: readonly string[],
): FeatureAvailability {
  const requirement = FEATURE_REQUIREMENTS[feature];
  const granted = new Set(grantedScopes);
  const missing = requirement.scopes.filter((scope) => !granted.has(scope));

  if (missing.length === 0) {
    return { available: true, missing: [], reason: null, grantable: requirement.grantable };
  }
  return {
    available: false,
    missing,
    reason: requirement.reason,
    grantable: requirement.grantable,
  };
}

/**
 * Whether THIS device may ask for `scope` through the scope-request route.
 *
 * Mirrors `DeviceService.requestScopes` (packages/auth): an `admin:*` scope
 * is refused (403 SCOPE_NOT_REQUESTABLE) unless the device already holds
 * some `admin:*` scope. Such a scope is still grantable — by an admin from a
 * trusted device (Settings › Security) — it just cannot be requested here.
 */
export function isScopeRequestable(scope: string, grantedScopes: readonly string[]): boolean {
  if (!scope.startsWith('admin:')) return true;
  return grantedScopes.some((held) => held.startsWith('admin:'));
}

/**
 * Whether "Request access" can work for a feature: it is grantable and every
 * scope it is missing may be requested from this device.
 */
export function canRequestFeature(feature: MobileFeature, grantedScopes: readonly string[]): boolean {
  const check = checkFeature(feature, grantedScopes);
  return (
    !check.available &&
    check.grantable &&
    check.missing.every((scope) => isScopeRequestable(scope, grantedScopes))
  );
}

/** Shown in place of "Request access" when the scope must be granted by an admin instead. */
export const GRANT_FROM_TRUSTED_DEVICE =
  'An admin can grant it from a trusted device in Settings › Security.';

export function isFeatureAvailable(
  feature: MobileFeature,
  grantedScopes: readonly string[],
): boolean {
  return checkFeature(feature, grantedScopes).available;
}

/** Features to surface as requestable in Settings → Security. */
export function grantableFeatures(grantedScopes: readonly string[]): MobileFeature[] {
  return (Object.keys(FEATURE_REQUIREMENTS) as MobileFeature[]).filter((feature) => {
    const check = checkFeature(feature, grantedScopes);
    return !check.available && check.grantable;
  });
}
