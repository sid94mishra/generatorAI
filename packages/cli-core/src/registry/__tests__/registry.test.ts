import { describe, it, expect } from 'vitest';
import { buildRegistry } from '../../commands/index.js';
import { toPalette, toRpcMethods, toDocs, DOCS_START, DOCS_END } from '../generators.js';
import { generateCompletions } from '../toCompletions.js';
import { commandPath, usageLine } from '../CommandSpec.js';

const registry = buildRegistry({ version: '0.2.0-test' });
const all = registry.all();

describe('command registry', () => {
  it('registers the full documented surface', () => {
    expect(all.length).toBeGreaterThanOrEqual(200);
    expect(registry.groupList().length).toBe(25);
  });

  it('has no duplicate command ids', () => {
    const ids = all.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no duplicate invocation paths', () => {
    const paths = all.map(commandPath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('declares every group a command belongs to', () => {
    const declared = new Set(registry.groupList().map((g) => g.name));
    for (const spec of all) expect(declared.has(spec.group)).toBe(true);
  });

  it('gives every command a summary, output kind and version', () => {
    for (const spec of all) {
      expect(spec.summary, spec.id).toBeTruthy();
      expect(spec.output.kind, spec.id).toBeTruthy();
      expect(spec.sinceVersion, spec.id).toBeTruthy();
    }
  });

  it('names flags in camelCase so Commander and RPC agree', () => {
    for (const spec of all) {
      for (const flag of spec.flags) {
        expect(flag.name, `${spec.id} --${flag.name}`).toMatch(/^[a-z][a-zA-Z0-9]*$/);
      }
    }
  });

  it('puts required positional args before optional ones', () => {
    for (const spec of all) {
      const firstOptional = spec.args.findIndex((a) => !a.required);
      if (firstOptional === -1) continue;
      const trailing = spec.args.slice(firstOptional);
      expect(trailing.some((a) => a.required), spec.id).toBe(false);
    }
  });

  it('allows at most one variadic arg, and only in last position', () => {
    for (const spec of all) {
      const variadic = spec.args.filter((a) => a.variadic);
      expect(variadic.length, spec.id).toBeLessThanOrEqual(1);
      if (variadic.length) expect(spec.args.at(-1)?.variadic, spec.id).toBe(true);
    }
  });

  it('marks destructive verbs so --yes is required', () => {
    for (const spec of all) {
      if (spec.verb === 'delete' || spec.verb === 'remove') {
        expect(spec.destructive, spec.id).toBe(true);
      }
    }
  });

  it('resolves a command by its path and by alias', () => {
    expect(registry.resolve(['run', 'start'])?.spec.id).toBe('run.start');
    expect(registry.resolve(['wf', 'list'])?.spec.id).toBe('workflow.list');
  });

  it('returns trailing tokens as args when resolving', () => {
    const hit = registry.resolve(['run', 'show', 'a3f2']);
    expect(hit?.spec.id).toBe('run.show');
    expect(hit?.rest).toEqual(['a3f2']);
  });

  it('marks local-only commands as not requiring a server', () => {
    for (const id of ['config.show', 'completions.generate', 'device.pair']) {
      const spec = all.find((s) => s.id === id);
      if (spec) expect(spec.requiresServer, id).toBe(false);
    }
  });
});

describe('generators derive from one registry', () => {
  it('produces a palette entry per visible command', () => {
    const palette = toPalette(registry);
    expect(palette.length).toBeGreaterThan(0);
    expect(palette.length).toBeLessThanOrEqual(all.length);
    for (const entry of palette) expect(entry.title).toContain('›');
  });

  it('produces RPC descriptors with stream flags matching output kind', () => {
    const methods = toRpcMethods(registry);
    const streaming = methods.filter((m) => m.streaming).map((m) => m.method);
    for (const id of streaming) {
      expect(all.find((s) => s.id === id)?.output.kind).toBe('stream');
    }
  });

  it('emits docs wrapped in the generated markers', () => {
    const docs = toDocs(registry);
    expect(docs.startsWith(DOCS_START)).toBe(true);
    expect(docs.trimEnd().endsWith(DOCS_END)).toBe(true);
    expect(docs).toContain('| Command | What | Flags |');
  });

  it('emits a completion script for every supported shell', () => {
    for (const shell of ['bash', 'zsh', 'fish', 'powershell', 'nushell'] as const) {
      const script = generateCompletions(registry, shell);
      expect(script.length, shell).toBeGreaterThan(100);
      expect(script, shell).toContain('generatorai');
    }
  });

  it('renders a usage line for every command', () => {
    for (const spec of all) {
      expect(usageLine(spec), spec.id).toContain(spec.group);
    }
  });
});
