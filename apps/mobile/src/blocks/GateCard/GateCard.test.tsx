import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import type { StreamBlock } from '@generatorai/client-core';

import { renderThemed, themed } from '../../ui/__tests__/themed';
import { PermissionCard } from './PermissionCard';
import { QuestionCard } from './QuestionCard';
import { ResolvedGateRow } from './ResolvedGateRow';

const permission = (over: Partial<Extract<StreamBlock, { type: 'permission' }>> = {}) =>
  ({
    type: 'permission',
    blockId: 1,
    interactionId: 'i1',
    toolName: 'Bash',
    permissionType: 'shell_exec',
    description: 'Publishes the branch',
    inputSummary: JSON.stringify({ command: 'git push -u origin fix' }),
    permissionMode: 'default',
    status: 'pending',
    ...over,
  }) as Extract<StreamBlock, { type: 'permission' }>;

describe('GateCard (MB-15)', () => {
  it('answers a standard permission with Allow once; no Always allow (MD-55)', async () => {
    const user = userEvent.setup();
    const onDecide = jest.fn(async () => undefined);
    await renderThemed(<PermissionCard block={permission({ risk: 'standard' })} onDecide={onDecide} />);
    expect(screen.queryByText(/Always allow/)).toBeNull();
    await user.press(screen.getByRole('button', { name: 'Allow Bash' }));
    expect(onDecide).toHaveBeenCalledWith('allow', undefined);
  });

  it('denies with an optional reason through Confirm deny', async () => {
    const user = userEvent.setup();
    const onDecide = jest.fn(async () => undefined);
    await renderThemed(<PermissionCard block={permission({ risk: 'standard' })} onDecide={onDecide} />);
    await user.press(screen.getByRole('button', { name: 'Deny Bash' }));
    await user.type(screen.getByTestId('gate-permission-reason'), 'Not yet');
    await user.press(screen.getByRole('button', { name: 'Confirm deny Bash' }));
    expect(onDecide).toHaveBeenCalledWith('deny', 'Not yet');
  });

  it('a risky gate says what this device needs: register, the biometric note, or why it cannot answer (MD-31)', async () => {
    const onRegister = jest.fn();
    const approval = { risky: true, noun: 'Face ID', onRegister, registering: false };
    const view = await renderThemed(<PermissionCard block={permission()} onDecide={jest.fn()} approval={{ ...approval, readiness: 'missing' }} />);
    expect(screen.getByTestId('gate-permission-register')).toBeTruthy();
    expect(screen.getByText('Risky')).toBeTruthy();
    await view.rerender(themed(<PermissionCard block={permission()} onDecide={jest.fn()} approval={{ ...approval, readiness: 'ok' }} />));
    expect(screen.getByText('Face ID required')).toBeTruthy();
    await view.rerender(themed(<PermissionCard block={permission()} onDecide={jest.fn()} approval={{ ...approval, readiness: 'unsupported' }} />));
    expect(screen.getByRole('button', { name: 'Allow Bash' }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('submits a single-choice question', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn(async () => undefined);
    const block = {
      type: 'question',
      blockId: 2,
      interactionId: 'q1',
      status: 'pending',
      questions: [{ id: 'q', header: 'Pick', question: 'Which branch?', options: [{ label: 'main' }, { label: 'dev' }], multiSelect: false, allowFreeform: false }],
    } as Extract<StreamBlock, { type: 'question' }>;
    await renderThemed(<QuestionCard block={block} onSubmit={onSubmit} />);
    await user.press(screen.getByText('dev'));
    await user.press(screen.getByTestId('gate-question-submit_answers'));
    expect(onSubmit).toHaveBeenCalledWith({ q: ['dev'] }, undefined);
  });

  it('collapses a settled gate to one line', async () => {
    await renderThemed(<ResolvedGateRow block={permission({ status: 'allowed' })} />);
    expect(screen.getByText('Allowed once')).toBeTruthy();
  });
});
