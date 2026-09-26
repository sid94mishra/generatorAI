// Story fixtures: the sidebar and rail as the boards draw them (Main,
// DesktopMac, DesktopWindows, ChatNarrow), composed from the kit with sample
// data. Plain functions (not components) so the stories-present check does
// not treat this file as kit API; stories only.

import type { ReactNode } from 'react';
import { Count } from '../../primitives/Count/Count.js';
import { Icon } from '../../icons/Icon.js';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { NavItem } from '../../primitives/NavItem/NavItem.js';
import { StatusDot } from '../../primitives/StatusDot/StatusDot.js';
import type { ShellLayout } from '../AppFrame/AppFrame.js';
import { MacTrafficLightRow } from '../MacTrafficLightRow/MacTrafficLightRow.js';
import { UpdatePill } from '../UpdatePill/UpdatePill.js';
import { Rail, RailCounterButton, RailDivider, RailGroup, RailMark, RailSpacer, RailStatusDot } from '../Rail/Rail.js';
import {
  ServerSwitcher,
  Sidebar,
  SidebarActionsRow,
  SidebarBrand,
  SidebarFooter,
  SidebarFooterNotice,
  SidebarHeaderRow,
  SidebarNav,
  SidebarNavRow,
  SidebarSearchButton,
  SidebarSection,
} from './Sidebar.js';

export const DESTINATIONS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'chats', label: 'Chats', icon: 'chats' },
  { id: 'projects', label: 'Projects', icon: 'projects' },
  { id: 'agents', label: 'Agents', icon: 'agents' },
  { id: 'workflows', label: 'Workflows', icon: 'workflows' },
  { id: 'automations', label: 'Automations', icon: 'automations' },
  { id: 'scripts', label: 'Scripts', icon: 'scripts' },
] as const;

export interface DemoOptions {
  layout?: ShellLayout;
  /** Linux native frame in the desktop app: the Back/Forward row. */
  desktop?: boolean;
  active?: (typeof DESTINATIONS)[number]['id'];
  /** The attention feed has loaded (false: no live lists, D-36). */
  live?: boolean;
  gap?: boolean;
  connection?: 'ok' | 'warn' | 'err';
  /** The flyout covers the rail. */
  covered?: boolean;
  /** An update is ready: the "Restart to update" pill in the footer / the rail icon (P3-06). */
  update?: boolean;
}

const CONNECTION_LABEL = { ok: 'Connected', warn: 'Reconnecting…', err: 'Disconnected' } as const;

export function demoSidebar({
  layout = 'native',
  desktop = false,
  active = 'chats',
  live = true,
  gap = false,
  connection = 'ok',
  update = false,
}: DemoOptions = {}): ReactNode {
  const strip = layout === 'strip';
  const newChat = (
    <IconButton
      icon="edit"
      label="New chat"
      className={strip ? undefined : 'aspect-square h-nav w-auto border-line-soft bg-surface'}
    />
  );
  return (
    <Sidebar
      layout={layout}
      className="h-full"
      topRow={
        layout === 'mac' ? (
          <MacTrafficLightRow aria-hidden />
        ) : layout === 'native' && desktop ? (
          <SidebarNavRow>
            <IconButton icon="back" label="Back" size="sm" />
            <IconButton icon="forward" label="Forward" size="sm" disabled />
          </SidebarNavRow>
        ) : undefined
      }
      header={
        strip ? (
          <SidebarHeaderRow className="mb-1.5 pl-2">
            <SidebarBrand />
            {newChat}
          </SidebarHeaderRow>
        ) : (
          <SidebarHeaderRow>
            <ServerSwitcher server="This computer" />
            <IconButton icon="sidebar" label="Hide sidebar" shortcut={['Ctrl', 'B']} />
          </SidebarHeaderRow>
        )
      }
      actions={
        strip ? undefined : (
          <SidebarActionsRow>
            <SidebarSearchButton shortcut={['Ctrl', 'K']} />
            {newChat}
          </SidebarActionsRow>
        )
      }
      nav={
        <SidebarNav>
          {DESTINATIONS.map((d) => (
            <NavItem key={d.id} icon={d.icon} label={d.label} href={`#${d.id}`} active={d.id === active} />
          ))}
        </SidebarNav>
      }
      live={
        live ? (
          <>
            <SidebarSection title="Needs you" count={2} countTone="warn">
              <NavItem label="Nightly dependency audit" subtitle="Approve “Apply upgrades”" dot="needs_you" href="#n1" />
              <NavItem label="Fix flaky checkout test" subtitle="Allow git push?" dot="needs_you" href="#n2" />
            </SidebarSection>
            <SidebarSection title="Running" count={3} spacing="next">
              {[
                ['Upgrade React Flow to v12', '4:12'],
                ['PR review pipeline 311', '1:05'],
                ['Memory leak in worker', '0:38'],
              ].map(([title, elapsed]) => (
                <NavItem
                  key={title}
                  leading={<Icon concept="status-running" size={16} className="text-run" />}
                  label={title}
                  count={<Count>{elapsed}</Count>}
                  href="#r"
                />
              ))}
            </SidebarSection>
          </>
        ) : null
      }
      footer={
        <SidebarFooter
          tone={connection}
          label={CONNECTION_LABEL[connection]}
          address="local:3100"
          notice={
            gap ? (
              <SidebarFooterNotice
                message="3 events may be missing since 10:42:07 after a dropped connection."
                action={<IconButton icon="refresh" label="Refresh" size="sm" />}
              />
            ) : null
          }
          update={update && !strip ? <UpdatePill placement="footer" version="0.0.2-alpha.1" /> : null}
          action={<IconButton icon="settings" label="Settings" />}
        />
      }
    />
  );
}

export function demoRail({ layout = 'native', active = 'chats', live = true, covered = false, update = false }: DemoOptions = {}): ReactNode {
  const strip = layout === 'strip';
  return (
    <Rail className="h-full" covered={covered} topRow={layout === 'mac' ? <MacTrafficLightRow aria-hidden /> : undefined}>
      {strip ? null : <RailMark label="GeneratorAI · This computer" />}
      <IconButton icon="sidebar" label="Show sidebar" size="lg" tooltipSide="right" />
      <RailDivider />
      {strip ? null : <IconButton icon="search" label="Search" size="lg" tooltipSide="right" />}
      <IconButton icon="edit" label="New chat" size="lg" tooltipSide="right" />
      <RailDivider />
      <RailGroup role="navigation" aria-label="Main">
        {DESTINATIONS.map((d) => (
          <IconButton
            key={d.id}
            icon={d.icon}
            label={d.label}
            size="lg"
            tooltipSide="right"
            {...(d.id === active ? { 'aria-current': 'page' as const, className: 'bg-selected text-fg' } : {})}
            badge={live && d.id === 'home' ? <StatusDot tone="warn" ring /> : undefined}
            render={<a href={`#${d.id}`} />}
          />
        ))}
      </RailGroup>
      {live ? (
        <>
          <RailDivider />
          <RailCounterButton count={3} label="3 running" />
        </>
      ) : null}
      <RailSpacer />
      {update && !strip ? <UpdatePill placement="rail" version="0.0.2-alpha.1" /> : null}
      <RailStatusDot tone="ok" label="Connected · local:3100" />
      <IconButton icon="settings" label="Settings" size="lg" tooltipSide="right" />
    </Rail>
  );
}
