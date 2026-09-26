// features/settings — the Settings modal (D-26) and its rebuilt sections.
export { SettingsModal, type SettingsModalProps } from './SettingsModal.js';
export {
  registerSettingsSection,
  getSettingsSection,
  useSettingsSection,
  type SettingsSectionDefinition,
  type RegisterSettingsSectionOptions,
} from './settingsSections.js';
export { AppearanceSection } from './appearance/AppearanceSection.js';
export { SecuritySection } from './security/SecuritySection.js';
export { GeneralSection } from './general/GeneralSection.js';
export { ProvidersSection } from './providers/ProvidersSection.js';
export { AgentsSection } from './agents/AgentsSection.js';
export { SkillsSection } from './skills/SkillsSection.js';
export { McpSection } from './mcp/McpSection.js';
export { TemplatesSection } from './templates/TemplatesSection.js';
export { SourceControlSection } from './source-control/SourceControlSection.js';
