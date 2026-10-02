import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Count } from './Count';

describe('Count (MP-09)', () => {
  it('reads as the number, capped', async () => {
    await render(<Count value={128} max={99} />);
    expect(screen.getByText('99+')).toBeTruthy();
  });
  it('hides from assistive tech inside a labelled control, and as a dot', async () => {
    await render(
      <>
        <Count value={2} form="bubble" hidden testID="b" />
        <Count value={1} form="dot" testID="d" />
      </>,
    );
    expect(screen.getByTestId('b', { includeHiddenElements: true }).props.importantForAccessibility).toBe('no-hide-descendants');
    expect(screen.getByTestId('d', { includeHiddenElements: true }).props.className).toContain('bg-warn');
  });
});
