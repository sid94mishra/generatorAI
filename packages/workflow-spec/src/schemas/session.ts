// ────────────────────────────────────────────────────────────────
// SessionSpec: the one description of an agent session (G2 §5.2).
//
// Chats keep their own columns and map them to this type (PD-20); a
// workflow carries `session`, and a stage carries a partial `session` that
// is merged over it with `resolveSessionSpec`. Every field is optional, so
// the same schema serves the full and the partial form.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { AGENT_MODES, HARNESS_PROVIDER_IDS, PERMISSION_MODES, REASONING_EFFORTS } from '../constants.js';

export const McpServerConfigSchema = z
  .object({
    type: z.enum(['http', 'sse', 'stdio']).describe('Transport'),
    url: z.string().max(2000).optional().describe('Server URL (http and sse)'),
    headers: z
      .record(z.string().max(4000))
      .optional()
      .describe("Request headers; secret values must be references to the server's own credentials, secretref:mcp/<system|project|custom>/<server id>/<name>"),
    command: z.string().max(1000).optional().describe('Executable (stdio); a literal'),
    args: z.array(z.string().max(4000)).max(64).optional().describe('Literal arguments (stdio)'),
    env: z
      .record(z.string().max(4000))
      .optional()
      .describe("Environment (stdio); secret values must be references to the server's own credentials, secretref:mcp/<system|project|custom>/<server id>/<name>"),
    cwd: z.string().max(1000).optional().describe('Working directory (stdio)'),
    tools: z.array(z.string().max(200)).max(500).optional().describe('Allow-list of tool names this server may expose'),
    timeoutMs: z.number().int().min(0).max(600_000).optional().describe('Per-call timeout'),
    enabled: z.boolean().optional().describe('False keeps the entry but does not start the server'),
  })
  .strict()
  .describe('An MCP server the session can use');
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const AgentToolPolicySchema = z
  .object({
    browser: z.boolean().optional().describe('Integrated browser tools'),
    widgets: z.boolean().optional().describe('Widget tools'),
    extensionAuthoring: z.boolean().optional().describe('Extension authoring tools'),
    orchestration: z.boolean().optional().describe('Orchestrator worker tools'),
    fileRead: z.boolean().optional().describe('File read tools'),
    fileWrite: z.boolean().optional().describe('File write tools'),
    shell: z.boolean().optional().describe('Shell tools'),
    web: z.boolean().optional().describe('Web fetch and search tools'),
    workflows: z.boolean().optional().describe('Workflow tools: list, describe, run, check, respond to an approval, cancel'),
    workflowAuthoring: z.boolean().optional().describe('Workflow authoring tools: guide, validate, plan, create a draft'),
  })
  .strict()
  .describe('Tool-group delta over the bound agent');

export const AgentRuntimePolicySchema = z
  .object({
    model: z.string().max(200).optional().describe('Model id'),
    harnessType: z.enum(HARNESS_PROVIDER_IDS).optional().describe('Agent provider'),
    reasoningEffort: z.enum(REASONING_EFFORTS).optional().describe('Reasoning effort'),
    contextTier: z.enum(['default', 'long_context']).optional().describe('Context window tier'),
    maxTurns: z.number().int().min(1).max(1000).optional().describe('Turn cap per prompt'),
    permissionMode: z.enum(PERMISSION_MODES).optional().describe('Permission mode'),
    defaultAgentMode: z.enum(AGENT_MODES).optional().describe('Default agent mode'),
  })
  .strict()
  .describe('Runtime delta over the bound agent');

export const AgentOverridesSchema = z
  .object({
    addSkillIds: z.array(z.string().max(200)).max(100).optional().describe('Skills added to the agent'),
    removeSkillIds: z.array(z.string().max(200)).max(100).optional().describe('Agent skills removed'),
    addMcpServerIds: z.array(z.string().max(200)).max(100).optional().describe('MCP servers added to the agent'),
    removeMcpServerIds: z.array(z.string().max(200)).max(100).optional().describe('Agent MCP servers removed'),
    tools: AgentToolPolicySchema.optional(),
    runtime: AgentRuntimePolicySchema.optional(),
    appendInstructions: z.string().max(16_000).optional().describe('Text appended to the agent instructions'),
    extraAllow: z.array(z.string().max(200)).max(200).optional().describe('Extra tool names allowed'),
    extraDeny: z.array(z.string().max(200)).max(200).optional().describe('Extra tool names denied'),
  })
  .strict()
  .describe('Additive capability delta applied to the bound agent at this binding site');
export type AgentOverrides = z.infer<typeof AgentOverridesSchema>;

