// `generatorai run …` — starting, watching and controlling workflow runs.
//
// A run starts through ONE call, `workflows.invoke` (P04): `run start`,
// `run retry` (a fork) and `script run` all build an `InvocationRequest`
// and send it with an idempotency key. `run plan` sends the same request to
// `workflows.plan` and prints what the run would do. The server validates
// the request (variables, stage keys, codebases, models, the permission
// ceiling) and answers every problem at once in its `issues[]`.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import {
  REASONING_EFFORTS,
  RUN_PERMISSION_MODES,
  RunProfileSchema,
  type InvocationIssue,
  type InvocationPlan,
  type InvocationRequest,
  type RunDigest,
  type RunProfile,
} from '@generatorai/workflow-spec';
import { newIdempotencyKey, type InvocationUploadFiles } from '@generatorai/client-core';
import {
  defineCommand,
  type CommandFlag,
  type CommandResult,
  type CommandSpec,
} from '../registry/CommandSpec.js';
import { CliError } from '../errors/CliError.js';
import { resolveRef } from '../refs/resolveRef.js';
import type { CliContext } from '../context/CliContext.js';
import { getRunProfilesDir, getUserRunProfilesDir } from '../config/paths.js';
import {
  compact,
  createdColumn,
  idColumn,
  inputSchema,
  list,
  ok,
  parseKeyValues,
  record,
  sleep,
  statusColumn,
  streamUntil,
  verbosityFlag,
  watchFlag,
} from './_shared.js';
import { findDefinition } from './workflow.js';
import { readAttachments, readStdin } from './chat.js';

export const RUN_GROUP = {
  name: 'run',
  summary: 'Workflow run lifecycle, stage controls and human-in-the-loop gates',
  order: 30,
};

async function findRun(ctx: CliContext, ref: string) {
  const runs = await ctx.api.runs.list({});
  return resolveRef(ref, {
    kind: 'run',
    candidates: runs.map((r) => ({
      id: r.id,
      name: r.name ?? null,
      status: r.status,
      createdAt: r.createdAt,
    })),
    activeStatuses: ['running', 'starting', 'waiting', 'paused', 'finalizing'],
  });
}

/** A stage run by its instance path, its stage key, its name, or its own id. */
async function findStage(ctx: CliContext, runId: string, ref: string) {
  const stages = await ctx.api.runs.stages(runId);
  const view = (s: (typeof stages)[number]) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    stageKey: s.stageKey,
    instancePath: s.instancePath,
  });
  const byKey = stages.filter((s) => s.instancePath === ref.trim() || s.stageKey === ref.trim());
  // A loop body has several instances under one key; the latest is the one
  // an operator means.
  const latest = byKey[byKey.length - 1];
  if (latest) return view(latest);
  const hit = await resolveRef(ref, {
    kind: 'stage',
    candidates: stages.map((s) => ({ id: s.id, name: s.name, status: s.status })),
  });
  const stage = stages.find((s) => s.id === hit.id);
  return stage ? view(stage) : { ...hit, stageKey: undefined, instancePath: undefined };
}

/** What each outcome of `run stage send` means, for the success line. */
const SEND_OUTCOME: Record<'queued' | 'amending' | 'retrying', string> = {
  queued: 'queued as the stage’s next turn',
  amending: 'amending the completed stage’s output (later stages keep what they used; `run retry --from` re-runs them)',
  retrying: 'the paused stage resumes with it',
};

/**
 * A refusal of the stage conversation API, with its code up front and the
 * next step as the hint (409 STAGE_BUSY, INTERACTION_PENDING, …).
 */
function stageConversationError(error: unknown, runId: string, stageRef: string): unknown {
  const api = error as { status?: unknown; message?: unknown; body?: unknown } | null;
  if (!api || api.status !== 409) return error;
  const code = (api.body as { error?: { code?: unknown } } | undefined)?.error?.code;
  const message = typeof api.message === 'string' ? api.message : 'The stage refused the request.';
  const hint =
    code === 'STAGE_BUSY'
      ? `Stop the turn in flight first: generatorai run stage stop ${runId} ${stageRef}`
      : code === 'INTERACTION_PENDING'
        ? `Answer the stage's gate first: generatorai run hitl pending ${runId}`
        : code === 'STAGE_NOT_CONVERSABLE'
          ? `Re-run it in a new run: generatorai run retry ${runId} --from ${stageRef}`
          : undefined;
  return new CliError('CONFLICT', typeof code === 'string' ? `${code}: ${message}` : message, {
    ...(hint ? { hint } : {}),
    details: { runId, stage: stageRef, ...(typeof code === 'string' ? { code } : {}) },
  });
}

