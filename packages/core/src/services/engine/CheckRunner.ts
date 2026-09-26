// ────────────────────────────────────────────────────────────────
// CheckRunner — one attempt of a `check` stage (P05 §1.2): one
// deterministic command, no LLM.
//
// The StageExecutor claims the instance (`ready → starting`, lease) and owns
// the frame; this runs the command inside it:
//   starting → running → (the command) → validating → succeeded
// and returns the attempt outcome. The output is
//   { exitCode, passed, timedOut, stdoutTail, stderrTail, durationMs, json?, jsonError? }
//
// Semantics:
//   - a LAUNCH failure fails the stage with `check_launch_failed`: not on the
//     allow-list, not found, ENOENT/EINVAL, a policy refusal, the run in
//     `plan` mode (the command runs repository code: the capability `shell`).
//     It never yields `passed: false`, so a loop waiting for a pass cannot spin
//     on a broken command. Only a spawn EAGAIN/EBUSY is transient;
//   - a non-zero exit or a timeout completes with `passed: false`, or fails
//     with `check_failed` under `failOnNonZero`;
//   - NO_COLOR=1 / FORCE_COLOR=0 are set and ANSI escapes stripped from the tails;
//   - `env` is the only templated field (context T of its enclosing loops);
//     args are literals (the validator refuses a template there);
//   - the command runs in the mount (`check.mount`, else the primary mount),
//     `cwd` inside it, with a child environment built by `buildChildEnv`.
// ────────────────────────────────────────────────────────────────

import * as path from 'node:path';
import { renderTemplate, type CheckStage } from '@generatorai/workflow-spec';
import type { WorkflowRun } from '@generatorai/shared';
import { StageError, classified } from '../../domain/errors/StageError.js';
import type { IScriptRunner } from '../../domain/ports/IScriptRunner.js';
import type { AttemptOutcome } from '../../domain/scheduler/types.js';

export interface CheckOutput {
  exitCode: number;
  passed: boolean;
  timedOut: boolean;
  stdoutTail: string;
  stderrTail: string;
  durationMs: number;
  json?: unknown;
  jsonError?: string;
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/** The last `bytes` of a text (UTF-16 units approximate bytes closely enough for a tail). */
function tail(text: string, bytes: number): string {
  const clean = stripAnsi(text);
  return clean.length <= bytes ? clean : `…${clean.slice(clean.length - bytes)}`;
}

const TRANSIENT_SPAWN = new Set(['EAGAIN', 'EBUSY']);

export interface CheckRunInput {
  stage: CheckStage;
  run: Pick<WorkflowRun, 'permissionMode' | 'systemVars'>;
  /** The run's primary working directory (used when the check names no mount). */
  primaryDir: string;
  /** The template scope (context T of the enclosing loops). */
  scope: Record<string, unknown>;
  scriptRunner: IScriptRunner | undefined;
  signal: AbortSignal;
}

/** The directory a check runs in: its mount (or the primary one), then `cwd` inside it. */
export function checkWorkDir(input: Pick<CheckRunInput, 'stage' | 'run' | 'primaryDir'>): { root: string; cwd: string } {
  const { check } = input.stage;
  const codebases = (input.run.systemVars?.codebases ?? {}) as Record<string, { path?: string } | undefined>;
  let root = input.primaryDir;
  if (check.mount !== undefined) {
    const mount = codebases[check.mount]?.path;
    if (!mount) throw new StageError('check_launch_failed', `The run has no mount '${check.mount}'`);
    root = mount;
  }
  const cwd = check.cwd ? path.resolve(root, check.cwd) : root;
  const rel = path.relative(path.resolve(root), cwd);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new StageError('check_launch_failed', `cwd '${check.cwd}' is outside the mount`);
  return { root, cwd };
}

/** Run the command; returns the attempt outcome (never throws for a command result). */
export async function runCheck(input: CheckRunInput): Promise<AttemptOutcome> {
  const { stage, scriptRunner } = input;
  const check = stage.check;
  if (input.run.permissionMode === 'plan') {
    return fail('check_launch_failed', 'A check runs repository code, which a run in plan mode may not do');
  }
  if (!scriptRunner) return fail('check_launch_failed', 'No script runner is configured on this server');

  let dirs: { root: string; cwd: string };
  try {
    dirs = checkWorkDir(input);
  } catch (err) {
    return fail('check_launch_failed', (err as Error).message);
  }

  const env: Record<string, string> = { NO_COLOR: '1', FORCE_COLOR: '0' };
  for (const [name, text] of Object.entries(check.env ?? {})) {
    const r = renderTemplate(text, input.scope);
    env[name] = r.ok ? r.text : text;
  }

  let result;
  try {
    result = await scriptRunner.run(check.command, check.args, {
      cwd: dirs.cwd,
      env,
      timeout: check.timeoutMs,
      abortSignal: input.signal,
      confineTo: dirs.root,
      keepTail: true,
    });
  } catch (err) {
    // The runner's policy refused the command line before anything was spawned.
    return fail('check_launch_failed', `The command was refused: ${(err as Error).message}`);
  }
  if (result.launchError !== undefined) {
    if (TRANSIENT_SPAWN.has(result.launchError)) {
      return { kind: 'failed', error: classified('transport', `The command could not start yet (${result.launchError})`) };
    }
    return fail('check_launch_failed', `The command could not start (${result.launchError}): ${result.stderr}`);
  }
  if (input.signal.aborted) return { kind: 'aborted', reason: 'cancel' };

  const timedOut = result.timedOut === true;
  const passed = !timedOut && result.exitCode === 0;
  const output: CheckOutput = {
    exitCode: result.exitCode,
    passed,
    timedOut,
    stdoutTail: tail(result.stdout, check.tailBytes),
    stderrTail: tail(result.stderr, check.tailBytes),
    durationMs: result.durationMs,
  };
  if (check.parseJson) {
    try {
      output.json = JSON.parse(stripAnsi(result.stdout));
    } catch (err) {
      output.jsonError = (err as Error).message;
    }
  }
  if (!passed && check.failOnNonZero) {
    const why = timedOut ? `timed out after ${check.timeoutMs} ms` : `exited with ${result.exitCode}`;
    return fail('check_failed', `${check.command} ${why}: ${output.stderrTail.slice(-500) || output.stdoutTail.slice(-500)}`);
  }
  return {
    kind: 'succeeded',
    output: {
      data: output,
      text: output.stdoutTail,
      summary: `${check.command} ${passed ? 'passed' : timedOut ? 'timed out' : `exited with ${result.exitCode}`} in ${result.durationMs} ms`,
    },
  };
}

function fail(code: 'check_launch_failed' | 'check_failed', message: string): AttemptOutcome {
  return { kind: 'failed', error: classified(code, message) };
}
