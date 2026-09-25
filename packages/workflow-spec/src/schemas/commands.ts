// ────────────────────────────────────────────────────────────────
// Run commands (P03 WP-3.6): the operator actions on a run or on one
// instance. One discriminated union behind one route; later phases add
// members (P05: grant_iterations, raise_budget, continue_with_input,
// accept, accept_iteration, deliver_event) without new routes.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';

const target = {
  instanceId: z.string().min(1).max(200).optional().describe('Stage instance the command targets; omitted means the run'),
  expectedVersion: z.number().int().min(0).optional().describe('Optimistic-concurrency version; a stale one returns 409'),
};

export const RunCommandSchema = z
  .discriminatedUnion('command', [
    z
      .object({
        command: z.literal('pause').describe('Pause the run or an instance'),
        ...target,
        mode: z
          .enum(['drain', 'interrupt'])
          .default('drain')
          .describe('drain stops new launches; interrupt also pauses in-flight instances'),
      })
      .strict()
      .describe('Pause'),
    z.object({ command: z.literal('resume').describe('Resume a paused run or instance'), ...target }).strict().describe('Resume'),
    z.object({ command: z.literal('cancel').describe('Cancel the run or an instance'), ...target }).strict().describe('Cancel'),
    z
      .object({
        command: z.literal('retry').describe('Start a new attempt of a paused instance'),
        ...target,
        mode: z.enum(['resume', 'restart']).default('resume').describe('Continue the conversation or restart from the first prompt'),
      })
      .strict()
      .describe('Retry'),
    z
      .object({
        command: z.literal('skip').describe('Skip a paused instance'),
        ...target,
        as: z
          .enum(['completed', 'skipped'])
          .default('skipped')
          .describe('completed lets on-success successors run; skipped is neutral to joins'),
        output: z.unknown().optional().describe('Output to record when skipping as completed; validated against the output schema'),
      })
      .strict()
      .describe('Skip'),
    z.object({ command: z.literal('fail').describe('Fail a paused instance'), ...target }).strict().describe('Fail'),
    z
      .object({
        command: z.literal('approve').describe('Resolve a pending approval'),
        ...target,
        outcome: z.enum(['approved', 'rejected', 'changes_requested']).describe('The decision'),
        feedback: z.string().max(20_000).optional().describe('Reviewer feedback, sent to the stage on changes_requested'),
        data: z.record(z.unknown()).optional().describe('Structured reviewer input'),
      })
      .strict()
      .describe('Approve'),
  ])
  .describe('An operator command on a run');
export type RunCommand = z.infer<typeof RunCommandSchema>;

/**
 * `forkRun` (P03 WP-3.8, G5 §3.8): re-run a terminal run as a NEW run. A
 * terminal run is never mutated. Instances not downstream of any `rerunFrom`
 * path are memoized (copied as completed, never re-validated).
 */
export const ForkRunRequestSchema = z
  .object({
    rerunFrom: z
      .array(z.string().min(1).max(500))
      .max(200)
      .optional()
      .describe('Instance paths to run again with everything downstream; omitted means every instance that did not complete'),
    definition: z
      .enum(['pinned', 'latest'])
      .default('pinned')
      .describe("pinned keeps the source run's definition version; latest runs the current published version"),
    variablesOverride: z.record(z.unknown()).optional().describe('Variables merged over the source run variables'),
    workspace: z
      .enum(['restore_checkpoint', 'reuse', 'fresh'])
      .default('fresh')
      .describe('fresh provisions a new workspace; reuse runs in the source workspace; restore_checkpoint reuses it rolled back to the checkpoint before the earliest re-run instance'),
    idempotencyKey: z.string().min(1).max(200).optional().describe('A repeated key returns the fork it already created'),
    start: z.boolean().default(true).describe('Start the fork immediately'),
  })
  .strict()
  .describe('Fork a terminal run');
export type ForkRunRequest = z.input<typeof ForkRunRequestSchema>;
export type ForkRunOptions = z.output<typeof ForkRunRequestSchema>;
