// MB-36 VariableForm: one control per type, names in mono, errors replace the help line.
import React from 'react';
import { screen } from '@testing-library/react-native';

import { renderThemed } from '../../ui/__tests__/themed';
import { VariableForm } from './VariableForm';
import { initialDraft, parseVariables } from './model/variableFormModel';

const DEFS = parseVariables([
  { name: 'target_branch', type: 'string', label: 'Branch', required: true },
  { name: 'dry_run', type: 'boolean', label: 'Dry run', defaultValue: false },
  { name: 'payload', type: 'json', label: 'Payload' },
]);

describe('VariableForm (MB-36)', () => {
  it('draws a control per input with its type line', async () => {
    await renderThemed(<VariableForm variables={DEFS} draft={initialDraft(DEFS)} onChange={() => undefined} />);
    expect(screen.getByTestId('variable-target_branch')).toBeTruthy();
    expect(screen.getByTestId('variable-dry_run')).toBeTruthy();
    expect(screen.getByText('String · Required')).toBeTruthy();
  });

  it('shows a field error instead of the help line', async () => {
    await renderThemed(<VariableForm variables={DEFS} draft={initialDraft(DEFS)} onChange={() => undefined} errors={{ target_branch: 'Branch is required.' }} />);
    expect(screen.getByText('Branch is required.')).toBeTruthy();
  });

  it('renders nothing without inputs', async () => {
    await renderThemed(<VariableForm variables={[]} draft={{}} onChange={() => undefined} testIDPrefix="x" />);
    expect(screen.queryByText('Variables')).toBeNull();
  });
});
