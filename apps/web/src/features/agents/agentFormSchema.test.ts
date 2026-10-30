// The AgentEditor form's validation is the real risk in this port: a rule
// that lets Save through arrives at the server as a generic 400 naming no
// field (see agentFormSchema.ts). Each `it` below is one such rule.
import { describe, expect, it } from 'vitest';
import { EMPTY_AGENT_FORM, effectiveSlug, instructionBytes, validateAgentForm, type AgentFormValues } from './agentFormSchema.js';

function form(partial: Partial<AgentFormValues>): AgentFormValues {
  return { ...EMPTY_AGENT_FORM, ...partial };
}

const VALID: AgentFormValues = form({
  name: 'Bug Fixer',
  description: 'Fixes failing tests with a minimal diff.',
  instructions: 'You are a meticulous bug fixer.',
});

describe('validateAgentForm', () => {
  it('accepts a fully filled-in worker draft', () => {
    expect(validateAgentForm(VALID)).toEqual([]);
  });

  it('requires a name', () => {
    expect(validateAgentForm(form({ ...VALID, name: '  ' }))).toContain('Name is required.');
  });

  it('requires a description of at least 10 characters', () => {
    expect(validateAgentForm(form({ ...VALID, description: 'too short' }))).toContain(
      'Description must be at least 10 characters — both SDKs use it to route delegation.',
    );
    expect(validateAgentForm(form({ ...VALID, description: 'exactly ten' }))).toEqual([]);
  });

  it('rejects a hand-edited slug that is too short or has invalid characters, even though the auto-derived one would be valid', () => {
    // `slugifyAgentName` always produces a valid slug (it pads short input
    // with an "agent-" prefix), so the pattern can only fail once the author
    // has typed their OWN slug and overridden that derivation.
    expect(validateAgentForm(form({ ...VALID, slug: 'x' }))).toContain(
      'Slug must be 2–64 characters: lowercase letters, digits and hyphens.',
    );
    expect(validateAgentForm(form({ ...VALID, slug: 'Not_Valid!' }))).toContain(
      'Slug must be 2–64 characters: lowercase letters, digits and hyphens.',
    );
  });

  it('accepts a hand-edited slug that overrides the derived one', () => {
    expect(validateAgentForm(form({ ...VALID, slug: 'bug-fixer' }))).toEqual([]);
  });

  it('requires non-empty instructions', () => {
    expect(validateAgentForm(form({ ...VALID, instructions: '   ' }))).toContain(
      'Instructions are required — they become the agent’s system prompt.',
    );
  });

  it('rejects instructions over the byte budget (measured in UTF-8 bytes, not JS string length)', () => {
    // Each "é" is 1 UTF-16 code unit but 2 UTF-8 bytes — a byte-budget bug
    // that counted `.length` would pass this and fail at the server.
    const long = 'é'.repeat(20_000);
    expect(instructionBytes(long)).toBe(40_000);
    const errors = validateAgentForm(form({ ...VALID, instructions: long }));
    expect(errors.some((e) => e.startsWith('Instructions are 40000 bytes'))).toBe(true);
  });

  it('requires a project for a project-scoped agent', () => {
    expect(validateAgentForm(form({ ...VALID, scope: 'project', projectId: '' }))).toContain(
      'Pick a project for a project-scoped agent.',
    );
    expect(validateAgentForm(form({ ...VALID, scope: 'project', projectId: 'p1' }))).toEqual([]);
  });

  it('rejects an orchestrator that includes itself in its own team', () => {
    const selfRef = `global:${effectiveSlug(VALID)}`;
    const errors = validateAgentForm(
      form({ ...VALID, role: 'orchestrator', orchestration: { teamAgentRefs: [selfRef] } }),
    );
    expect(errors).toContain('An orchestrator cannot include itself in its own team.');
  });

  it('allows an orchestrator whose team excludes itself', () => {
    const errors = validateAgentForm(
      form({ ...VALID, role: 'orchestrator', orchestration: { teamAgentRefs: ['global:other-agent'] } }),
    );
    expect(errors).toEqual([]);
  });

  it('reports every violated rule at once, not just the first', () => {
    const errors = validateAgentForm(form({ name: '', description: '', instructions: '' }));
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('effectiveSlug', () => {
  it('derives from the name until the author types their own slug', () => {
    expect(effectiveSlug({ slug: '', name: 'Code Reviewer' })).toBe('code-reviewer');
    expect(effectiveSlug({ slug: 'custom-slug', name: 'Code Reviewer' })).toBe('custom-slug');
  });

  it('falls back to "agent" for a blank name', () => {
    expect(effectiveSlug({ slug: '', name: '' })).toBe('agent');
  });
});
