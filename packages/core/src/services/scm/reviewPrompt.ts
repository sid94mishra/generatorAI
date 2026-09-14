// ────────────────────────────────────────────────────────────────
// buildPullRequestReviewPrompt — the "Review in chat" turn (doc §6)
// ────────────────────────────────────────────────────────────────
//
// Seeds a chat whose workspace is the PR's head branch, so the agent can read
// the surrounding repository rather than judging a diff in isolation. The
// output format is fixed so the transcript renders consistently and the
// verdict is machine-readable.

import type { PullRequestDetail, PullRequestFile } from '@generatorai/shared';
import { capDiffExcerpt } from './ScmTextGenerator.js';

export interface PullRequestReviewPromptInput {
  pr: PullRequestDetail;
  files: PullRequestFile[];
  instructions?: string;
}

/** Total characters of patch text handed to the model. */
const PATCH_BUDGET = 40_000;

function fileBlock(file: PullRequestFile): string {
  const rename = file.previousPath ? ` (renamed from ${file.previousPath})` : '';
  const header =
    `diff --git a/${file.previousPath ?? file.path} b/${file.path}\n` +
    `# ${file.status}${rename} — +${file.additions}/-${file.deletions}`;
  const patch = file.patch?.trim();
  return patch ? `${header}\n${patch}` : `${header}\n# (no patch available — binary or too large)`;
}

export function buildPullRequestReviewPrompt(input: PullRequestReviewPromptInput): string {
  const { pr, files } = input;

  const patches = capDiffExcerpt(files.map(fileBlock).join('\n'), PATCH_BUDGET);

  const parts: string[] = [
    'You are a senior engineer reviewing a pull request. Review it as carefully as you would review a change you will have to maintain.',
    '',
    '## Pull request',
    '',
    `- **#${pr.number}** — ${pr.title}`,
    `- Author: ${pr.author ?? 'unknown'}`,
    `- Branches: \`${pr.base}\` ← \`${pr.head}\``,
    `- Changes: ${pr.changedFiles} file(s), +${pr.additions}/-${pr.deletions} over ${pr.commits} commit(s)`,
    `- URL: ${pr.url}`,
    '',
    '### Description',
    '',
    pr.body?.trim() ? pr.body.trim() : '_(the author left no description)_',
    '',
    '## Changed files',
    '',
    files.length > 0
      ? files
          .map(
            (f) =>
              `- \`${f.path}\`${f.previousPath ? ` (was \`${f.previousPath}\`)` : ''} — ${f.status}, +${f.additions}/-${f.deletions}`,
          )
          .join('\n')
      : '_(no files reported)_',
    '',
    '## Diff',
    '',
    '```diff',
    patches,
    '```',
    '',
    '## How to review',
    '',
    'Read the repository around the diff before judging it — open the files that are changed, the callers of anything whose signature moved, and the tests that cover them. A diff that looks wrong in isolation is often fine in context, and a diff that looks fine in isolation is often wrong in context.',
    '',
    'Cover every one of these dimensions:',
    '',
    '1. **Correctness and edge cases** — off-by-one, null/undefined, empty collections, the error path, what happens on the second call.',
    '2. **Security** — injection (SQL, shell, template), authentication and authorization gaps, secrets in code or logs, path traversal, SSRF, unsafe deserialization.',
    '3. **Error handling and resource cleanup** — swallowed errors, missing `finally`, leaked handles, timers, sockets, child processes, transactions.',
    '4. **Concurrency** — races, unawaited promises, shared mutable state, re-entrancy, ordering assumptions.',
    '5. **Tests** — what is NOT covered that should be; name the specific case.',
    '6. **Performance** — work inside loops, N+1 calls, unbounded buffers, needless copies on hot paths.',
    '7. **API and contract compatibility** — breaking changes to exported types, routes, payloads, persisted shapes or defaults.',
    '8. **Readability and consistency** — does this match how the surrounding code already does it?',
    '',
    'Do not invent problems; if the diff is fine, say so.',
    '',
    '## Output format',
    '',
    'List findings as:',
    '',
    '- **[severity]** `path:line` — <what is wrong> → <the fix>',
    '',
    'Order them severity-descending, using exactly these severities: `blocker`, `major`, `minor`, `nit`.',
    '',
    'Finish with a `## Verdict` heading followed by one line that is exactly one of `approve`, `approve with comments`, or `request changes`, plus a one-sentence rationale.',
  ];

  if (input.instructions && input.instructions.trim()) {
    parts.push('', '## Extra instructions from the reviewer', '', input.instructions.trim());
  }

  return parts.join('\n');
}
