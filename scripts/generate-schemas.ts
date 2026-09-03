#!/usr/bin/env tsx
/**
 * W45 — Protocol schema generator.
 *
 * L18 law: "Protocol schemas are generated from a pinned upstream artifact and
 * diffed in CI. Never hand-written."
 *
 * This script honours that law for the protocols where a pinned upstream
 * artifact actually exists, and refuses — loudly, with a non-zero exit — for
 * the ones where it does not. It never emits a file that claims upstream
 * provenance it cannot demonstrate.
 *
 * ── Why this file was rewritten ───────────────────────────────────────────
 * The previous version did not generate anything. `generateOpenCode` and
 * `generateCodex` each parsed a schema into a `const schema` that was then
 * never read, and rewrote a single `// Schema version:` comment line inside a
 * hand-authored `.ts` file. The 70-line `jsonSchemaToTs()` helper was dead
 * code — never called once. The two "pinned upstream artifacts" it read were
 * themselves hand-invented: `schemas/codex/codex-rpc-schema.json` described a
 * `session.create`/`turn`/`turn.steer` vocabulary that Codex's app-server does
 * not expose, and `schemas/opencode/openapi.json` listed Anthropic's SSE event
 * names as OpenCode's. Both carried a `$comment` reading "generated from
 * upstream spec. Do not hand-edit."
 *
 * The net effect was a CI-diffable "generated" tree that would stay green
 * forever no matter how far upstream drifted — the exact failure W45 exists to
 * prevent. Comment-patching is strictly worse than no generator, because it
 * produces the evidence of a working one.
 *
 * ── What is obtainable, verified 2026-08-30 ───────────────────────────────
 * ACP    → GENERATED. `@agentclientprotocol/sdk` is pinned to an exact version
 *          in packages/agent-harness-providers/package.json and ships the real
 *          370 KB JSON Schema at `schema/schema.json`, declared in its own
 *          `exports` map. That is a genuine, versioned, offline, pinned
 *          artifact, and every type emitted into `acp.generated.ts` — all 265
 *          of them — is derived from it.
 * codex  → NOT GENERATED. Requires `codex app-server generate-ts` run against
 *          a pinned `@openai/codex` binary. That package is not a dependency
 *          of this repo and no `codex` binary is on PATH.
 * opencode → NOT GENERATED. Requires the OpenAPI 3.1 document served at
 *          `GET /doc` by a running `opencode serve` from a pinned
 *          `opencode-ai`. Not a dependency here, and no `opencode` binary on
 *          PATH.
 *
 * Neither gap can be closed by this script alone: both need a new pinned
 * dependency plus a build step that executes a third-party binary. Until then
 * `codex.handwritten.ts` and `opencode.handwritten.ts` hold hand-written
 * stand-ins whose headers say so plainly.
 *
 * ── Exit codes ────────────────────────────────────────────────────────────
 *   0  every protocol either generated, or missing-and-`--allow-missing`
 *   1  a protocol is missing its artifact (default), or a protocol declared
 *      generatable could not be generated (always fatal, flag or not)
 *
 * Usage:
 *   pnpm generate:schemas                  # fails loudly on the known gaps
 *   pnpm generate:schemas --allow-missing  # CI: proceed, but assert the gap set
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const OUTPUT_SUBDIR = path.join('packages', 'agent-harness-providers', 'src', 'protocol');

const manifestFileFor = (root: string) => path.join(root, 'schemas', 'versions.json');
const outputDirFor = (root: string) => path.join(root, OUTPUT_SUBDIR);

// ── Manifest ─────────────────────────────────────────────────────────────

/**
 * A protocol whose upstream artifact is available to this repo, either inside
 * a pinned npm dependency (`npmPackage` + `artifactExport`) or committed under
 * `schemas/` (`artifactPath`, repo-root-relative).
 *
 * Both forms exist because they are the two ways the remaining gaps close: ACP
 * ships its schema inside the SDK, whereas Codex's `generate-ts` output and
 * OpenCode's `GET /doc` response would have to be committed as files.
 */
