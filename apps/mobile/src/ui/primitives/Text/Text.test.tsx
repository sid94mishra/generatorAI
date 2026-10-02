import React from 'react';
import { Platform } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { Text } from './Text';
import { geometry } from '../../platform/geometry';

const android = Platform.OS === 'android';

describe('Text (MP-01)', () => {
  it('renders the role class, family, tone and Dynamic Type ramp', async () => {
    await render(<Text role="footnote" tone="fg-2" testID="t">Meta</Text>);
    const node = screen.getByTestId('t');
    expect(node.props.className).toContain('text-small');
    expect(node.props.className).toContain('font-sans');
    expect(node.props.className).toContain('text-fg-2');
    expect(node.props.dynamicTypeRamp).toBe('footnote');
    expect(node.props.maxFontSizeMultiplier).toBe(0);
  });

  it('makes title roles headers, caps them, and caps chrome at 1.4', async () => {
    await render(
      <>
        <Text role="largeTitle" testID="lt">Chats</Text>
        <Text role="caption" chrome testID="c">3</Text>
      </>,
    );
    expect(screen.getByRole('header', { name: 'Chats' })).toBeTruthy();
    expect(screen.getByTestId('lt').props.maxFontSizeMultiplier).toBe(1.3);
    expect(screen.getByTestId('c').props.maxFontSizeMultiplier).toBe(1.4);
  });

  it('renders mono roles in the mono family with tabular numerals', async () => {
    await render(<Text role="monoSm" testID="m">4:12</Text>);
    const cls = screen.getByTestId('m').props.className as string;
    expect(cls).toContain('font-mono');
    expect(cls).toContain('tabular-nums');
    expect(cls).toContain('text-mono-sm');
    expect(screen.getByTestId('m').props.dynamicTypeRamp).toBe('caption1');
  });

  it('uses the platform ramp values through geometry', () => {
    expect(geometry().type.body.size).toBe(android ? 16 : 17);
  });
});
