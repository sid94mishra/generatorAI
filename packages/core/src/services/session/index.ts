// The session composer (P02): one code path builds every agent session.
export * from './types.js';
export * from './cfg.js';
export { PlatformToolBinder, type BindTarget } from './PlatformToolBinder.js';
export { resolveMcp } from './resolveMcp.js';
export { PROVIDER_CAPABILITY_LEVELS, capabilityLevelsFor, type CapabilityLevels } from './capabilityLevels.js';
export { applyAgentProjection, applyExplicitSpec, appendAgentInstructions, deliverSkills, type AgentProjectionInput } from './agentProjection.js';
export { chatSessionSpec } from './chatSpec.js';
export { workspaceExposure, applyWorkspaceExposure, runWorkspace } from './workspaceExposure.js';
export { TurnContextRegistry, withAgentToolPolicy, stampCardSequence, type GatePort } from './gates.js';
export { applyModeConfig, planPromptPrefix, type ModeConfigInput } from './modeConfig.js';
export { StageGatePort, type StageGatePortDeps } from './StageGatePort.js';
export { runPermissionSource, runPermissionMode, turnOptionsFrom, checkPermissionGating, type PermissionModeSource } from './permissionSource.js';
export { SessionComposer, type ComposeInput, type ComposeResult } from './SessionComposer.js';
export { formatConversationBindingKey, type BindingKeyParts } from './bindingKey.js';
export { TurnRecorder, type RecordedTurn, type RecordedToolCall, type TurnSnapshot, type TurnRecorderOptions } from './TurnRecorder.js';
export { rememberProviderSession } from './providerSession.js';