interface GeneratedProtocol {
  status: 'generated';
  /** Package that ships the artifact. Its version becomes the recorded pin. */
  npmPackage?: string;
  /** Subpath export resolving to the artifact, e.g. './schema/schema.json'. */
  artifactExport?: string;
  /** Repo-root-relative path to a committed artifact. Alternative to the pair above. */
  artifactPath?: string;
  /** Version recorded in the header when `artifactPath` is used. */
  version?: string;
  /**
   * How the artifact was captured, for the emitted header. Committed artifacts
   * have no `require.resolve` trail to point at, so the command that produced
   * them is recorded instead of being left to folklore.
   */
  capturedBy?: string;
  /**
   * Dotted path to the object holding the definitions, when it is not the
   * conventional `$defs` / `definitions`. OpenAPI keeps them under
   * `components.schemas`.
   */
  defsPath?: string;
  /**
   * Nested definition namespaces to flatten into the output, e.g. `["v2"]` for
   * Codex's `definitions.v2.*`.
   *
   * Names from a namespace are ALWAYS prefixed with its capitalised name
   * (`v2` → `V2ThreadStartParams`). Prefixing unconditionally rather than only
   * on collision is deliberate: Codex already ships two `RequestId`s whose
   * shapes differ, and a collision-triggered rename would silently move an
   * existing exported name the day upstream adds a top-level twin of some v2
   * type. A stable name is worth the four characters.
   */
  namespaces?: string[];
  /**
   * Which table to derive alongside the types:
   *   'x-method' — ACP's `x-method`/`x-side` annotations.
   *   'jsonrpc'  — method `const`/`enum` tags inside request/notification unions.
   *   'openapi'  — the `paths` object: one row per operation.
   *   'none'     — types only.
   * Defaults to 'x-method' for backwards compatibility with the ACP entry.
   */
  methodTable?: 'x-method' | 'jsonrpc' | 'openapi' | 'none';
  /** Prefix for emitted table constants, e.g. `ACP` → `ACP_METHODS`. */
  tableName?: string;
  /** Emitted file, relative to the protocol output directory. */
  output: string;
}

/** A protocol whose upstream artifact cannot be obtained in this repo today. */
interface MissingProtocol {
  status: 'missing-upstream-artifact';
  /** Upstream package that would supply it, for the failure message. */
  npmPackage: string;
  /** Why it cannot be produced here. */
  reason: string;
  /** Concrete steps a human would run to close the gap. */
  howToObtain: string[];
  /** The hand-written stand-in currently compiled in its place. */
  handWrittenStandIn: string;
}

type Protocol = GeneratedProtocol | MissingProtocol;

interface Manifest {
  protocols: Record<string, Protocol>;
}

function readManifest(root: string): Manifest {
  const manifestFile = manifestFileFor(root);
  const raw = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Manifest;
  if (!raw.protocols || typeof raw.protocols !== 'object') {
    throw new Error(`${manifestFile} has no "protocols" object.`);
  }
  return raw;
}

// ── JSON Schema → TypeScript ─────────────────────────────────────────────
//
// Covers the JSON Schema 2020-12 subset the ACP artifact actually uses:
// $ref/$defs, const, enum, oneOf, anyOf, allOf, type arrays (for `T | null`),
// object properties + required, additionalProperties, and array items.
// Annotation-only keywords (title, format, default, minimum, maximum,
// discriminator, x-*) carry no type information and are skipped; `not` and
// `unevaluatedProperties` only narrow a type that is already expressible, so
// skipping them widens rather than falsifies.

type JsonSchema = Record<string, unknown>;

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Pointer → emitted type name, for the artifact currently being rendered.
 *
 * A module-scoped map rather than a threaded parameter: `typeExpr` recurses
 * through a dozen call sites and the emitter is synchronous and
 * single-artifact, so threading a resolver through every one of them would be
 * noise. `emitModule` sets it and clears it in a `finally`.
 */
let activeRefAliases: ReadonlyMap<string, string> | null = null;

/** Bare JSON-pointer leaf → identifier, ignoring any namespace. */
function bareRefName(ref: string): string {
  const leaf = ref.split('/').pop() ?? ref;
  const sanitised = leaf.replace(/[^A-Za-z0-9_$]/g, '_');
  return IDENT_RE.test(sanitised) ? sanitised : `_${sanitised}`;
}

/**
 * `#/$defs/ToolCallId` → `ToolCallId`, and `#/definitions/v2/TurnStartParams`
 * → `V2TurnStartParams` when the artifact declares a `v2` namespace.
 *
 * Falls back to the bare leaf so a pointer into a part of the artifact we do
 * not emit still produces a readable (if unresolved) name rather than throwing
 * mid-render.
 */
function refName(ref: string): string {
  const aliased = activeRefAliases?.get(ref);
  return aliased ?? bareRefName(ref);
}

