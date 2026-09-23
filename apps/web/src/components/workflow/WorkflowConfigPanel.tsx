// ────────────────────────────────────────────────────────────────
// WorkflowConfigPanel — Tabbed modal with sidebar navigation
// Sections: General, Project & Codebases, Variables, Tags
// ────────────────────────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import { X, Settings, FolderGit2, Variable, Tag, Webhook } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Modal, Button } from '@/components/ui/index.js';
import { GeneralTab } from './settings/GeneralTab.js';
import { ProjectCodebasesTab } from './settings/ProjectCodebasesTab.js';
import { VariablesTab } from './settings/VariablesTab.js';
import { TagsMetadataTab } from './settings/TagsMetadataTab.js';
import { HooksTab } from './settings/HooksTab.js';

interface WorkflowConfigPanelProps {
  open: boolean;
  onClose: () => void;
}

type SettingsTab = 'general' | 'project' | 'variables' | 'tags' | 'hooks';

const TABS: { key: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { key: 'general', label: 'General', icon: <Settings className="h-4 w-4" /> },
  { key: 'project', label: 'Project & Codebases', icon: <FolderGit2 className="h-4 w-4" /> },
  { key: 'variables', label: 'Variables', icon: <Variable className="h-4 w-4" /> },
  { key: 'hooks', label: 'Hooks', icon: <Webhook className="h-4 w-4" /> },
  { key: 'tags', label: 'Tags & Metadata', icon: <Tag className="h-4 w-4" /> },
];

export function WorkflowConfigPanel({ open, onClose }: WorkflowConfigPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  // Reset tab when modal opens
  useEffect(() => {
    if (open) setActiveTab('general');
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} size="xl" hideClose ariaLabel="Workflow settings">
      {/* Full-bleed two-pane layout inside the Modal body */}
      <div
        className="-mx-5 -my-4 flex h-[calc(100%+2rem)] overflow-hidden"
        aria-label="Workflow Settings"
      >

        {/* ═══ Sidebar Navigation ═══ */}
        <div className="flex w-52 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-subtle,var(--color-background))]">
          {/* Sidebar header */}
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-4">
            <Settings className="h-5 w-5 text-[var(--color-primary)]" />
            <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Settings</h2>
          </div>

          {/* Tab buttons */}
          <nav className="flex-1 p-2 space-y-0.5">
            {TABS.map(({ key, label, icon }) => (
              <Button
                key={key}
                onClick={() => setActiveTab(key)}
                variant="ghost"
                size="sm"
                className={cn(
                  'h-auto flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium transition-all duration-150',
                  activeTab === key
                    ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10'
                    : 'bg-transparent text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]',
                )}
              >
                <span className={cn(
                  'shrink-0 transition-colors',
                  activeTab === key ? 'text-[var(--color-primary)]' : 'text-[var(--color-muted-foreground)]',
                )}>
                  {icon}
                </span>
                {label}
              </Button>
            ))}
          </nav>

          {/* Sidebar footer */}
          <div className="border-t border-[var(--color-border)] p-3">
            <Button
              onClick={onClose}
              variant="ghost"
              size="sm"
              className="h-auto w-full rounded-lg bg-[var(--color-primary)] px-3 py-2 text-xs font-medium text-[var(--color-primary-foreground)] transition-all hover:brightness-110"
            >
              Done
            </Button>
          </div>
        </div>

        {/* ═══ Main Content Area ═══ */}
        <div className="flex flex-1 flex-col min-w-0">
          {/* Content header */}
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
            <h3 className="text-base font-semibold text-[var(--color-foreground)]">
              {TABS.find((t) => t.key === activeTab)?.label}
            </h3>
            <Button
              onClick={onClose}
              aria-label="Close settings"
              variant="ghost"
              size="icon-sm"
              className="h-auto w-auto rounded-md p-1.5 text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)]"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'general' && <GeneralTab />}
            {activeTab === 'project' && <ProjectCodebasesTab />}
            {activeTab === 'variables' && <VariablesTab />}
            {activeTab === 'hooks' && <HooksTab />}
            {activeTab === 'tags' && <TagsMetadataTab />}
          </div>
        </div>
      </div>
    </Modal>
  );
}
