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
//     args are literals (the validator refuses a template there). A
//     `secretref:workflow/<name>` env value is resolved through the vault;
//     an unresolved pointer or a failed render is `check_launch_failed`
//     (never passed on verbatim), and the secret values are masked in the
//     output (final review PLATFORM R2 / LOOP R11);
//   - the command runs in the mount (`check.mount`, else the primary mount),
//     `cwd` inside it, with a child environment built by `buildChildEnv`;
//   - while it runs, its output goes to `onOutput` in whole lines (redacted,
//     ANSI stripped) so the run page can show it live — the tails above are
//     only known when it ends.
// ────────────────────────────────────────────────────────────────

import * as path from 'node:path';
import { renderTemplate, type CheckStage } from '@generatorai/workflow-spec';
import type { WorkflowRun } from '@generatorai/shared';
import { StageError, classified } from '../../domain/errors/StageError.js';
import type { IScriptRunner } from '../../domain/ports/IScriptRunner.js';
import type { WorkflowSecretResolver } from '../../mcp/McpCredentialVault.js';
import { redactSecrets, resolveSecretMap } from '../../mcp/workflowSecrets.js';
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
  /** A check stage, or a map's itemSetup entry (only `check` is read). */
  stage: Pick<CheckStage, 'check'>;
  run: Pick<WorkflowRun, 'permissionMode' | 'systemVars'>;
  /** The run's primary working directory (used when the check names no mount). */
  primaryDir: string;
  /** The template scope (context T of the enclosing loops). */
  scope: Record<string, unknown>;
  scriptRunner: IScriptRunner | undefined;
  /** Resolves `secretref:workflow/<name>` env values; without it such a check cannot launch. */
  secrets?: WorkflowSecretResolver | undefined;
  /** The command's output while it runs: whole lines, redacted, ANSI stripped. */
  onOutput?: ((text: string) => void) | undefined;
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
    return fail('check_launch_failed', 'A command stage runs repository code, which a run in plan mode may not do');
  }
  if (!scriptRunner) return fail('check_launch_failed', 'No script runner is configured on this server');

  let dirs: { root: string; cwd: string };
  try {
    dirs = checkWorkDir(input);
  } catch (err) {
    return fail('check_launch_failed', (err as Error).message);
  }

  const resolved = await resolveSecretMap(check.env, input.secrets, 'check.env', (text) => {
    const r = renderTemplate(text, input.scope);
    return r.ok ? r : { ok: false, error: r.error.message };
  });
  if (!resolved.ok) return fail('check_launch_failed', resolved.error);
  // A check never has a TTY: CI=1 makes tools take their non-interactive path instead of
  // aborting on a prompt (pnpm's "Aborted removal of modules directory due to no TTY", U-17).
  // The check's own env wins.
  const env: Record<string, string> = { CI: 'true', NO_COLOR: '1', FORCE_COLOR: '0', ...resolved.values };
  const redact = (text: string) => redactSecrets(text, resolved.secrets);
  // Whole lines only: a secret split across two chunks would otherwise slip past the redaction.
  const lines = input.onOutput ? lineBuffer((text) => input.onOutput?.(stripAnsi(redact(text)))) : undefined;

  let result;
  try {
    result = await scriptRunner.run(check.command, check.args, {
      cwd: dirs.cwd,
      env,
      timeout: check.timeoutMs,
      abortSignal: input.signal,
      confineTo: dirs.root,
      // Past the output cap a check keeps the end (its tails) — but `parseJson` needs the start of the document (LOOP-R12).
      keepTail: !check.parseJson,
      ...(lines ? { streamTo: (chunk: string) => lines.push(chunk) } : {}),
    });
  } catch (err) {
    // The runner's policy refused the command line before anything was spawned.
    return fail('check_launch_failed', `The command was refused: ${(err as Error).message}`);
  } finally {
    lines?.end();
  }
  if (result.launchError !== undefined) {
    if (TRANSIENT_SPAWN.has(result.launchError)) {
      return { kind: 'failed', error: classified('transport', `The command could not start yet (${result.launchError})`) };
    }
    return fail('check_launch_failed', `The command could not start (${result.launchError}): ${redact(result.stderr)}`);
  }
  if (input.signal.aborted) return { kind: 'aborted', reason: 'cancel' };

  const timedOut = result.timedOut === true;
  const passed = !timedOut && result.exitCode === 0;
  const output: CheckOutput = {
    exitCode: result.exitCode,
    passed,
    timedOut,
    stdoutTail: tail(redact(result.stdout), check.tailBytes),
    stderrTail: tail(redact(result.stderr), check.tailBytes),
    durationMs: result.durationMs,
  };
  if (check.parseJson) {
    try {
      output.json = JSON.parse(stripAnsi(redact(result.stdout)));
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

/**
 * A running check's output in batches for the live view: at most one `send` per `everyMs`, never two in flight (the
 * batches arrive in order). Past `maxChars` a batch keeps its end — the live view shows the newest lines. `end` sends
 * the rest and resolves once everything has been sent, so the last lines land before the stage's outcome.
 */
export function outputBatches(
  send: (text: string) => Promise<unknown>,
  everyMs = 300,
  maxChars = 16_000,
): { push: (text: string) => void; end: () => Promise<void> } {
  let held = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  const flush = () => {
    timer = undefined;
    if (!held) return;
    const text = held.length > maxChars ? held.slice(-maxChars) : held;
    held = '';
    chain = chain.then(() => send(text));
  };
  return {
    push: (text) => {
      held += text;
      timer ??= setTimeout(flush, everyMs);
    },
    end: () => {
      if (timer) clearTimeout(timer);
      flush();
      return chain.then(() => undefined);
    },
  };
}

/** Hands on complete lines only; `end` hands on the rest. A line longer than `maxLine` is cut rather than held. */
function lineBuffer(emit: (text: string) => void, maxLine = 4_000): { push(chunk: string): void; end(): void } {
  let held = '';
  return {
    push(chunk) {
      held += chunk;
      const cut = held.lastIndexOf('\n');
      if (cut >= 0) {
        emit(held.slice(0, cut + 1));
        held = held.slice(cut + 1);
      } else if (held.length > maxLine) {
        emit(held);
        held = '';
      }
    },
    end() {
      if (held) emit(held);
      held = '';
    },
  };
}

function fail(code: 'check_launch_failed' | 'check_failed', message: string): AttemptOutcome {
  return { kind: 'failed', error: classified(code, message) };
}
