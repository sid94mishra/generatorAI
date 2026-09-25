// ────────────────────────────────────────────────────────────────
// Golden snapshots of session composition — chat and stage (P00 WP-0.5).
//
// Three builders assemble provider conversation params today:
// ChatManagementService.createChat, ChatManagementService.buildConversationConfig
// (resume) and StageExecutionService.executeStage (→ SessionAllocator). PHASE-02
// extracts ONE SessionComposer from them, and the chat prompt-cache prefix
// must stay byte-identical while it does (R-10). These snapshots are that
// guard: each case serialises exactly what reached `createConversation` /
// `resumeConversation` (ids, paths and handler functions redacted).
//
// The service graph is the real one (`createCoreServices` over an in-memory
// DB migrated with `migrateDB`); only the provider is a spy, plus fakes for
// the agent resolver, browser service and workspace manager.
//
// Known drifts between the builders were asserted explicitly and marked
// `// KNOWN-DRIFT W-5x`. PHASE-02 flipped them deliberately: W-50 (WP-2.4)
// added `systemPromptAppend` / `maxTurns` to the chat create snapshots
// (a, c, d, e — nothing else in them changed) and made resume equal create;
// W-51 / W-52 (WP-2.8) regenerated the stage snapshots (f, g).
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  closeDB,
  createDB,
  migrateDB,
  DrizzleAgentInteractionRepository,
  DrizzleArtifactRepository,
  DrizzleAutomationExecutionRepository,
  DrizzleAutomationRepository,
  DrizzleChatMessageRepository,
  DrizzleChatRepository,
  DrizzleEventRepository,
  DrizzleIdempotencyKeyRepository,
  DrizzlePlanRepository,
  DrizzleSequenceAllocator,
  DrizzleSessionAllocationRepository,
  DrizzleSessionRepository,
  DrizzleStageRunRepository,
  DrizzleWorkflowRunRepository,
  EntryRepository,
  RegisterRepository,
  SqliteWorkflowDefinitionStore,
  type AppDatabase,
} from '@generatorai/db';
import type { ILogger, ResolvedAgentProjection } from '@generatorai/shared';
import { createCoreServices, type CoreServices } from '../../src/bootstrap/createCoreServices.js';
import { AgentResolver } from '../../src/services/AgentResolver.js';
import { AdmissionController } from '../../src/services/AdmissionController.js';
import type { IAgentHarness, CreateConversationParams } from '../../src/domain/ports/IAgentHarness.js';
import type { BrowserService } from '../../src/services/BrowserService.js';
import type { WorkspaceManager } from '../../src/services/WorkspaceManager.js';
import type { IScriptRunner, IHttpClient } from '../../src/domain/ports/index.js';
import type { GitManager } from '../../src/infrastructure/GitManager.js';

// ── Spy harness ──────────────────────────────────────────────────

interface Recorded {
  op: 'create' | 'resume';
  conversationId: string;
  params: CreateConversationParams | undefined;
}

function spyHarness(calls: Recorded[]): IAgentHarness {
  return {
    createConversation: async (p: CreateConversationParams) => {
      calls.push({ op: 'create', conversationId: p.conversationId, params: p });
      return p.conversationId;
    },
    resumeConversation: async (id: string, p?: CreateConversationParams) => {
      calls.push({ op: 'resume', conversationId: id, params: p });
    },
    hasLiveConversation: () => false,
    destroyConversation: async () => undefined,
    deleteConversation: async () => undefined,
    listConversations: async () => [],
    getLastConversationId: async () => null,
    getConversationWarnings: () => [],
    selectAgent: async () => undefined,
    listAgents: async () => [],
    getMessages: async () => [],
    onConversationEvent: () => () => undefined,
    sendPrompt: async () => undefined,
    sendPromptAndWait: async () => ({ content: 'Golden stage answer: long enough to skip the output-retry turn.' }),
    abortConversation: async () => undefined,
    initialize: async () => undefined,
    stop: async () => undefined,
    forceStop: async () => undefined,
    shutdown: async () => undefined,
    getClientState: () => 'running',
    ping: async () => true,
    onClientEvent: () => () => undefined,
    capabilities: () => ({
      vision: false,
      reasoning: false,
      reasoningEfforts: [],
      maxParallelTools: 1,
      planMode: false,
      mcpServers: false,
      approvalGating: 'none',
      hostTools: 'none',
      structuredOutput: 'none',
      skills: 'none',
      sessionPersistence: false,
      budgetTracking: false,
      computerUse: false,
    }),
    getModels: async () => [],
  } as unknown as IAgentHarness;
}

// ── The agent every agent case binds ─────────────────────────────

const AGENT_REF = 'global:golden-agent';

