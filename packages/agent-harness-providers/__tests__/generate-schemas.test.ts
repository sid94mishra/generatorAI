/**
 * W45 — the protocol schema generator must actually generate.
 *
 * These tests exist because the previous `scripts/generate-schemas.ts` did
 * not. `generateOpenCode` and `generateCodex` each parsed a schema into a
 * `const schema` that was never read, then rewrote a single
 * `// Schema version:` comment line inside a hand-authored `.ts` file. Its
 * 70-line `jsonSchemaToTs()` was never called. CI diffed the result and would
 * have stayed green through any amount of upstream drift.
 *
 * The load-bearing test here is "output is derived from the artifact": mutate
 * the source schema, and the emitted TypeScript must change. Comment-patching
 * cannot pass it, because its output does not depend on the schema at all.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';

import { emitModule, runGenerator } from '../../../scripts/generate-schemas.js';

const require = createRequire(import.meta.url);

/** The real pinned artifact — the same one the generator reads. */
const ACP_ARTIFACT = require.resolve('@agentclientprotocol/sdk/schema/schema.json');

const META = {
  protocol: 'acp',
  sourceLabel: 'test',
  artifactSha256: 'x'.repeat(64),
  artifactPath: ACP_ARTIFACT,
};

function readAcpSchema(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(ACP_ARTIFACT, 'utf8')) as Record<string, unknown>;
}

const OUTPUT_SUBDIR = path.join('packages', 'agent-harness-providers', 'src', 'protocol');

/**
 * A throwaway repo-shaped tree: `schemas/versions.json` plus the protocol
 * output directory. Lets the generator be driven end to end without touching
 * the real one.
 */
function makeFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'w45-genschemas-'));
  fs.mkdirSync(path.join(root, 'schemas'), { recursive: true });
  fs.mkdirSync(path.join(root, OUTPUT_SUBDIR), { recursive: true });
  return root;
}

function writeManifest(root: string, protocols: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(root, 'schemas', 'versions.json'),
    JSON.stringify({ protocols }, null, 2),
    'utf8',
  );
}

function writeArtifact(root: string, relPath: string, schema: unknown): void {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(schema, null, 2), 'utf8');
}

/** Silences the generator's own reporting; these tests assert on return codes. */
const QUIET = { log: () => {}, error: () => {} };

let root: string;

