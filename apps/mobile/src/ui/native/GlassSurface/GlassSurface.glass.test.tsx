// The glass path (iOS with Liquid Glass): props must reach GlassView unchanged (device review, MD-136).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { screen } from '@testing-library/react-native';
import { nativePlatform } from '../../platform/geometry';
import { GlassSurface } from './GlassSurface';
import { renderThemed } from '../../__tests__/themed';

jest.mock('../../platform/glass', () => ({ useGlass: () => true }));
jest.mock('expo-glass-effect', () => {
  const { createElement } = jest.requireActual('react');
  const { View: RNView } = jest.requireActual('react-native');
  return {
    GlassView: (props: object) => createElement(RNView, { ...props, testID: 'glass-view' }),
    GlassContainer: (props: object) => createElement(RNView, props),
  };
});

describe('GlassSurface glass path (MP-38)', () => {
  const ios = nativePlatform === 'ios' ? it : it.skip;
  ios('passes glassEffectStyle as a plain string, with the token radius', async () => {
    await renderThemed(
      <GlassSurface radiusStep="new" interactive>
        <View />
      </GlassSurface>,
    );
    const view = screen.getByTestId('glass-view');
    expect(view.props.glassEffectStyle).toBe('regular');
    expect(view.props.isInteractive).toBe(true);
    expect(StyleSheet.flatten(view.props.style)).toMatchObject({ borderRadius: 26 });
  });
});
