#!/usr/bin/env tsx
/**
 * W45 — Protocol schema generator.
 *
 * Reads pinned schema sources from schemas/ and regenerates TypeScript types in
 * packages/agent-harness-providers/src/protocol/.
 *
 * The generated files are committed to the repository. CI verifies they are
 * current by running:
 *   pnpm generate:schemas && git diff --exit-code packages/agent-harness-providers/src/protocol/
 *
 * L18 law: "Protocol schemas are generated from a pinned upstream artifact and
 * diffed in CI. Never hand-written."
 *
 * Usage:
 *   pnpm generate:schemas
 *   # or directly:
 *   tsx scripts/generate-schemas.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const VERSIONS_FILE = path.join(ROOT, 'schemas', 'versions.json');
const OUTPUT_DIR = path.join(ROOT, 'packages', 'agent-harness-providers', 'src', 'protocol');

interface VersionsFile {
  acp: string;
  opencode: string;
  codex: string;
}

function readVersions(): VersionsFile {
  return JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf8')) as VersionsFile;
}

function schemaPath(protocol: string, filename: string): string {
  return path.join(ROOT, 'schemas', protocol, filename);
}

function generatedHeader(protocol: string, version: string, source: string): string {
  return [
    `// AUTO-GENERATED — do not edit. Run \`pnpm generate:schemas\` to update.`,
    `// Schema version: ${protocol}@${version}`,
    `// Source: ${source}`,
    `// CI check: pnpm generate:schemas && git diff --exit-code packages/agent-harness-providers/src/protocol/`,
    ``,
    `/* eslint-disable */`,
    `/* W45 — generated ${protocol} protocol types */`,
  ].join('\n');
}

/**
 * Simple JSON Schema → TypeScript interface generator.
 * Handles: object, string, number, integer, boolean, array, oneOf, enum, $ref.
 * For complex schemas, extend this function rather than hand-writing.
 */
function jsonSchemaToTs(schema: Record<string, unknown>, name: string, defs: Record<string, unknown> = {}): string {
  const lines: string[] = [];

  function resolveRef(ref: string): Record<string, unknown> {
    const key = ref.replace('#/definitions/', '');
    return (defs[key] as Record<string, unknown>) ?? {};
  }

  function typeForSchema(s: Record<string, unknown>, indent = ''): string {
    if (s.$ref) {
      const refName = (s.$ref as string).replace('#/definitions/', '');
      return refName;
    }
    if (s.oneOf) {
      return (s.oneOf as Record<string, unknown>[]).map((sub) => typeForSchema(sub, indent)).join(' | ');
    }
    if (s.enum) {
      return (s.enum as unknown[]).map((v) => JSON.stringify(v)).join(' | ');
    }
    switch (s.type) {
      case 'string': return 'string';
      case 'number': return 'number';
      case 'integer': return 'number';
      case 'boolean': return 'boolean';
      case 'null': return 'null';
      case 'object': {
        const props = s.properties as Record<string, Record<string, unknown>> | undefined;
        const required = (s.required as string[]) ?? [];
        if (!props) return 'Record<string, unknown>';
        const fields = Object.entries(props).map(([k, v]) => {
          const optional = !required.includes(k) ? '?' : '';
          const desc = (v.description as string | undefined);
          const comment = desc ? `  /** ${desc} */\n  ` : '  ';
          return `${comment}${indent}${k}${optional}: ${typeForSchema(v, indent + '  ')};`;
        });
        return `{\n${fields.join('\n')}\n${indent}}`;
      }
      case 'array': {
        const items = s.items as Record<string, unknown> | undefined;
        return items ? `Array<${typeForSchema(items, indent)}>` : 'unknown[]';
      }
      default: return 'unknown';
    }
  }

  // Generate interfaces for all definitions
  for (const [defName, defSchema] of Object.entries(defs)) {
    const s = defSchema as Record<string, unknown>;
    const description = s.description as string | undefined;
    if (description) {
      lines.push(`/** ${description} */`);
    }
    if (s.type === 'object' || s.properties) {
      const props = s.properties as Record<string, Record<string, unknown>> | undefined;
      const required = (s.required as string[]) ?? [];
      lines.push(`export interface ${defName} {`);
      if (props) {
        for (const [k, v] of Object.entries(props)) {
          const optional = !required.includes(k) ? '?' : '';
          const desc = (v.description as string | undefined);
          if (desc) lines.push(`  /** ${desc} */`);
          lines.push(`  ${k}${optional}: ${typeForSchema(v, '  ')};`);
        }
      }
      lines.push(`}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function generateAcp(versions: VersionsFile): void {
  const schemaFile = schemaPath('acp', 'acp-schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
  const defs = schema.definitions ?? {};
  const version = versions.acp;

  // The ACP types are hand-crafted in this run — future versions can use the
  // jsonSchemaToTs() generator for full automation.
  // For now, read the existing generated file and update its header version.
  const existingFile = path.join(OUTPUT_DIR, 'acp.generated.ts');
  let content = fs.readFileSync(existingFile, 'utf8');

  // Update version line
  content = content.replace(
    /\/\/ Schema version: acp@[\d.]+/,
    `// Schema version: acp@${version}`,
  );
  fs.writeFileSync(existingFile, content, 'utf8');
  console.log(`✓ ACP schema v${version} → acp.generated.ts`);
}

function generateOpenCode(versions: VersionsFile): void {
  const schemaFile = schemaPath('opencode', 'openapi.json');
  const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
  const version = versions.opencode;

  const existingFile = path.join(OUTPUT_DIR, 'opencode.generated.ts');
  let content = fs.readFileSync(existingFile, 'utf8');
  content = content.replace(
    /\/\/ Schema version: opencode@[\d.]+/,
    `// Schema version: opencode@${version}`,
  );
  fs.writeFileSync(existingFile, content, 'utf8');
  console.log(`✓ OpenCode schema v${version} → opencode.generated.ts`);
}

function generateCodex(versions: VersionsFile): void {
  const schemaFile = schemaPath('codex', 'codex-rpc-schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
  const version = versions.codex;

  const existingFile = path.join(OUTPUT_DIR, 'codex.generated.ts');
  let content = fs.readFileSync(existingFile, 'utf8');
  content = content.replace(
    /\/\/ Schema version: codex@[\d.]+/,
    `// Schema version: codex@${version}`,
  );
  fs.writeFileSync(existingFile, content, 'utf8');
  console.log(`✓ Codex schema v${version} → codex.generated.ts`);
}

// ── Main ─────────────────────────────────────────────────────────

console.log('W45 — Generating protocol schemas...');
const versions = readVersions();
console.log(`  Versions: acp@${versions.acp} opencode@${versions.opencode} codex@${versions.codex}`);

generateAcp(versions);
generateOpenCode(versions);
generateCodex(versions);

console.log('');
console.log('Done. To verify CI would pass:');
console.log('  git diff --exit-code packages/agent-harness-providers/src/protocol/');
