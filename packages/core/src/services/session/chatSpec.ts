// ────────────────────────────────────────────────────────────────
// Chat row ↔ SessionSpec (PD-20).
//
// Chats keep their own columns and wire shape (`CreateChatParams` is
// unchanged); the composer only ever sees a `SessionSpec`. This is the
// storage mapping from a chat record (or a create request) to that type —
// the one place a chat's `harnessConfig` field names meet the spec's.
// ────────────────────────────────────────────────────────────────

import type { Chat, CreateChatParams, HarnessConfig } from '@generatorai/shared';
import type { SessionSpec } from '@generatorai/workflow-spec';

type ChatSource = Pick<
  Chat,
  'model' | 'agentRef' | 'agentOverrides' | 'permissionMode' | 'defaultAgentMode' | 'browserConfig' | 'orchestratorMode'
> & { harnessConfig?: Partial<HarnessConfig> | undefined };

/** The session a chat (or a chat create request) describes. */
export function chatSessionSpec(chat: ChatSource | CreateChatParams): SessionSpec {
  const hc = (chat.harnessConfig ?? {}) as Partial<HarnessConfig>;
  const spec: SessionSpec = {};
  const model = hc.model ?? chat.model;
  if (model) spec.model = model;
  if (hc.harnessType) spec.harnessType = hc.harnessType;
  if (hc.reasoningEffort) spec.reasoningEffort = hc.reasoningEffort as SessionSpec['reasoningEffort'];
  if (hc.contextTier) spec.contextTier = hc.contextTier;
  if (hc.maxTurns) spec.maxTurns = hc.maxTurns;
  if (hc.provider) spec.provider = hc.provider;
  const agentRef = chat.agentRef ?? hc.agentRef;
  if (agentRef) spec.agentRef = agentRef;
  if (chat.agentOverrides) spec.agentOverrides = chat.agentOverrides as SessionSpec['agentOverrides'];
  if (hc.systemMessage) spec.systemMessage = hc.systemMessage;
  if (hc.systemPromptAppend) spec.systemPromptAppend = hc.systemPromptAppend;
  if (hc.planModeInstructions) spec.planModeInstructions = hc.planModeInstructions;
  if (hc.availableTools || hc.excludedTools) {
    spec.tools = {
      ...(hc.availableTools ? { available: hc.availableTools } : {}),
      ...(hc.excludedTools ? { excluded: hc.excludedTools } : {}),
    };
  }
  if (hc.mcpServers || hc.excludedMcpServerIds) {
    spec.mcp = {
      ...(hc.mcpServers ? { servers: hc.mcpServers as NonNullable<SessionSpec['mcp']>['servers'] } : {}),
      ...(hc.excludedMcpServerIds ? { excludedIds: hc.excludedMcpServerIds } : {}),
    };
  }
  if (hc.skillDirectories || hc.disabledSkills) {
    spec.skills = {
      ...(hc.skillDirectories ? { directories: hc.skillDirectories } : {}),
      ...(hc.disabledSkills ? { disabled: hc.disabledSkills } : {}),
    };
  }
  if (hc.customAgents) spec.customAgents = hc.customAgents;
  if (chat.permissionMode) spec.permissionMode = chat.permissionMode as SessionSpec['permissionMode'];
  if (chat.defaultAgentMode) spec.defaultAgentMode = chat.defaultAgentMode as SessionSpec['defaultAgentMode'];
  if (chat.browserConfig) spec.browser = chat.browserConfig as SessionSpec['browser'];
  if (chat.orchestratorMode !== undefined) spec.orchestrator = chat.orchestratorMode;
  return spec;
}