function goldenProjection(): ResolvedAgentProjection {
  const base = AgentResolver.empty();
  return {
    ...base,
    agentRef: AGENT_REF,
    agentId: 'agent-1',
    agentVersion: 3,
    driving: {
      ref: AGENT_REF,
      name: 'Golden Agent',
      description: 'Agent used by the golden composition snapshots',
      instructions: 'GOLDEN-AGENT-INSTRUCTIONS: review carefully.',
      projection: 'replace',
      role: 'agent',
    },
    team: [
      {
        ref: 'global:golden-reviewer',
        name: 'reviewer',
        description: 'Restricted reviewer sub-agent',
        instructions: 'Only read files.',
        tools: ['Read', 'Grep'],
        disallowedTools: ['Bash', 'Write'],
        model: 'claude-haiku',
        reasoningEffort: 'low',
        skills: ['review'],
        maxTurns: 4,
        permissionMode: 'plan',
      },
    ],
    toolPolicy: { ...base.toolPolicy, deny: ['WebFetch'] },
    runtime: { model: 'claude-sonnet', reasoningEffort: 'medium', maxTurns: 12 },
    warnings: [],
  };
}

const fakeResolver = {
  resolve: async (input: { agentRef?: string }) =>
    input.agentRef === AGENT_REF ? goldenProjection() : AgentResolver.empty(),
} as unknown as AgentResolver;

// ── Serialisation ────────────────────────────────────────────────

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Stable, redacted JSON of what a provider was handed. */
function golden(params: unknown, workDir: string): string {
  const norm = (s: string) =>
    s
      .split(workDir)
      .join('<workDir>')
      .split(workDir.replace(/\\/g, '/'))
      .join('<workDir>')
      .replace(/(chat|stage)-<uuid>-\d+/g, '$1-<uuid>-<ts>')
      .replace(UUID, '<uuid>')
      .replace(/(chat|stage)-<uuid>-\d+/g, '$1-<uuid>-<ts>')
      // Paths under the scratch dir use '/' on every OS, so the snapshots
      // are identical on Windows and on the ubuntu CI leg.
      .replace(/<workDir>[^\s"'`]*/g, (m) => m.replace(/\\/g, '/'));
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === 'function') return '[Function]';
    if (typeof v === 'string') return norm(v);
    if (Array.isArray(v)) {
      if (key === 'tools') {
        // Every ToolDefinition field the provider sees (name, description,
        // parametersSchema, skipPermission, requiredPermissions, …), minus
        // the handler function itself.
        return v.map((t) => {
          const { handler: _handler, ...tool } = t as Record<string, unknown>;
          return walk(tool);
        });
      }
      return v.map((x) => walk(x));
    }
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>)) {
        const val = (v as Record<string, unknown>)[k];
        if (val === undefined) continue;
        out[k] = walk(val, k);
      }
      return out;
    }
    return v;
  };
  return `${JSON.stringify(walk(params), null, 2)}\n`;
}

// ── Service graph ────────────────────────────────────────────────

const quiet = { debug() {}, info() {}, warn() {}, error() {} } as unknown as ILogger;

interface Env {
  db: AppDatabase;
  workDir: string;
  calls: Recorded[];
  services: CoreServices;
}

function boot(db: AppDatabase, workDir: string): Env {
  const calls: Recorded[] = [];
  // Only case (g) passes a `__workspaceId`; every other case never asks.
  const workspaces = {
    getExecutionWorkspace: async (id: string) => ({ id, rootPath: join(workDir, 'ws'), browserConfig: {} }),
    findWorkspaceByOwner: async () => null,
  } as unknown as WorkspaceManager;
  const services = createCoreServices({
    logger: quiet,
    harness: spyHarness(calls),
    scriptRunner: {} as IScriptRunner,
    httpClient: {} as IHttpClient,
    gitManager: {} as GitManager,
    sequenceAllocator: new DrizzleSequenceAllocator(db),
    sessionRepo: new DrizzleSessionRepository(db),
    eventRepo: new DrizzleEventRepository(db),
    chatMessageRepo: new DrizzleChatMessageRepository(db),
    artifactRepo: new DrizzleArtifactRepository(db),
    chatEntityRepo: new DrizzleChatRepository(db),
    workflowDefinitionStore: new SqliteWorkflowDefinitionStore(db),
    workflowRunRepo: new DrizzleWorkflowRunRepository(db),
    stageRunRepo: new DrizzleStageRunRepository(db),
    automationRepo: new DrizzleAutomationRepository(db),
    automationExecutionRepo: new DrizzleAutomationExecutionRepository(db),
    idempotencyKeyRepo: new DrizzleIdempotencyKeyRepository(db),
    registerRepo: new RegisterRepository(db),
    entryRepo: new EntryRepository(db),
    sessionAllocationRepo: new DrizzleSessionAllocationRepository(db),
    sandbox: null,
    workspaceManager: workspaces,
    admissionController: new AdmissionController(),
    scmFlow: { run: async () => { throw new Error('golden: no source control'); } },
    config: { artifactsDir: join(workDir, 'art') },
    chatExtensions: {},
    planRepo: new DrizzlePlanRepository(db),
    agentInteractionRepo: new DrizzleAgentInteractionRepository(db),
    agentResolver: fakeResolver,
  });
  return { db, workDir, calls, services };
}