/** The question an `awaiting_input` stage asks, from its interrupt payload. */
function gatePrompt(data: unknown): string | undefined {
  if (typeof data === 'string') return data;
  if (!data || typeof data !== 'object') return undefined;
  const r = data as Record<string, unknown>;
  for (const key of ['prompt', 'reason', 'message', 'question']) {
    const v = r[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return typeof r['kind'] === 'string' ? r['kind'] : undefined;
}

// ── Invocation requests ─────────────────────────────────────────────

/** `path: message` for one invocation issue. */
function issueLine(issue: Pick<InvocationIssue, 'path' | 'message'>): string {
  const where = issue.path.length ? `${issue.path.join('.')}: ` : '';
  return `${where}${issue.message}`;
}

/**
 * A refusal of the invocation API (`{error: {code, message, issues[]}}`) as
 * a CLI error that lists every issue, rather than only the summary line.
 */
export function invocationError(error: unknown): unknown {
  const api = error as { status?: unknown; message?: unknown; body?: unknown } | null;
  if (!api || typeof api.status !== 'number') return error;
  const body = (api.body as { error?: { code?: unknown; message?: unknown; issues?: unknown } } | undefined)?.error;
  if (!body || typeof body.code !== 'string') return error;
  const issues = Array.isArray(body.issues) ? (body.issues as InvocationIssue[]) : [];
  const message = typeof body.message === 'string' ? body.message : String(api.message ?? 'The server refused the run.');
  const code =
    api.status === 404
      ? 'NOT_FOUND'
      : api.status === 403
        ? 'FORBIDDEN'
        : api.status === 409
          ? 'CONFLICT'
          : api.status === 503
            ? 'UNAVAILABLE'
            : 'VALIDATION';
  const listed = issues.filter((i) => i.message && !message.includes(i.message));
  return new CliError(code, `${body.code}: ${message}${listed.length ? `\n${listed.map((i) => `  ${issueLine(i)}`).join('\n')}` : ''}`, {
    details: { code: body.code, issues },
    ...(body.code === 'DRAFT_NOT_RUNNABLE' ? { hint: 'Publish it (`generatorai workflow publish`), or run the draft with --test-run.' } : {}),
  });
}

/**
 * Loads and validates a run profile (`RunProfileSchema`, stage overrides by
 * KEY). Bare names resolve against `./.generatorai/run-profiles/` first and
 * the user directory second, so a repo can ship its own profiles and a user
 * can keep personal ones without collision. A path with a separator is taken
 * literally. `dir` is where the profile's own file paths are relative to.
 */
export async function loadRunProfile(
  ref: string,
  cwd = process.cwd(),
): Promise<{ profile: RunProfile; file: string; dir: string }> {
  const candidates = ref.includes('/') || ref.includes('\\') || ref.endsWith('.json')
    ? [path.resolve(cwd, ref)]
    : [
        path.join(getRunProfilesDir(cwd), `${ref}.json`),
        path.join(getUserRunProfilesDir(), `${ref}.json`),
      ];

  for (const candidate of candidates) {
    let raw: string;
    try {
      raw = await fs.readFile(candidate, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new CliError('VALIDATION', `Could not read profile at ${candidate}.`, {
        hint: error instanceof Error ? error.message : String(error),
      });
    }
    return { profile: parseRunProfile(raw, candidate), file: candidate, dir: path.dirname(candidate) };
  }

  throw CliError.notFound('run profile', ref, {
    hint: `Looked in:\n${candidates.map((c) => `  ${c}`).join('\n')}`,
    suggestions: ['generatorai run profile list'],
  });
}

/** Profile file text → a `RunProfile`, or a VALIDATION error listing every problem. */
export function parseRunProfile(raw: string, file: string): RunProfile {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new CliError('VALIDATION', `Profile ${file} is not valid JSON.`, {
      hint: error instanceof Error ? error.message : String(error),
    });
  }
  const parsed = RunProfileSchema.safeParse(json);
  if (!parsed.success) {
    throw new CliError(
      'VALIDATION',
      `Profile ${file} is not valid:\n${parsed.error.issues.map((i) => `  ${issueLine(i)}`).join('\n')}`,
      { hint: 'Write a fresh one with `generatorai run profile generate <workflow> -o <file>`.' },
    );
  }
  return parsed.data;
}

type StageOverride = NonNullable<InvocationRequest['stageOverrides']>[number];
type CodebaseSelection = NonNullable<InvocationRequest['codebases']>[number];

/** Merges stage overrides by key; later sources win field by field. */
export function mergeStageOverrides(...sources: Array<StageOverride[] | undefined>): StageOverride[] {
  const merged = new Map<string, StageOverride>();
  for (const override of sources.flatMap((source) => source ?? [])) {
    const previous = merged.get(override.stageKey);
    const variables = previous?.variables || override.variables
      ? { ...previous?.variables, ...override.variables }
      : undefined;
    const model = override.model ?? previous?.model;
    merged.set(override.stageKey, {
      stageKey: override.stageKey,
      ...(override.skip ?? previous?.skip ? { skip: true } : {}),
      ...(variables ? { variables } : {}),
      ...(model ? { model } : {}),
    });
  }
  return [...merged.values()];
}

/** `--skip <key>`, `--stage-var <key>.<name>=<value>` and `--stage-model <key>=<model>` as overrides by key. */
export function overridesFromFlags(
  skip: string[] | undefined,
  stageVars: string[] | undefined,
  stageModels: string[] | undefined,
): StageOverride[] {
  const out: StageOverride[] = (skip ?? []).map((stageKey) => ({ stageKey: stageKey.trim(), skip: true }));
  for (const pair of stageVars ?? []) {
    const dot = pair.indexOf('.');
    const equals = pair.indexOf('=');
    if (dot <= 0 || equals === -1 || dot > equals) {
      throw CliError.usage(`Expected <stageKey>.<name>=<value>, got "${pair}".`);
    }
    out.push({ stageKey: pair.slice(0, dot).trim(), variables: parseKeyValues([pair.slice(dot + 1)]) });
  }
  for (const pair of stageModels ?? []) {
    const equals = pair.indexOf('=');
    const stageKey = pair.slice(0, equals).trim();
    const model = pair.slice(equals + 1).trim();
    if (equals <= 0 || !stageKey || !model) {
      throw CliError.usage(`Expected <stageKey>=<model>, got "${pair}".`);
    }
    out.push({ stageKey, model });
  }
  return out;
}

/** `alias`, `alias@ref`, `alias:in_place`, `alias@ref:in_place` → a codebase selection. */
export function parseCodebaseFlag(value: string): CodebaseSelection {
  let rest = value.trim();
  let mode: CodebaseSelection['mode'] = 'worktree';
  const suffix = /:(in_place|worktree)$/.exec(rest);
  if (suffix) {
    mode = suffix[1] as CodebaseSelection['mode'];
    rest = rest.slice(0, suffix.index);
  }
  const at = rest.indexOf('@');
  const alias = (at === -1 ? rest : rest.slice(0, at)).trim();
  const baseRef = at === -1 ? undefined : rest.slice(at + 1).trim();
  if (!alias || baseRef === '') {
    throw CliError.usage(`Expected <alias>[@<ref>][:in_place], got "${value}".`);
  }
  return { alias, mode, ...(baseRef ? { baseRef } : {}) };
}

/** Local files → the multipart parts of an invocation. */
async function readUploads(
  paths: Partial<Record<keyof InvocationUploadFiles, string[]>>,
): Promise<InvocationUploadFiles> {
  const out: InvocationUploadFiles = {};
  for (const [category, list] of Object.entries(paths) as Array<[keyof InvocationUploadFiles, string[] | undefined]>) {
    if (list?.length) out[category] = await readAttachments(list);
  }
  return out;
}

/** The flags `run start` and `run plan` share: everything an `InvocationRequest` carries. */
const INVOCATION_FLAGS: CommandFlag[] = [
  { name: 'var', description: 'Variable as key=value (repeatable)', type: 'string', variadic: true },
  { name: 'profile', description: 'Run profile name or path (RunProfile v2); flags win over its values', type: 'string' },
  { name: 'skip', description: 'Skip the stage with this key (repeatable)', type: 'string', variadic: true, completes: 'stage' },
  {
    name: 'stageVar',
    description: 'Variable for one stage as <stageKey>.<name>=<value> (repeatable)',
    type: 'string',
    variadic: true,
  },
  { name: 'stageModel', description: 'Model for one stage as <stageKey>=<model> (repeatable)', type: 'string', variadic: true },
  { name: 'model', description: 'Model for every stage without its own', type: 'string', completes: 'model' },
  { name: 'effort', description: 'Reasoning effort', type: 'string', choices: REASONING_EFFORTS },
  {
    name: 'codebase',
    description: 'Codebase to mount as <alias>[@<ref>][:in_place] (repeatable; default: the workflow lifecycle aliases)',
    type: 'string',
    variadic: true,
    completes: 'codebase',
  },
  { name: 'project', description: 'Project id or name whose codebases the run may mount', type: 'string', completes: 'project' },
  {
    name: 'permissionMode',
    description: 'Permission mode for the run (capped by your device ceiling)',
    type: 'string',
    choices: RUN_PERMISSION_MODES,
  },
  { name: 'name', description: 'Name for this run', type: 'string' },
  // Not `--timeout`: that is the global per-request timeout, and Commander
  // hands a global option to the program even when it follows the verb.
  { name: 'runTimeout', description: 'Stop the run after this many minutes (budget.maxDurationMs)', type: 'number' },
  { name: 'skillFile', description: 'Skill file to upload for the run (repeatable)', type: 'string', variadic: true, completes: 'file' },
  { name: 'agentFile', description: 'Agent file to upload for the run (repeatable)', type: 'string', variadic: true, completes: 'file' },
  { name: 'promptFile', description: 'Prompt file to upload for the run (repeatable)', type: 'string', variadic: true, completes: 'file' },
  { name: 'testRun', description: 'Run the draft (unpublished) graph as a test version', type: 'boolean' },
  // The client label the server records on the trigger; the TUI sets `tui`.
  { name: 'client', description: 'Client label', type: 'string', choices: ['cli', 'tui'], hidden: true },
];

const INVOCATION_FLAG_SCHEMA = {
  var: z.array(z.string()).optional(),
  profile: z.string().optional(),
  skip: z.array(z.string()).optional(),
  stageVar: z.array(z.string()).optional(),
  stageModel: z.array(z.string()).optional(),
  model: z.string().optional(),
  effort: z.enum(REASONING_EFFORTS).optional(),
  codebase: z.array(z.string()).optional(),
  project: z.string().optional(),
  permissionMode: z.enum(RUN_PERMISSION_MODES).optional(),
  name: z.string().optional(),
  runTimeout: z.coerce.number().positive().optional(),
  skillFile: z.array(z.string()).optional(),
  agentFile: z.array(z.string()).optional(),
  promptFile: z.array(z.string()).optional(),
  testRun: z.boolean().optional(),
  client: z.enum(['cli', 'tui']).default('cli'),
};

type InvocationFlags = {
  [K in keyof typeof INVOCATION_FLAG_SCHEMA]: z.infer<(typeof INVOCATION_FLAG_SCHEMA)[K]>;
};

/**
 * `run start`/`run plan` input → one `InvocationRequest` and its files.
 * Explicit flags sit on top of the profile's values, field by field.
 */
export async function buildInvocation(
  ctx: CliContext,
  workflowRef: string | undefined,
  flags: Partial<InvocationFlags>,
): Promise<{ request: InvocationRequest; files: InvocationUploadFiles }> {
  const loaded = flags.profile ? await loadRunProfile(flags.profile) : undefined;
  const profile = loaded?.profile;

  const ref = workflowRef ?? profile?.workflow;
  if (!ref) {
    throw CliError.usage('Which workflow? Pass it as an argument, or set `workflow` in the profile.');
  }
  const definition = await findDefinition(ctx, ref);

  let projectId = profile?.projectId;
  if (flags.project) {
    projectId = resolveRef(flags.project, { kind: 'project', candidates: await ctx.api.projects.list() }).id;
  }

  const stageOverrides = mergeStageOverrides(
    profile?.stageOverrides,
    overridesFromFlags(flags.skip, flags.stageVar, flags.stageModel),
  );

  const codebases = new Map((profile?.codebases ?? []).map((c) => [c.alias, c]));
  for (const value of flags.codebase ?? []) {
    const selection = parseCodebaseFlag(value);
    codebases.set(selection.alias, selection);
  }

  const overrides = compact({
    ...profile?.overrides,
    model: flags.model ?? profile?.overrides?.model,
    reasoningEffort: flags.effort ?? profile?.overrides?.reasoningEffort,
    permissionMode: flags.permissionMode ?? profile?.overrides?.permissionMode,
  });

  const budget = compact({
    ...profile?.budget,
    maxDurationMs: flags.runTimeout !== undefined ? Math.round(flags.runTimeout * 60_000) : profile?.budget?.maxDurationMs,
  });

  // A profile's file paths are relative to the profile; a flag's to the shell.
  const fromProfile = (list: string[] | undefined) => (list ?? []).map((p) => path.resolve(loaded!.dir, p));
  const files = await readUploads({
    skills: [...fromProfile(profile?.skillFiles), ...(flags.skillFile ?? [])],
    agents: [...fromProfile(profile?.agentFiles), ...(flags.agentFile ?? [])],
    prompts: [...fromProfile(profile?.promptFiles), ...(flags.promptFile ?? [])],
  });

  const name = flags.name ?? profile?.runName;
  const request: InvocationRequest = {
    target: {
      kind: 'definition',
      workflowDefinitionId: definition.id,
      ...(flags.testRun ? { testRun: true } : {}),
    },
    variables: { ...profile?.variables, ...parseKeyValues(flags.var) },
    ...(projectId ? { projectId } : {}),
    ...(codebases.size ? { codebases: [...codebases.values()] } : {}),
    ...(stageOverrides.length ? { stageOverrides } : {}),
    ...(Object.keys(overrides).length ? { overrides } : {}),
    ...(Object.keys(budget).length ? { budget } : {}),
    ...(name ? { name } : {}),
    client: flags.client ?? 'cli',
  };
  return { request, files };
}

/** The plan as readable lines: stages by layer, skips, codebases, phases, post-processing, warnings. */
export function describeInvocationPlan(plan: InvocationPlan, options: { maxStages?: number } = {}): string[] {
  const lines: string[] = [];
  const version = plan.definitionVersionId ? `version ${plan.definitionVersionId.slice(0, 8)}` : 'not materialized yet';
  lines.push(`${plan.workflowName} (${version})`);
  lines.push(`Permission mode: ${plan.permissionMode}`);

  const runs = plan.stages.filter((s) => !s.skipped).length;
  lines.push(`Stages: ${runs} to run${plan.stages.length > runs ? `, ${plan.stages.length - runs} skipped` : ''}`);
  const byLayer = [...plan.stages].sort((a, b) => a.layer - b.layer);
  const shown = byLayer.slice(0, options.maxStages ?? byLayer.length);
  for (const stage of shown) {
    const notes = [
      stage.skipped ? `skipped${stage.skipReason === 'guard_false' ? ' (guard is false)' : ''}` : undefined,
      stage.model ? `model ${stage.model}` : undefined,
      stage.agentRef ? `agent ${stage.agentRef}` : undefined,
      stage.approvalRequired ? 'needs approval' : undefined,
      stage.kind && stage.kind !== 'agent' ? stage.kind : undefined,
      stage.parentKey ? `in ${stage.parentKey}` : undefined,
    ].filter(Boolean);
    const label = stage.name && stage.name !== stage.key ? `${stage.key} — ${stage.name}` : stage.key;
    lines.push(`  ${stage.skipped ? '-' : '•'} L${stage.layer}  ${label}${notes.length ? `  [${notes.join(', ')}]` : ''}`);
  }
  if (shown.length < byLayer.length) lines.push(`  … ${byLayer.length - shown.length} more`);

  lines.push(
    `Codebases: ${
      plan.codebases.length
        ? plan.codebases
            .map((c) => `${c.alias}${c.baseRef ? `@${c.baseRef}` : ''} (${c.mode === 'in_place' ? 'in place' : 'worktree'}${c.source === 'lifecycle' ? ', from the workflow' : ''})`)
            .join(', ')
        : 'none'
    }`,
  );
  if (plan.prepare.length) lines.push(`Prepare: ${plan.prepare.join(' → ')}`);
  if (plan.preprocessing.length) lines.push(`Preprocessing: ${plan.preprocessing.join(', ')}`);
  lines.push(`Post-processing: ${plan.postProcessing.length ? plan.postProcessing.join(', ') : 'none'}`);
  for (const r of plan.risks ?? []) lines.push(`Risk: ${r.message}`);
  if (plan.lineage.depth > 0) lines.push(`Nested run: depth ${plan.lineage.depth} under ${plan.lineage.parentRunId ?? '?'}`);
  for (const warning of plan.warnings) lines.push(`! ${issueLine(warning)}`);
  return lines;
}

// ── Watching ───────────────────────────────────────────────────────

/** Seconds one digest long-poll waits: 30, or less when `--timeout` is shorter. */
function digestWaitSeconds(ctx: CliContext): number {
  if (!(ctx.timeoutMs > 0)) return 30;
  return Math.max(1, Math.min(30, Math.floor(ctx.timeoutMs / 1000) - 5));
}

/** Long-polls the run digest until the run is finalized (post-processing and release done). */
export async function waitForFinalized(ctx: CliContext, runId: string): Promise<RunDigest> {
  const waitSeconds = digestWaitSeconds(ctx);
  for (;;) {
    ctx.assertNotCancelled();
    const started = Date.now();
    const digest = await ctx.api.workflows.digest(runId, { waitSeconds });
    if (digest.finalized) return digest;
    // A server that answers at once (no long-poll) must not become a hot loop.
    if (Date.now() - started < 1000) await sleep(1000, ctx.signal);
  }
}

/**
 * Streams a run's progress until it is finalized. Exported so any command
 * that starts a run (`run start`, `run retry`, `script run`) offers `--watch`
 * through one implementation. A failed or cancelled run is a RESULT_FAILED
 * error, so the exit code reflects the outcome.
 */
export async function watchRun(
  ctx: CliContext,
  runId: string,
  verbosity: 'minimal' | 'normal' | 'verbose',
): Promise<RunDigest> {
  const showThinking = verbosity === 'verbose';
  const showTools = verbosity !== 'minimal';
  let internalTurn = false;
  let currentStage = '';

  const streamed = streamUntil(ctx, 'run', runId, {
    onEvent: (event) => {
      const data = event.data;
      if (event.kind === 'harness.turn_start') {
        internalTurn = Boolean(data['__isInternalTurn']);
        return;
      }

      // The server's stage lifecycle: a stage beginning is
      // `stage_run.running`; HITL gates are `stage_run.awaiting_input`.
      switch (event.kind) {
        case 'stage.started':
        case 'stage_run.running': {
          currentStage = String(data['name'] ?? data['stageName'] ?? data['stageRunId'] ?? '');
          ctx.emit({ type: 'log', level: 'info', message: `▶ ${currentStage}` });
          return;
        }
        case 'stage.completed':
        case 'stage_run.completed':
          ctx.emit({ type: 'log', level: 'info', message: `✓ ${currentStage || String(data['name'] ?? '')}` });
          return;
        case 'stage.failed':
        case 'stage_run.failed':
          ctx.emit({
            type: 'log',
            level: 'error',
            message: `✗ ${currentStage || String(data['name'] ?? '')}: ${String(data['error'] ?? '')}`,
          });
          return;
        case 'stage_run.awaiting_input':
          ctx.emit({
            type: 'log',
            level: 'warn',
            message: `⏳ ${currentStage} is waiting for approval — run \`generatorai run hitl pending ${runId}\``,
          });
          return;
      }

      if (internalTurn || data['__isInternalTurn']) return;

      switch (event.kind) {
        case 'harness.token':
          if (verbosity !== 'minimal') ctx.chunk(String(data['text'] ?? ''));
          break;
        case 'harness.reasoning_delta':
          if (showThinking) ctx.chunk(String(data['text'] ?? ''), 'thinking');
          break;
        case 'harness.tool_start':
          if (showTools) {
            ctx.emit({
              type: 'log',
              level: 'info',
              message: `  → ${String(data['tool'] ?? data['name'] ?? 'tool')}`,
            });
          }
          break;
        case 'harness.usage':
          if (verbosity === 'verbose') {
            ctx.emit({ type: 'log', level: 'debug', message: `tokens: ${JSON.stringify(data)}` });
          }
          break;
      }
    },
  });

  // The stream never ends on its own; the digest decides when the run is
  // over. Racing them means a missed terminal event cannot hang the command,
  // and waiting for `finalized` (not just a terminal status) means the
  // commit/PR post-processing has happened when the command returns.
  const digest = await waitForFinalized(ctx, runId);
  await ctx.dispose();
  await streamed.catch(() => undefined);

  for (const step of digest.postProcessing) {
    ctx.emit({
      type: 'log',
      level: step.success ? 'info' : 'error',
      message: step.success
        ? `✓ ${step.step}${step.output ? `: ${step.output}` : ''}`
        : `✗ ${step.step}: ${step.error ?? 'failed'}`,
    });
  }

  if (digest.outcome === 'failed') {
    throw new CliError('RESULT_FAILED', `Run failed: ${digest.error ?? 'no error message'}`, {
      details: { runId, status: digest.status },
    });
  }
  if (digest.outcome === 'cancelled') {
    throw new CliError('RESULT_FAILED', 'Run was cancelled.', { details: { runId, status: digest.status } });
  }
  return digest;
}

/** A started run as the success line and the warnings `run start`/`run retry`/`script run` print. */
export function startedRun(
  result: { runId: string; replayed: boolean; warnings: InvocationIssue[] },
  verb = 'Started',
): { message: string; warnings: string[] } {
  return {
    message: result.replayed
      ? `Run ${result.runId} was already started with this idempotency key — \`generatorai run watch ${result.runId}\``
      : `${verb} run ${result.runId} — watch it with \`generatorai run watch ${result.runId}\``,
    warnings: result.warnings.map(issueLine),
  };
}

export function runCommands(): CommandSpec[] {
  return [
    defineCommand({
      id: 'run.list',
      group: 'run',
      verb: 'list',
      aliases: ['ls'],
      summary: 'List workflow runs',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [
        { name: 'status', description: 'Filter by status', type: 'string' },
        { name: 'definition', description: 'Filter by workflow', type: 'string', completes: 'workflow' },
        { name: 'limit', description: 'Maximum rows', type: 'number', default: 50 },
      ],
      schema: inputSchema(
        {},
        {
          status: z.string().optional(),
          definition: z.string().optional(),
          limit: z.coerce.number().int().positive().default(50),
        },
      ),
      output: {
        kind: 'list',
        columns: [
          idColumn,
          { key: 'name', header: 'Name', priority: 1 },
          statusColumn,
          { key: 'workflowDefinitionId', header: 'Workflow', format: 'id', priority: 3 },
          createdColumn,
        ],
      },
      async handler(ctx, { flags }) {
        const definitionId = flags.definition
          ? (await findDefinition(ctx, flags.definition)).id
          : undefined;
        return list(
          await ctx.api.runs.list(compact({ status: flags.status, definitionId, limit: flags.limit })),
        );
      },
    }),

    defineCommand({
      id: 'run.start',
      group: 'run',
      verb: 'start',
      summary: 'Start a run of a workflow (one invocation)',
      description:
        'Sends one InvocationRequest to the server, which validates it and starts the run with its full lifecycle ' +
        '(workspace, codebases, uploads, post-processing). Flags sit on top of --profile values. Every call carries an ' +
        'idempotency key (a fresh one unless --idempotency-key is given), so a retried command never starts two runs.',
      requiresServer: true,
      sinceVersion: '0.2.0',
      examples: [
        'generatorai run start nightly-e2e --var topic=caching --watch',
        'generatorai run start a3f2 --profile quick-surface --permission-mode acceptEdits',
        'generatorai run start review --codebase api@main --skip lint --stage-model review=claude-opus --run-timeout 30',
      ],
      args: [
        {
          name: 'workflow',
          description: 'Workflow definition reference (optional when the profile names one)',
          required: false,
          completes: 'workflow',
        },
      ],
      flags: [
        ...INVOCATION_FLAGS,
        {
          name: 'idempotencyKey',
          description: 'Idempotency key; the same key and request replay the same run (default: a fresh key)',
          type: 'string',
        },
        watchFlag,
        verbosityFlag,
      ],
      schema: inputSchema(
        { workflow: z.string().optional() },
        {
          ...INVOCATION_FLAG_SCHEMA,
          idempotencyKey: z.string().regex(/^[!-~]{1,200}$/, 'printable ASCII without spaces, at most 200 characters').optional(),
          watch: z.boolean().optional(),
          verbosity: z.enum(['minimal', 'normal', 'verbose']).default('normal'),
        },
      ),
      output: { kind: 'record', successMessage: 'Started run {runId}' },
      async handler(ctx, { args, flags }): Promise<CommandResult<unknown>> {
        const { request, files } = await buildInvocation(ctx, args.workflow, flags);
        const result = await ctx.api.workflows
          .invoke(request, { idempotencyKey: flags.idempotencyKey ?? newIdempotencyKey(), files })
          .catch((error: unknown) => {
            throw invocationError(error);
          });
        const { message, warnings } = startedRun(result);

        if (flags.watch) {
          await watchRun(ctx, result.runId, flags.verbosity);
          return { data: await ctx.api.runs.get(result.runId), warnings };
        }
        return { data: result, warnings, message };
      },
    }),

    defineCommand({
      id: 'run.plan',
      group: 'run',
      verb: 'plan',
      summary: 'Show what `run start` would do, without starting anything',
      description:
        'Sends the same request as `run start` to the plan endpoint: the stages by layer (and which are skipped), ' +
        'the codebases it mounts, the prepare and post-processing phases, the permission mode and every warning.',
      requiresServer: true,
      sinceVersion: '0.2.0',
      examples: [
        'generatorai run plan nightly-e2e --var topic=caching',
        'generatorai run plan review --profile quick-surface --skip lint',
      ],
      args: [
        {
          name: 'workflow',
          description: 'Workflow definition reference (optional when the profile names one)',
          required: false,
          completes: 'workflow',
        },
      ],
      flags: INVOCATION_FLAGS,
      schema: inputSchema({ workflow: z.string().optional() }, INVOCATION_FLAG_SCHEMA),
      // `stream` prints the rendered plan (the message) as is; structured
      // output carries the plan itself.
      output: { kind: 'stream' },
      async handler(ctx, { args, flags }) {
        const { request } = await buildInvocation(ctx, args.workflow, flags);
        // Files are uploaded only by `invoke`; the plan sees none of them.
        const plan = await ctx.api.workflows.plan(request).catch((error: unknown) => {
          throw invocationError(error);
        });
        return { data: plan, message: describeInvocationPlan(plan).join('\n') };
      },
    }),

    defineCommand({
      id: 'run.show',
      group: 'run',
      verb: 'show',
      aliases: ['get'],
      summary: 'Show a run and its stages',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
      flags: [{ name: 'stages', description: 'Include stage detail', type: 'boolean', default: true }],
      schema: inputSchema({ run: z.string() }, { stages: z.boolean().default(true) }),
      output: { kind: 'record' },
      async handler(ctx, { args, flags }) {
        const target = await findRun(ctx, args.run);
        const run = await ctx.api.runs.get(target.id);
        if (!flags.stages) return record(run);
        const stages = await ctx.api.runs.stages(target.id);
        return record({ ...run, stages });
      },
    }),

    defineCommand({
      id: 'run.watch',
      group: 'run',
      verb: 'watch',
      summary: 'Stream a run until it is finalized (post-processing done); the exit code reflects its outcome',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
      flags: [verbosityFlag],
      schema: inputSchema(
        { run: z.string() },
        { verbosity: z.enum(['minimal', 'normal', 'verbose']).default('normal') },
      ),
      output: { kind: 'stream' },
      async handler(ctx, { args, flags }) {
        const target = await findRun(ctx, args.run);
        const digest = await ctx.api.workflows.digest(target.id);
        if (digest.finalized) {
          return record(await ctx.api.runs.get(target.id), `Run already ${digest.status}.`);
        }
        await watchRun(ctx, target.id, flags.verbosity);
        return record(await ctx.api.runs.get(target.id));
      },
    }),

    ...(['pause', 'resume', 'cancel'] as const).map((verb) =>
      defineCommand({
        id: `run.${verb}`,
        group: 'run',
        verb,
        summary: `${verb[0]!.toUpperCase()}${verb.slice(1)} a run`,
        requiresServer: true,
        destructive: verb === 'cancel',
        sinceVersion: '0.2.0',
        args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
        flags: [],
        schema: inputSchema({ run: z.string() }, {}),
        output: { kind: 'record', successMessage: `Run {id} ${verb}d.` },
        async handler(ctx, { args }) {
          const target = await findRun(ctx, args.run);
          // A run command; pause interrupts in-flight stages as well.
          await ctx.api.runs.command(
            target.id,
            verb === 'pause' ? { command: 'pause', mode: 'interrupt' } : { command: verb },
          );
          return record(await ctx.api.runs.get(target.id));
        },
      }),
    ),

    // A finished run is never mutated: retry forks a NEW run (an invocation
    // with a fork target) that re-runs every stage that did not complete
    // (completed ones are memoized), in a fresh workspace, on the pinned
    // definition version.
    defineCommand({
      id: 'run.retry',
      group: 'run',
      verb: 'retry',
      summary: 'Re-run the failed stages of a finished run as a new run',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
      flags: [
        { name: 'from', description: 'Re-run from this stage instance (and everything after it)', type: 'string', completes: 'stage' },
        {
          name: 'idempotencyKey',
          description: 'Idempotency key; the same key and request replay the same run (default: a fresh key)',
          type: 'string',
        },
        watchFlag,
        verbosityFlag,
      ],
      schema: inputSchema(
        { run: z.string() },
        {
          from: z.string().optional(),
          idempotencyKey: z.string().regex(/^[!-~]{1,200}$/, 'printable ASCII without spaces, at most 200 characters').optional(),
          watch: z.boolean().optional(),
          verbosity: z.enum(['minimal', 'normal', 'verbose']).default('normal'),
        },
      ),
      output: { kind: 'record', successMessage: 'Retried as run {runId}' },
      async handler(ctx, { args, flags }): Promise<CommandResult<unknown>> {
        const target = await findRun(ctx, args.run);
        const from = flags.from ? await findStage(ctx, target.id, flags.from) : undefined;
        const fromPath = from ? (from.instancePath ?? from.stageKey) : undefined;
        if (from && !fromPath) {
          throw new CliError('VALIDATION', `Stage "${flags.from}" has no instance path to re-run from.`);
        }
        const result = await ctx.api.workflows
          .invoke(
            {
              target: {
                kind: 'fork',
                sourceRunId: target.id,
                ...(fromPath ? { rerunFrom: [fromPath] } : {}),
                definition: 'pinned',
                workspace: 'fresh',
              },
              variables: {},
              client: 'cli',
            },
            { idempotencyKey: flags.idempotencyKey ?? newIdempotencyKey() },
          )
          .catch((error: unknown) => {
            throw invocationError(error);
          });
        const { message, warnings } = startedRun(result, 'Retried as');
        if (flags.watch) {
          await watchRun(ctx, result.runId, flags.verbosity);
          return { data: await ctx.api.runs.get(result.runId), warnings };
        }
        return { data: result, warnings, message };
      },
    }),

    defineCommand({
      id: 'run.delete',
      group: 'run',
      verb: 'delete',
      aliases: ['rm'],
      summary: 'Delete a run record',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
      flags: [],
      schema: inputSchema({ run: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Deleted.' },
      async handler(ctx, { args }) {
        const target = await findRun(ctx, args.run);
        await ctx.api.runs.remove(target.id);
        return ok(`Deleted run ${target.id}.`);
      },
    }),

    defineCommand({
      id: 'run.stage.list',
      group: 'run',
      verb: 'stage list',
      summary: 'Stage runs for a run',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
      flags: [],
      schema: inputSchema({ run: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'id', header: 'Stage Run', format: 'id', priority: 0 },
          { key: 'stageKey', header: 'Key', priority: 0 },
          { key: 'name', header: 'Stage', priority: 1 },
          statusColumn,
          { key: 'startedAt', header: 'Started', format: 'relative', priority: 3 },
          { key: 'durationMs', header: 'Duration', format: 'duration', priority: 2 },
        ],
      },
      async handler(ctx, { args }) {
        const target = await findRun(ctx, args.run);
        return list(await ctx.api.runs.stages(target.id));
      },
    }),

    // Instance commands. Retry starts a new attempt of a PAUSED stage in a
    // live run; to re-run a stage of a finished run, use `run retry --from`.
    ...(['pause', 'resume', 'retry', 'cancel'] as const).map((verb) =>
      defineCommand({
        id: `run.stage.${verb}`,
        group: 'run',
        verb: `stage ${verb}`,
        summary: `${verb[0]!.toUpperCase()}${verb.slice(1)} one stage`,
        requiresServer: true,
        destructive: verb === 'cancel',
        sinceVersion: '0.2.0',
        args: [
          { name: 'run', description: 'Run reference', required: true, completes: 'run' },
          { name: 'stage', description: 'Stage reference', required: true, completes: 'stage' },
        ],
        flags: [],
        schema: inputSchema({ run: z.string(), stage: z.string() }, {}),
        output: { kind: 'void', successMessage: `Stage ${verb}d.` },
        async handler(ctx, { args }) {
          const run = await findRun(ctx, args.run);
          const stage = await findStage(ctx, run.id, args.stage);
          await ctx.api.runs.command(
            run.id,
            verb === 'pause'
              ? { command: 'pause', instanceId: stage.id, mode: 'interrupt' }
              : verb === 'retry'
                ? { command: 'retry', instanceId: stage.id, mode: 'resume' }
                : { command: verb, instanceId: stage.id },
          );
          return ok(`Stage ${stage.name ?? stage.id} ${verb}d.`);
        },
      }),
    ),

    // A stage is a compact chat (P03b): message it, stop its turn.
    defineCommand({
      id: 'run.stage.send',
      group: 'run',
      verb: 'stage send',
      summary: 'Send a message to a stage (the next turn, an amendment of a completed stage, or a retry of a paused one)',
      requiresServer: true,
      sinceVersion: '0.2.0',
      examples: [
        'generatorai run stage send @last review "also cover the empty-input case"',
        'generatorai run stage send a3f2 implement - --attach spec.md',
      ],
      args: [
        { name: 'run', description: 'Run reference', required: true, completes: 'run' },
        { name: 'stage', description: 'Stage reference', required: true, completes: 'stage' },
        { name: 'text', description: 'Message text, or - to read stdin', required: true },
      ],
      flags: [
        { name: 'mode', description: 'Agent mode of this turn (auto or plan)', type: 'string' },
        { name: 'attach', description: 'Attach a file (repeatable)', type: 'string', variadic: true, completes: 'file' },
      ],
      schema: inputSchema(
        { run: z.string(), stage: z.string(), text: z.string() },
        { mode: z.enum(['auto', 'plan']).optional(), attach: z.array(z.string()).optional() },
      ),
      output: { kind: 'record' },
      async handler(ctx, { args, flags }) {
        const run = await findRun(ctx, args.run);
        const stage = await findStage(ctx, run.id, args.stage);
        const text = args.text === '-' ? await readStdin() : args.text;
        if (!text.trim()) throw CliError.usage('The message is empty.');
        const input = { message: text, ...(flags.mode ? { mode: flags.mode } : {}) };
        try {
          const result = flags.attach?.length
            ? await ctx.api.runs.stageMessageWithAttachments(run.id, stage.id, input, await readAttachments(flags.attach))
            : await ctx.api.runs.stageMessage(run.id, stage.id, input);
          return record(
            { runId: run.id, stageId: stage.id, outcome: result.outcome, attachments: result.attachmentIds.length },
            `Sent to ${stage.name ?? stage.id}: ${SEND_OUTCOME[result.outcome]}.`,
          );
        } catch (error) {
          throw stageConversationError(error, run.id, args.stage);
        }
      },
    }),

    defineCommand({
      id: 'run.stage.stop',
      group: 'run',
      verb: 'stage stop',
      summary: 'Stop the turn a stage is taking; the stage continues from its next step',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'run', description: 'Run reference', required: true, completes: 'run' },
        { name: 'stage', description: 'Stage reference', required: true, completes: 'stage' },
      ],
      flags: [{ name: 'force', description: 'Also tear the provider conversation down (re-bound before the next turn)', type: 'boolean' }],
      schema: inputSchema({ run: z.string(), stage: z.string() }, { force: z.boolean().optional() }),
      output: { kind: 'void', successMessage: 'Turn stopped.' },
      async handler(ctx, { args, flags }) {
        const run = await findRun(ctx, args.run);
        const stage = await findStage(ctx, run.id, args.stage);
        try {
          await ctx.api.runs.cancelStageTurn(run.id, stage.id, flags.force ? { force: true } : {});
        } catch (error) {
          throw stageConversationError(error, run.id, args.stage);
        }
        return ok(`Stopped the turn of ${stage.name ?? stage.id}; the stage continues from its next step.`);
      },
    }),

    defineCommand({
      id: 'run.hitl.mode',
      group: 'run',
      verb: 'hitl mode',
      summary: 'Show or set the run permission mode',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'run', description: 'Run reference', required: true, completes: 'run' },
        { name: 'mode', description: 'New mode; omit to read', required: false },
      ],
      flags: [],
      schema: inputSchema({ run: z.string(), mode: z.enum(RUN_PERMISSION_MODES).optional() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await findRun(ctx, args.run);
        if (!args.mode) return record(await ctx.api.runs.permissionMode.get(target.id));
        return record(
          await ctx.api.runs.permissionMode.set(target.id, args.mode),
          `Permission mode set to ${args.mode}.`,
        );
      },
    }),

    defineCommand({
      id: 'run.hitl.pending',
      group: 'run',
      verb: 'hitl pending',
      summary: 'Gates waiting for a human decision',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
      flags: [],
      schema: inputSchema({ run: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'stageId', header: 'Stage', format: 'id', priority: 0 },
          { key: 'stageName', header: 'Name', priority: 0 },
          { key: 'prompt', header: 'Prompt', priority: 1 },
          { key: 'createdAt', header: 'Waiting since', format: 'relative', priority: 2 },
        ],
      },
      async handler(ctx, { args }) {
        const target = await findRun(ctx, args.run);
        // The pending gates are the run's `awaiting_input` stage runs.
        const run = await ctx.api.runs.get(target.id);
        return list(
          run.stageRuns
            .filter((s) => s.status === 'awaiting_input')
            .map((s) => ({
              stageId: s.id,
              stageName: s.name ?? s.stageKey,
              prompt: gatePrompt(s.interruptData),
              createdAt: s.startedAt ?? null,
            })),
        );
      },
    }),

    // Three verdicts, one per command. `rejected` terminates the run;
    // `changes_requested` sends feedback and re-parks the stage.
    ...(
      [
        { verb: 'approve', outcome: 'approved', past: 'approved' },
        { verb: 'reject', outcome: 'rejected', past: 'rejected' },
        { verb: 'changes-request', outcome: 'changes_requested', past: 'sent back for changes' },
      ] as const
    ).map(({ verb, outcome, past }) =>
      defineCommand({
        id: `run.hitl.${verb}`,
        group: 'run',
        verb: `hitl ${verb}`,
        summary:
          outcome === 'approved'
            ? 'Approve a waiting stage'
            : outcome === 'rejected'
              ? 'Reject a waiting stage and fail the run'
              : 'Send a waiting stage back for changes',
        requiresServer: true,
        destructive: outcome === 'rejected',
        sinceVersion: '0.2.0',
        args: [
          { name: 'run', description: 'Run reference', required: true, completes: 'run' },
          { name: 'stage', description: 'Stage reference', required: true, completes: 'stage' },
        ],
        flags: [
          { name: 'value', description: 'JSON object to hand back to the stage', type: 'string' },
          { name: 'feedback', description: 'Reviewer feedback, sent to the agent', type: 'string' },
        ],
        schema: inputSchema(
          { run: z.string(), stage: z.string() },
          {
            value: z.string().optional(),
            feedback: z.string().optional(),
          },
        ),
        output: { kind: 'record', successMessage: `Stage ${past}.` },
        async handler(ctx, { args, flags }) {
          const run = await findRun(ctx, args.run);
          const stage = await findStage(ctx, run.id, args.stage);

          // `data` is an object; a bare (non-object) value is a free-form answer.
          let data: Record<string, unknown> | undefined;
          if (flags.value !== undefined) {
            let parsed: unknown;
            try {
              parsed = JSON.parse(flags.value);
            } catch {
              parsed = flags.value;
            }
            data =
              parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? (parsed as Record<string, unknown>)
                : { freeformResponse: typeof parsed === 'string' ? parsed : JSON.stringify(parsed) };
          }

          await ctx.api.runs.command(run.id, {
            command: 'approve',
            instanceId: stage.id,
            outcome,
            ...(flags.feedback ? { feedback: flags.feedback } : {}),
            ...(data ? { data } : {}),
          });
          return record({ runId: run.id, stageId: stage.id, outcome });
        },
      }),
    ),

    defineCommand({
      id: 'run.profile.list',
      group: 'run',
      verb: 'profile list',
      summary: 'Run profiles visible from here, each checked against the RunProfile schema',
      requiresServer: false,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'name', header: 'Name', priority: 0 },
          { key: 'workflow', header: 'Workflow', priority: 1 },
          { key: 'scope', header: 'Scope', priority: 1 },
          { key: 'valid', header: 'Valid', format: 'boolean', priority: 0 },
          { key: 'description', header: 'Description', priority: 2 },
          { key: 'path', header: 'Path', priority: 3 },
        ],
      },
      async handler() {
        const rows: Array<Record<string, unknown>> = [];
        for (const [scope, dir] of [
          ['project', getRunProfilesDir()],
          ['user', getUserRunProfilesDir()],
        ] as const) {
          let files: string[];
          try {
            files = await fs.readdir(dir);
          } catch {
            // Directory does not exist — nothing to list from this scope.
            continue;
          }
          for (const file of files.filter((f) => f.endsWith('.json'))) {
            const full = path.join(dir, file);
            const base = { file: file.replace(/\.json$/, ''), scope, path: full };
            try {
              const profile = parseRunProfile(await fs.readFile(full, 'utf8'), full);
              rows.push({ ...base, name: profile.name, workflow: profile.workflow, description: profile.description, valid: true });
            } catch (error) {
              rows.push({ ...base, name: base.file, valid: false, error: error instanceof Error ? error.message : String(error) });
            }
          }
        }
        return list(rows);
      },
    }),

    defineCommand({
      id: 'run.profile.generate',
      group: 'run',
      verb: 'profile generate',
      summary: 'Write a run-profile template (RunProfile v2) for a workflow',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' },
      ],
      flags: [{ name: 'out', short: 'o', description: 'Output path', type: 'string' }],
      schema: inputSchema({ workflow: z.string() }, { out: z.string().optional() }),
      output: { kind: 'record' },
      async handler(ctx, { args, flags }): Promise<CommandResult<unknown>> {
        const definition = await findDefinition(ctx, args.workflow);
        const { graph } = await ctx.api.definitions.get(definition.id);

        // No permission mode: absent means the deployment posture decides.
        const profile: RunProfile = RunProfileSchema.parse({
          version: 2,
          name: `${graph.workflow.name} profile`.slice(0, 100),
          workflow: definition.id,
          variables: Object.fromEntries(graph.workflow.variables.map((v) => [v.name, v.defaultValue ?? ''])),
          stageOverrides: [],
        });

        if (!flags.out) return record(profile);

        const target = path.resolve(flags.out);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
        return record({ path: target }, `Wrote ${target}`);
      },
    }),

    defineCommand({
      id: 'run.profile.validate',
      group: 'run',
      verb: 'profile validate',
      summary: 'Check a run profile: its schema, then the server plan for a workflow',
      description:
        'Parses the profile with the RunProfile schema, then asks the server to plan a run from it — the same ' +
        'validation `run start` gets (variables, stage keys, codebases, models, permission ceiling).',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' },
        { name: 'profile', description: 'Profile name or path', required: true },
      ],
      flags: [{ name: 'testRun', description: 'Plan against the draft (unpublished) graph', type: 'boolean' }],
      schema: inputSchema({ workflow: z.string(), profile: z.string() }, { testRun: z.boolean().optional() }),
      output: { kind: 'record' },
      async handler(ctx, { args, flags }) {
        const { request } = await buildInvocation(ctx, args.workflow, {
          profile: args.profile,
          ...(flags.testRun ? { testRun: true } : {}),
        });
        const plan = await ctx.api.workflows.plan(request).catch((error: unknown) => {
          throw invocationError(error);
        });
        const warnings = plan.warnings.map(issueLine);
        return { data: { valid: true, warnings }, warnings, message: 'Profile is valid.' };
      },
    }),

    defineCommand({
      id: 'run.messages',
      group: 'run',
      verb: 'messages',
      summary: 'Messages recorded for a run, optionally one stage',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
      flags: [{ name: 'stage', description: 'Limit to one stage', type: 'string', completes: 'stage' }],
      schema: inputSchema({ run: z.string() }, { stage: z.string().optional() }),
      output: {
        kind: 'list',
        columns: [
          { key: 'role', header: 'Role', priority: 0 },
          { key: 'content', header: 'Content', priority: 0 },
          { key: 'timestamp', header: 'When', format: 'relative', priority: 2 },
        ],
      },
      async handler(ctx, { args, flags }) {
        const target = await findRun(ctx, args.run);
        const stages = await ctx.api.runs.stages(target.id);

        const wanted = flags.stage
          ? [await findStage(ctx, target.id, flags.stage)]
          : stages.map((s) => ({ id: s.id, name: s.name }));

        const sessionByStage = new Map(stages.map((s) => [s.id, s.sessionId]));

        const rows: Array<Record<string, unknown>> = [];
        for (const stage of wanted) {
          const sessionId = sessionByStage.get(stage.id);
          if (!sessionId) continue;
          const messages = await ctx.api.sessions.chat(sessionId);
          for (const message of messages) rows.push({ stage: stage.name, ...message });
        }
        return list(rows);
      },
    }),

    defineCommand({
      id: 'run.diff',
      group: 'run',
      verb: 'diff',
      summary: 'Unified diff of everything a run changed, per mounted codebase',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
      flags: [],
      schema: inputSchema({ run: z.string() }, {}),
      output: { kind: 'raw' },
      async handler(ctx, { args }) {
        const target = await findRun(ctx, args.run);
        const { repos } = await ctx.api.runs.workspaceDiff(target.id);
        const text = repos
          .filter((repo) => repo.files.length > 0)
          .map((repo) => {
            const body = repo.files.map((f) => f.diff ?? `${f.status} ${f.path}\n`).join('');
            return repos.length > 1 ? `# ${repo.alias}\n${body}` : body;
          })
          .join('\n');
        return record(text);
      },
    }),

    defineCommand({
      id: 'run.workspace',
      group: 'run',
      verb: 'workspace',
      summary: 'Workspace a run executed in: its root, artifacts, uploads and every mount with its files',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
      flags: [],
      schema: inputSchema({ run: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await findRun(ctx, args.run);
        return record(await ctx.api.runs.workspace(target.id));
      },
    }),
  ];
}
