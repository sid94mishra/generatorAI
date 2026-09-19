// ────────────────────────────────────────────────────────────────
// AppLayout — Top-level shell: sidebar + header + main content
// Sidebar state lives in uiStore (persisted); registers the global
// ⌘K / Ctrl+K keybinding for the command palette.
//
// Below the `md` breakpoint the sidebar is a real modal Drawer (Radix
// Dialog): the page behind it is inert, focus is trapped, Escape and the
// backdrop close it, and focus returns to the button that opened it. The
// previous hand-rolled full-viewport backdrop had none of that.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar.js';
import { Header } from './Header.js';
import { TitleBar } from './TitleBar.js';
import { CommandPalette } from './CommandPalette.js';
import { FindBar } from './FindBar.js';
import { Drawer } from '@/components/ui/Drawer.js';
import { useUiStore } from '@/stores/uiStore.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';
import { useDesktopIntegration } from '@/hooks/useDesktopIntegration.js';
import { useIsNarrowViewport } from '@/hooks/useMediaQuery.js';
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
  const isMobile = useIsNarrowViewport();
  const location = useLocation();
  const navigate = useNavigate();
  const setSettingsNavigator = useSettingsUiStore((s) => s.setNavigator);

  // Settings is a routed page; `openSettings(section)` is a navigation, and
  // the store cannot hold a router hook. The shell lends it one — imported
  // the other way round (store → router.tsx) it would close an import cycle
  // through every lazy page.
  useEffect(() => {
    setSettingsNavigator((path, opts) => navigate(path, { replace: opts?.replace ?? false }));
    return () => setSettingsNavigator(null);
  }, [navigate, setSettingsNavigator]);

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

  // On a phone the drawer covers the page, so following a nav link must
  // also dismiss it — otherwise the user lands on the new page and still
  // sees the menu. Desktop keeps the sidebar where it is.
  const lastPath = useRef(location.pathname);
  useEffect(() => {
    if (lastPath.current !== location.pathname) {
      lastPath.current = location.pathname;
      if (isMobile) setSidebarOpen(false);
    }
  }, [location.pathname, isMobile, setSidebarOpen]);

  return (
    // Column, not row: in the desktop shell the title bar spans the FULL width
    // above both the sidebar and the content, so the OS window controls get a
    // strip of their own instead of overlapping the header's buttons.
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TitleBar visible={chrome.titleBarStyle !== 'native'} />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {isMobile ? (
          // Sidebar has its own "Hide sidebar" control, so the Drawer's
          // default close button is redundant here.
          <Drawer
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            side="left"
            title="Navigation"
            hideTitle
            hideClose
            className="w-60 border-sidebar-border bg-sidebar"
          >
            <Sidebar />
          </Drawer>
        ) : (
          <aside
            className={cn(
              'flex flex-col border-r border-sidebar-border bg-sidebar transition-[width,opacity] duration-200 ease-in-out',
              sidebarOpen ? 'w-60' : 'w-0 overflow-hidden opacity-0',
            )}
            // A collapsed sidebar is still in the DOM (for the width
            // transition); keep its links out of the tab order.
            inert={!sidebarOpen}
            aria-hidden={!sidebarOpen}
          >
            <Sidebar />
          </aside>
        )}

        {/* Main area */}
        <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
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
      <FindBar />

    </div>
  );
}
