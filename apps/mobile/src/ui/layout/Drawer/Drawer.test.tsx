import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import { renderThemed } from '../../__tests__/themed';
import { Drawer, DrawerLiveRow, DrawerNavItem, DrawerSection } from './Drawer';

describe('Drawer (ML-06)', () => {
  it('renders the slots, nav items with drawer-<id> ids and selected state, and the live sections', async () => {
    const onHome = jest.fn();
    const onRow = jest.fn();
    await renderThemed(
      <Drawer
        variant="modal"
        header={null}
        search={null}
        nav={
          <>
            <DrawerNavItem destination="home" label="Home" icon="home" selected onPress={onHome} />
            <DrawerNavItem destination="chats" label="Chats" icon="chats" selected={false} onPress={jest.fn()} />
          </>
        }
        live={
          <DrawerSection label="Needs you" count={2} countTone="warn" testID="drawer-inbox">
            <DrawerLiveRow kind="needs-you" title="Nightly audit" trailing="Approve" onPress={onRow} />
          </DrawerSection>
        }
        footer={null}
      />,
    );
    expect(screen.getByTestId('drawer-home').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('drawer-chats').props.accessibilityState).toMatchObject({ selected: false });
    await fireEvent.press(screen.getByTestId('drawer-home'));
    expect(onHome).toHaveBeenCalled();
    expect(screen.getByTestId('drawer-inbox').props.accessibilityLabel).toBe('Needs you, 2');
    await fireEvent.press(screen.getByLabelText('Nightly audit, needs you, Approve'));
    expect(onRow).toHaveBeenCalled();
  });

  it('offers "Show all" for an overflowing section', async () => {
    const onAll = jest.fn();
    await renderThemed(
      <DrawerSection label="Running" count={9} showAll={{ label: 'Show all (9)', onPress: onAll }}>
        {null}
      </DrawerSection>,
    );
    await fireEvent.press(screen.getByText('Show all (9)'));
    expect(onAll).toHaveBeenCalled();
  });
});