beforeEach(() => {
  root = makeFixtureRoot();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('emitModule — output is derived from the artifact', () => {
  it('emits a type for every definition in the schema', () => {
    const schema = readAcpSchema();
    const defs = schema['$defs'] as Record<string, unknown>;
    const out = emitModule(schema, META);

    expect(Object.keys(defs).length).toBeGreaterThan(200);
    for (const name of Object.keys(defs)) {
      expect(out).toContain(`export type ${name} =`);
    }
  });

  it('renders the real ACP vocabulary, not a stand-in', () => {
    const out = emitModule(readAcpSchema(), META);

    // Scalar newtype, string enum, and tagged union — three distinct emitter
    // paths, all pinned to what upstream actually declares.
    expect(out).toContain('export type SessionId = string;');
    expect(out).toContain('export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";');
    expect(out).toContain('{\n  type: "text";\n} & TextContent');
  });

  it('DROPS a type when its definition is removed from the artifact', () => {
    // The regression test. A generator that patches a comment produces
    // identical output for both inputs and fails here.
    const full = readAcpSchema();
    expect(emitModule(full, META)).toContain('export type ToolKind =');

    const trimmed = readAcpSchema();
    delete (trimmed['$defs'] as Record<string, unknown>)['ToolKind'];

    const out = emitModule(trimmed, META);
    expect(out).not.toContain('export type ToolKind =');
    expect(out).not.toEqual(emitModule(full, META));
  });

  it('ADDS a type when a definition is added to the artifact', () => {
    const schema = readAcpSchema();
    (schema['$defs'] as Record<string, unknown>)['W45Probe'] = {
      description: 'Injected by the test.',
      type: 'object',
      properties: { probe: { type: 'string' } },
      required: ['probe'],
    };

    const out = emitModule(schema, META);
    expect(out).toContain('export type W45Probe = {');
    expect(out).toContain('  probe: string;');
  });

  it('reflects a renamed enum member', () => {
    const schema = readAcpSchema();
    const toolKind = (schema['$defs'] as Record<string, Record<string, unknown>>)['ToolKind']!;
    (toolKind['oneOf'] as Record<string, unknown>[])[0]!['const'] = 'renamed_upstream';

    expect(emitModule(schema, META)).toContain('"renamed_upstream"');
  });

  it('derives the method table from x-method/x-side', () => {
    const schema = readAcpSchema();
    expect(emitModule(schema, META)).toContain('"fs/write_text_file": { side: "client"');

    const renamed = readAcpSchema();
    (renamed['$defs'] as Record<string, Record<string, unknown>>)['WriteTextFileRequest']![
      'x-method'
    ] = 'fs/write_text_file_v2';

    // Only the Request was renamed; the Response still carries the original
    // method, so the old key survives — but it must lose the Request type and
    // the new key must pick it up. Both halves move, which is what makes this
    // a derivation rather than a copy.
    const out = emitModule(renamed, META);
    expect(out).toContain('"fs/write_text_file_v2": { side: "client", types: ["WriteTextFileRequest"] }');
    expect(out).toContain('"fs/write_text_file": { side: "client", types: ["WriteTextFileResponse"] }');
  });

  it('emits no duplicate keys in the method table', () => {
    // `authenticate` annotates both AuthenticateRequest and
    // AuthenticateResponse; one row per definition would be a TS error.
    const out = emitModule(readAcpSchema(), META);
    const table = out.slice(out.indexOf('export const ACP_METHODS'));
    const keys = [...table.matchAll(/^ {2}("[^"]+"|[A-Za-z_$][\w$]*): \{/gm)].map((m) => m[1]);

    expect(keys.length).toBeGreaterThan(20);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is deterministic', () => {
    expect(emitModule(readAcpSchema(), META)).toEqual(emitModule(readAcpSchema(), META));
  });

  it('records the artifact hash so drift is detectable', () => {
    const out = emitModule(readAcpSchema(), { ...META, artifactSha256: 'a'.repeat(64) });
    expect(out).toContain(`// Artifact sha256: ${'a'.repeat(64)}`);
  });

  it('refuses to emit an empty module', () => {
    expect(() => emitModule({ $defs: {} }, META)).toThrow(/contains no definitions/);
    expect(() => emitModule({}, META)).toThrow(/contains no definitions/);
  });

  it('flattens a declared namespace under a prefix rather than colliding', () => {
    // Codex ships `definitions.v2.*` alongside its top-level definitions, and
    // the two disagree: `RequestId` is a different type in each. A bare merge
    // would silently keep one and drop the other.
    const out = emitModule(
      {
        definitions: {
          RequestId: { type: 'string' },
          v2: {
            RequestId: { type: 'number' },
            TurnStartParams: {
              type: 'object',
              properties: { threadId: { $ref: '#/definitions/v2/RequestId' } },
              required: ['threadId'],
            },
          },
        },
      },
      { ...META, namespaces: ['v2'], methodTable: 'none' },
    );
    expect(out).toContain('export type RequestId = string;');
    expect(out).toContain('export type V2RequestId = number;');
    // …and a `$ref` INTO the namespace resolves to the prefixed name, not the
    // top-level twin.
    expect(out).toMatch(/threadId: V2RequestId;/);
  });

  it('derives a JSON-RPC method table from union method tags', () => {
    const out = emitModule(
      {
        definitions: {
          ClientRequest: {
            oneOf: [
              { properties: { method: { enum: ['thread/start'] } } },
              { properties: { method: { const: 'turn/start' } } },
            ],
          },
        },
      },
      { ...META, protocol: 'codex', tableName: 'CODEX', methodTable: 'jsonrpc' },
    );
    expect(out).toContain('export const CODEX_METHODS = {');
    expect(out).toContain('"thread/start"');
    expect(out).toContain('"turn/start"');
  });

  it('derives an OpenAPI operation table, recording which routes stream', () => {
    const out = emitModule(
      {
        components: { schemas: { Thing: { type: 'string' } } },
        paths: {
          '/event': {
            get: {
              operationId: 'event.subscribe',
              responses: { 200: { content: { 'text/event-stream': {} } } },
            },
          },
          '/session/{id}/message': {
            post: {
              operationId: 'session.prompt',
              responses: { 200: { content: { 'application/json': {} } } },
            },
          },
        },
      },
      {
        ...META,
        protocol: 'opencode',
        tableName: 'OPENCODE',
        methodTable: 'openapi',
        defsPath: 'components.schemas',
      },
    );
    // The streaming flag is the whole point: reading a JSON route as a stream
    // is the defect this table exists to make impossible to hold quietly.
    expect(out).toContain('"event.subscribe": { method: "GET", path: "/event", sse: true }');
    expect(out).toContain(
      '"session.prompt": { method: "POST", path: "/session/{id}/message", sse: false }',
    );
  });
});

describe('runGenerator — failure is loud, never silent', () => {
  const GOOD_SCHEMA = {
    $defs: {
      Widget: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  };

  it('writes the declared output and returns 0', () => {
    writeArtifact(root, 'schemas/test/artifact.json', GOOD_SCHEMA);
    writeManifest(root, {
      test: {
        status: 'generated',
        artifactPath: 'schemas/test/artifact.json',
        version: '9.9.9',
        output: 'test.generated.ts',
      },
    });

    expect(runGenerator({ root, ...QUIET })).toBe(0);

    const written = fs.readFileSync(path.join(root, OUTPUT_SUBDIR, 'test.generated.ts'), 'utf8');
    expect(written).toContain('export type Widget = {');
    expect(written).toMatch(/^\/\/ Artifact sha256: [0-9a-f]{64}$/m);
  });

  it('throws when a declared artifact is missing, rather than succeeding', () => {
    writeManifest(root, {
      test: {
        status: 'generated',
        artifactPath: 'schemas/test/does-not-exist.json',
        output: 'test.generated.ts',
      },
    });

    expect(() => runGenerator({ root, ...QUIET })).toThrow(/does not exist/);
    expect(fs.existsSync(path.join(root, OUTPUT_SUBDIR, 'test.generated.ts'))).toBe(false);
  });

  it('throws when the artifact is not valid JSON', () => {
    fs.mkdirSync(path.join(root, 'schemas', 'test'), { recursive: true });
    fs.writeFileSync(path.join(root, 'schemas/test/artifact.json'), '{ not json', 'utf8');
    writeManifest(root, {
      test: {
        status: 'generated',
        artifactPath: 'schemas/test/artifact.json',
        output: 'test.generated.ts',
      },
    });

    expect(() => runGenerator({ root, ...QUIET })).toThrow(/not valid JSON/);
  });

  it('throws when the artifact has no definitions, rather than emitting an empty file', () => {
    writeArtifact(root, 'schemas/test/artifact.json', { $defs: {} });
    writeManifest(root, {
      test: {
        status: 'generated',
        artifactPath: 'schemas/test/artifact.json',
        output: 'test.generated.ts',
      },
    });

    expect(() => runGenerator({ root, ...QUIET })).toThrow(/Refusing to emit an empty type module/);
    expect(fs.existsSync(path.join(root, OUTPUT_SUBDIR, 'test.generated.ts'))).toBe(false);
  });

  it('throws when an entry claims to be generatable but names no artifact', () => {
    writeManifest(root, { test: { status: 'generated', output: 'test.generated.ts' } });
    expect(() => runGenerator({ root, ...QUIET })).toThrow(/names neither "artifactPath"/);
  });

  it('returns non-zero when a protocol has no upstream artifact', () => {
    writeArtifact(root, 'schemas/test/artifact.json', GOOD_SCHEMA);
    writeManifest(root, {
      test: {
        status: 'generated',
        artifactPath: 'schemas/test/artifact.json',
        output: 'test.generated.ts',
      },
      gapped: {
        status: 'missing-upstream-artifact',
        npmPackage: 'some-upstream',
        reason: 'not a dependency here',
        howToObtain: ['pin it'],
        handWrittenStandIn: 'somewhere.ts',
      },
    });

    expect(runGenerator({ root, ...QUIET })).toBe(1);
    // ...but only the exit code is withheld: what CAN be generated still is,
    // so --allow-missing does not have to skip real work.
    expect(fs.existsSync(path.join(root, OUTPUT_SUBDIR, 'test.generated.ts'))).toBe(true);
  });

  it('returns 0 for the same gap under --allow-missing', () => {
    writeArtifact(root, 'schemas/test/artifact.json', GOOD_SCHEMA);
    writeManifest(root, {
      test: {
        status: 'generated',
        artifactPath: 'schemas/test/artifact.json',
        output: 'test.generated.ts',
      },
      gapped: {
        status: 'missing-upstream-artifact',
        npmPackage: 'some-upstream',
        reason: 'not a dependency here',
        howToObtain: ['pin it'],
        handWrittenStandIn: 'somewhere.ts',
      },
    });

    expect(runGenerator({ root, allowMissing: true, ...QUIET })).toBe(0);
  });

  it('names the missing artifact and how to obtain it', () => {
    writeArtifact(root, 'schemas/test/artifact.json', GOOD_SCHEMA);
    writeManifest(root, {
      test: {
        status: 'generated',
        artifactPath: 'schemas/test/artifact.json',
        output: 'test.generated.ts',
      },
      gapped: {
        status: 'missing-upstream-artifact',
        npmPackage: '@vendor/thing',
        reason: 'no binary on PATH',
        howToObtain: ['pin @vendor/thing at an exact version'],
        handWrittenStandIn: 'protocol/thing.handwritten.ts',
      },
    });

    const errors: string[] = [];
    runGenerator({ root, log: () => {}, error: (l) => errors.push(l) });
    const text = errors.join('\n');

    expect(text).toContain('@vendor/thing');
    expect(text).toContain('no binary on PATH');
    expect(text).toContain('pin @vendor/thing at an exact version');
    expect(text).toContain('protocol/thing.handwritten.ts');
  });

  it('refuses to report success when nothing at all is generated', () => {
    writeManifest(root, {
      gapped: {
        status: 'missing-upstream-artifact',
        npmPackage: 'some-upstream',
        reason: 'not a dependency here',
        howToObtain: ['pin it'],
        handWrittenStandIn: 'somewhere.ts',
      },
    });

    // Even with --allow-missing: a run that emits nothing certifies nothing,
    // which is exactly the vacuous-CI failure W45 exists to prevent.
    expect(runGenerator({ root, allowMissing: true, ...QUIET })).toBe(1);
  });
});

describe('the repo manifest', () => {
  const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

  const manifest = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'versions.json'), 'utf8'),
  ) as {
    protocols: Record<
      string,
      { status: string; handWrittenStandIn?: string; artifactPath?: string; capturedBy?: string }
    >;
  };

  it('generates ACP from the pinned SDK artifact', () => {
    expect(manifest.protocols['acp']).toMatchObject({
      status: 'generated',
      npmPackage: '@agentclientprotocol/sdk',
      artifactExport: './schema/schema.json',
    });
  });

  it('generates codex and opencode from committed upstream artifacts', () => {
    // Both were `missing-upstream-artifact` while hand-written stand-ins stood
    // in for them, describing vocabularies neither binary has ever spoken. The
    // real artifacts are now captured and committed, so nothing in this repo
    // claims a provenance it cannot show.
    for (const name of ['codex', 'opencode']) {
      const entry = manifest.protocols[name];
      expect(entry?.status, `${name} should be generated`).toBe('generated');
      expect(entry?.artifactPath, `${name} should name its artifact`).toBeTruthy();
      expect(entry?.capturedBy, `${name} should record how it was captured`).toBeTruthy();
    }
  });

  it('every declared artifact exists on disk', () => {
    for (const [name, entry] of Object.entries(manifest.protocols)) {
      if (!entry.artifactPath) continue;
      const full = path.join(REPO_ROOT, entry.artifactPath);
      expect(fs.existsSync(full), `${name}: ${entry.artifactPath} should exist`).toBe(true);
    }
  });

  it('no protocol is left standing on a hand-written stand-in', () => {
    for (const entry of Object.values(manifest.protocols)) {
      expect(entry.status).toBe('generated');
      expect(entry.handWrittenStandIn).toBeUndefined();
    }
    const dir = path.join(REPO_ROOT, OUTPUT_SUBDIR);
    const handWritten = fs.readdirSync(dir).filter((f) => f.includes('handwritten'));
    expect(handWritten, 'no *.handwritten.ts should remain').toEqual([]);
  });

  it('keeps the fabricated stub deleted', () => {
    // This file claimed "generated from pinned binary types. Do not hand-edit"
    // while being hand-invented. The real artifact replaces it under a name
    // that matches what upstream actually emits.
    expect(fs.existsSync(path.join(REPO_ROOT, 'schemas/codex/codex-rpc-schema.json'))).toBe(false);
    expect(
      fs.existsSync(path.join(REPO_ROOT, 'schemas/codex/codex_app_server_protocol.schemas.json')),
    ).toBe(true);
  });

  it('leaves no file in protocol/ claiming to be generated unless it is', () => {
    const dir = path.join(REPO_ROOT, OUTPUT_SUBDIR);
    const generatedOutputs = new Set(
      Object.values(manifest.protocols)
        .map((p) => (p as { output?: string }).output)
        .filter((o): o is string => typeof o === 'string'),
    );

    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const body = fs.readFileSync(path.join(dir, file), 'utf8');
      if (!body.startsWith('// AUTO-GENERATED')) continue;
      expect(generatedOutputs.has(file), `${file} claims AUTO-GENERATED but nothing emits it`).toBe(
        true,
      );
      expect(body).toMatch(/^\/\/ Artifact sha256: [0-9a-f]{64}$/m);
    }
  });
});
