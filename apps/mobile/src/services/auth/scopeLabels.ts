// ────────────────────────────────────────────────────────────────
// Human descriptions for authorization scopes.
//
// The consent screen is the ONLY place a user decides what a device may do,
// so `read:reviews` is not an acceptable thing to show them. Each string
// says what the device can actually do, in the second person, without
// jargon.
//
// Scope ids come from packages/auth/src/scopes.ts. A scope with no entry
// falls back to a readable derivation rather than rendering blank — an
// unlabelled permission is worse than an imperfectly labelled one.
// ────────────────────────────────────────────────────────────────

const LABELS: Record<string, string> = {
  'read:status': 'See whether your server is running and healthy',
  'read:projects': 'See your projects and their settings',
  'read:workspaces': 'See workspaces and their contents',
  'read:chats': 'Read your conversations',
  'read:workflows': 'See workflow definitions and run history',
  'read:files': 'Read files in workspaces and codebases',
  'read:reviews': 'See code changes and review threads',
  'read:activity': 'See when chats, runs and automations start, finish or fail',

  'write:projects': 'Create and change projects',
  'write:workspaces': 'Create and change workspaces',
  'write:chats': 'Send messages and start new conversations',
  'write:workflows': 'Create and change workflows',
  'write:files': 'Upload and modify files',
  'write:reviews': 'Comment on and approve code changes',

  'stream:events': 'Receive live updates as your agents work',
  'exec:agent': 'Run agents and answer their questions',
  'exec:terminal': 'Run terminal commands on your machine',
  'exec:browser': 'Control the built-in browser',
  'exec:computer': 'Watch and approve the agent operating apps on your desktop',

  'admin:harnesses': 'Change which AI provider is used',
  'admin:credentials': 'View and change stored credentials',
  'admin:devices': 'Pair and revoke other devices',
  'admin:settings': 'Change server settings',
  'admin:relay': 'Configure remote access through the relay',
};

/**
 * Scopes highlighted as sensitive on the consent and elevation screens.
 *
 * The rule is precise: these are exactly the scopes a mobile device does NOT
 * receive by default (`DEFAULT_MOBILE_SCOPES` in packages/auth/src/scopes.ts).
 * Granting any of them is a deliberate act that deserves a warning.
 *
 * Note `exec:agent` is deliberately ABSENT. Running agents is the entire
 * purpose of the app and is granted at pairing; flagging it as sensitive
 * would train users to click through the warning that actually matters.
 */
export const SENSITIVE_SCOPES = new Set([
  'exec:terminal',
  'exec:browser',
  'exec:computer',
  'write:projects',
  'write:workspaces',
  'write:files',
  'write:workflows',
  'admin:harnesses',
  'admin:credentials',
  'admin:devices',
  'admin:settings',
  'admin:relay',
]);

export function describeScope(scope: string): string {
  const known = LABELS[scope];
  if (known) return known;
  // Unknown scope (a newer server than this app): derive something readable
  // rather than showing a blank bullet the user cannot evaluate.
  const [action, resource] = scope.split(':');
  if (!action || !resource) return scope;
  const verb = action === 'read' ? 'See' : action === 'write' ? 'Change' : 'Access';
  return `${verb} ${resource.replace(/[-_]/g, ' ')}`;
}

export function isSensitiveScope(scope: string): boolean {
  return SENSITIVE_SCOPES.has(scope);
}
