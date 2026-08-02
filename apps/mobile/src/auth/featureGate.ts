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
  | 'voice'
  | 'fileUpload'
  | 'runControl'
  | 'workflowEdit'
  | 'projectEdit'
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
  runControl: {
    scopes: ['write:workflows'],
    reason:
      'Starting, pausing and cancelling runs needs workflow-edit permission. Approving a blocked stage does not — you can still do that here.',
    grantable: true,
  },
  workflowEdit: {
    scopes: ['write:workflows'],
    reason: 'Editing workflows is done on the desktop or web app.',
    grantable: true,
  },
  projectEdit: {
    scopes: ['write:projects'],
    reason:
      'Linking a codebase points at a folder on the machine running GeneratorAI, which this device cannot browse.',
    // Structural: even with the scope, a phone cannot pick a host path.
    grantable: false,
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
