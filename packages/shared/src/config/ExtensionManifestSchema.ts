// ────────────────────────────────────────────────────────────────
// ExtensionManifestSchema — Zod validator for `extension.json`.
//
// The manifest is intentionally thin: identity + metadata + an `entry`
// pointer to the ES module whose default export is `loadExtension(ai)`.
// All contributions (widgets, tools, hooks, …) are registered
// imperatively from the entry file — there is no declarative
// `contributes` block.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { normalizeWidgetSurface } from '../types/Widget.js';

/**
 * Widget surface schema. Accepts any string and normalizes to one of the
 * two canonical surfaces (`inline` | `widget`).
 */
export const WidgetSurfaceSchema = z.string().transform((v) => normalizeWidgetSurface(v));

const ExtensionAuthorSchema = z.union([
  z.string(),
  z.object({
    name: z.string(),
    email: z.string().optional(),
    url: z.string().optional(),
  }),
]);

export const ExtensionManifestSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*$/i, 'extension id must be alphanumeric, dot, dash, underscore'),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  author: ExtensionAuthorSchema.optional(),
  license: z.string().optional(),
  repository: z.string().optional(),
  publisher: z.string().optional(),
  engines: z
    .object({ generatorai: z.string() })
    .optional(),
  permissions: z.array(z.string()).optional(),
  /**
   * Relative path to the ES module whose default (or named
   * `loadExtension`) export receives the per-extension `ExtensionAPI`
   * handle (`ai`) and registers contributions imperatively.
   *
   * Example: `"entry": "./index.js"`.
   */
  entry: z.string().min(1),
  icon: z.string().optional(),
  signature: z.string().optional(),
});

export const InstallExtensionParamsSchema = z.object({
  path: z.string().optional(),
  source: z.string().optional(),
  scope: z.enum(['system', 'user', 'workspace']).optional(),
  workspaceId: z.string().optional(),
  force: z.boolean().optional(),
});

export type ExtensionManifestParsed = z.infer<typeof ExtensionManifestSchema>;
