// ────────────────────────────────────────────────────────────────
// Scope labels, sensitivity and pairing presets (mobile MG-23).
//
// One vocabulary for every screen where a person decides what a device may
// do: pairing consent, Pair a device, scope requests, Security › devices —
// on mobile and desktop alike. The ids are `packages/auth/src/scopes.ts`
// `SCOPES` (this package cannot import `@generatorai/auth`, which depends on
// it); `packages/auth/src/__tests__/scopeLabels.test.ts` fails when the two
// drift: every scope labelled, presets equal to the auth constants,
// sensitivity covering `HIGH_RISK_SCOPES`.
// ────────────────────────────────────────────────────────────────

export interface ScopeLabel {
  /** Short noun phrase for a row: "Edit workflows". */
  label: string;
  /** What the device can actually do, second person, no jargon. */
  description: string;
}

export const SCOPE_LABELS: Readonly<Record<string, ScopeLabel>> = {
  'read:status': { label: 'Server status', description: 'See whether your server is running and healthy' },
  'read:projects': { label: 'View projects', description: 'See your projects and their settings' },
  'read:workspaces': { label: 'View workspaces', description: 'See workspaces and their contents' },
  'read:chats': { label: 'Read chats', description: 'Read your conversations' },
  'read:workflows': { label: 'View workflows', description: 'See workflow definitions and run history' },
  'read:files': { label: 'Read files', description: 'Read files in workspaces and codebases' },
  'read:reviews': { label: 'View changes', description: 'See code changes and review threads' },
  'read:activity': { label: 'Activity', description: 'See when chats, runs and automations start, finish or fail' },
  'write:projects': { label: 'Edit projects', description: 'Create and change projects' },
  'write:workspaces': { label: 'Edit workspaces', description: 'Create and change workspaces' },
  'write:chats': { label: 'Chat', description: 'Send messages and start new conversations' },
  'write:workflows': { label: 'Edit workflows', description: 'Create and change workflows' },
  'write:files': { label: 'Edit files', description: 'Upload and modify files' },
  'write:reviews': { label: 'Review changes', description: 'Comment on and approve code changes' },
  'stream:events': { label: 'Live updates', description: 'Receive live updates as your agents work' },
  'exec:agent': { label: 'Run agents', description: 'Run agents and answer their questions' },
  'exec:terminal': { label: 'Terminal', description: 'Run terminal commands on your machine' },
  'exec:browser': { label: 'Browser', description: 'Control the built-in browser' },
  'exec:computer': { label: 'Computer use', description: 'Watch and approve the agent operating apps on your desktop' },
  'admin:harnesses': { label: 'Model providers', description: 'Change which AI provider is used' },
  'admin:credentials': { label: 'Credentials', description: 'View and change stored credentials' },
  'admin:devices': { label: 'Devices', description: 'Pair and revoke other devices' },
  'admin:settings': { label: 'Server settings', description: 'Change server settings' },
  'admin:relay': { label: 'Remote access', description: 'Configure remote access through the relay' },
};

/** A scope a newer server knows and this build does not: derive something readable, never blank. */
function derived(scope: string): ScopeLabel {
  const [action, resource] = scope.split(':');
  if (!action || !resource) return { label: scope, description: scope };
  const noun = resource.replace(/[-_]/g, ' ');
  const verb = action === 'read' ? 'See' : action === 'write' ? 'Change' : 'Access';
  return { label: `${verb} ${noun}`, description: `${verb} ${noun}` };
}

export function scopeLabel(scope: string): string {
  return (SCOPE_LABELS[scope] ?? derived(scope)).label;
}

export function describeScope(scope: string): string {
  return (SCOPE_LABELS[scope] ?? derived(scope)).description;
}

/**
 * Sensitive = hands over control of the machine or the server: every
 * `exec:*` except `exec:agent` (running agents is what pairing is for) and
 * every `admin:*`. A superset of the server's `HIGH_RISK_SCOPES`, which
 * predates `exec:computer` and leaves out `admin:harnesses` (MD-165).
 */
export function isSensitiveScope(scope: string): boolean {
  if (scope.startsWith('admin:')) return true;
  return scope.startsWith('exec:') && scope !== 'exec:agent';
}

export type ScopePresetId = 'companion' | 'standalone' | 'device' | 'cli';

export interface ScopePreset {
  id: ScopePresetId;
  label: string;
  description: string;
  /** Which `pair` platform the preset is the server default for. */
  platform: 'mobile' | 'web' | 'cli';
  scopes: readonly string[];
}

const COMPANION = [
  'read:status',
  'read:projects',
  'read:workspaces',
  'read:chats',
  'read:workflows',
  'read:files',
  'read:reviews',
  'read:activity',
  'write:chats',
  'write:reviews',
  'stream:events',
  'exec:agent',
] as const;

const DEVICE = [
  'read:status',
  'read:projects',
  'read:workspaces',
  'read:chats',
  'read:workflows',
  'read:files',
  'read:reviews',
  'read:activity',
  'write:chats',
  'write:workflows',
  'write:reviews',
  'stream:events',
  'exec:agent',
] as const;

/**
 * The named grants a pairing may start from — exactly the server's preset
 * constants (`DEFAULT_MOBILE_SCOPES`, `STANDALONE_MOBILE_SCOPES`,
 * `DEFAULT_DEVICE_SCOPES`, `DEFAULT_CLI_SCOPES`). A preset the boards draw
 * without a server constant ("Recommended", "Read only", "Full workstation")
 * is not offered.
 */
export const SCOPE_PRESETS: readonly ScopePreset[] = [
  {
    id: 'companion',
    label: 'Mobile companion',
    description: 'Read, chat, approve and review',
    platform: 'mobile',
    scopes: COMPANION,
  },
  {
    id: 'standalone',
    label: 'Mobile standalone',
    description: 'Adds files, workflows, terminal, browser',
    platform: 'mobile',
    scopes: [
      ...COMPANION,
      'write:workspaces',
      'write:files',
      'write:workflows',
      'write:projects',
      'exec:terminal',
      'exec:browser',
    ],
  },
  {
    id: 'device',
    label: 'Desktop or browser',
    description: 'Read everything, chat and edit workflows',
    platform: 'web',
    scopes: DEVICE,
  },
  {
    id: 'cli',
    label: 'Command line',
    description: 'Adds projects, files and the terminal',
    platform: 'cli',
    scopes: [...DEVICE, 'write:projects', 'write:workspaces', 'write:files', 'exec:terminal'],
  },
];
