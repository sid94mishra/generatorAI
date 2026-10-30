import React from 'react';
import { fireEvent, screen, userEvent } from '@testing-library/react-native';
import { Breadcrumb, BreadcrumbTitle } from './Breadcrumb';
import { collapseCrumbs, crumbActions, titleViewLabel } from './breadcrumbModel';
import { renderThemed } from '../../__tests__/themed';

describe('Breadcrumb (ML-03)', () => {
  it('collapses the middle and names the title view', () => {
    const segs = ['A', 'B', 'C', 'D', 'E'].map((label) => ({ label, onPress: jest.fn() }));
    const c = collapseCrumbs(segs);
    expect(c.shown.map((s) => s.label)).toEqual(['A', 'D', 'E']);
    expect(c.hidden.map((s) => s.label)).toEqual(['B', 'C']);
    expect(collapseCrumbs(segs.slice(0, 3)).ellipsisAt).toBeNull();
    expect(titleViewLabel([{ label: 'Chats' }], 'Fix')).toBe('Chats, Fix');
    expect(crumbActions([{ label: 'Chats', onPress: jest.fn() }, { label: 'Step 4 of 6' }])).toEqual([{ name: 'crumb-0', label: 'Go to Chats' }]);
  });

  it('makes ancestors links and leaves non-ancestors as text', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<Breadcrumb segments={[{ label: 'Chats', onPress }, { label: 'Step 4 of 6' }]} />);
    await user.press(screen.getByRole('link', { name: 'Chats' }));
    expect(onPress).toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Step 4 of 6' })).toBeNull();
  });

  it('exposes crumbs as actions on the title view', async () => {
    const onPress = jest.fn();
    await renderThemed(<BreadcrumbTitle breadcrumb={[{ label: 'Chats', onPress }]} title="Fix flaky test" testID="tv" />);
    const view = screen.getByTestId('tv');
    expect(view.props.accessibilityLabel).toBe('Chats, Fix flaky test');
    fireEvent(view, 'accessibilityAction', { nativeEvent: { actionName: 'crumb-0' } });
    expect(onPress).toHaveBeenCalled();
  });
});
