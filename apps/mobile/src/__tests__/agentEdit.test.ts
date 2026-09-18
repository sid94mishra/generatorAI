import { describe, expect, it } from 'vitest';

import {
  agentDraftFrom,
  agentEditAvailability,
  agentUpdateBody,
  validateAgentDraft,
} from '../components/work/agentModel';

const saved = {
  name: 'Reviewer',
  description: 'Reviews pull requests carefully',
  instructions: 'Be thorough.',
  runtime: { model: 'gpt-5', reasoningEffort: 'high', harnessType: 'copilot', permissionMode: null },
};

describe('agent edit availability', () => {
  it('never edits built-in agents', () => {
    expect(agentEditAvailability({ scope: 'system' }, ['admin:settings'])).toMatchObject({
      editable: false,
      requestable: false,
    });
  });

  it('asks for admin:settings otherwise', () => {
    expect(agentEditAvailability({ scope: 'global' }, ['read:workflows'])).toMatchObject({
      editable: false,
      requestable: true,
    });
    expect(agentEditAvailability({ scope: 'project' }, ['admin:settings']).editable).toBe(true);
  });
});

describe('agent draft', () => {
  it('reads the editable fields', () => {
    expect(agentDraftFrom(saved)).toEqual({
      name: 'Reviewer',
      description: 'Reviews pull requests carefully',
      instructions: 'Be thorough.',
      model: 'gpt-5',
    });
    expect(agentDraftFrom({ name: 'X' })).toEqual({ name: 'X', description: '', instructions: '', model: '' });
  });

  it('mirrors the server schema minimums', () => {
    expect(validateAgentDraft({ name: ' ', description: 'short', instructions: ' ', model: '' })).toEqual({
      name: expect.any(String),
      description: expect.stringMatching(/10 characters/),
      instructions: expect.any(String),
    });
    expect(validateAgentDraft(agentDraftFrom(saved))).toEqual({});
  });

  it('sends nothing when nothing changed', () => {
    expect(agentUpdateBody(saved, agentDraftFrom(saved))).toBeNull();
    expect(agentUpdateBody(saved, { ...agentDraftFrom(saved), name: ' Reviewer ' })).toBeNull();
  });

  it('sends only changed text fields, trimmed', () => {
    expect(agentUpdateBody(saved, { ...agentDraftFrom(saved), name: 'Critic ', instructions: 'Be kind.' })).toEqual({
      name: 'Critic',
      instructions: 'Be kind.',
    });
  });

  it('keeps the rest of the runtime when the model changes', () => {
    expect(agentUpdateBody(saved, { ...agentDraftFrom(saved), model: 'claude-opus' })).toEqual({
      runtime: { model: 'claude-opus', reasoningEffort: 'high', harnessType: 'copilot' },
    });
    expect(agentUpdateBody(saved, { ...agentDraftFrom(saved), model: '' })).toEqual({
      runtime: { reasoningEffort: 'high', harnessType: 'copilot' },
    });
  });
});
