import React from 'react';
import { screen } from '@testing-library/react-native';
import { Text } from '../../primitives/Text';
import { GlassSurface } from './GlassSurface';
import { GLASS_FALLBACK_CLASS, GLASS_RADIUS_CLASS } from './glassModel';
import { renderThemed } from '../../__tests__/themed';

describe('GlassSurface (MP-38)', () => {
  it('maps radius steps to tokens', () => {
    expect(GLASS_RADIUS_CLASS).toEqual({ composer: 'rounded-composer', new: 'rounded-new', toast: 'rounded-toast', full: 'rounded-full' });
  });

  it('draws the opaque fallback where glass is unavailable (Jest, Android)', async () => {
    await renderThemed(
      <GlassSurface radiusStep="toast" testID="g">
        <Text>Inside</Text>
      </GlassSurface>,
    );
    const node = screen.getByTestId('g');
    for (const c of GLASS_FALLBACK_CLASS.split(' ')) expect(node.props.className).toContain(c);
    expect(node.props.className).toContain('rounded-toast');
    expect(screen.getByText('Inside')).toBeTruthy();
  });
});
