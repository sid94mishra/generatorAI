import React from 'react';
import { Text } from 'react-native';
import { screen } from '@testing-library/react-native';
import { Field } from './Field';
import { controlHint, useFieldContext } from './fieldContext';
import { renderThemed } from '../../__tests__/themed';

function Probe(): React.ReactElement {
  const field = useFieldContext();
  return <Text testID="probe">{JSON.stringify(field)}</Text>;
}

describe('Field (MP-19)', () => {
  it('renders label with " · required", help, and passes the hint to its control', async () => {
    await renderThemed(
      <Field label="Name" required help="Shown in the sidebar.">
        <Probe />
      </Field>,
    );
    expect(screen.getByText('Name · required')).toBeTruthy();
    expect(screen.getByText('Shown in the sidebar.')).toBeTruthy();
    expect(JSON.parse(String(screen.getByTestId('probe').props.children))).toEqual({ hint: 'Shown in the sidebar.', invalid: false, required: true });
  });

  it('shows the error instead of the help and marks the control invalid', async () => {
    await renderThemed(
      <Field help="Help" error="Required">
        <Probe />
      </Field>,
    );
    expect(screen.queryByText('Help')).toBeNull();
    expect(screen.getByText('Required')).toBeTruthy();
    expect(controlHint({}, { hint: 'Required', invalid: true, required: false })).toBe('Error: Required');
    expect(controlHint({ error: 'Own' }, null)).toBe('Error: Own');
    expect(controlHint({}, null)).toBeUndefined();
  });
});
