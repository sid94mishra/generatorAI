// ────────────────────────────────────────────────────────────────
// Sidebar — Vertical navigation menu: Dashboard, Chats, Workflows,
//           Automations, Settings.
//           No inline entity lists — navigation takes user to the
//           dedicated list page for each section.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

import { Settings, Zap, MessageSquare, GitBranch, LayoutDashboard, RefreshCw, FolderKanban, FileCode2, PanelLeftClose, Bot } from 'lucide-react';
import { Kbd, Button } from '@/components/ui/index.js';
import { Tooltip } from '@/components/Tooltip.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';
import { useUiStore } from '@/stores/uiStore.js';
import { cn } from '@/lib/utils.js';

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const openSettings = useSettingsUiStore((s) => s.openSettings);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  const isChatRoute = location.pathname.startsWith('/chats');
  const isAgentRoute = location.pathname.startsWith('/agents');
  const isWorkflowRoute = location.pathname.startsWith('/workflows');
  const isAutomationRoute = location.pathname.startsWith('/automations');
  const isProjectRoute = location.pathname.startsWith('/projects');
  const isScriptRoute = location.pathname.startsWith('/scripts');

  const navItem = (
    path: string,
    label: string,
    Icon: React.ElementType,
    isActive: boolean,
  ) => (
    <Button
      key={path}
      variant="ghost"
      onClick={() => navigate(path)}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
        isActive
          ? 'bg-[var(--color-sidebar-accent)] text-[var(--color-sidebar-accent-foreground)]'
          : 'text-[var(--color-sidebar-foreground)] hover:bg-[var(--color-sidebar-accent)]',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </Button>
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header — logo + collapse toggle (lives on the left pane) */}
      <div className="flex h-10 items-center justify-between border-b border-[var(--color-sidebar-border)] px-3">
        <Button
          variant="ghost"
          onClick={() => navigate('/')}
          className="flex items-center gap-2.5 transition-opacity hover:opacity-90 active:scale-[0.97]"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--color-primary)]">
            <Zap className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-[var(--color-foreground)]">GeneratorAI</span>
        </Button>
        <Tooltip content="Hide sidebar">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleSidebar}
            aria-pressed
            aria-label="Hide sidebar"
            data-testid="sidebar-toggle"
            className="rounded-md border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 p-1 text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary)]/20"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </Tooltip>
      </div>

      {/* Main vertical nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {navItem('/', 'Dashboard', LayoutDashboard, location.pathname === '/')}
        {navItem('/projects', 'Projects', FolderKanban, isProjectRoute)}
        {navItem('/chats', 'Chats', MessageSquare, isChatRoute)}
        {navItem('/agents', 'Agents', Bot, isAgentRoute)}
        {navItem('/workflows', 'Workflows', GitBranch, isWorkflowRoute)}
        {navItem('/scripts', 'Scripts', FileCode2, isScriptRoute)}
        {navItem('/automations', 'Automations', RefreshCw, isAutomationRoute)}
      </nav>

      {/* Bottom Navigation */}
      <div className="border-t border-[var(--color-sidebar-border)] px-2 py-2 space-y-0.5">
        <Button
          variant="ghost"
          onClick={() => openSettings()}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
            'text-[var(--color-sidebar-foreground)] hover:bg-[var(--color-sidebar-accent)]',
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          Settings
        </Button>
        <div className="flex items-center justify-between px-3 pb-0.5 pt-1.5 text-[11px] text-[var(--color-muted-foreground)]">
          <span>Command palette</span>
          <Kbd keys={['mod', 'K']} />
        </div>
      </div>
    </div>
  );
}
