// Settings section registrations (F-settings-01, D-26). Loaded with the
// Settings modal (app/routes/settings.routes.tsx). Sections not yet rebuilt on
// the C-13 recipe render their legacy component inside the new frame until
// their P6-05…P6-10 task replaces the entry here — the contract is in
// features/settings/settingsSections.ts.

import {
  AppearanceSection,
  SecuritySection,
  registerSettingsSection,
  type SettingsSectionDefinition,
} from '@/features/settings/index.js';
import { SettingsStatusFooter } from '@/ui/patterns/SettingsSection/SettingsSection.js';
import { GeneralSection } from '@/components/settings/sections/General.js';
import { ProvidersSection } from '@/components/settings/sections/Providers.js';
import { SkillsSection, McpSection, TemplatesSection } from '@/components/settings/sections/Catalogs.js';
import { AgentsSection } from '@/components/settings/sections/Agents.js';
import { SourceControlSection } from '@/components/settings/sections/SourceControl.js';
import { BrowserTerminalSection } from '@/components/settings/sections/BrowserTerminal.js';
import { ComputerUseSection } from '@/components/settings/sections/ComputerUse.js';
import { ExtensionsSection } from '@/components/settings/sections/Extensions.js';
import { DiagnosticsSection } from '@/components/settings/sections/Diagnostics.js';
import { WorkspaceRetentionSection } from '@/components/settings/sections/WorkspaceRetention.js';
import { AudioSection } from '@/components/settings/sections/Audio.js';

const SECTIONS: SettingsSectionDefinition[] = [
  { id: 'general', render: () => <GeneralSection /> },
  {
    id: 'appearance',
    render: () => <AppearanceSection />,
    footer: <SettingsStatusFooter icon="check">Changes apply instantly · Saved on this device</SettingsStatusFooter>,
  },
  { id: 'providers', render: () => <ProvidersSection /> },
  { id: 'agents', render: () => <AgentsSection /> },
  { id: 'skills', render: () => <SkillsSection /> },
  { id: 'mcp', render: () => <McpSection /> },
  { id: 'templates', render: () => <TemplatesSection /> },
  { id: 'source-control', render: () => <SourceControlSection /> },
  { id: 'browser-terminal', render: () => <BrowserTerminalSection /> },
  { id: 'computer-use', render: () => <ComputerUseSection /> },
  { id: 'audio', render: () => <AudioSection /> },
  { id: 'extensions', render: () => <ExtensionsSection /> },
  {
    id: 'security',
    render: () => <SecuritySection />,
    footer: <SettingsStatusFooter icon="shield">Saved to this server · devices need a pairing code to connect</SettingsStatusFooter>,
  },
  { id: 'storage', render: () => <WorkspaceRetentionSection /> },
  { id: 'diagnostics', render: () => <DiagnosticsSection /> },
];

// A hot reload re-runs this file (the modal loads it with a new URL).
for (const section of SECTIONS) registerSettingsSection(section, { replace: Boolean(import.meta.hot) });
