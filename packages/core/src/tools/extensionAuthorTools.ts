// ────────────────────────────────────────────────────────────────
// extensionAuthorTools — Built-in tools that let the agent scaffold
// and reload user-scope extensions from a chat.
//
// Two tools:
//   - write_extension  — write a full file tree under ~/.generatorai/extensions
//                        and (if it validates) load it into the runtime.
//   - reload_extension — reload an already-installed extension from disk.
//
// Path traversal is strictly guarded: paths must be relative and cannot
// contain `..`. Tools always target the user scope (never system, never
// workspace).
//
// See docs/EXTENSIONS_V2_PLAN.md §9 and
// templates/system/artifacts/skills/extension-author.md.
// ────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, resolve, sep, isAbsolute } from 'node:path';
import type { ToolDefinition } from '../domain/ports/IAgentHarness.js';
import type { ExtensionManager } from '../services/ExtensionManager.js';
import type { IWidgetRegistry } from '../domain/ports/IWidgetRegistry.js';

export interface ExtensionAuthorContext {
  extensionManager: ExtensionManager;
  /**
   * Optional widget registry. When present, `write_extension` returns the
   * actually-registered widget descriptors after install so the caller can
   * render them without a follow-up `search_widget` round-trip.
   */
  widgetRegistry?: IWidgetRegistry;
}

// Extension ids used by user-authored extensions must be like `user.<slug>`
// or `<publisher>.<slug>`. Reserved namespaces `genai.` and `acme.` cannot be
// written by the agent — they belong to the platform / demo publisher.
const EXT_ID = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/;
const RESERVED_NAMESPACES = new Set(['genai', 'acme']);

function isSafeRelativePath(p: string): boolean {
  if (typeof p !== 'string' || !p) return false;
  if (isAbsolute(p)) return false;
  // Normalize separators
  const parts = p.replace(/\\/g, '/').split('/');
  if (parts.some((seg) => seg === '..' || seg === '' || seg === '.')) return false;
  // No leading/trailing slashes accepted (isAbsolute catches leading /).
  if (p.endsWith('/') || p.endsWith('\\')) return false;
  return true;
}

// ── write_extension ────────────────────────────────────────────

