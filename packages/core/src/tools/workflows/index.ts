// ────────────────────────────────────────────────────────────────
// buildWorkflowToolSet — the workflow tools of one caller (P06 WP-6.1;
// G4 §2.2–2.3). ONE definition list with ONE description text, bound:
//   - into chats, orchestrator chats and stages by the PlatformToolBinder
//     (the `workflows` and `workflowAuthoring` tool groups);
//   - over MCP through the server's tool route (`/api/workflow-tools`), which
//     runs these same handlers for an `external` caller.
//
// Order is fixed and the set is APPENDED after every other tool of a
// session, so an existing chat's tool prefix keeps its order (R-10). The
// descriptions carry the rules a model must follow, because inside
// GeneratorAI a skill file is not what the model reads: tool descriptions,
// one short hint and the guide tool are.
// ────────────────────────────────────────────────────────────────

import type { ToolCallContext, ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import { toolError, type RunToolArgs, type WorkflowToolCaller, type WorkflowToolHost, type WorkflowToolTurn } from './WorkflowToolHost.js';

export {
  WorkflowToolHost,
  WorkflowToolRefusal,
  DEFAULT_WORKFLOW_TOOL_LIMITS,
  compactDigest,
  compactPlan,
  riskFlags,
  toolError,
  type ChatRunLinker,
  type RunToolArgs,
  type WorkflowToolCaller,
  type WorkflowToolHostDeps,
  type WorkflowToolLimits,
  type WorkflowToolTurn,
} from './WorkflowToolHost.js';

/** The run group, in binding order. */
export const WORKFLOW_TOOL_NAMES = [
  'list_workflows',
  'describe_workflow',
  'run_workflow',
  'check_workflow_run',
  'respond_workflow_approval',
  'cancel_workflow_run',
] as const;

/** The authoring group, in binding order (after the run group). */
export const WORKFLOW_AUTHORING_TOOL_NAMES = [
  'get_workflow_authoring_guide',
  'validate_workflow',
  'plan_workflow',
  'create_workflow_draft',
] as const;

export type WorkflowToolName = (typeof WORKFLOW_TOOL_NAMES)[number] | (typeof WORKFLOW_AUTHORING_TOOL_NAMES)[number];

/**
 * Appended to the system message when `workflowAuthoring` is on (≈600
 * characters). The full text is the guide tool's; the tool descriptions
 * carry the rules.
 */
export const WORKFLOW_AUTHORING_HINT =
  `\n\n[Authoring GeneratorAI workflows]\n` +
  `When asked to create or change a workflow: 1) list_workflows and describe_workflow to reuse what exists; ` +
  `2) read get_workflow_authoring_guide (overview, then the topics you need); 3) write the WorkflowGraph JSON; ` +
  `4) validate_workflow and fix every error until valid; 5) plan_workflow with realistic variables and read it; ` +
  `6) tell the user what each stage does, what it may change, the permission mode and whether it commits or opens a PR; ` +
  `7) create_workflow_draft and give the review link. Never publish or run a draft: a person reviews and publishes it.`;

export interface WorkflowToolGroups {
  /** list / describe / run / check / respond / cancel. */
  run: boolean;
  /** guide / validate / plan / create a draft. */
  authoring: boolean;
}

export interface BuildWorkflowToolSetOptions {
  /** The turn in flight (chats and stages): its id and permission mode. */
  turnOf?: (() => WorkflowToolTurn | undefined) | undefined;
  owner?: string | undefined;
}

const obj = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
});

const GRAPH_PARAM = {
  type: 'object',
  description:
    'The WorkflowGraph document: {workflow: {name, variables, session, lifecycle, …}, stages: [{key, name, kind, …}], edges: [{from, to, on}]}. ' +
    'Stage keys are lower_snake_case and are what edges, expressions and overrides use. See get_workflow_authoring_guide("schema").',
};

