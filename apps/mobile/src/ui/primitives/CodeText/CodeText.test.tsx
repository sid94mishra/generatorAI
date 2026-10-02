import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { CodeText, codeBlockLabel, tokenColour } from './CodeText';
import { renderThemed } from '../../__tests__/themed';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));

describe('CodeText (MP-42)', () => {
  it('labels a block with its language and line count', () => {
    expect(codeBlockLabel('a\nb', 'ts')).toMatch(/^Code, .+, 2 lines$/);
    expect(codeBlockLabel('a')).toBe('Code, 1 line');
  });

  it('maps token kinds onto the theme syntax colours', () => {
    const syntax = { keyword: 'k', string: 's', comment: 'c' } as never;
    expect(tokenColour('keyword', syntax)).toBe('k');
    expect(tokenColour('meta', syntax)).toBe('c');
    expect(tokenColour('plain', syntax)).toBeUndefined();
  });

  it('copies the code and confirms with "Copied"', async () => {
    const user = userEvent.setup();
    await renderThemed(<CodeText form="block" code="pnpm test" language="bash" copyable />);
    await user.press(screen.getByRole('button', { name: 'Copy code' }));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('pnpm test');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('toggles wrap as a selected state', async () => {
    const user = userEvent.setup();
    await renderThemed(<CodeText form="block" code="x" />);
    await user.press(screen.getByRole('button', { name: 'Wrap lines' }));
    expect(screen.getByRole('button', { name: 'Turn off line wrap' }).props.accessibilityState).toMatchObject({ selected: true });
  });
});