export function buildWriteExtensionTool(ctx: ExtensionAuthorContext): ToolDefinition {
  return {
    name: 'write_extension',
    description:
      'Create or overwrite a GeneratorAI extension in the user scope ' +
      '(`~/.generatorai/extensions/<id>@<version>/`) and hot-load it. ' +
      'Use this to scaffold a new widget from the user\'s spec: pass the ' +
      'extension id, version, and the full file tree (manifest.json + ' +
      'index.js + ui/*.html). All paths must be safe relative paths. On ' +
      'success returns `registeredWidgets` — the fully-qualified ids ' +
      'you can immediately pass to `render_widget` without another ' +
      '`search_widget` round-trip.',
    parametersSchema: {
      type: 'object',
      properties: {
        extensionId: {
          type: 'string',
          description:
            'Fully-qualified id like "user.pomodoro". Must be lowercase ' +
            'alphanumeric + dot + dash. Reserved: "genai.*", "acme.*".',
        },
        version: {
          type: 'string',
          description: 'Semver, e.g. "1.0.0". Optional — defaults to "1.0.0".',
        },
        files: {
          type: 'array',
          description:
            'File tree to write. Each entry has a relative `path` (inside ' +
            'the extension root) and UTF-8 string `content`. Must include ' +
            'at minimum `extension.json` and (if `entry` is set) the entry ' +
            'JS file. No absolute paths, no `..` segments.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
          },
        },
        force: {
          type: 'boolean',
          description:
            'Overwrite an existing installation of the same id+version. ' +
            'Default true — the tool assumes overwrite semantics for ' +
            'iterative authoring.',
        },
      },
      required: ['extensionId', 'files'],
    },
    handler: async (args) => {
      const extensionId = String(args['extensionId'] ?? '').trim();
      const version = String(args['version'] ?? '1.0.0').trim();
      const filesRaw = args['files'];
      const force = args['force'] !== false;

      // ── Validate ──
      if (!EXT_ID.test(extensionId)) {
        return {
          ok: false,
          error:
            `Invalid extensionId "${extensionId}". Must match ` +
            `/^[a-z][a-z0-9]*(\\.[a-z][a-z0-9-]*)+$/ — e.g. "user.pomodoro".`,
        };
      }
      const namespace = extensionId.split('.')[0];
      if (namespace && RESERVED_NAMESPACES.has(namespace)) {
        return {
          ok: false,
          error:
            `Namespace "${namespace}.*" is reserved for the platform. ` +
            `Prefix your extension with "user.<slug>" instead.`,
        };
      }
      if (!Array.isArray(filesRaw) || filesRaw.length === 0) {
        return { ok: false, error: 'files must be a non-empty array' };
      }
      type Entry = { path: string; content: string };
      const files: Entry[] = [];
      for (const f of filesRaw as unknown[]) {
        if (!f || typeof f !== 'object') {
          return { ok: false, error: 'files entries must be { path, content } objects' };
        }
        const p = (f as Record<string, unknown>)['path'];
        const c = (f as Record<string, unknown>)['content'];
        if (typeof p !== 'string' || typeof c !== 'string') {
          return {
            ok: false,
            error: 'files entries must have string `path` and string `content`',
          };
        }
        if (!isSafeRelativePath(p)) {
          return {
            ok: false,
            error: `Unsafe path "${p}" — must be a plain relative path (no ".." / no absolute / no trailing slash).`,
          };
        }
        files.push({ path: p, content: c });
      }
      const hasManifest = files.some((f) => f.path === 'extension.json');
      if (!hasManifest) {
        return {
          ok: false,
          error: 'files must include an `extension.json` at the root.',
        };
      }

      // Validate the manifest content parses + matches the declared id/version.
      const manifestEntry = files.find((f) => f.path === 'extension.json')!;
      let manifest: Record<string, unknown>;
      try {
        manifest = JSON.parse(manifestEntry.content) as Record<string, unknown>;
      } catch (err) {
        return {
          ok: false,
          error: `extension.json is not valid JSON: ${String(err)}`,
        };
      }
      if (manifest['id'] !== extensionId) {
        return {
          ok: false,
          error:
            `extension.json.id ("${String(manifest['id'])}") does not match ` +
            `the declared extensionId ("${extensionId}"). They must be identical.`,
        };
      }
      if (typeof manifest['version'] !== 'string') {
        return { ok: false, error: 'extension.json.version must be a string.' };
      }
      // If caller passed a different version, prefer the manifest's.
      const finalVersion = String(manifest['version'] ?? version);

      // ── Write to a staging dir first, then hand to install() ──
      const userDir = ctx.extensionManager.getUserDir();
      const stagingDir = resolve(userDir, `.staging`, `${extensionId}@${finalVersion}`);
      try {
        // Ensure staging cleared
        if (existsSync(stagingDir)) {
          await fs.rm(stagingDir, { recursive: true, force: true });
        }
        await fs.mkdir(stagingDir, { recursive: true });
        for (const f of files) {
          const abs = resolve(stagingDir, f.path);
          // Belt-and-braces check the resolved path lives inside stagingDir.
          if (!abs.startsWith(stagingDir + sep) && abs !== stagingDir) {
            throw new Error(`refusing to write outside staging: ${f.path}`);
          }
          await fs.mkdir(dirname(abs), { recursive: true });
          await fs.writeFile(abs, f.content, 'utf8');
        }
      } catch (err) {
        return {
          ok: false,
          error: `staging write failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      // ── Install (copies staging → final location + validates + loads) ──
      let installed;
      try {
        installed = await ctx.extensionManager.install({
          path: stagingDir,
          scope: 'user',
          force,
        });
      } catch (err) {
        // Clean up staging on failure so we don't leak
        await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
        return {
          ok: false,
          error: `install failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      // Clean up staging — install() already copied to the real location.
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);

      // Collect the widgets the runtime actually registered (from the live
      // widget registry) so the caller can skip a follow-up `search_widget`
      // call and go straight to `render_widget`.
      const registeredWidgets = ctx.widgetRegistry
        ? ctx.widgetRegistry
            .list()
            .filter((w) => w.extensionId === installed.manifest.id)
            .map((w) => ({
              id: w.id,
              component: w.component,
              title: w.title,
              description: w.description,
              preferredSurface: w.preferredSurface,
              keywords: w.keywords ?? [],
              actions: (w.actions ?? []).map((a) => a.name),
            }))
        : [];

      const hintLines: string[] = [`Extension "${installed.manifest.id}" installed.`];
      if (registeredWidgets.length > 0) {
        hintLines.push(
          `Registered widgets (call render_widget with these ids):`,
          ...registeredWidgets.map(
            (w) => `  - "${w.id}"  (surface: ${w.preferredSurface}, title: ${w.title ?? w.component})`,
          ),
        );
      } else {
        hintLines.push(
          `No widgets registered. Check your entry file's loadExtension(ai) call.`,
        );
      }

      // A widget whose entry HTML was never written installs cleanly and only
      // fails much later as a blank panel, so report it while the agent still
      // has the file contents in hand.
      const missingEntries = (ctx.widgetRegistry?.list() ?? [])
        .filter((w) => w.extensionId === installed.manifest.id && Boolean(w.entry))
        .filter((w) => !existsSync(resolve(installed.rootPath, w.entry)))
        .map((w) => `${w.id} → ${w.entry}`);
      if (missingEntries.length > 0) {
        return {
          ok: false,
          error:
            `Extension "${installed.manifest.id}" installed, but these widgets declare entry ` +
            `files that were never written: ${missingEntries.join(', ')}. Call write_extension ` +
            `again with those files included — rendering will fail until they exist.`,
        };
      }

      return {
        ok: true,
        extensionId: installed.manifest.id,
        version: installed.manifest.version,
        scope: installed.scope,
        rootPath: installed.rootPath,
        ready: installed.ready,
        registeredWidgets,
        hint: hintLines.join('\n'),
        errors: installed.errors,
      };
    },
    owner: 'system:extension-author',
  };
}

