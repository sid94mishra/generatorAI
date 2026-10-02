import React from 'react';
import { screen } from '@testing-library/react-native';
import { AgentGlyph, agentGlyphLabel } from './AgentGlyph';
import { renderThemed } from '../../__tests__/themed';

describe('AgentGlyph (MP-37)', () => {
  it('names agent, model and lock without initials', () => {
    expect(agentGlyphLabel({ kind: 'agent', name: 'Bug Fixer', model: 'Sonnet 5', locked: true })).toBe('Bug Fixer, Sonnet 5, locked');
    expect(agentGlyphLabel({ kind: 'team', name: 'Orchestrator', members: ['A', 'B'] })).toBe('Orchestrator, A, B');
    expect(agentGlyphLabel({ kind: 'you', name: 'ignored' })).toBe('You');
  });
  it('is one labelled element', async () => {
    await renderThemed(<AgentGlyph kind="model" name="Claude Sonnet 5" />);
    expect(screen.getByLabelText('Claude Sonnet 5')).toBeTruthy();
  });
});
