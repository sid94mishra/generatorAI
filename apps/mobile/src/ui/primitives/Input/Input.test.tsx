import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { Field } from '../Field';
import { Input } from './Input';
import { floatingLabelGeometry, frameState, kindProps, labelFloats, spokenValue } from './inputModel';
import { renderThemed } from '../../__tests__/themed';

describe('Input (MP-16)', () => {
  it('maps kinds to keyboard, secrecy and mono', () => {
    expect(kindProps('secret')).toMatchObject({ secure: true, autoCorrect: false, textContentType: 'password' });
    expect(kindProps('url')).toMatchObject({ keyboardType: 'url', mono: true, autoCapitalize: 'none' });
    expect(kindProps('number').keyboardType).toBe('number-pad');
    expect(kindProps('text')).toMatchObject({ secure: false, autoCorrect: true });
    expect(frameState({ focused: true })).toBe('focused');
    expect(frameState({ focused: true, error: 'x' })).toBe('error');
    expect(frameState({ focused: true, error: 'x', disabled: true })).toBe('disabled');
    expect(labelFloats(false, '')).toBe(false);
    expect(labelFloats(false, 'a')).toBe(true);
    expect(spokenValue('secret', 'abc', false)).toBe('3 characters, hidden');
    expect(spokenValue('secret', 'abc', true)).toBe('abc');
    // The floating label stays on the outline and pushes the value down only at large text (device review).
    expect(floatingLabelGeometry(16)).toEqual({ top: -8, padTop: 0 });
    expect(floatingLabelGeometry(32)).toEqual({ top: -16, padTop: 8 });
  });

  it('is named by its label, types, and takes the Field error as its hint', async () => {
    const onChangeText = jest.fn();
    const user = userEvent.setup();
    await renderThemed(
      <Field error="Use an http address">
        <Input label="Webhook URL" value="" onChangeText={onChangeText} testID="in" />
      </Field>,
    );
    const input = screen.getByLabelText('Webhook URL');
    expect(input.props.accessibilityHint).toBe('Error: Use an http address');
    await user.type(input, 'h');
    expect(onChangeText).toHaveBeenCalledWith('h');
  });

  it('hides a secret behind a named reveal control', async () => {
    const user = userEvent.setup();
    await renderThemed(<Input label="Token" kind="secret" value="abc" onChangeText={jest.fn()} />);
    expect(screen.getByLabelText('Token').props.secureTextEntry).toBe(true);
    await user.press(screen.getByRole('button', { name: 'Show Token' }));
    expect(screen.getByLabelText('Token').props.secureTextEntry).toBe(false);
    expect(screen.getByRole('button', { name: 'Hide Token' })).toBeTruthy();
  });

  it('cannot be edited when disabled or read-only', async () => {
    await renderThemed(
      <>
        <Input label="A" value="x" onChangeText={jest.fn()} disabled />
        <Input label="B" value="y" onChangeText={jest.fn()} readOnly />
      </>,
    );
    expect(screen.getByLabelText('A').props.editable).toBe(false);
    expect(screen.getByLabelText('B').props.editable).toBe(false);
  });
});