/**
 * Renders a description as a JSDoc block. Upstream descriptions are multi-line
 * Markdown containing links, so they are re-wrapped rather than inlined, and
 * any literal `*​/` is defanged so a description can never terminate the block
 * it lives in.
 */
function jsDoc(description: unknown, indent: string): string[] {
  if (typeof description !== 'string' || description.trim() === '') return [];
  const safe = description.replace(/\*\//g, '*\\/');
  const lines = safe.split('\n');
  if (lines.length === 1) return [`${indent}/** ${lines[0]} */`];
  return [
    `${indent}/**`,
    ...lines.map((l) => (l.trim() === '' ? `${indent} *` : `${indent} * ${l}`)),
    `${indent} */`,
  ];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Wraps in parentheses only when the expression is a union or intersection. */
function parenthesise(expr: string): string {
  return /[|&]/.test(expr) && !expr.startsWith('(') ? `(${expr})` : expr;
}

function objectLiteral(schema: JsonSchema, indent: string): string {
  const properties = schema['properties'] as Record<string, JsonSchema> | undefined;
  const required = new Set((schema['required'] as string[] | undefined) ?? []);

  if (!properties || Object.keys(properties).length === 0) {
    // No declared shape: fall back to what additionalProperties permits.
    const additional = schema['additionalProperties'];
    if (additional === false) return 'Record<string, never>';
    if (additional && typeof additional === 'object') {
      return `Record<string, ${typeExpr(additional, indent)}>`;
    }
    return 'Record<string, unknown>';
  }

  const inner = indent + '  ';
  const lines: string[] = ['{'];
  for (const [key, propSchema] of Object.entries(properties)) {
    lines.push(...jsDoc(propSchema['description'], inner));
    const name = IDENT_RE.test(key) ? key : JSON.stringify(key);
    const optional = required.has(key) ? '' : '?';
    lines.push(`${inner}${name}${optional}: ${typeExpr(propSchema, inner)};`);
  }
  lines.push(`${indent}}`);
  return lines.join('\n');
}

function typeExpr(schemaLike: unknown, indent: string): string {
  // JSON Schema permits a bare boolean where a schema is expected.
  if (typeof schemaLike === 'boolean') return schemaLike ? 'unknown' : 'never';
  if (!schemaLike || typeof schemaLike !== 'object' || Array.isArray(schemaLike)) return 'unknown';
  const schema = schemaLike as JsonSchema;

  if (typeof schema['$ref'] === 'string') return refName(schema['$ref'] as string);

  if ('const' in schema) return JSON.stringify(schema['const']);

  if (Array.isArray(schema['enum'])) {
    return unique((schema['enum'] as unknown[]).map((v) => JSON.stringify(v))).join(' | ');
  }

  // oneOf/anyOf are both unions here: the artifact uses oneOf for closed
  // variant sets and anyOf for `T | null`, and TypeScript expresses both the
  // same way (it has no exclusive-union form).
  for (const key of ['oneOf', 'anyOf'] as const) {
    const branches = schema[key] as JsonSchema[] | undefined;
    if (Array.isArray(branches) && branches.length > 0) {
      const parts = unique(branches.map((b) => parenthesise(typeExpr(b, indent))));
      return parts.length === 1 ? (parts[0] as string) : parts.join(' | ');
    }
  }

  // `allOf` composes. A schema may carry BOTH its own properties and an
  // allOf — the artifact's tagged unions look like
  //   { properties: { type: { const: 'text' } }, allOf: [{ $ref: TextContent }] }
  // which must become `{ type: "text" } & TextContent`, not one or the other.
  const allOf = schema['allOf'] as JsonSchema[] | undefined;
  if (Array.isArray(allOf) && allOf.length > 0) {
    const parts: string[] = [];
    if (schema['properties'] || schema['type'] === 'object') {
      parts.push(objectLiteral(schema, indent));
    }
    parts.push(...allOf.map((s) => parenthesise(typeExpr(s, indent))));
    const deduped = unique(parts);
    return deduped.length === 1 ? (deduped[0] as string) : deduped.join(' & ');
  }

  const type = schema['type'];

  // `type: ["object", "null"]` — a union over the primitive names.
  if (Array.isArray(type)) {
    const parts = unique(
      type.map((t) => typeExpr({ ...schema, type: t } as JsonSchema, indent)),
    );
    return parts.length === 1 ? (parts[0] as string) : parts.join(' | ');
  }

  switch (type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array': {
      const items = schema['items'] as JsonSchema | undefined;
      return items ? `Array<${typeExpr(items, indent)}>` : 'unknown[]';
    }
    case 'object':
      return objectLiteral(schema, indent);
    default:
      // No `type` but properties present: still an object.
      if (schema['properties']) return objectLiteral(schema, indent);
      return 'unknown';
  }
}

/**
 * Emits `export type X = ...` for every entry in `$defs`.
 *
 * Type aliases rather than interfaces throughout: the artifact's tagged unions
 * are intersections and its scalar newtypes (`SessionId`, `ToolCallId`) are
 * bare strings, neither of which an interface can express.
 */
function emitDefinitions(defs: Record<string, JsonSchema>): string[] {
  const out: string[] = [];
  for (const [name, schema] of Object.entries(defs)) {
    out.push(...jsDoc(schema['description'], ''));
    out.push(`export type ${refName(name)} = ${typeExpr(schema, '')};`);
    out.push('');
  }
  return out;
}

/**
 * ACP: emits the method table derived from the artifact's `x-method` / `x-side`
 * annotations. This is the part the ACP provider can actually assert against:
 * a method renamed upstream changes this table, and the CI diff catches it.
 */
function emitXMethodTable(defs: Record<string, JsonSchema>, tableName: string): string[] {
  // Grouped by method, not one row per definition: several definitions share a
  // method (`authenticate` annotates both AuthenticateRequest and
  // AuthenticateResponse), and emitting a row each produces a duplicate key,
  // which is a TypeScript error in an object literal.
  const byMethod = new Map<string, { sides: Set<string>; types: Set<string> }>();
  for (const [name, schema] of Object.entries(defs)) {
    const method = schema['x-method'];
    if (typeof method !== 'string') continue;
    const side = typeof schema['x-side'] === 'string' ? (schema['x-side'] as string) : 'unknown';
    let entry = byMethod.get(method);
    if (!entry) {
      entry = { sides: new Set(), types: new Set() };
      byMethod.set(method, entry);
    }
    entry.sides.add(side);
    entry.types.add(refName(name));
  }
  if (byMethod.size === 0) return [];

  // Sorted so the emitted table is stable under upstream key reordering —
  // otherwise a no-op upstream reshuffle produces a noisy CI diff.
  const methods = [...byMethod.keys()].sort();

  const out: string[] = [
    '/**',
    ' * Every JSON-RPC method the artifact annotates, with the side that serves',
    ' * it and the types carrying its payloads (request and response both carry',
    ' * the same `x-method`). Derived from `x-method`/`x-side`.',
    ' */',
    `export const ${tableName}_METHODS = {`,
  ];
  for (const method of methods) {
    const entry = byMethod.get(method)!;
    const key = IDENT_RE.test(method) ? method : JSON.stringify(method);
    const side = [...entry.sides].sort().join('+');
    const types = [...entry.types].sort().map((t) => JSON.stringify(t)).join(', ');
    out.push(`  ${key}: { side: ${JSON.stringify(side)}, types: [${types}] },`);
  }
  out.push('} as const;', '');
  out.push('/** Method names present in the pinned artifact. */');
  out.push(`export type ${titleCase(tableName)}MethodName = keyof typeof ${tableName}_METHODS;`);
  out.push('');
  return out;
}

/**
 * JSON-RPC (Codex): derives the wire method names from the request and
 * notification union definitions.
 *
 * Codex tags each union variant with a `method` property carrying a single
 * `enum`/`const` value, so the set of methods is recoverable from the schema
 * without any bespoke annotation. This is the table that turns a renamed
 * upstream method into a failing CI diff instead of a runtime "unknown method".
 *
 * The scanned unions are the protocol's own entry points; everything else in
 * the artifact is a payload type and carries no method tag.
 */
const JSONRPC_UNION_DEFS: readonly string[] = [
  'ClientRequest',
  'ClientNotification',
  'ServerRequest',
  'ServerNotification',
];

function methodTagsOf(schema: JsonSchema): string[] {
  const found: string[] = [];
  const branches = [
    ...((schema['oneOf'] as JsonSchema[] | undefined) ?? []),
    ...((schema['anyOf'] as JsonSchema[] | undefined) ?? []),
  ];
  for (const branch of branches) {
    const props = branch['properties'] as Record<string, JsonSchema> | undefined;
    const method = props?.['method'];
    if (!method) continue;
    if (typeof method['const'] === 'string') found.push(method['const']);
    else if (Array.isArray(method['enum'])) {
      for (const v of method['enum']) if (typeof v === 'string') found.push(v);
    }
  }
  return found;
}

function emitJsonRpcTable(defs: Record<string, JsonSchema>, tableName: string): string[] {
  const byUnion = new Map<string, string[]>();
  for (const union of JSONRPC_UNION_DEFS) {
    // A namespaced artifact exposes these as both `ClientRequest` and
    // `V2ClientRequest`. Emit whichever the artifact actually defines; both,
    // when both exist, because the two namespaces are genuinely different
    // surfaces and a client may speak either.
    for (const candidate of [union, `V2${union}`]) {
      const schema = defs[candidate];
      if (!schema) continue;
      const methods = methodTagsOf(schema);
      if (methods.length > 0) byUnion.set(candidate, [...new Set(methods)].sort());
    }
  }
  if (byUnion.size === 0) return [];

  const out: string[] = [
    '/**',
    ' * Every JSON-RPC method name the artifact declares, grouped by the union',
    ' * that carries it. Derived from the `method` tag on each union variant, so',
    " * a method renamed upstream changes this table and CI's `git diff` fails.",
    ' */',
    `export const ${tableName}_METHODS = {`,
  ];
  for (const union of [...byUnion.keys()].sort()) {
    const methods = byUnion.get(union)!;
    out.push(`  ${union}: [`);
    for (const m of methods) out.push(`    ${JSON.stringify(m)},`);
    out.push('  ],');
  }
  out.push('} as const;', '');
  out.push('/** Union of every method name in the pinned artifact. */');
  out.push(
    `export type ${titleCase(tableName)}MethodName =`,
    `  (typeof ${tableName}_METHODS)[keyof typeof ${tableName}_METHODS][number];`,
    '',
  );
  return out;
}

/**
 * OpenAPI (OpenCode): derives the endpoint table from the `paths` object.
 *
 * One row per operation, keyed by `operationId` where upstream supplies one.
 * The row records the HTTP method, the path template and whether the success
 * response is an SSE stream — the three things a client must get right, and
 * three the hand-written stand-in got wrong.
 */
function emitOpenApiTable(schema: JsonSchema, tableName: string): string[] {
  const paths = schema['paths'] as Record<string, Record<string, JsonSchema>> | undefined;
  if (!paths || Object.keys(paths).length === 0) return [];

  const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
  interface Row { id: string; method: string; path: string; sse: boolean }
  const rows: Row[] = [];

  for (const [pathTemplate, item] of Object.entries(paths)) {
    for (const httpMethod of HTTP_METHODS) {
      const op = item[httpMethod];
      if (!op || typeof op !== 'object') continue;
      const responses = (op['responses'] ?? {}) as Record<string, JsonSchema>;
      const sse = Object.values(responses).some((r) =>
        Object.keys((r?.['content'] ?? {}) as Record<string, unknown>).includes('text/event-stream'),
      );
      const rawId =
        typeof op['operationId'] === 'string' && op['operationId'].trim() !== ''
          ? op['operationId']
          : `${httpMethod}${pathTemplate}`;
      rows.push({ id: rawId, method: httpMethod.toUpperCase(), path: pathTemplate, sse });
    }
  }
  if (rows.length === 0) return [];

  // Sorted by id for a stable diff. Duplicate ids would be a duplicate object
  // key (a TypeScript error), so they are disambiguated rather than silently
  // dropped — losing an endpoint from this table is the one outcome that would
  // make it lie.
  rows.sort((a, b) => (a.id === b.id ? a.path.localeCompare(b.path) : a.id.localeCompare(b.id)));
  const seen = new Map<string, number>();
  for (const row of rows) {
    const n = (seen.get(row.id) ?? 0) + 1;
    seen.set(row.id, n);
    if (n > 1) row.id = `${row.id}#${n}`;
  }

  const out: string[] = [
    '/**',
    ' * Every operation the pinned OpenAPI document declares: HTTP method, path',
    ' * template, and whether the success response is a `text/event-stream`.',
    ' *',
    ' * `sse` is the load-bearing column — reading a JSON endpoint as a stream',
    ' * (or the reverse) is exactly the mistake this table makes impossible to',
    " * hold for long, because upstream flipping it fails CI's `git diff`.",
    ' */',
    `export const ${tableName}_OPERATIONS = {`,
  ];
  for (const row of rows) {
    const key = IDENT_RE.test(row.id) ? row.id : JSON.stringify(row.id);
    out.push(
      `  ${key}: { method: ${JSON.stringify(row.method)}, ` +
        `path: ${JSON.stringify(row.path)}, sse: ${row.sse} },`,
    );
  }
  out.push('} as const;', '');
  out.push('/** Operation ids present in the pinned document. */');
  out.push(`export type ${titleCase(tableName)}OperationId = keyof typeof ${tableName}_OPERATIONS;`);
  out.push('');
  return out;
}

/** `ACP` → `Acp`, for type names derived from a table prefix. */
function titleCase(name: string): string {
  return name.charAt(0) + name.slice(1).toLowerCase();
}

// ── Generation ───────────────────────────────────────────────────────────

interface GenerationResult {
  protocol: string;
  outputPath: string;
  artifactPath: string;
  artifactSha256: string;
  version: string;
  definitionCount: number;
}

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Resolves the artifact through the dependency's own `exports` map, so a
 * package that stops publishing the file fails here rather than silently
 * falling back to a stale copy. A committed artifact is resolved from the repo
 * root instead.
 */
function resolveArtifact(
  spec: GeneratedProtocol,
  root: string,
): { artifactPath: string; version: string; sourceLabel: string } {
  if (spec.artifactPath) {
    const artifactPath = path.resolve(root, spec.artifactPath);
    if (!fs.existsSync(artifactPath)) {
      throw new Error(
        `Artifact "${spec.artifactPath}" is declared in the manifest but does not exist ` +
          `at ${artifactPath}. Refusing to emit types with no source.`,
      );
    }
    const version = spec.version ?? 'unpinned';
    return { artifactPath, version, sourceLabel: `${spec.artifactPath}@${version}` };
  }

  if (!spec.npmPackage || !spec.artifactExport) {
    throw new Error(
      `Manifest entry declares status=generated but names neither "artifactPath" nor ` +
        `"npmPackage"+"artifactExport". There is no artifact to generate from.`,
    );
  }

  const request = `${spec.npmPackage}/${spec.artifactExport.replace(/^\.\//, '')}`;
  let artifactPath: string;
  try {
    artifactPath = require.resolve(request);
  } catch (cause) {
    throw new Error(
      `Cannot resolve "${request}". The pinned artifact is not installed.\n` +
        `  Fix: pnpm install, and confirm "${spec.npmPackage}" still exports "${spec.artifactExport}".`,
      { cause },
    );
  }
  // Walk up from the resolved artifact rather than resolving
  // `<pkg>/package.json` directly: a package with an `exports` map need not
  // expose its own manifest as a subpath, and @agentclientprotocol/sdk does
  // not. This finds the manifest that actually owns the file we just read.
  const version = readOwningPackageVersion(artifactPath, spec.npmPackage);
  return {
    artifactPath,
    version,
    sourceLabel: `${spec.npmPackage}@${version} → ${spec.artifactExport}`,
  };
}

function readOwningPackageVersion(artifactPath: string, npmPackage: string): string {
  let dir = path.dirname(artifactPath);
  while (true) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === npmPackage && typeof pkg.version === 'string') return pkg.version;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Resolved ${artifactPath} but found no package.json for "${npmPackage}" above it, ` +
      `so the artifact cannot be attributed to a pinned version. Refusing to emit an ` +
      `unattributed "generated" file.`,
  );
}

/** Reads a dotted path (`components.schemas`) out of a parsed artifact. */
function readDefsAt(schema: JsonSchema, dotted: string): unknown {
  let node: unknown = schema;
  for (const segment of dotted.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/** Where the definitions live, and the JSON-pointer prefix that reaches them. */
function defsLocation(spec: Pick<GeneratedProtocol, 'defsPath'>, schema: JsonSchema): {
  defs: Record<string, JsonSchema>;
  pointerPrefix: string;
} | null {
  if (spec.defsPath) {
    const found = readDefsAt(schema, spec.defsPath);
    if (found && typeof found === 'object') {
      return {
        defs: found as Record<string, JsonSchema>,
        pointerPrefix: `#/${spec.defsPath.split('.').join('/')}`,
      };
    }
    return null;
  }
  for (const key of ['$defs', 'definitions'] as const) {
    const found = schema[key];
    if (found && typeof found === 'object') {
      return { defs: found as Record<string, JsonSchema>, pointerPrefix: `#/${key}` };
    }
  }
  return null;
}

