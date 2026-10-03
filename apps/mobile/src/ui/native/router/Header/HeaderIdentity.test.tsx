// MD-162: the header applies the navigator options (and the iOS toolbars) from values, not identities — a caller
// that rebuilds equal props each render (fresh arrays, inline handlers) never re-applies them, and presses still
// reach the latest handler.
import React from 'react';
import { Platform } from 'react-native';
import { render } from '@testing-library/react-native';

import { themed } from '../../../__tests__/themed';
import { Header } from './Header';
import type { HeaderProps } from './Header.types';

const mockSeen: Record<'options' | 'left' | 'right', unknown[]> = { options: [], left: [], right: [] };

jest.mock('expo-router', () => {
  const Toolbar = ({ placement, children }: { placement: 'left' | 'right'; children: unknown }) => {
    mockSeen[placement].push(children);
    return null;
  };
  const Noop = () => null;
  Object.assign(Toolbar, { Button: Noop, Menu: Noop, MenuAction: Noop, Badge: Noop });
  return {
    Stack: {
      Screen: ({ options }: { options: unknown }) => {
        mockSeen.options.push(options);
        return null;
      },
      Toolbar,
    },
    useNavigation: () => ({ setOptions: () => undefined }),
    useFocusEffect: () => undefined,
  };
});

const distinct = (list: unknown[]): number => new Set(list).size;

function props(onMenuSelect: (id: string) => void, title = 'Fix the flaky test'): HeaderProps {
  return {
    role: 'workspace',
    title,
    breadcrumb: [{ label: 'Chats', onPress: () => undefined }],
    status: { state: 'running', label: 'Running' },
    onBack: () => undefined,
    paneToggle: { open: false, count: 2, attention: false, onPress: () => undefined },
    actions: [{ id: 'chat-menu', icon: 'more', label: 'Chat actions', menu: [{ id: 'rename', label: 'Rename' }], onMenuSelect }],
  };
}

describe('Header applies options by value (MD-162)', () => {
  beforeEach(() => {
    mockSeen.options = [];
    mockSeen.left = [];
    mockSeen.right = [];
  });

  it('keeps one options object (and one set of toolbar items) across equal re-renders', async () => {
    const first = jest.fn();
    const view = await render(themed(<Header {...props(first)} />));
    for (let i = 0; i < 3; i++) await view.rerender(themed(<Header {...props(jest.fn())} />));
    expect(mockSeen.options.length).toBeGreaterThanOrEqual(4);
    expect(distinct(mockSeen.options)).toBe(1);
    if (Platform.OS === 'ios') {
      expect(distinct(mockSeen.left)).toBe(1);
      expect(distinct(mockSeen.right)).toBe(1);
    }
  });

  it('re-applies when a value changes', async () => {
    const view = await render(themed(<Header {...props(jest.fn())} />));
    await view.rerender(themed(<Header {...props(jest.fn(), 'Renamed')} />));
    if (Platform.OS === 'ios') expect(distinct(mockSeen.options)).toBe(2);
    else expect(distinct(mockSeen.options)).toBe(1);
  });
});
