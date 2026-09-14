// ────────────────────────────────────────────────────────────────
// AutoSourceControlRunner — the post-turn commit → push → PR hook (doc §5)
// ────────────────────────────────────────────────────────────────
//
// A chat that opted into `sourceControl.autoCommit` has the PLATFORM commit
// its change set after every completed turn, and (when enabled) push the work
// branch and open one PR. The agent is told not to run git itself, so this is
// the only thing that turns a turn into durable history.
//
// Lives outside `ChatManagementService` so it can be exercised with fakes:
// the idle handler it is called from is 200 lines of provider bookkeeping,
// and "does a blocked result still reach the transcript?" should not require
// standing up a harness to answer.
//
// Rules this enforces, all of which exist because the alternative was seen:
//   * NEVER throws. The turn is finished from the user's point of view; a git
//     hiccup must not turn a completed answer into a failed one.
//   * Mounts run SEQUENTIALLY. Two flows writing two repos at once is fine,
//     but two flows sharing one index is not, and mounts can alias the same
//     clone.
//   * One flow per workspace+alias at a time. A fast follow-up turn would
//     otherwise start a second commit on top of a half-finished first.
//   * Silence for the boring case. A mount with nothing to commit and no
//     merge in progress emits nothing; everything else — including `blocked`
//     — is emitted so the transcript can say why no PR was possible.

import type {
  AgentEvent,
  ChatSourceControlOptions,
  ILogger,
  RepoReadiness,
  ScmFlowRequest,
  ScmFlowResult,
} from '@generatorai/shared';
import { REASON_NOTHING_TO_COMMIT } from './RepoReadinessService.js';
import type { ScmMountTarget } from './workspaceMounts.js';

/** The slice of `SourceControlFlowService` this hook needs. */
export interface AutoScmFlowPort {
  run(input: {
    workspaceId?: string;
    repoDir: string;
    alias: string;
    request: ScmFlowRequest;
    context?: { chatName?: string; hint?: string };
  }): Promise<ScmFlowResult>;
}

/** The slice of `RepoReadinessService` this hook needs. */
export interface AutoScmReadinessPort {
  readiness(input: { repoDir: string; alias: string }): Promise<RepoReadiness>;
}

export interface AutoSourceControlDeps {
  flow: AutoScmFlowPort;
  readiness: AutoScmReadinessPort;
  /** Publishes on the chat's SESSION scope — the bus path the orchestrator's
   *  `chat.background_task.*` events take, so the stream and the replay log
   *  both get this for free. */
  emit: (event: AgentEvent) => Promise<void> | void;
  logger: Pick<ILogger, 'info' | 'warn'>;
}

export interface AutoSourceControlInput {
  chatId: string;
  turnId: string;
  workspaceId: string;
  chatName?: string;
  options: ChatSourceControlOptions;
  /** Git targets of the chat's workspace, primary mount first. */
  mounts: ScmMountTarget[];
  /** Seeds the generated commit message / PR text — see `buildTurnHint`. */
  hint?: string;
}

export class AutoSourceControlRunner {
  /** `workspaceId::alias` of every flow currently running. */
  private readonly inFlight = new Set<string>();

  constructor(private readonly deps: AutoSourceControlDeps) {}

  /**
   * Run the flow for every git target of one chat's workspace and emit one
   * `chat.scm.result` per target that produced something worth saying.
   *
   * Returns the results it emitted, for tests and for callers that want to
   * stamp a compact record on the turn.
   */
  async run(input: AutoSourceControlInput): Promise<ScmFlowResult[]> {
    const { options } = input;
    if (!options.autoCommit) return [];

    const emitted: ScmFlowResult[] = [];

    for (const mount of input.mounts) {
      const key = `${input.workspaceId}::${mount.alias}`;
      if (this.inFlight.has(key)) {
        this.deps.logger.warn(
          `[SCM] Auto-commit already running for ${key} — skipping this turn's run`,
        );
        continue;
      }

      this.inFlight.add(key);
      try {
        const result = await this.runOne(input, mount);
        if (!result) continue;
        emitted.push(result);
        await this.emitResult(input, mount.alias, result);
      } catch (err) {
        // `SourceControlFlowService.run` already converts its own failures
        // into `status: 'failed'`, so reaching here means readiness or the
        // event bus threw. Either way the turn stands.
        this.deps.logger.warn(
          `[SCM] Auto-commit failed for ${mount.alias}: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        this.inFlight.delete(key);
      }
    }

    return emitted;
  }

  /** One mount. Returns the result to emit, or null to stay silent. */
  private async runOne(
    input: AutoSourceControlInput,
    mount: ScmMountTarget,
  ): Promise<ScmFlowResult | null> {
    const readiness = await this.deps.readiness.readiness({
      repoDir: mount.dir,
      alias: mount.alias,
    });

    // Nothing happened here. A non-repo mount (scratch, a generated folder)
    // lands in the same branch — it has no changed files either — and neither
    // deserves a card in the transcript every turn.
    if (readiness.changedFiles === 0 && !readiness.mergeInProgress) return null;

    const { options } = input;
    const wantPush = options.autoPush === true || options.autoPullRequest === true;

    const request: ScmFlowRequest = {
      alias: mount.alias,
      commit: { generate: true },
      push: wantPush,
      ...(options.autoPullRequest
        ? {
            pullRequest: {
              generate: true,
              ...(options.base ? { base: options.base } : {}),
              ...(options.draft !== undefined ? { draft: options.draft } : {}),
            },
          }
        : {}),
      ...(input.hint ? { hint: input.hint } : {}),
    };

    const result = await this.deps.flow.run({
      workspaceId: input.workspaceId,
      repoDir: mount.dir,
      alias: mount.alias,
      request,
      context: {
        ...(input.chatName ? { chatName: input.chatName } : {}),
        ...(input.hint ? { hint: input.hint } : {}),
      },
    });

    return isSilent(result) ? null : result;
  }

  private async emitResult(
    input: AutoSourceControlInput,
    alias: string,
    result: ScmFlowResult,
  ): Promise<void> {
    await this.deps.emit({
      kind: 'chat.scm.result',
      data: { chatId: input.chatId, turnId: input.turnId, alias, result },
    } as AgentEvent);
  }
}

/**
 * True when the result says only "there was nothing to commit".
 *
 * That is the one outcome the user does not need told: they watched a turn
 * that changed no files. Every other blocked reason — not a repo, host not
 * connected, detached HEAD — is exactly what the transcript has to explain,
 * because it is the answer to "why is there no PR?".
 */
export function isSilent(result: ScmFlowResult): boolean {
  if (result.status === 'blocked') {
    return result.steps.every(
      (step) => step.status !== 'blocked' || step.detail === REASON_NOTHING_TO_COMMIT,
    );
  }
  if (result.status !== 'ok') return false;
  // An `ok` run that committed / pushed / opened nothing, because the commit
  // step found a clean tree. The merge-in-progress path never gets here (it
  // has unmerged files, so the flow reports conflicts or commits the merge).
  if (result.commit || result.pushed || result.pullRequest || result.branch) return false;
  return result.steps.some(
    (step) => step.id === 'commit' && step.status === 'skipped' && step.detail === REASON_NOTHING_TO_COMMIT,
  );
}
