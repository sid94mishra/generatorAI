import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StatusDot, statusDotTone } from './StatusDot';

describe('StatusDot (MP-08)', () => {
  it('takes its tone from the shared status map or a health tone', () => {
    expect(statusDotTone('needs_you')).toBe('warn');
    expect(statusDotTone(undefined, 'ok')).toBe('ok');
    expect(statusDotTone()).toBe('idle');
  });
  it('is read by its label, or hidden when the word is beside it', async () => {
    await render(
      <>
        <StatusDot health="ok" label="Connected" />
        <StatusDot state="running" testID="d" />
      </>,
    );
    expect(screen.getByLabelText('Connected')).toBeTruthy();
    expect(screen.getByTestId('d', { includeHiddenElements: true }).props.importantForAccessibility).toBe('no-hide-descendants');
  });
});
