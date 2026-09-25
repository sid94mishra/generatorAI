// ────────────────────────────────────────────────────────────────
// Hints for unknown fields: renamed fields point at their replacement, and
// typos get a "did you mean" from the spec's own field vocabulary.
// ────────────────────────────────────────────────────────────────

import { WorkflowGraphSchema } from '../schemas/graph.js';
import { closest } from '../util/text.js';
import { fieldNames } from '../util/zodWalk.js';

/** Field names from earlier formats (and other tools) → where the setting lives now. */
export const RENAMED_FIELDS: Readonly<Record<string, string>> = {
  copilotConfig: 'did you mean `session`? (agent settings live in `session`)',
  harnessConfig: 'did you mean `session`?',
  harnessConfigOverrides: 'did you mean `session`? (a stage `session` is merged over the workflow `session`)',
  agentMode: 'use `session.defaultAgentMode`',
  sessionMode: 'use `sessionReuse` and `sessionGroup` on the stages',
  condition: 'use `guard` on the stage, or `when` on an edge',
  retryPolicy: 'use `retry` (maxAttempts counts the first attempt)',
  timeoutMs: 'use `timeouts.attemptMs`',
  outputFormat: 'use `output.format`',
  outputSchema: 'use `output.schema`',
  expectedOutput: 'use `output.instructions`',
  resultValidation: 'use `output.rules`',
  resultValidations: "use each stage's `output.rules`",
  contextFilter: 'use `context.mode`',
  contextSources: 'use `context.from` (stage keys)',
  approvalRequired: 'use `approval: {}`',
  orchestratorConfig: 'use `lifecycle`',
  browserConfig: 'use `session.browser`',
  mcpServers: 'use `session.mcp.servers`',
  skills: 'use `session.skills` or `session.agentOverrides.addSkillIds`',
  hooksFile: 'put workflow hooks in `workflow.hooks` and stage hooks in each stage `hooks`',
  fromStageIndex: 'edges connect stage keys: use `from`',
  toStageIndex: 'edges connect stage keys: use `to`',
  fromStageId: 'edges connect stage keys: use `from`',
  toStageId: 'edges connect stage keys: use `to`',
  edgeType: 'use `on` (success, failure, completion, always)',
  order: 'stages are ordered by their edges; array order is only display order',
  codebaseAliases: 'use `lifecycle.codebaseAliases`',
  useWorktree: 'use `lifecycle.useWorktree`',
  requiresCodebase: 'use `lifecycle.requiresCodebase`',
  preprocessingSteps: 'use `lifecycle.preprocessingSteps`',
  postProcessingSteps: 'use `lifecycle.postProcessing.steps`',
  autoCommit: 'use `lifecycle.postProcessing.autoCommit`',
  autoPush: 'use `lifecycle.postProcessing.autoPush`',
  autoCreatePR: 'use `lifecycle.postProcessing.autoCreatePR`',
  maxRetries: 'use `maxAttempts` (it counts the first attempt)',
  backoffMs: 'use `initialDelayMs`',
};

let vocabulary: Set<string> | undefined;

export function unknownFieldHint(key: string, siblings?: Iterable<string>): string | undefined {
  const renamed = RENAMED_FIELDS[key];
  if (renamed) return renamed;
  const near = siblings ? closest(key, siblings) : undefined;
  if (near) return `did you mean \`${near}\`?`;
  vocabulary ??= fieldNames(WorkflowGraphSchema);
  const far = closest(key, vocabulary);
  return far ? `did you mean \`${far}\`?` : undefined;
}
