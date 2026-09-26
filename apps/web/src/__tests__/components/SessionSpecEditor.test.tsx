// P02 WP-2.11 — the shared SessionSpecEditor (chat, workflow, stage).
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/hooks/queries.js', () => ({
  useModels: () => ({ data: [{ id: 'oc-model', name: 'OC', provider: 'opencode' }] }),
}));
vi.mock('@/components/shared/ModelPicker.js', () => ({
  ModelPicker: () => <div data-testid="model-picker" />,
  providerLabel: (id: string) => id,
}));

import { SessionSpecEditor } from '@/components/session/SessionSpecEditor.js';
import { chatParamsFromSession } from '@/components/chat/CreateChatDialog.js';

afterEach(cleanup);

describe('SessionSpecEditor', () => {
  it('shows the PD-17 refusal inline for a provider that cannot hold the mode (routing by model)', () => {
    render(
      <SessionSpecEditor
        value={{ model: 'oc-model', permissionMode: 'default' }}
        onChange={() => {}}
        scope="workflow"
        sections={['warnings']}
      />,
    );
    expect(screen.getByTestId('session-warnings-workflow').textContent).toMatch(/cannot hold "default"/);
  });

  it('a stage is judged over its workflow session', () => {
    render(
      <SessionSpecEditor
        value={{ permissionMode: 'acceptEdits' }}
        inherited={{ harnessType: 'codex' }}
        onChange={() => {}}
        scope="stage"
        sections={['warnings']}
      />,
    );
    expect(screen.getByTestId('session-warnings-stage').textContent).toMatch(/asks only before commands and patches/);
  });

  it('platform toggles patch the session; computer use and widgets are not offered to a chat', () => {
    const onChange = vi.fn();
    const { unmount } = render(<SessionSpecEditor value={{}} onChange={onChange} scope="stage" sections={['platform']} />);
    fireEvent.click(screen.getByRole('switch', { name: /Computer use/ }));
    expect(onChange).toHaveBeenCalledWith({ computerUse: true });
    fireEvent.click(screen.getByRole('switch', { name: /Integrated browser/ }));
    expect(onChange).toHaveBeenCalledWith({ browser: { enabled: false } });
    unmount();
    render(<SessionSpecEditor value={{}} onChange={onChange} scope="chat" sections={['platform']} />);
    expect(screen.queryByRole('switch', { name: /Computer use/ })).toBeNull();
    expect(screen.queryByRole('switch', { name: /Widgets/ })).toBeNull();
  });
});

describe('chat create mapping (PD-20)', () => {
  it('maps the edited session onto the chat create fields', () => {
    expect(
      chatParamsFromSession({
        model: 'm',
        harnessType: 'claude-agent',
        reasoningEffort: 'high',
        contextTier: 'long_context',
        agentRef: 'global:rev',
        agentOverrides: { addSkillIds: ['s1'] },
        defaultAgentMode: 'plan',
        permissionMode: 'acceptEdits',
        mcp: { excludedIds: ['gh'] },
      }),
    ).toEqual({
      model: 'm',
      harnessConfig: { harnessType: 'claude-agent', reasoningEffort: 'high', contextTier: 'long_context', excludedMcpServerIds: ['gh'] },
      agentRef: 'global:rev',
      agentOverrides: { addSkillIds: ['s1'] },
      defaultAgentMode: 'plan',
      permissionMode: 'acceptEdits',
    });
  });
});