// ── reload_extension ───────────────────────────────────────────

export function buildReloadExtensionTool(ctx: ExtensionAuthorContext): ToolDefinition {
  return {
    name: 'reload_extension',
    description:
      'Reload an already-installed extension from disk without a server ' +
      'restart. Useful after write_extension if you edited files afterwards, ' +
      'or if the user edited the extension folder manually. Returns the ' +
      'refreshed InstalledExtension record.',
    parametersSchema: {
      type: 'object',
      properties: {
        extensionId: {
          type: 'string',
          description: 'Id of the extension to reload, e.g. "user.pomodoro".',
        },
      },
      required: ['extensionId'],
    },
    handler: async (args) => {
      const extensionId = String(args['extensionId'] ?? '').trim();
      if (!EXT_ID.test(extensionId)) {
        return { ok: false, error: `Invalid extensionId "${extensionId}"` };
      }
      const reloaded = await ctx.extensionManager.reloadOne(extensionId);
      if (!reloaded) {
        return {
          ok: false,
          error: `Extension "${extensionId}" is not installed. Use write_extension first.`,
        };
      }
      return {
        ok: true,
        extensionId: reloaded.manifest.id,
        version: reloaded.manifest.version,
        scope: reloaded.scope,
        ready: reloaded.ready,
        errors: reloaded.errors,
      };
    },
    owner: 'system:extension-author',
  };
}

export const EXTENSION_AUTHOR_TOOL_NAMES = [
  'write_extension',
  'reload_extension',
] as const;

export type ExtensionAuthorToolName = (typeof EXTENSION_AUTHOR_TOOL_NAMES)[number];
