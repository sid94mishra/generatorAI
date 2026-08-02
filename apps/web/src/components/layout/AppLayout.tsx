// ────────────────────────────────────────────────────────────────
// AppLayout — Top-level shell: sidebar + header + main content
// Sidebar state lives in uiStore (persisted); registers the global
// ⌘K / Ctrl+K keybinding for the command palette.
// ────────────────────────────────────────────────────────────────

import React, { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar.js';
import { Header } from './Header.js';
import { TitleBar } from './TitleBar.js';
import { CommandPalette } from './CommandPalette.js';
import { SettingsModal } from '@/components/settings/SettingsModal.js';
import { useUiStore } from '@/stores/uiStore.js';
import { useDesktopIntegration } from '@/hooks/useDesktopIntegration.js';
import { isDesktop } from '@/lib/desktop.js';
import { cn } from '@/lib/utils.js';

/** True when the keydown originates from a text-editing context. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export function AppLayout() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);

  // Publishes window chrome, handles native menu commands, and mirrors UI
  // state back into the menu. No-op outside the Electron shell.
  const chrome = useDesktopIntegration();

  // Global ⌘K / Ctrl+K — toggle the command palette.
  //
  // In the desktop shell the native `View ▸ Command Palette` accelerator
  // already fires this, and Electron delivers menu accelerators *and* the
  // keydown, so listening here too would toggle twice and cancel out.
  useEffect(() => {
    if (isDesktop) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        setCommandPaletteOpen(!useUiStore.getState().commandPaletteOpen);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setCommandPaletteOpen]);

  return (
    // Column, not row: in the desktop shell the title bar spans the FULL width
    // above both the sidebar and the content, so the OS window controls get a
    // strip of their own instead of overlapping the header's buttons.
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--color-background)]">
      <TitleBar visible={chrome.titleBarStyle !== 'native'} />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Mobile backdrop overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={cn(
            'flex flex-col border-r border-sidebar-border bg-sidebar transition-[width,transform,opacity] duration-200 ease-in-out',
            sidebarOpen
              ? 'fixed inset-y-0 left-0 z-50 w-60 md:relative md:z-auto'
              : 'w-0 overflow-hidden opacity-0',
          )}
        >
          <Sidebar />
        </aside>

        {/* Main area */}
        <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
          {/* Header */}
          <Header
            sidebarOpen={sidebarOpen}
            onToggleSidebar={toggleSidebar}
          />

          {/* Content */}
          <main className="flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Global ⌘K command palette */}
      <CommandPalette />

      {/* Global settings modal */}
      <SettingsModal />
    </div>
  );
}
