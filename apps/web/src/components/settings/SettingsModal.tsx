// ────────────────────────────────────────────────────────────────
// SettingsModal — the global Settings surface. A fixed top header
// (title + close), a grouped left nav, and a full-width scrollable
// content pane whose scrollbar sits flush with the modal edge. Opened
// from the sidebar gear / command palette / any openSettings() call.
// Built on the vendored Dialog primitive for a bespoke layout.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import {
  Settings2, Cpu, Sparkles, Server, LayoutTemplate,
  GitPullRequest, SquareTerminal, Blocks, HeartPulse, ShieldCheck, X,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/index.js';
import { cn } from '@/lib/utils.js';
import { useSettingsUiStore, type SettingsSectionId } from '@/stores/settingsUiStore.js';

import { GeneralSection } from './sections/GeneralAppearance.js';
import { ProvidersSection } from './sections/Providers.js';
import { SkillsSection, McpSection, TemplatesSection } from './sections/Catalogs.js';
import { SourceControlSection } from './sections/SourceControl.js';
import { BrowserTerminalSection } from './sections/BrowserTerminal.js';
import { ExtensionsSection } from './sections/Extensions.js';
import { SecuritySection } from './sections/Security.js';
import { DiagnosticsSection } from './sections/Diagnostics.js';

interface NavEntry {
  id: SettingsSectionId;
  label: string;
  icon: React.ElementType;
}

interface NavGroup {
  heading: string;
  items: NavEntry[];
}

const NAV: NavGroup[] = [
  {
    heading: 'App',
    items: [
      { id: 'general', label: 'General', icon: Settings2 },
    ],
  },
  {
    heading: 'Agents',
    items: [
      { id: 'providers', label: 'Model Providers', icon: Cpu },
      { id: 'skills', label: 'Skills', icon: Sparkles },
      { id: 'mcp', label: 'MCP Servers', icon: Server },
      { id: 'templates', label: 'Templates', icon: LayoutTemplate },
    ],
  },
  {
    heading: 'Integrations',
    items: [
      { id: 'source-control', label: 'Source Control', icon: GitPullRequest },
      { id: 'browser-terminal', label: 'Browser & Terminal', icon: SquareTerminal },
      { id: 'extensions', label: 'Extensions', icon: Blocks },
    ],
  },
  {
    heading: 'System',
    items: [
      { id: 'security', label: 'Security & Devices', icon: ShieldCheck },
      { id: 'diagnostics', label: 'Diagnostics', icon: HeartPulse },
    ],
  },
];

const SECTIONS: Record<SettingsSectionId, React.ReactNode> = {
  general: <GeneralSection />,
  providers: <ProvidersSection />,
  skills: <SkillsSection />,
  mcp: <McpSection />,
  templates: <TemplatesSection />,
  'source-control': <SourceControlSection />,
  'browser-terminal': <BrowserTerminalSection />,
  extensions: <ExtensionsSection />,
  security: <SecuritySection />,
  diagnostics: <DiagnosticsSection />,
};

export function SettingsModal() {
  const open = useSettingsUiStore((s) => s.open);
  const section = useSettingsUiStore((s) => s.section);
  const setSection = useSettingsUiStore((s) => s.setSection);
  const closeSettings = useSettingsUiStore((s) => s.closeSettings);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeSettings()}>
      <DialogContent hideClose className="h-[min(94vh,54rem)] w-[min(98vw,78rem)] p-0">
        <DialogTitle className="sr-only">Settings</DialogTitle>

        {/* Fixed top header spanning the full modal width */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Settings2 className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-semibold text-foreground">Settings</h2>
          </div>
          <button
            type="button"
            onClick={closeSettings}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* Left nav */}
          <nav className="flex w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border bg-subtle/40 px-3 py-4">
            {NAV.map((group) => (
              <div key={group.heading} className="space-y-1">
                <div className="px-2 pb-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                    {group.heading}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {group.items.map(({ id, label, icon: Icon }) => {
                    const active = id === section;
                    return (
                      <button
                        key={id}
                        onClick={() => setSection(id)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                          active
                            ? 'bg-primary/10 font-medium text-primary'
                            : 'text-muted-foreground hover:bg-subtle hover:text-foreground',
                        )}
                        aria-current={active ? 'page' : undefined}
                      >
                        <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
                        <span className="truncate">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Content — full-width scroller so the scrollbar sits at the modal
              edge; an inner column keeps the reading measure comfortable. */}
          <div className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-8 py-6">
              {SECTIONS[section]}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
