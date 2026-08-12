// ────────────────────────────────────────────────────────────────
// buildOrchestratorToolSet — the background-agent tool surface an
// orchestrator chat drives. Mirrors buildBrowserToolSet: handlers close
// over the OrchestratorService + parentChatId.
//
// Tool schemas use STABLE key order so the tools prefix hashes identically
// across turns/workers (prompt-cache friendliness, plan §5.8 / M2).
// ────────────────────────────────────────────────────────────────

import type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import type { OrchestratorService } from '../../services/orchestrator/OrchestratorService.js';
import { TaskBriefSchema } from '@generatorai/shared';

export interface OrchestratorToolSetDeps {
  orchestratorService: OrchestratorService;
  parentChatId: string;
  owner?: string;
  /**
   * Append `list_available_agents`. Off by default: adding a 7th tool
   * unconditionally would change the tools prefix of EVERY existing
   * orchestrator chat and cost a one-time full prompt-cache miss on upgrade.
   */
  includeAgentDiscovery?: boolean;
}

export function buildOrchestratorToolSet(deps: OrchestratorToolSetDeps): ToolDefinition[] {
  const { orchestratorService, parentChatId, owner } = deps;

  const spawn: ToolDefinition = {
    name: 'spawn_background_agent',
    description:
      'Spawn a background WORKER agent (a new chat/session) to complete ONE subtask. ' +
      'Returns { taskId } immediately; the worker runs independently and streams in its own pane. ' +
      'Provide a complete, self-contained brief: the worker inherits NOTHING except what you pass here. ' +
      'Include objective, self-contained context, and explicit boundaries to avoid overlap with sibling workers. ' +
      'Prefer referencing artifact paths (inputArtifacts) over pasting large content. ' +
      'If list_available_agents returns a specialised agent that fits the subtask, you MUST pass its ' +
      '`ref` as `agentRef` — naming the agent in your narration does NOT bind it, and a worker spawned ' +
      'without `agentRef` gets no instructions, skills or tool policy. ' +
      'Use check_background_agents to collect results.',
    parametersSchema: {
      type: 'object',
      properties: {
        taskName: { type: 'string', description: 'Short, unique-ish name shown in the UI.' },
        objective: { type: 'string', description: 'The ONE outcome this worker must produce.' },
        context: { type: 'string', description: 'ONLY the facts/decisions the worker needs. Self-contained, no "see above".' },
        model: { type: 'string', description: 'Optional model/tier for the worker. Omit to use the default worker model.' },
        inputArtifacts: { type: 'array', items: { type: 'string' }, description: 'Read-only artifact paths the worker may open.' },
        boundaries: { type: 'string', description: 'Explicit out-of-scope list to prevent duplicated work.' },
        budget: {
          type: 'object',
          properties: {
            maxTokens: { type: 'number' },
            maxToolCalls: { type: 'number' },
          },
        },
        // APPENDED LAST on purpose — inserting a key mid-object would change
        // the schema hash for every existing orchestrator chat.
        agentRef: {
          type: 'string',
          description:
            'Optional `scope:slug` ref of a custom agent that should drive this worker ' +
            '(see list_available_agents). Gives the worker that agent\'s instructions, skills, ' +
            'MCP servers and tool policy. Omit for a generic worker.',
        },
      },
      required: ['taskName', 'objective'],
    },
    skipPermission: true,
    owner: owner ?? `orchestrator:${parentChatId}`,
    handler: async (args) => {
      const parsed = TaskBriefSchema.safeParse(args);
      if (!parsed.success) {
        return { ok: false, error: `Invalid brief: ${parsed.error.issues.map((i: { path: (string | number)[]; message: string }) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
      }
      return orchestratorService.spawnBackgroundAgent(parentChatId, parsed.data);
    },
  };

  const checkAll: ToolDefinition = {
    name: 'check_background_agents',
    description:
      'Collect compact result digests for ALL your background workers. Pass wait=true to block until running ' +
      'workers finish (bounded by a timeout). Digests contain summary + artifact references, not full transcripts — ' +
      'open a referenced artifact only if you need more detail.',
    parametersSchema: {
      type: 'object',
      properties: {
        wait: { type: 'boolean', description: 'Block until running workers finish (bounded by timeout).' },
      },
    },
    skipPermission: true,
    owner: owner ?? `orchestrator:${parentChatId}`,
    handler: async (args) => {
      const wait = Boolean((args as { wait?: unknown }).wait);
      const digests = await orchestratorService.checkBackgroundAgents(parentChatId, { wait });
      return { count: digests.length, digests };
    },
  };

  const checkOne: ToolDefinition = {
    name: 'check_background_agent',
    description: 'Get the compact result digest for ONE background worker by taskId. Pass wait=true to block until it finishes.',
    parametersSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The taskId returned by spawn_background_agent.' },
        wait: { type: 'boolean', description: 'Block until this worker finishes (bounded by timeout).' },
      },
      required: ['taskId'],
    },
    skipPermission: true,
    owner: owner ?? `orchestrator:${parentChatId}`,
    handler: async (args) => {
      const a = args as { taskId?: unknown; wait?: unknown };
      if (typeof a.taskId !== 'string') return { ok: false, error: 'taskId is required' };
      return orchestratorService.checkBackgroundAgent(a.taskId, { wait: Boolean(a.wait) });
    },
  };

  const send: ToolDefinition = {
    name: 'send_to_background_agent',
    description:
      'Send a follow-up message to a background worker (resumes its context) — use to request a revision after ' +
      'reviewing its digest. Bounded by a per-worker review-round limit.',
    parametersSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The taskId to send the follow-up to.' },
        followup: { type: 'string', description: 'The follow-up instruction / revision request.' },
      },
      required: ['taskId', 'followup'],
    },
    skipPermission: true,
    owner: owner ?? `orchestrator:${parentChatId}`,
    handler: async (args) => {
      const a = args as { taskId?: unknown; followup?: unknown };
      if (typeof a.taskId !== 'string' || typeof a.followup !== 'string') {
        return { ok: false, error: 'taskId and followup are required' };
      }
      return orchestratorService.sendToBackgroundAgent(a.taskId, a.followup);
    },
  };

  const list: ToolDefinition = {
    name: 'list_background_agents',
    description: 'List your background workers with their current statuses (running / needs_review / completed / failed).',
    parametersSchema: {
      type: 'object',
      properties: {},
    },
    skipPermission: true,
    owner: owner ?? `orchestrator:${parentChatId}`,
    handler: async () => {
      const tasks = await orchestratorService.listBackgroundAgents(parentChatId);
      return { count: tasks.length, tasks };
    },
  };

  const listModels: ToolDefinition = {
    name: 'list_models',
    description:
      'List the models you can assign to background workers, each with a coarse priceTier ' +
      '("low" | "medium" | "high"). Call this ONCE before your first wave, then pass a ' +
      'cost-appropriate "model" to each spawn_background_agent — cheap tiers for simple ' +
      'subtasks, expensive tiers only for hard reasoning.',
    parametersSchema: {
      type: 'object',
      properties: {},
    },
    skipPermission: true,
    owner: owner ?? `orchestrator:${parentChatId}`,
    handler: async () => {
      const models = await orchestratorService.listAvailableModels();
      return { count: models.length, models };
    },
  };

  const listAvailableAgents: ToolDefinition = {
    name: 'list_available_agents',
    description:
      'List the custom agents you may assign to background workers. Each entry has a ' +
      '`ref` (pass it as `agentRef` to spawn_background_agent), a name and a description ' +
      'of when to use it. Prefer picking a specialised agent over writing the same ' +
      'instructions into every brief. After calling this, every spawn whose subtask ' +
      'matches one of these agents MUST carry that agent\'s `ref` in `agentRef`.',
    parametersSchema: {
      type: 'object',
      properties: {},
    },
    skipPermission: true,
    owner: owner ?? `orchestrator:${parentChatId}`,
    handler: async () => {
      const agents = await orchestratorService.listAssignableAgents(parentChatId);
      return { count: agents.length, agents };
    },
  };

  // Deterministic order (M2). The optional 7th tool is APPENDED so the prefix
  // of the original six hashes identically for chats that do not use it.
  const base = [listModels, spawn, checkAll, checkOne, send, list];
  return deps.includeAgentDiscovery ? [...base, listAvailableAgents] : base;
}