const envs: Env[] = [];
function fresh(): Env {
  const workDir = mkdtempSync(join(tmpdir(), 'gai-golden-'));
  const db = createDB(':memory:');
  migrateDB(db);
  const env = boot(db, workDir);
  envs.push(env);
  return env;
}

afterEach(() => {
  for (const env of envs.splice(0)) {
    env.services.agentInteractionService?.dispose();
    env.services.automationService.shutdown();
    env.services.workflowRunService.shutdown();
    try {
      closeDB(env.db);
    } catch {
      /* closed */
    }
    rmSync(env.workDir, { recursive: true, force: true });
  }
});

const CHAT_HARNESS = {
  model: 'claude-sonnet',
  harnessType: 'claude-agent' as const,
  systemMessage: { mode: 'append' as const, content: 'USER-SYSTEM-MESSAGE' },
  systemPromptAppend: 'USER-APPEND',
  maxTurns: 7,
  availableTools: ['Read', 'Edit'],
  excludedTools: ['my_custom_tool'],
  reasoningEffort: 'high' as const,
};

const lastCreate = (env: Env) => env.calls.filter((c) => c.op === 'create').at(-1)!.params!;

async function runStage(
  env: Env,
  stage: Record<string, unknown>,
  extraVars: Record<string, unknown> = {},
): Promise<CreateConversationParams> {
  const { workflowDefinitionService, workflowRunService, stageExecutionService } = env.services;
  const def = await workflowDefinitionService.createFromSpec(
    {
      formatVersion: 2,
      workflow: {
        name: 'golden',
        session: {
          model: 'claude-sonnet',
          harnessType: 'claude-agent',
          systemMessage: { mode: 'append', content: 'WORKFLOW-AUTHOR-SYSTEM-MESSAGE' },
        },
      },
      stages: [{ kind: 'agent', key: 'golden', name: 'golden', prompts: [{ label: 'p', text: 'Do the golden stage.' }], ...stage }],
      edges: [],
    },
    { canEditCommands: true, status: 'published' },
  );
  const run = await workflowRunService.createRun({ workflowDefinitionId: def.id });
  const [stageRun] = await new DrizzleStageRunRepository(env.db).getByRunId(run.id);
  await stageExecutionService.executeStage(stageRun!, run.id, 'per-stage', def.graph.workflow.session, {
    __workingDirectory: join(env.workDir, 'run'),
    __workflowRunId: run.id,
    ...extraVars,
  });
  return lastCreate(env);
}

const sys = (p: CreateConversationParams | undefined) =>
  (p as unknown as { systemMessage?: { mode?: string; content?: string } } | undefined)?.systemMessage;

// ── Cases ────────────────────────────────────────────────────────

