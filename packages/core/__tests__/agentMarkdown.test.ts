// ────────────────────────────────────────────────────────────────
// agentMarkdown — parsing untrusted `.agent.md` documents.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  parseAgentMarkdown,
  serialiseAgentMarkdown,
  AGENT_MARKDOWN_MAX_BYTES,
} from '../src/services/agentMarkdown.js';
import type { Agent } from '@generatorai/shared';

const MINIMAL = `---
name: Code Reviewer
description: Reviews code for defects and convention drift.
tools: ['read', 'search']
---
You review code.`;

describe('parseAgentMarkdown', () => {
  it('parses the GitHub-compatible frontmatter shape', () => {
    const p = parseAgentMarkdown(MINIMAL);
    expect(p.name).toBe('Code Reviewer');
    expect(p.description).toContain('Reviews code');
    expect(p.instructions).toBe('You review code.');
    expect(p.role).toBe('agent');
    expect(p.tools.fileRead).toBe(true);
    expect(p.tools.fileWrite).toBe(false);
  });

  it('reads the x-generatorai extension block', () => {
    const p = parseAgentMarkdown(`---
name: Lead
description: Coordinates delegated work across specialised agents.
model: claude-sonnet-4.6
x-generatorai:
  slug: lead
  role: orchestrator
  projection: replace
  skills: [conventions]
  mcpServers: [github]
  capabilities: { browser: false, shell: true }
  team: ['global:worker']
  reasoningEffort: xhigh
---
Coordinate.`);

    expect(p.slug).toBe('lead');
    expect(p.role).toBe('orchestrator');
    expect(p.projection).toBe('replace');
    expect(p.skillNames).toEqual(['conventions']);
    expect(p.mcpServerNames).toEqual(['github']);
    expect(p.tools.browser).toBe(false);
    expect(p.tools.shell).toBe(true);
    expect(p.teamAgentRefs).toEqual(['global:worker']);
    expect(p.runtime.model).toBe('claude-sonnet-4.6');
    expect(p.runtime.reasoningEffort).toBe('xhigh');
  });

  it('ignores frontmatter fields that are not on the allow-list', () => {
    const p = parseAgentMarkdown(`---
name: Sneaky
description: Tries to set fields it must not control.
scope: system
enabled: false
sourcePath: /etc/passwd
x-generatorai:
  harnessType: claude-agent
  enabled: false
  sourcePath: /etc/passwd
---
Body.`);

    // `harnessType` is deliberately NOT readable from a document: it would let
    // an imported file pin the provider.
    expect(p.runtime.harnessType).toBeUndefined();
    expect((p as Record<string, unknown>)['scope']).toBeUndefined();
    expect((p as Record<string, unknown>)['sourcePath']).toBeUndefined();
  });

  it('rejects a document with no frontmatter', () => {
    expect(() => parseAgentMarkdown('Just a body')).toThrow(/frontmatter/i);
  });

  it('rejects a document missing name or description', () => {
    expect(() => parseAgentMarkdown('---\nname: X\n---\nBody')).toThrow(/description/);
    expect(() => parseAgentMarkdown('---\ndescription: Y is a long description\n---\nBody')).toThrow(/name/);
  });

  it('rejects an empty instructions body', () => {
    expect(() =>
      parseAgentMarkdown('---\nname: X\ndescription: A long enough description here\n---\n\n'),
    ).toThrow(/instructions/i);
  });

  it('rejects a document over the size cap', () => {
    const huge = `---\nname: X\ndescription: A long enough description here\n---\n${'a'.repeat(AGENT_MARKDOWN_MAX_BYTES)}`;
    expect(() => parseAgentMarkdown(huge)).toThrow(/limit/i);
  });

  it('rejects malformed YAML rather than silently accepting it', () => {
    expect(() => parseAgentMarkdown('---\nname: [unclosed\n---\nBody')).toThrow(/YAML/i);
  });

  it('rejects a YAML alias bomb', () => {
    const bomb = `---
a: &x ["v","v"]
b: [*x, *x]
name: X
description: A long enough description here
---
Body`;
    expect(() => parseAgentMarkdown(bomb)).toThrow();
  });
});

describe('serialiseAgentMarkdown', () => {
  const agent: Agent = {
    id: 'a',
    scope: 'global',
    projectId: '',
    slug: 'reviewer',
    ref: 'global:reviewer',
    name: 'Reviewer',
    description: 'Reviews code for defects.',
    instructions: 'You review code.',
    role: 'agent',
    projection: 'append',
    tags: ['review'],
    enabled: true,
    skillIds: ['s1'],
    mcpServerIds: ['m1'],
    tools: { fileWrite: false },
    runtime: { model: 'claude-sonnet-4.6' },
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('round-trips through the parser', () => {
    const md = serialiseAgentMarkdown(agent, { skillNames: ['conventions'], mcpServerNames: ['github'] });
    const parsed = parseAgentMarkdown(md);

    expect(parsed.name).toBe('Reviewer');
    expect(parsed.slug).toBe('reviewer');
    expect(parsed.instructions).toBe('You review code.');
    expect(parsed.skillNames).toEqual(['conventions']);
    expect(parsed.mcpServerNames).toEqual(['github']);
    expect(parsed.tools.fileWrite).toBe(false);
    expect(parsed.runtime.model).toBe('claude-sonnet-4.6');
  });

  it('exports server NAMES, never credentials', () => {
    const md = serialiseAgentMarkdown(agent, { skillNames: [], mcpServerNames: ['github'] });
    expect(md).toContain('github');
    expect(md).not.toContain('m1');
  });
});