/** Tool definitions for one caller. The handlers never throw: a refusal comes back as `{ok: false, code, error}`. */
export function buildWorkflowToolSet(
  host: WorkflowToolHost,
  caller: WorkflowToolCaller,
  groups: WorkflowToolGroups,
  opts: BuildWorkflowToolSetOptions = {},
): ToolDefinition[] {
  const owner = opts.owner ?? (caller.kind === 'chat' ? `chat:${caller.chatId}` : caller.kind === 'stage' ? `stage:${caller.stageRunId}` : 'mcp');
  const turn = () => opts.turnOf?.();
  const wrap = (fn: (args: Record<string, unknown>, ctx: ToolCallContext) => Promise<unknown>) => async (args: Record<string, unknown>, ctx?: ToolCallContext) => {
    try {
      return await fn(args ?? {}, ctx ?? {});
    } catch (err) {
      return toolError(err);
    }
  };
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
  const out: ToolDefinition[] = [];

  if (groups.run) {
    out.push(
      {
        name: 'list_workflows',
        description:
          'List the saved GeneratorAI workflows you can run: id, name, description, variables (name, type, required), stage count, ' +
          'whether a codebase is required, post-processing (commit, push, PR). Only published workflows run. Call this before run_workflow.',
        parametersSchema: obj({
          query: { type: 'string', description: 'Name contains' },
          projectId: { type: 'string', description: 'Only this project\'s workflows' },
          tag: { type: 'string', description: 'Only workflows with this tag' },
          limit: { type: 'number', description: 'At most this many (1-50, default 20)' },
        }),
        skipPermission: true,
        owner,
        handler: wrap((a) =>
          host.list(
            {
              ...(str(a['query']) ? { query: str(a['query'])! } : {}),
              ...(str(a['projectId']) ? { projectId: str(a['projectId'])! } : {}),
              ...(str(a['tag']) ? { tag: str(a['tag'])! } : {}),
              ...(typeof a['limit'] === 'number' ? { limit: a['limit'] } : {}),
            },
            { includeDrafts: groups.authoring },
          ),
        ),
      },
      {
        name: 'describe_workflow',
        description:
          'Describe one workflow before running it: its variables (type, required, default, options), stages (key, kind, agent, model, ' +
          'approval, guard), edges, codebases, post-processing, declared outputs and RISK FLAGS (writes_files, commits, pushes, opens_pr, ' +
          'bypass_permissions, runs_repo_code, starts_other_workflows). Tell the user about the risk flags before you run it.',
        parametersSchema: obj({ workflowId: { type: 'string', description: 'The workflow id from list_workflows' } }, ['workflowId']),
        skipPermission: true,
        owner,
        handler: wrap((a) => host.describe(String(a['workflowId'] ?? ''))),
      },
      {
        name: 'run_workflow',
        description:
          'Start a run of a PUBLISHED workflow. Returns {runId, status, link, replayed, plan}. The run gets its own worktrees ' +
          '(workspace "isolated", default); "from_chat_branch" cuts them from this chat\'s branches and is refused while the chat has ' +
          'uncommitted changes. Limits you cannot raise: permissionMode never above your own, runs nest at most 3 deep, a workflow cannot ' +
          'start itself, a chat runs at most 3 at once, your remaining time caps the run. A retried call returns the same run. ' +
          'Completion reviews go to a person unless you pass approvalDelegate "invoker"; tool-permission prompts always go to a person. ' +
          'wait "until_done" / "until_approval_or_done" blocks up to waitSeconds (max 600), then call check_workflow_run.',
        parametersSchema: obj(
          {
            workflowId: { type: 'string', description: 'The workflow id' },
            variables: { type: 'object', description: 'Variable values by name' },
            codebases: {
              type: 'array',
              description: 'Project codebases to mount: [{alias, baseRef?}]; omitted means the workflow\'s own',
              items: obj({ alias: { type: 'string' }, baseRef: { type: 'string' } }, ['alias']),
            },
            stageOverrides: {
              type: 'array',
              description: 'Per stage: [{stageKey, skip?, model?, variables?}]',
              items: obj({ stageKey: { type: 'string' }, skip: { type: 'boolean' }, model: { type: 'string' }, variables: { type: 'object' } }, ['stageKey']),
            },
            model: { type: 'string', description: 'Model for every stage without its own' },
            permissionMode: { type: 'string', enum: ['plan', 'default', 'acceptEdits', 'bypassPermissions'], description: 'At most your own mode' },
            workspace: { type: 'string', enum: ['isolated', 'from_chat_branch'], description: 'Default isolated' },
            wait: { type: 'string', enum: ['none', 'until_done', 'until_approval_or_done'], description: 'Default none' },
            waitSeconds: { type: 'number', description: 'How long to wait (max 600, default 60)' },
            approvalDelegate: { type: 'string', enum: ['human', 'invoker'], description: 'Who answers completion reviews (default human)' },
            reason: { type: 'string', description: 'One line: why you start this run (shown to the user and stored on the run)' },
            projectId: { type: 'string', description: 'Project whose codebases the run mounts; default the workflow\'s or this chat\'s' },
          },
          ['workflowId', 'reason'],
        ),
        skipPermission: false,
        owner,
        handler: wrap((a, ctx) =>
          host.run(caller, a as unknown as RunToolArgs, { ...(ctx.toolCallId ? { toolCallId: ctx.toolCallId } : {}), turn: turn() }),
        ),
      },
      {
        name: 'check_workflow_run',
        description:
          'The state of a run you started (or one nested under it): status, each stage\'s status and summary, pending approvals (and ' +
          'whether you may answer them), post-processing results (commit, branch, PR), the link. wait=true blocks until it finishes or ' +
          'parks on an approval, up to waitSeconds (max 600).',
        parametersSchema: obj(
          {
            runId: { type: 'string', description: 'The run id' },
            wait: { type: 'boolean', description: 'Block until it finishes or waits for an approval' },
            waitSeconds: { type: 'number', description: 'How long to wait (max 600, default 60)' },
          },
          ['runId'],
        ),
        skipPermission: true,
        owner,
        handler: wrap((a) =>
          host.check(caller, { runId: String(a['runId'] ?? ''), ...(a['wait'] === true ? { wait: true } : {}), ...(typeof a['waitSeconds'] === 'number' ? { waitSeconds: a['waitSeconds'] } : {}) }, { turn: turn() }),
        ),
      },
      {
        name: 'respond_workflow_approval',
        description:
          'Answer a stage COMPLETION REVIEW of a run you started with approvalDelegate "invoker" (see check_workflow_run ' +
          'pendingApprovals[].answerableByYou). Anything else (a tool-permission prompt, a question, a loop decision, an approval wait) ' +
          'returns "needs a human": tell the user and give them the link.',
        parametersSchema: obj(
          {
            runId: { type: 'string' },
            instanceId: { type: 'string', description: 'pendingApprovals[].instanceId' },
            outcome: { type: 'string', enum: ['approved', 'changes_requested', 'rejected'] },
            feedback: { type: 'string', description: 'What to change (changes_requested) or why' },
            reason: { type: 'string', description: 'One line: why you decided so' },
          },
          ['runId', 'instanceId', 'outcome', 'reason'],
        ),
        skipPermission: false,
        owner,
        handler: wrap((a) =>
          host.respond(
            caller,
            {
              runId: String(a['runId'] ?? ''),
              instanceId: String(a['instanceId'] ?? ''),
              outcome: a['outcome'] as 'approved' | 'changes_requested' | 'rejected',
              ...(str(a['feedback']) ? { feedback: str(a['feedback'])! } : {}),
              reason: String(a['reason'] ?? ''),
            },
            { turn: turn() },
          ),
        ),
      },
      {
        name: 'cancel_workflow_run',
        description: 'Cancel a run you started. Say why in reason.',
        parametersSchema: obj({ runId: { type: 'string' }, reason: { type: 'string' } }, ['runId', 'reason']),
        skipPermission: true,
        owner,
        handler: wrap((a) => host.cancel(caller, { runId: String(a['runId'] ?? ''), reason: String(a['reason'] ?? '') }, { turn: turn() })),
      },
    );
  }

  if (groups.authoring && host.hasAuthoring) {
    out.push(
      {
        name: 'get_workflow_authoring_guide',
        description:
          'The GeneratorAI workflow authoring guide, by topic: overview (the mandatory process and hard rules; read it first), schema ' +
          '(every field), stages, edges, expressions, control-flow (loop, map, subworkflow, wait, check), agents, lifecycle, pitfalls, examples.',
        parametersSchema: obj({
          topic: {
            type: 'string',
            enum: ['overview', 'schema', 'stages', 'edges', 'expressions', 'control-flow', 'agents', 'lifecycle', 'pitfalls', 'examples'],
          },
        }),
        skipPermission: true,
        owner,
        handler: wrap(async (a) => ({ topic: str(a['topic']) ?? 'overview', text: await host.authoring.guide(str(a['topic'])) })),
      },
      {
        name: 'validate_workflow',
        description:
          'Validate a WorkflowGraph with the server\'s rules: {valid, issues:[{code, severity, path, stageKey, message, hint}]}. Fix every ' +
          'error and validate again; repeat until valid. Pass schemaHash from your skill to learn whether it is out of date.',
        parametersSchema: obj({ graph: GRAPH_PARAM, schemaHash: { type: 'string', description: 'The schemaHash your skill was generated for' } }, ['graph']),
        skipPermission: true,
        owner,
        handler: wrap((a) => host.validate(caller, { graph: a['graph'], ...(str(a['schemaHash']) ? { schemaHash: str(a['schemaHash'])! } : {}) }, { turn: turn() })),
      },
      {
        name: 'plan_workflow',
        description:
          'What a run would do, without running it: stages by layer, which are skipped (overrides, guards decided now), models, codebases, ' +
          'post-processing, permission mode, risks, warnings, and unresolved variables. Pass a graph (a draft) or a workflowId, with ' +
          'realistic variables. Show the result to the user before you create a draft.',
        parametersSchema: obj({
          graph: GRAPH_PARAM,
          workflowId: { type: 'string', description: 'A saved workflow instead of a graph' },
          variables: { type: 'object', description: 'Variable values by name' },
          stageOverrides: { type: 'array', items: { type: 'object' }, description: '[{stageKey, skip?, model?, variables?}]' },
        }),
        skipPermission: true,
        owner,
        handler: wrap((a) =>
          host.plan(
            caller,
            {
              ...(a['graph'] !== undefined ? { graph: a['graph'] } : {}),
              ...(str(a['workflowId']) ? { workflowId: str(a['workflowId'])! } : {}),
              ...(a['variables'] && typeof a['variables'] === 'object' ? { variables: a['variables'] as Record<string, unknown> } : {}),
              ...(Array.isArray(a['stageOverrides']) ? { stageOverrides: a['stageOverrides'] as unknown[] } : {}),
            },
            { turn: turn() },
          ),
        ),
      },
      {
        name: 'create_workflow_draft',
        description:
          'Save a validated WorkflowGraph as a DRAFT and return {workflowId, status: "draft", reviewLink}. A draft never runs: a person ' +
          'reviews it in the builder and publishes it. Never ask to publish it yourself. replacesWorkflowId marks it as a proposed change ' +
          'to an existing workflow (the builder shows the diff).',
        parametersSchema: obj(
          {
            graph: GRAPH_PARAM,
            projectId: { type: 'string', description: 'Owning project; default this chat\'s' },
            replacesWorkflowId: { type: 'string', description: 'The workflow this draft proposes to replace' },
          },
          ['graph'],
        ),
        skipPermission: false,
        owner,
        handler: wrap((a) =>
          host.createDraft(
            caller,
            {
              graph: a['graph'],
              ...(str(a['projectId']) ? { projectId: str(a['projectId'])! } : {}),
              ...(str(a['replacesWorkflowId']) ? { replacesWorkflowId: str(a['replacesWorkflowId'])! } : {}),
            },
            { turn: turn() },
          ),
        ),
      },
    );
  }
  return out;
}

/** The tool advertisements without handlers (the MCP adapter lists these). */
export function describeWorkflowTools(host: WorkflowToolHost, groups: WorkflowToolGroups): Array<{ name: string; description: string; parametersSchema: Record<string, unknown>; readOnly: boolean }> {
  const readOnly = new Set<string>(['list_workflows', 'describe_workflow', 'check_workflow_run', 'get_workflow_authoring_guide', 'validate_workflow', 'plan_workflow']);
  return buildWorkflowToolSet(host, { kind: 'external', principal: { kind: 'system', id: 'describe', scopes: [] }, via: 'mcp' }, groups).map((t) => ({
    name: t.name,
    description: t.description,
    parametersSchema: t.parametersSchema,
    readOnly: readOnly.has(t.name),
  }));
}
