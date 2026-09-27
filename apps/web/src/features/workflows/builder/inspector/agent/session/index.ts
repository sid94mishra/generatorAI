// The kit session editor (P02 WP-2.11): a stage's session in the agent-stage
// inspector (scope "stage", `inherited` = the workflow session) and the
// workflow's own session in the settings General tab (scope "workflow").
export { SessionSpecEditor, type SessionSpecEditorProps } from './SessionSpecEditor.js';
export {
  ALL_SESSION_SECTIONS,
  effectiveSession,
  enabledToolCount,
  inheritsLabel,
  useBoundAgent,
  useSessionCatalog,
  type SessionCatalog,
  type SessionScope,
  type SessionSpecSection,
} from './sessionModel.js';
export { AgentBindingSection, type AgentBindingSectionProps } from './AgentBindingSection.js';
export { AgentOverridesEditor, type AgentOverridesEditorProps } from './AgentOverridesEditor.js';
export { McpSection, PlatformToolsSection, SkillsSection } from './ToolSections.js';
