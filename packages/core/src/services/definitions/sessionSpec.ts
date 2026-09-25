// ────────────────────────────────────────────────────────────────
// SessionSpec → the harness session config the v1 stage executor builds
// its conversation from. `resolveSessionSpec` (workflow-spec) is the one
// merge of session layers; this maps a (merged or single) layer onto the
// `HarnessConfig` field names the executor and the agent resolver take.
// PHASE-02's SessionComposer replaces this with the composer.
// ────────────────────────────────────────────────────────────────

import type { SessionSpec } from '@generatorai/workflow-spec';
import type { HarnessConfig } from '@generatorai/shared';

export function sessionSpecToHarnessConfig(s: SessionSpec | undefined): Partial<HarnessConfig> {
  if (!s) return {};
  const h: Partial<HarnessConfig> = {};
  if (s.model) h.model = s.model;
  if (s.harnessType) h.harnessType = s.harnessType;
  if (s.reasoningEffort) h.reasoningEffort = s.reasoningEffort as HarnessConfig['reasoningEffort'];
  if (s.contextTier) h.contextTier = s.contextTier;
  if (s.maxTurns !== undefined) h.maxTurns = s.maxTurns;
  if (s.provider) h.provider = s.provider;
  if (s.agentRef) h.agentRef = s.agentRef;
  if (s.agentOverrides) h.agentOverrides = s.agentOverrides as HarnessConfig['agentOverrides'];
  if (s.systemMessage) h.systemMessage = { mode: s.systemMessage.mode, content: s.systemMessage.content };
  if (s.systemPromptAppend) h.systemPromptAppend = s.systemPromptAppend;
  if (s.planModeInstructions) h.planModeInstructions = s.planModeInstructions;
  if (s.permissionMode) h.permissionMode = s.permissionMode as HarnessConfig['permissionMode'];
  if (s.defaultAgentMode) h.defaultAgentMode = s.defaultAgentMode;
  if (s.tools?.available) h.availableTools = [...s.tools.available];
  if (s.tools?.excluded) h.excludedTools = [...s.tools.excluded];
  if (s.mcp?.servers) h.mcpServers = { ...s.mcp.servers } as HarnessConfig['mcpServers'];
  if (s.mcp?.excludedIds) h.excludedMcpServerIds = [...s.mcp.excludedIds];
  if (s.skills?.directories) h.skillDirectories = [...s.skills.directories];
  if (s.skills?.disabled) h.disabledSkills = [...s.skills.disabled];
  if (s.customAgents) h.customAgents = s.customAgents.map((c) => ({ ...c }));
  return h;
}
