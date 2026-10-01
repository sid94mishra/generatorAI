// ────────────────────────────────────────────────────────────────
// Scope presets — naming what a pairing offer amounts to.
//
// The consent screen lists every scope, and it should: that list is the
// decision. But twelve bullets do not tell a person "this is the normal
// phone grant" versus "this would let the phone run commands on your
// machine", and a name does. When an offer's scope SET equals one of the
// presets the desktop's Settings › Security offers (`SCOPE_PRESETS` in
// apps/web/src/components/settings/sections/Security.tsx), that preset's
// name is shown; anything else is "Custom".
//
// The lists are mirrored here rather than imported: `@generatorai/auth` is
// a server package (a devDependency of this app, used by tests only) and the
// web component is a TSX file. The test asserts the mirror has not drifted
// from `DEFAULT_MOBILE_SCOPES`.
//
// Pure — no React, no platform.
// ────────────────────────────────────────────────────────────────

export type ScopePresetId = 'readonly' | 'companion' | 'workstation' | 'admin';

export interface ScopePreset {
  id: ScopePresetId;
  label: string;
  hint: string;
  scopes: readonly string[];
}

const READ_SCOPES = [
  'read:status',
  'read:projects',
  'read:workspaces',
  'read:chats',
  'read:workflows',
  'read:files',
  'read:reviews',
  'read:activity',
] as const;

/** Mirrors `DEFAULT_MOBILE_SCOPES` in packages/auth/src/scopes.ts. */
export const COMPANION_SCOPES: readonly string[] = [
  ...READ_SCOPES,
  'write:chats',
  'write:reviews',
  'stream:events',
  'exec:agent',
];

/**
 * Plan §5.1 — Companion plus the write and exec scopes a standalone client
 * needs. As a SET this is exactly the desktop's "Full workstation" preset
 * (the test asserts it), so an offer with these scopes is named
 * "Full workstation" below rather than carrying a second name for the same
 * grant.
 */
export const STANDALONE_SCOPES: readonly string[] = [
  ...COMPANION_SCOPES,
  'write:workspaces',
  'write:files',
  'write:workflows',
  'write:projects',
  'exec:terminal',
  'exec:browser',
];

export const SCOPE_PRESETS: readonly ScopePreset[] = [
  {
    id: 'readonly',
    label: 'Read only',
    hint: 'Can view projects, chats, workflows and diffs. Cannot run anything.',
    scopes: [...READ_SCOPES, 'stream:events'],
  },
  {
    id: 'companion',
    label: 'Mobile companion',
    hint: 'Read, chat, approve and review. No terminal, browser or admin access.',
    scopes: COMPANION_SCOPES,
  },
  {
    id: 'workstation',
    label: 'Full workstation',
    hint: 'Everything except administration — including terminal and browser control. This is the standalone-phone grant.',
    scopes: [
      ...READ_SCOPES,
      'write:projects',
      'write:workspaces',
      'write:chats',
      'write:workflows',
      'write:files',
      'write:reviews',
      'stream:events',
      'exec:agent',
      'exec:terminal',
      'exec:browser',
    ],
  },
  {
    id: 'admin',
    label: 'Administrator',
    hint: 'Full workstation plus every admin scope: providers, credentials, devices, settings and relay.',
    scopes: [
      ...READ_SCOPES,
      'write:projects',
      'write:workspaces',
      'write:chats',
      'write:workflows',
      'write:files',
      'write:reviews',
      'stream:events',
      'exec:agent',
      'exec:terminal',
      'exec:browser',
      'exec:computer',
      'admin:harnesses',
      'admin:credentials',
      'admin:devices',
      'admin:settings',
      'admin:relay',
    ],
  },
];

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const scope of left) if (!right.has(scope)) return false;
  return true;
}

/**
 * The preset whose scope set equals the offer's, or null for a custom grant.
 *
 * Set comparison, not array equality: the server may order scopes
 * differently from the desktop picker, and duplicates carry no meaning.
 */
export function matchScopePreset(scopes: readonly string[]): ScopePreset | null {
  for (const preset of SCOPE_PRESETS) {
    if (sameSet(preset.scopes, scopes)) return preset;
  }
  return null;
}

export type ScopeGroupId = 'read' | 'act' | 'sensitive';

export interface ScopeGroup {
  id: ScopeGroupId;
  title: string;
  scopes: string[];
}

/**
 * Split an offer into the three groups the consent screen shows.
 *
 * "Sensitive" wins over the verb: `write:files` is a write scope AND a
 * withheld-by-default one, and the warning matters more than the grammar.
 * Empty groups are omitted so the screen never shows an empty heading.
 */
export function groupScopes(
  scopes: readonly string[],
  isSensitive: (scope: string) => boolean,
): ScopeGroup[] {
  const read: string[] = [];
  const act: string[] = [];
  const sensitive: string[] = [];
  const seen = new Set<string>();

  for (const scope of scopes) {
    if (seen.has(scope)) continue;
    seen.add(scope);
    if (isSensitive(scope)) sensitive.push(scope);
    else if (scope.startsWith('read:') || scope.startsWith('stream:')) read.push(scope);
    else act.push(scope);
  }

  const groups: ScopeGroup[] = [];
  if (read.length > 0) groups.push({ id: 'read', title: 'Read', scopes: read });
  if (act.length > 0) groups.push({ id: 'act', title: 'Act', scopes: act });
  if (sensitive.length > 0) groups.push({ id: 'sensitive', title: 'Sensitive', scopes: sensitive });
  return groups;
}
