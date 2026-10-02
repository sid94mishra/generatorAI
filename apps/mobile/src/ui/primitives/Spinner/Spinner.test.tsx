import React from 'react';
import { screen } from '@testing-library/react-native';
import { Spinner } from './Spinner';
import { renderThemed } from '../../__tests__/themed';

describe('Spinner (MP-12)', () => {
  it('is a busy progressbar when labelled', async () => {
    await renderThemed(<Spinner label="Loading" />);
    const node = screen.getByRole('progressbar', { name: 'Loading' });
    expect(node.props.accessibilityState).toMatchObject({ busy: true });
  });
  it('is decorative without a label', async () => {
    await renderThemed(<Spinner testID="s" />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