export const BrowserConfigSchema = z
  .object({
    enabled: z.boolean().optional().describe('Whether the integrated browser is available'),
    mode: z.enum(['auto', 'native', 'screencast']).optional().describe('Rendering mode'),
    visibility: z.enum(['visible', 'headless', 'off']).optional().describe('Visibility (default headless)'),
    headless: z.boolean().optional().describe('Low-level headless switch; visibility wins'),
    viewport: z
      .object({
        width: z.number().int().min(320).max(3840).describe('Viewport width in pixels'),
        height: z.number().int().min(240).max(2160).describe('Viewport height in pixels'),
      })
      .strict()
      .optional()
      .describe('Viewport size'),
    allowedHosts: z.array(z.string().min(1).max(200)).max(100).optional().describe('Host allow-list for navigation'),
    persistProfile: z.boolean().optional().describe('Keep the browser profile between sessions'),
    screencastFps: z.number().int().min(1).max(15).optional().describe('Screencast frame rate'),
    screencastQuality: z.number().int().min(20).max(95).optional().describe('Screencast JPEG quality'),
    idlePauseMinutes: z.number().int().min(1).max(120).optional().describe('Pause the browser after this idle time'),
    evalAllowed: z.boolean().optional().describe('Allow page script evaluation'),
    dialogPolicy: z.enum(['dismiss', 'accept', 'ask']).optional().describe('How page dialogs are handled'),
    permissions: z.array(z.string().min(1).max(50)).max(20).optional().describe('Browser permissions granted'),
    piiRedaction: z.boolean().optional().describe('Redact PII from snapshots'),
    injectionDefense: z.enum(['off', 'classifier']).optional().describe('Prompt-injection defense'),
    recordVideo: z.boolean().optional().describe('Record a video of the session'),
    allowLocalhostSelfSigned: z
      .boolean()
      .optional()
      .describe('Trust self-signed certificates, restricting https navigation to loopback hosts'),
  })
  .strict()
  .describe('Integrated browser configuration');
export type BrowserConfig = z.infer<typeof BrowserConfigSchema>;

export const CustomAgentSchema = z
  .object({
    name: z.string().min(1).max(120).describe('Sub-agent name'),
    description: z.string().min(1).max(2000).describe('When the model should use this sub-agent'),
    instructions: z.string().min(1).max(64_000).describe('Sub-agent instructions'),
    tools: z.array(z.string().max(200)).max(200).optional().describe('Tools the sub-agent may use'),
  })
  .strict()
  .describe('An inline sub-agent');

export const ProviderConfigSchema = z
  .object({
    name: z.string().min(1).max(100).describe('Provider name'),
    baseUrl: z.string().url().max(2000).describe('API base URL'),
    apiKey: z.string().min(1).max(500).describe('API key; must be a secretref: reference'),
    model: z.string().max(200).optional().describe('Model id at this provider'),
  })
  .strict()
  .describe('Bring-your-own-key provider endpoint');

export const SessionSpecSchema = z
  .object({
    // runtime
    model: z.string().max(200).optional().describe('Model id; omitted means the provider or agent default'),
    harnessType: z
      .enum(HARNESS_PROVIDER_IDS)
      .optional()
      .describe('Agent provider; omitted routes by model, then the server default'),
    reasoningEffort: z.enum(REASONING_EFFORTS).optional().describe('Reasoning effort'),
    contextTier: z.enum(['default', 'long_context']).optional().describe('Context window tier'),
    maxTurns: z.number().int().min(1).max(1000).optional().describe('Turn cap per prompt'),
    provider: ProviderConfigSchema.optional(),
    // agent
    agentRef: z.string().min(1).max(128).optional().describe('Portable scope:slug reference of the agent driving the session'),
    agentOverrides: AgentOverridesSchema.optional(),
    // instructions
    systemMessage: z
      .object({
        mode: z.enum(['append', 'replace']).default('append').describe('Append to or replace the replaceable base message'),
        content: z.string().max(100_000).describe('Message text'),
      })
      .strict()
      .optional()
      .describe('System message'),
    systemPromptAppend: z.string().max(100_000).optional().describe('Text appended to the system prompt'),
    planModeInstructions: z.string().max(20_000).optional().describe('Replaces the default plan-mode workflow text'),
    // capability surface
    tools: z
      .object({
        available: z.array(z.string().max(200)).max(500).optional().describe('Allow-list of tool names'),
        excluded: z.array(z.string().max(200)).max(500).optional().describe('Tool names removed'),
      })
      .strict()
      .optional()
      .describe('Tool allow and deny lists'),
    mcp: z
      .object({
        servers: z.record(McpServerConfigSchema).optional().describe('MCP servers by id'),
        excludedIds: z.array(z.string().max(200)).max(200).optional().describe('MCP server ids removed'),
      })
      .strict()
      .optional()
      .describe('MCP servers'),
    skills: z
      .object({
        directories: z.array(z.string().max(1000)).max(100).optional().describe('Extra skill directories'),
        disabled: z.array(z.string().max(200)).max(500).optional().describe('Skill names disabled'),
      })
      .strict()
      .optional()
      .describe('Skills'),
    customAgents: z.array(CustomAgentSchema).max(50).optional().describe('Inline sub-agents'),
    // interaction policy
    permissionMode: z.enum(PERMISSION_MODES).optional().describe('Tool permission policy'),
    defaultAgentMode: z.enum(AGENT_MODES).optional().describe('Agent mode for each turn (auto or plan)'),
    // platform integrations (still gated by the agent tool policy)
    browser: BrowserConfigSchema.optional(),
    computerUse: z.boolean().optional().describe('Computer-use tools; opt-in, refused on bypass runs'),
    widgets: z.boolean().optional().describe('Widget tools (default on)'),
    orchestrator: z.boolean().optional().describe('Orchestrator tools (default from the agent role)'),
  })
  .strict()
  .describe('Agent session configuration shared by chats, workflows and stages');
export type SessionSpec = z.infer<typeof SessionSpecSchema>;
