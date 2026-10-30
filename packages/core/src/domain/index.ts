// Domain layer barrel
export * from './state-machines/index.js';
export * from './ports/index.js';
export * from './dag/index.js';
export * from './errors/index.js';
export * from './workflow-graph/index.js';
export * from './scheduler/index.js';

// Shared domain entities and value objects
export type {
	Session,
	ChatMessage,
	Artifact,
	HookDefinition,
	HookConfig,
	HookPhase,
	HookType,
	HookFailurePolicy,
	ScriptHookConfig,
	HttpHookConfig,
	FunctionHookConfig,
} from '@generatorai/shared';

// Shared event types and guards
export type { AgentEvent, AgentEventKind, PersistedEvent } from '@generatorai/shared';
export {
	isAgentEvent,
	isHarnessEvent,
	isWorkflowRunEvent,
	isSessionEvent,
	isGitEvent,
	isHookEvent,
	createAgentEvent,
} from '@generatorai/shared';
