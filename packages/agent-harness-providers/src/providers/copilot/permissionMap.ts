// ────────────────────────────────────────────────────────────────
// permissionMap — ORC-06
//
// Translates SDK permission kinds to the domain `PermissionRequest['type']`.
//
// Previously this lived inline in CopilotAdapter as a plain string-keyed
// `Record`, which silently drifted the day the SDK added a new kind — the
// lookup would fall through to `'other'` and the server would log nothing.
//
// The implementation below uses two guards to prevent that drift:
//
//   1. A typed map keyed by the SDK's literal-union `SdkPermissionKind`.
//      TypeScript's exhaustiveness checking makes this map a compile error
//      until every new SDK kind has been mapped. Upgrading `@github/copilot-sdk`
//      therefore forces a tsc failure at build time, not a production gap.
//
//   2. A runtime assertion in `mapPermissionKind` that logs unknown kinds
//      (the type system already prevents this at build time, but a `.d.ts`
//      mismatch or dynamic payload could still slip one through at runtime).
//
// When the SDK publishes a `PermissionKind` value enum the runtime map can
// be generated from it; until then the compile-time coverage is sufficient.
// ────────────────────────────────────────────────────────────────

import type { PermissionRequest as SdkPermissionRequest } from '@github/copilot-sdk';
import type { PermissionRequest } from '@generatorai/core';

/** Literal union of every kind the SDK currently emits. */
export type SdkPermissionKind = SdkPermissionRequest['kind'];

/**
 * Compile-time exhaustiveness: every `SdkPermissionKind` must appear as a
 * key. Adding a new SDK kind without a mapping → `tsc` fails this file.
 *
 * The `satisfies` constraint keeps the literal value types narrow while
 * also enforcing that every required key is present.
 */
export const PERMISSION_KIND_TO_DOMAIN_TYPE = {
  shell: 'shell_exec',
  write: 'file_write',
  read: 'file_read',
  // MCP tool calls don't fit shell / file / network cleanly; the domain
  // ontology bins them into `other` until we have a dedicated bucket.
  mcp: 'other',
  url: 'network',
  // SDK 0.3.0 added three new permission kinds:
  'custom-tool': 'other',
  memory: 'other',
  hook: 'other',
  // SDK 1.0 GA added extension-management permission kinds:
  'extension-management': 'other',
  'extension-permission-access': 'other',
} as const satisfies Record<SdkPermissionKind, PermissionRequest['type']>;

/**
 * Map an SDK permission kind to the domain type. Falls back to `'other'`
 * with a `console.warn` if an unexpected kind slips through at runtime
 * (would only happen if the SDK's TypeScript types are behind its
 * implementation — rare, but we'd rather log than silently mislabel).
 */
export function mapPermissionKind(kind: string): PermissionRequest['type'] {
  const mapped = (PERMISSION_KIND_TO_DOMAIN_TYPE as Record<string, PermissionRequest['type']>)[kind];
  if (mapped === undefined) {
    // eslint-disable-next-line no-console
    console.warn(
      `[permissionMap] Unknown SDK permission kind '${kind}' — mapping to 'other'. ` +
      `Update PERMISSION_KIND_TO_DOMAIN_TYPE in packages/agent-harness-providers/src/providers/copilot/permissionMap.ts.`,
    );
    return 'other';
  }
  return mapped;
}
