// Settings section registrations (F-settings-01, D-26). Loaded with the
// Settings modal (app/routes/settings.routes.tsx). Sections not yet rebuilt on
// the C-13 recipe render their legacy component inside the new frame until
// their P6-05…P6-10 task replaces the entry here — the contract is in
// features/settings/settingsSections.ts.

import {
  AgentsSection,
  AppearanceSection,
  GeneralSection,
  McpSection,
  ProvidersSection,
  AudioSection,
  BrowserTerminalSection,
  ComputerUseSection,
  DiagnosticsSection,
  ExtensionsSection,
  SecuritySection,
  SkillsSection,
  SourceControlSection,
  TemplatesSection,
  StorageSection,
  registerSettingsSection,
  type SettingsSectionDefinition,
} from '@/features/settings/index.js';
import { SettingsStatusFooter } from '@/ui/patterns/SettingsSection/SettingsSection.js';

const SECTIONS: SettingsSectionDefinition[] = [
  {
    id: 'general',
    render: () => <GeneralSection />,
    footer: <SettingsStatusFooter icon="check">Changes apply instantly · Saved on this device</SettingsStatusFooter>,
  },
  {
    id: 'appearance',
    render: () => <AppearanceSection />,
    footer: <SettingsStatusFooter icon="check">Changes apply instantly · Saved on this device</SettingsStatusFooter>,
  },
  { id: 'providers', render: () => <ProvidersSection /> },
  { id: 'agents', render: () => <AgentsSection /> },
  {
    id: 'skills',
    render: () => <SkillsSection />,
    footer: <SettingsStatusFooter icon="check">Disabled skills are excluded on this device only</SettingsStatusFooter>,
  },
  { id: 'mcp', render: () => <McpSection /> },
  { id: 'templates', render: () => <TemplatesSection /> },
  {
    id: 'source-control',
    render: () => <SourceControlSection />,
    footer: <SettingsStatusFooter icon="server">Accounts and defaults are saved to the server</SettingsStatusFooter>,
  },
  {
    id: 'browser-terminal',
    render: () => <BrowserTerminalSection />,
    footer: <SettingsStatusFooter icon="check">Changes apply instantly · Saved on this device</SettingsStatusFooter>,
  },
  {
    id: 'computer-use',
    render: () => <ComputerUseSection />,
    footer: <SettingsStatusFooter icon="shield">Saved to the server</SettingsStatusFooter>,
  },
  {
    id: 'audio',
    render: () => <AudioSection />,
    footer: <SettingsStatusFooter icon="check">Saved to the server · the microphone choice stays on this device</SettingsStatusFooter>,
  },
  {
    id: 'extensions',
    render: () => <ExtensionsSection />,
    footer: <SettingsStatusFooter icon="check">Saved to the server</SettingsStatusFooter>,
  },
  {
    id: 'security',
    render: () => <SecuritySection />,
    footer: <SettingsStatusFooter icon="shield">Saved to this server · devices need a pairing code to connect</SettingsStatusFooter>,
  },
  {
    id: 'storage',
    render: () => <StorageSection />,
    footer: <SettingsStatusFooter icon="check">Saved to the server</SettingsStatusFooter>,
  },
  { id: 'diagnostics', render: () => <DiagnosticsSection /> },
];

// A hot reload re-runs this file (the modal loads it with a new URL).
for (const section of SECTIONS) registerSettingsSection(section, { replace: Boolean(import.meta.hot) });