/**
 * Flattens the artifact's definitions — including any declared nested
 * namespaces — into one emitted name space, and records the pointer→name map
 * `refName` needs to resolve `$ref`s against it.
 */
export function collectDefinitions(
  schema: JsonSchema,
  spec: Pick<GeneratedProtocol, 'defsPath' | 'namespaces'>,
): { defs: Record<string, JsonSchema>; aliases: Map<string, string> } | null {
  const located = defsLocation(spec, schema);
  if (!located) return null;
  const { defs: rawDefs, pointerPrefix } = located;

  const namespaces = spec.namespaces ?? [];
  const defs: Record<string, JsonSchema> = {};
  const aliases = new Map<string, string>();

  for (const [name, value] of Object.entries(rawDefs)) {
    // A declared namespace is a container of definitions, not a definition.
    if (namespaces.includes(name)) continue;
    if (!value || typeof value !== 'object') continue;
    const emitted = bareRefName(name);
    defs[emitted] = value as JsonSchema;
    aliases.set(`${pointerPrefix}/${name}`, emitted);
  }

  for (const ns of namespaces) {
    const bucket = rawDefs[ns];
    if (!bucket || typeof bucket !== 'object') {
      throw new Error(
        `Manifest declares namespace "${ns}" but the artifact has no ` +
          `"${pointerPrefix}/${ns}" object to flatten.`,
      );
    }
    const prefix = ns.charAt(0).toUpperCase() + ns.slice(1);
    for (const [name, value] of Object.entries(bucket as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const emitted = `${prefix}${bareRefName(name)}`;
      defs[emitted] = value as JsonSchema;
      aliases.set(`${pointerPrefix}/${ns}/${name}`, emitted);
    }
  }

  return { defs, aliases };
}

/**
 * Renders a whole type module from a parsed artifact. Pure: same artifact in,
 * same bytes out, no filesystem. Exported so tests can assert the output is
 * genuinely derived — mutate the artifact, and this must change.
 */
export function emitModule(
  schema: JsonSchema,
  meta: {
    protocol: string;
    sourceLabel: string;
    artifactSha256: string;
    artifactPath: string;
    capturedBy?: string;
    defsPath?: string;
    namespaces?: string[];
    methodTable?: GeneratedProtocol['methodTable'];
    tableName?: string;
  },
): string {
  const collected = collectDefinitions(schema, meta);
  if (!collected || Object.keys(collected.defs).length === 0) {
    throw new Error(
      `${meta.artifactPath} contains no definitions at ` +
        `${meta.defsPath ?? '"$defs"/"definitions"'}. ` +
        `Refusing to emit an empty type module.`,
    );
  }
  const { defs, aliases } = collected;
  const tableName = meta.tableName ?? meta.protocol.toUpperCase();

  const header = [
    '// AUTO-GENERATED — do not edit. Run `pnpm generate:schemas` to update.',
    `// Protocol:        ${meta.protocol}`,
    `// Source artifact: ${meta.sourceLabel}`,
    ...(meta.capturedBy ? [`// Captured by:     ${meta.capturedBy}`] : []),
    `// Artifact sha256: ${meta.artifactSha256}`,
    `// Definitions:     ${Object.keys(defs).length}`,
    '//',
    '// The sha256 above is of the upstream file itself. If the pinned dependency',
    '// changes, this hash and the types below change with it, and CI\'s',
    '// `git diff --exit-code` turns that into a failing build instead of a',
    '// runtime decode error.',
    '',
  ];
  // No blanket `/* eslint-disable */`: the emitted output lints clean today,
  // and if an upstream change ever makes it not, that is signal about the
  // emitter worth surfacing rather than suppressing.

  // `refName` resolves `$ref`s through this map for the duration of the render.
  // Cleared in `finally` so a throw cannot leak one artifact's names into the
  // next protocol's output.
  activeRefAliases = aliases;
  try {
    const table = ((): string[] => {
      switch (meta.methodTable ?? 'x-method') {
        case 'none': return [];
        case 'jsonrpc': return emitJsonRpcTable(defs, tableName);
        case 'openapi': return emitOpenApiTable(schema, tableName);
        case 'x-method': return emitXMethodTable(defs, tableName);
      }
    })();
    const body = [...emitDefinitions(defs), ...table];
    return `${[...header, ...body].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
  } finally {
    activeRefAliases = null;
  }
}

function generateProtocol(
  protocol: string,
  spec: GeneratedProtocol,
  root: string,
): GenerationResult {
  const { artifactPath, version, sourceLabel } = resolveArtifact(spec, root);
  const bytes = fs.readFileSync(artifactPath);
  const artifactSha256 = sha256(bytes);

  let schema: JsonSchema;
  try {
    schema = JSON.parse(bytes.toString('utf8')) as JsonSchema;
  } catch (cause) {
    throw new Error(`${artifactPath} is not valid JSON, so no types can be derived from it.`, {
      cause,
    });
  }

  const contents = emitModule(schema, {
    protocol,
    sourceLabel,
    artifactSha256,
    artifactPath,
    capturedBy: spec.capturedBy,
    defsPath: spec.defsPath,
    namespaces: spec.namespaces,
    methodTable: spec.methodTable,
    tableName: spec.tableName,
  });
  // Counted from the same collection the emitter used, not re-derived from a
  // hard-coded `$defs`: the reported number must be the number of types the
  // file actually contains, namespaces included.
  const collected = collectDefinitions(schema, spec);

  const outputPath = path.join(outputDirFor(root), spec.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, contents, 'utf8');

  return {
    protocol,
    outputPath,
    artifactPath,
    artifactSha256,
    version,
    definitionCount: Object.keys(collected?.defs ?? {}).length,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────

export interface RunOptions {
  /** Repo root holding `schemas/versions.json` and the protocol output dir. */
  root?: string;
  /** Tolerate protocols declared `missing-upstream-artifact`. */
  allowMissing?: boolean;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

/**
 * Runs the generator and returns the process exit code. Exported and
 * root-parameterised so tests can drive it against a fixture tree rather than
 * mutating the real one.
 */
export function runGenerator(options: RunOptions = {}): number {
  const root = options.root ?? REPO_ROOT;
  const allowMissing = options.allowMissing ?? false;
  const log = options.log ?? ((l: string) => console.log(l));
  const error = options.error ?? ((l: string) => console.error(l));

  const manifest = readManifest(root);
  const generated: GenerationResult[] = [];
  const missing: [string, MissingProtocol][] = [];

  log('Generating protocol schemas...\n');

  for (const [protocol, spec] of Object.entries(manifest.protocols)) {
    if (spec.status === 'generated') {
      // A declared-generatable protocol that cannot be generated is always
      // fatal — --allow-missing covers known gaps, never a broken pin.
      const result = generateProtocol(protocol, spec, root);
      generated.push(result);
      log(
        `  ✓ ${protocol}: ${result.definitionCount} definitions from ` +
          `${spec.npmPackage ?? spec.artifactPath}@${result.version} ` +
          `(sha256 ${result.artifactSha256.slice(0, 12)}…)`,
      );
      log(`      → ${path.relative(root, result.outputPath)}`);
    } else {
      missing.push([protocol, spec]);
    }
  }

  if (generated.length === 0) {
    error('\nERROR: no protocol was generated. Refusing to report success.');
    return 1;
  }

  if (missing.length > 0) {
    error('');
    error('─'.repeat(72));
    error('NOT GENERATED — no pinned upstream artifact available');
    error('─'.repeat(72));
    for (const [protocol, spec] of missing) {
      error('');
      error(`  ${protocol} (would come from ${spec.npmPackage})`);
      error(`    Why:  ${spec.reason}`);
      error('    Fix:');
      for (const step of spec.howToObtain) error(`      - ${step}`);
      error(`    Meanwhile: ${spec.handWrittenStandIn}`);
      error('               is HAND-WRITTEN and is not verified against upstream.');
    }
    error('');
    error('─'.repeat(72));

    if (!allowMissing) {
      error(
        'Exiting non-zero: L18 requires a pinned upstream artifact per protocol.\n' +
          'Pass --allow-missing to proceed with these gaps recorded (CI does this,\n' +
          'and separately asserts the gap set has not grown).',
      );
      return 1;
    }
    error('--allow-missing given: proceeding with the gaps above recorded.');
  }

  log('');
  log('Verify CI would pass:');
  log(`  git diff --exit-code ${OUTPUT_SUBDIR.split(path.sep).join('/')}/`);
  return 0;
}

/**
 * Only run when executed as a script. Importing this module (the tests do)
 * must not generate anything or exit the process.
 */
function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
}

if (isMain()) {
  try {
    process.exit(runGenerator({ allowMissing: process.argv.includes('--allow-missing') }));
  } catch (err) {
    // Loud and specific: the whole point of this rewrite is that a generator
    // which cannot do its job must say so rather than exiting 0.
    console.error('');
    console.error('GENERATION FAILED');
    console.error(err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.cause) console.error(`  caused by: ${String(err.cause)}`);
    process.exit(1);
  }
}
