// ────────────────────────────────────────────────────────────────
// Settings section registry — the nav rail groups and the component
// behind each section id.
//
// Lives apart from the page so the list is importable from tests and
// from anything that needs a section's label (the command palette, a
// deep link's page title) without pulling the whole page in.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import {
  Settings2, Cpu, Sparkles, Server, LayoutTemplate,
  GitPullRequest, SquareTerminal, Blocks, HeartPulse, ShieldCheck, Bot, MonitorCog, Palette, HardDrive, Mic, Workflow,
} from 'lucide-react';
import type { SettingsSectionId } from '@/stores/settingsUiStore.js';

import { GeneralSection } from './sections/General.js';
import { AppearanceSection } from './sections/Appearance.js';
import { ProvidersSection } from './sections/Providers.js';
import { SkillsSection, McpSection, TemplatesSection } from './sections/Catalogs.js';
import { AgentsSection } from './sections/Agents.js';
import { SourceControlSection } from './sections/SourceControl.js';
import { BrowserTerminalSection } from './sections/BrowserTerminal.js';
import { ComputerUseSection } from './sections/ComputerUse.js';
import { ExtensionsSection } from './sections/Extensions.js';
import { SecuritySection } from './sections/Security.js';
import { DiagnosticsSection } from './sections/Diagnostics.js';
import { WorkspaceRetentionSection } from './sections/WorkspaceRetention.js';
import { AudioSection } from './sections/Audio.js';
import { WorkflowEngineSection } from './sections/WorkflowEngine.js';

export interface SettingsNavEntry {
  id: SettingsSectionId;
  label: string;
  icon: React.ElementType;
}

export interface SettingsNavGroup {
  heading: string;
  items: SettingsNavEntry[];
}

export const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    heading: 'App',
    items: [
      { id: 'general', label: 'General', icon: Settings2 },
      { id: 'appearance', label: 'Appearance', icon: Palette },
    ],
  },
  {
    heading: 'Agents',
    items: [
      { id: 'providers', label: 'Model Providers', icon: Cpu },
      { id: 'agents', label: 'Agents', icon: Bot },
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
      { id: 'computer-use', label: 'Computer Use', icon: MonitorCog },
      { id: 'audio', label: 'Audio', icon: Mic },
      { id: 'extensions', label: 'Extensions', icon: Blocks },
    ],
  },
  {
    heading: 'System',
    items: [
      { id: 'security', label: 'Security & Devices', icon: ShieldCheck },
      { id: 'storage', label: 'Storage', icon: HardDrive },
      { id: 'workflow-engine', label: 'Workflow Engine', icon: Workflow },
      { id: 'diagnostics', label: 'Diagnostics', icon: HeartPulse },
    ],
  },
];

export const SETTINGS_SECTIONS: Record<SettingsSectionId, React.ReactNode> = {
  general: <GeneralSection />,
  appearance: <AppearanceSection />,
  providers: <ProvidersSection />,
  agents: <AgentsSection />,
  skills: <SkillsSection />,
  mcp: <McpSection />,
  templates: <TemplatesSection />,
  'source-control': <SourceControlSection />,
  'browser-terminal': <BrowserTerminalSection />,
  'computer-use': <ComputerUseSection />,
  audio: <AudioSection />,
  extensions: <ExtensionsSection />,
  security: <SecuritySection />,
  storage: <WorkspaceRetentionSection />,
  'workflow-engine': <WorkflowEngineSection />,
  diagnostics: <DiagnosticsSection />,
};

/** Human label for a section id (falls back to the id itself). */
export function settingsSectionLabel(id: SettingsSectionId): string {
  for (const group of SETTINGS_NAV) {
    for (const item of group.items) if (item.id === id) return item.label;
  }
  return id;
}