describe('session composition golden snapshots', () => {
  it('(a) chat create', async () => {
    const env = fresh();
    await env.services.chatManagementService.createChat({ name: 'golden chat', harnessConfig: CHAT_HARNESS });
    await expect(golden(lastCreate(env), env.workDir)).toMatchFileSnapshot('__snapshots__/a-chat-create.json');
  });

  it('(b) chat resume after a restart', async () => {
    const first = fresh();
    const chat = await first.services.chatManagementService.createChat({ name: 'golden chat', harnessConfig: CHAT_HARNESS });
    const created = lastCreate(first);

    // A fresh process on the same DB: the conversation is not live, so the
    // first prompt rebuilds the config and resumes with it.
    const second = boot(first.db, first.workDir);
    envs.push(second);
    await Promise.race([
      second.services.chatManagementService.sendPrompt(chat.id, 'hello').catch(() => undefined),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
    const resumed = second.calls.find((c) => c.op === 'resume')!;
    expect(resumed).toBeDefined();
    await expect(golden(resumed.params, first.workDir)).toMatchFileSnapshot('__snapshots__/b-chat-resume.json');

    // W-50 (fixed in P02 WP-2.4) — one precedence rule for create and
    // resume: both reach the provider on create too.
    const c = created as unknown as Record<string, unknown>;
    const r = resumed.params as unknown as Record<string, unknown>;
    expect(c['systemPromptAppend']).toBe('USER-APPEND');
    expect(r['systemPromptAppend']).toBe('USER-APPEND');
    expect(c['maxTurns']).toBe(7);
    expect(r['maxTurns']).toBe(7);
    // …and the resumed conversation is the created one, key for key, apart
    // from the provider-session handle a resume carries.
    const strip = (p: Record<string, unknown>) => {
      const { resumeProviderSessionId: _r, ...rest } = p;
      return golden(rest, first.workDir);
    };
    expect(strip(r)).toBe(strip(c));
  });

  it('(c) orchestrator chat', async () => {
    const env = fresh();
    await env.services.chatManagementService.createChat({
      name: 'golden orchestrator',
      harnessConfig: CHAT_HARNESS,
      orchestratorMode: true,
    });
    const p = lastCreate(env);
    expect((p as unknown as { tools?: Array<{ name: string }> }).tools?.map((t) => t.name)).toContain('spawn_background_agent');
    await expect(golden(p, env.workDir)).toMatchFileSnapshot('__snapshots__/c-orchestrator-chat.json');
  });

  it('(d) worker chat', async () => {
    const env = fresh();
    const orch = await env.services.chatManagementService.createChat({
      name: 'golden orchestrator',
      harnessConfig: CHAT_HARNESS,
      orchestratorMode: true,
    });
    await env.services.chatManagementService.createChat({
      name: 'golden worker',
      harnessConfig: CHAT_HARNESS,
      parentChatId: orch.id,
      orchestratorMode: true,
    });
    const p = lastCreate(env);
    // A worker never gets the orchestrator tool set (no recursive spawning).
    expect(((p as unknown as { tools?: Array<{ name: string }> }).tools ?? []).map((t) => t.name)).not.toContain(
      'spawn_background_agent',
    );
    await expect(golden(p, env.workDir)).toMatchFileSnapshot('__snapshots__/d-worker-chat.json');
  });

  it('(e) chat with an agent (team, disallowedTools, replace projection)', async () => {
    const env = fresh();
    await env.services.chatManagementService.createChat({
      name: 'golden agent chat',
      harnessConfig: CHAT_HARNESS,
      agentRef: AGENT_REF,
    });
    await expect(golden(lastCreate(env), env.workDir)).toMatchFileSnapshot('__snapshots__/e-chat-agent.json');
  });

  it('(f) stage with the same agent', async () => {
    const env = fresh();
    const stageParams = await runStage(env, { name: 'golden-stage', session: { agentRef: AGENT_REF } });
    await expect(golden(stageParams, env.workDir)).toMatchFileSnapshot('__snapshots__/f-stage-agent.json');

    // Same agent through the chat builder, for the drift assertions.
    await env.services.chatManagementService.createChat({
      name: 'golden agent chat',
      harnessConfig: CHAT_HARNESS,
      agentRef: AGENT_REF,
    });
    const chatParams = lastCreate(env);

    // W-51 — `projection: replace` on a stage wipes the workflow author's
    // whole system message; the chat keeps the user's message and drops only
    // the provider base prompt.
    expect(sys(stageParams)?.mode).toBe('replace');
    expect(sys(stageParams)?.content).not.toContain('WORKFLOW-AUTHOR-SYSTEM-MESSAGE'); // KNOWN-DRIFT W-51 (replace wipes the author's system message)
    expect(sys(chatParams)?.content).toContain('GOLDEN-AGENT-INSTRUCTIONS');

    // W-52 — the stage's team mapping drops every restriction on a sub-agent.
    const stageTeam = (stageParams as unknown as { customAgents?: Array<Record<string, unknown>> }).customAgents!;
    expect(stageTeam).toHaveLength(1);
    for (const field of ['tools', 'disallowedTools', 'maxTurns', 'permissionMode', 'reasoningEffort']) {
      expect(stageTeam[0]![field]).toBeUndefined(); // KNOWN-DRIFT W-52 (restricted team member unrestricted in a stage)
    }
  });

  it('(g) stage with the browser enabled', async () => {
    const env = fresh();
    const browser = {
      reattachOnPrompt: () => undefined,
      resolveConfig: () => ({ enabled: false, visibility: 'off' }),
      ensureStarted: async () => undefined,
    } as unknown as BrowserService;
    env.services.stageExecutionService.setBrowserService(browser);
    const p = await runStage(env, { name: 'golden-browser-stage', session: { agentRef: AGENT_REF } }, { __workspaceId: 'ws-golden' });
    const toolNames = ((p as unknown as { tools?: Array<{ name: string }> }).tools ?? []).map((t) => t.name);
    expect(toolNames).toContain('open_browser_page');
    await expect(golden(p, env.workDir)).toMatchFileSnapshot('__snapshots__/g-stage-browser.json');

    // W-51 — on a stage the agent instructions land BEFORE the platform
    // (browser) block; a chat appends them after every platform block.
    const content = sys(p)?.content ?? '';
    expect(content.indexOf('GOLDEN-AGENT-INSTRUCTIONS')).toBeLessThan(content.indexOf('[Integrated Browser]')); // KNOWN-DRIFT W-51 (instructions before platform blocks)
  });
});
