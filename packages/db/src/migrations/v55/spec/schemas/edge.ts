// FROZEN COPY for migration v55 (README R-3, RV-33). Copied from
// packages/workflow-spec/src (P01 review fixes). Never edit: v55 converts
// legacy rows into exactly these shapes and validates them with this copy of
// the validator; the live spec package may move on.

// ────────────────────────────────────────────────────────────────
// EdgeSpec v2: edges connect stage keys, at most one edge per pair.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { ExprSchema, StageKeySchema } from './common.js';

export const EDGE_ON_VALUES = ['success', 'failure', 'completion', 'always'] as const;
export type EdgeOn = (typeof EDGE_ON_VALUES)[number];

export const EdgeSpecSchema = z
  .object({
    from: StageKeySchema.describe('Key of the source stage'),
    to: StageKeySchema.describe('Key of the target stage'),
    on: z
      .enum(EDGE_ON_VALUES)
      .default('success')
      .describe('success: source completed; failure: source failed; completion: completed or failed; always: any terminal state'),
    when: ExprSchema.optional().describe('Boolean expression; false makes the edge inactive. May read parent.status'),
    handlesFailure: z
      .boolean()
      .optional()
      .describe('Lets a completion or always edge count as handling a failure of the source'),
  })
  .strict()
  .describe('A dependency between two stages');
export type EdgeSpec = z.infer<typeof EdgeSpecSchema>;
