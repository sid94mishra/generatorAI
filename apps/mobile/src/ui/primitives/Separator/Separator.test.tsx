import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Separator } from './Separator';

describe('Separator (MP-36)', () => {
  it('is hidden from assistive tech and insets from the start edge', async () => {
    await render(<Separator inset={56} testID="s" />);
    const node = screen.getByTestId('s', { includeHiddenElements: true });
    expect(node.props.className).toContain('ms-14');
    expect(node.props.importantForAccessibility).toBe('no-hide-descendants');
  });
});
