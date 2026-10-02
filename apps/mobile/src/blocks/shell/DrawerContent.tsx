// The sidebar's content (06 §1.1, ML-06, MSidebar): server identity + New chat, the search field in button mode
// (opens the palette, MD-46), the seven NAV_DESTINATIONS (a module switch resets the Stack, MD-87), the live Needs you
// / Running sections (MB-19) and the connection footer (MB-43) with Settings. testIDs per MD-95.
import React from 'react';
import { usePathname } from 'expo-router';
import { NAV_DESTINATIONS, navDestinationFor } from '@generatorai/shared/ui-contract';

import { Drawer, DrawerNavItem } from '../../ui/layout/Drawer';
import { IconButton } from '../../ui/primitives/IconButton';
import { SearchInput } from '../../ui/primitives/SearchInput';
import { AttentionList } from '../AttentionList';
import { ConnectionFooter } from '../ConnectionStatus';
import { ServerSwitcherTrigger } from '../ServerSwitcher';
import { goToModule, openNewChat, openSearch, openServers, openSettings } from './navigation';
import { normalizePath } from './parentHref';

const noop = (): void => undefined;

export interface DrawerContentProps {
  variant: 'modal' | 'persistent';
  /** The phone drawer closes after any navigation; the tablet sidebar stays. */
  onNavigate: () => void;
  /** Visible (ticks running timers only while shown). */
  active: boolean;
}

export function DrawerContent({ variant, onNavigate, active }: DrawerContentProps): React.ReactElement {
  const pathname = usePathname();
  const current = navDestinationFor(normalizePath(pathname))?.id ?? null;
  const then = (action: () => void) => () => {
    onNavigate();
    action();
  };
  return (
    <Drawer
      variant={variant}
      testID="drawer-content"
      header={
        <>
          <ServerSwitcherTrigger onPress={then(openServers)} />
          <IconButton icon="edit" label="New chat" variant="bordered" onPress={then(openNewChat)} testID="drawer-new-chat" />
        </>
      }
      search={<SearchInput value="" onChangeText={noop} placeholder="Search chats, runs, commands" size="compact" asButton onPress={then(() => openSearch())} testID="drawer-search" />}
      nav={NAV_DESTINATIONS.map((d) => (
        <DrawerNavItem key={d.id} destination={d.id} label={d.label} icon={d.icon} selected={current === d.id} onPress={then(() => goToModule(d.path, pathname))} />
      ))}
      live={<AttentionList variant="drawer" onNavigate={onNavigate} active={active} />}
      footer={
        <>
          <ConnectionFooter />
          <IconButton icon="settings" label="Settings" onPress={then(openSettings)} testID="drawer-settings" />
        </>
      }
    />
  );
}
