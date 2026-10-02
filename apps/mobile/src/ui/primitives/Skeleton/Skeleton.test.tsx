import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Skeleton } from './Skeleton';

describe('Skeleton (MP-31)', () => {
  it('is one busy Loading element whatever it draws', async () => {
    await render(<Skeleton preset="list" count={3} testID="k" />);
    const node = screen.getByLabelText('Loading');
    expect(node.props.accessibilityState).toMatchObject({ busy: true });
  });
});
