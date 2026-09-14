// ────────────────────────────────────────────────────────────────
// ScmTextGenerator — commit messages and PR title/body
// ────────────────────────────────────────────────────────────────
//
// The ONE place a model is used in the source-control flow (doc §1.2): it
// writes text, it never runs git. The conversation is ephemeral, tool-less,
// single-turn and in the most restricted permission mode, and it is deleted
// in a `finally` so a failed generation never leaks a session.
//
// Every path degrades: no model configured, a harness that throws, or a reply
// that cannot be parsed all fall back to deterministic heuristic text.

import type { ILogger } from '@generatorai/shared';
import type { IAgentHarness } from '../../domain/ports/IAgentHarness.js';
import { extractSummaryLine } from './turnHint.js';

export interface ScmTextGeneratorDeps {
  harness: IAgentHarness;
  logger: ILogger;
  /** Live model selection from settings. */
  generation: () => { provider: string | null; model: string | null };
}

export interface CommitTextResult {
  message: string;
  model?: string;
  source: 'model' | 'heuristic';
}

export interface PullRequestTextResult {
  title: string;
  body: string;
  model?: string;
  source: 'model' | 'heuristic';
}

export interface CommitPromptInput {
  repoDir: string;
  hint?: string;
  files: string[];
  diffExcerpt: string;
}

export interface PullRequestPromptInput {
  repoDir: string;
  base: string;
  hint?: string;
  commits: string[];
  files: string[];
  diffExcerpt: string;
  template?: string;
}

const COMMIT_ROLE =
  'You write git commit messages for a senior engineering team. You reply with the commit message and nothing else.';

const PR_ROLE =
  'You write pull-request descriptions for a senior engineering team. You reply in the exact format you are asked for and nothing else.';

const GENERATION_TIMEOUT_MS = 60_000;

const TRUNCATION_MARKER = '\n… (truncated)\n';

const DEFAULT_DIFF_CAP = 12_000;

/** Smallest slice of the budget a single file may get, so headers survive. */
const MIN_PER_FILE = 400;

// ────────────────────────────────────────────────────────────────
// Pure helpers (exported for unit tests and for callers building inputs)
// ────────────────────────────────────────────────────────────────

/**
 * Trim a unified diff to at most `max` characters by giving every file an
 * equal share of the budget, so a single huge file cannot crowd out the rest.
 * Files beyond what the budget can hold are reported as a count.
 */
export function capDiffExcerpt(diff: string, max = DEFAULT_DIFF_CAP): string {
  if (!diff) return '';
  if (diff.length <= max) return diff;
  if (max <= 0) return '';

  const chunks = diff.split('\ndiff --git ');
  const sections = chunks.map((chunk, i) => (i === 0 ? chunk : `diff --git ${chunk}`));

  const maxFiles = Math.max(1, Math.floor(max / MIN_PER_FILE));
  const kept = sections.slice(0, maxFiles);
  const omitted = sections.length - kept.length;
  const suffix = omitted > 0 ? `\n… (${omitted} more file${omitted === 1 ? '' : 's'} omitted)` : '';

  // Budget left for the sections themselves, minus the newlines joining them.
  const budget = Math.max(1, max - suffix.length - (kept.length - 1));
  const perFile = Math.max(1, Math.floor(budget / kept.length));

  const pieces = kept.map((section) => {
    if (section.length <= perFile) return section;
    const head = Math.max(0, perFile - TRUNCATION_MARKER.length);
    return `${section.slice(0, head)}${TRUNCATION_MARKER}`;
  });

  return `${pieces.join('\n')}${suffix}`.slice(0, max);
}

function fileList(files: string[], cap = 60): string {
  if (files.length === 0) return '(no files)';
  const shown = files.slice(0, cap).map((f) => `- ${f}`);
  if (files.length > cap) shown.push(`- … and ${files.length - cap} more`);
  return shown.join('\n');
}

/**
 * The one line of a hint that actually describes the change.
 *
 * Agent-native mode (doc §5) hands us the whole turn — the user's prompt plus
 * the assistant's closing prose — and asks the agent to end that prose with a
 * `Summary:` line written for exactly this purpose. When the hint carries one,
 * it wins: it is a deliberate one-sentence description, where the surrounding
 * transcript is chatter that pulls the generated message off-target.
 */
export function narrowHint(hint: string | undefined): string | undefined {
  if (!hint) return undefined;
  const trimmed = hint.trim();
  if (!trimmed) return undefined;
  return extractSummaryLine(trimmed) ?? trimmed;
}

export function buildCommitPrompt(input: CommitPromptInput): string {
  const parts: string[] = [
    'Write a git commit message for the change below.',
    '',
    'Rules:',
    '- Use Conventional Commits: `type(scope): summary` (feat, fix, refactor, docs, test, chore, perf, build, ci).',
    '- The subject line is at most 50 characters, in the imperative mood, with no trailing period.',
    '- Then a blank line, then 1 to 5 concise `- ` bullets explaining WHY the change was made, not restating the diff.',
    '- Do not invent testing that was not performed.',
  ];
  const commitHint = narrowHint(input.hint);
  if (commitHint) {
    parts.push('', `The author described the task as: ${commitHint}`);
  }
  parts.push('', 'Files changed:', fileList(input.files));
  if (input.diffExcerpt) {
    parts.push('', 'Diff (may be truncated):', '```diff', input.diffExcerpt, '```');
  }
  parts.push('', 'Reply with the commit message only — no code fences, no preamble.');
  return parts.join('\n');
}

export function buildPullRequestPrompt(input: PullRequestPromptInput): string {
  const parts: string[] = [
    `Write a pull-request title and description for the change below. The PR targets the \`${input.base}\` branch.`,
    '',
  ];

  const prHint = narrowHint(input.hint);
  if (prHint) {
    parts.push(`The author described the task as: ${prHint}`, '');
  }

  if (input.commits.length > 0) {
    parts.push('Commits on this branch:', input.commits.map((c) => `- ${c}`).join('\n'), '');
  }

  parts.push('Files changed:', fileList(input.files), '');

  if (input.diffExcerpt) {
    parts.push('Diff (may be truncated):', '```diff', input.diffExcerpt, '```', '');
  }

  if (input.template && input.template.trim()) {
    parts.push(
      'The repository has a pull-request template. Fill in its sections verbatim: keep every heading exactly as written, remove HTML comments and placeholder instructions, and leave out nothing.',
      '',
      'Template:',
      '---',
      input.template.trim(),
      '---',
      '',
    );
  } else {
    parts.push(
      'Structure the description as a `## Summary` section with 2 to 5 bullets, then a `## Test plan` section.',
      '',
    );
  }

  parts.push(
    'Do not invent testing that was not performed — if you cannot tell what was tested, write `- Not verified`.',
    '',
    'Output format — the first line must be exactly:',
    'TITLE: <one-line PR title, imperative, no trailing period>',
    '',
    'then a blank line, then the body in markdown. No code fences around the whole reply, no preamble.',
  );
  return parts.join('\n');
}

/** Remove a wrapping ```lang … ``` fence, when the whole reply is one fence. */
function stripFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const lines = trimmed.split('\n');
  const firstLine = lines[0] ?? '';
  if (!/^```[A-Za-z0-9_-]*\s*$/.test(firstLine)) return trimmed;
  // Find the closing fence (last line that is only backticks).
  for (let i = lines.length - 1; i > 0; i--) {
    if (/^```\s*$/.test(lines[i] ?? '')) {
      return lines.slice(1, i).join('\n').trim();
    }
  }
  return trimmed;
}

export function parseCommitReply(raw: string): string {
  let text = stripFence(raw ?? '');
  // Some models prefix a label line before the message itself.
  const lines = text.split('\n');
  const first = (lines[0] ?? '').trim();
  if (/^\*{0,2}commit message:?\*{0,2}\s*$/i.test(first)) {
    text = lines.slice(1).join('\n').trim();
  } else {
    const inline = first.match(/^\*{0,2}commit message:\*{0,2}\s*(.+)$/i);
    if (inline?.[1]) {
      text = [inline[1].trim(), ...lines.slice(1)].join('\n').trim();
    }
  }
  return text.trim();
}

export function parsePullRequestReply(raw: string): { title: string; body: string } | null {
  const text = stripFence(raw ?? '');
  if (!text) return null;

  // JSON form: { "title": …, "body": … }
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as { title?: unknown; body?: unknown };
      if (typeof parsed.title === 'string' && parsed.title.trim()) {
        return {
          title: parsed.title.trim(),
          body: typeof parsed.body === 'string' ? parsed.body.trim() : '',
        };
      }
    } catch {
      // Fall through to the TITLE: form.
    }
  }

  const lines = text.split('\n');
  const first = (lines[0] ?? '').trim();
  const match = first.match(/^\*{0,2}title:\*{0,2}\s*(.+)$/i);
  if (!match?.[1]) return null;
  const title = match[1].trim().replace(/\*{2,}$/, '').trim();
  if (!title) return null;
  return { title, body: lines.slice(1).join('\n').trim() };
}

/** Up to 3 distinct `a/b` (or `a`) prefixes across the changed files. */
function topDirs(files: string[]): string {
  const seen: string[] = [];
  for (const file of files) {
    const segments = file.split('/').filter(Boolean);
    let key: string;
    if (segments.length >= 3) key = `${segments[0]}/${segments[1]}`;
    else if (segments.length === 2) key = segments[0] ?? '';
    else key = 'the repo root';
    if (key && !seen.includes(key)) seen.push(key);
    if (seen.length === 3) break;
  }
  return seen.length > 0 ? seen.join(', ') : 'the repo root';
}

function heuristicSubject(files: string[], hint?: string): string {
  // Same narrowing as the model path: a turn-sized hint would otherwise put
  // the whole conversation on the subject line.
  const narrowed = narrowHint(hint);
  if (narrowed) {
    const trimmed = narrowed.replace(/\s+/g, ' ');
    return trimmed.length > 72 ? `${trimmed.slice(0, 71)}…` : trimmed;
  }
  const n = files.length;
  return `Update ${n} file${n === 1 ? '' : 's'} in ${topDirs(files)}`;
}

export function heuristicCommitMessage(files: string[], hint?: string): string {
  const subject = heuristicSubject(files, hint);
  const shown = files.slice(0, 20).map((f) => `- ${f}`);
  if (files.length > 20) shown.push(`- … and ${files.length - 20} more`);
  const body = shown.length > 0 ? shown.join('\n') : '- (no files)';
  return `${subject}\n\n${body}`;
}

export function heuristicPullRequestText(
  files: string[],
  commits: string[],
  hint?: string,
  template?: string,
): { title: string; body: string } {
  const subject = heuristicSubject(files, hint);
  const summary = narrowHint(hint) ?? subject;
  const extra = commits.slice(0, 5).map((c) => `- ${c}`);
  const summaryBullets = [`- ${summary}`, ...extra.filter((b) => b !== `- ${summary}`)].join('\n');
  const headings = (template ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^#{1,3}\s+\S/.test(l));
  if (headings.length > 0) {
    // Honour the repository's PR template: keep its headings, fill what we
    // know (summary under the first, test plan under a test-ish heading).
    const sections = headings.map((h, i) => {
      const content = i === 0 ? summaryBullets : /test|verif|check/i.test(h) ? '- Not verified' : '';
      return content ? `${h}\n\n${content}` : h;
    });
    return { title: subject, body: sections.join('\n\n') };
  }
  return {
    title: subject,
    body: `## Summary\n\n${summaryBullets}\n\n## Test plan\n\n- Not verified`,
  };
}

// ────────────────────────────────────────────────────────────────

export class ScmTextGenerator {
  constructor(private readonly deps: ScmTextGeneratorDeps) {}

  async generateCommitMessage(input: CommitPromptInput): Promise<CommitTextResult> {
    const gen = this.deps.generation();
    if (!gen.model) {
      return { message: heuristicCommitMessage(input.files, input.hint), source: 'heuristic' };
    }
    try {
      const raw = await this.ask(COMMIT_ROLE, buildCommitPrompt(input), input.repoDir, gen);
      const message = parseCommitReply(raw);
      if (message) return { message, model: gen.model, source: 'model' };
      this.deps.logger.warn('[SCM] The model returned an empty commit message — using heuristic text');
    } catch (err) {
      this.deps.logger.warn(
        `[SCM] Commit-message generation failed, using heuristic text: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { message: heuristicCommitMessage(input.files, input.hint), source: 'heuristic' };
  }

  async generatePullRequestText(input: PullRequestPromptInput): Promise<PullRequestTextResult> {
    const gen = this.deps.generation();
    if (!gen.model) {
      const fallback = heuristicPullRequestText(input.files, input.commits, input.hint, input.template);
      return { ...fallback, source: 'heuristic' };
    }
    try {
      const raw = await this.ask(PR_ROLE, buildPullRequestPrompt(input), input.repoDir, gen);
      const parsed = parsePullRequestReply(raw);
      if (parsed) return { ...parsed, model: gen.model, source: 'model' };
      this.deps.logger.warn('[SCM] Could not parse the PR text reply — using heuristic text');
    } catch (err) {
      this.deps.logger.warn(
        `[SCM] PR-text generation failed, using heuristic text: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const fallback = heuristicPullRequestText(input.files, input.commits, input.hint, input.template);
    return { ...fallback, source: 'heuristic' };
  }

  /**
   * One ephemeral, tool-less, single-turn conversation. Always deleted, even
   * when creation or the prompt throws.
   */
  private async ask(
    role: string,
    prompt: string,
    repoDir: string,
    gen: { provider: string | null; model: string | null },
  ): Promise<string> {
    const conversationId = `scm-text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await this.deps.harness.createConversation({
        conversationId,
        model: gen.model ?? undefined,
        harnessType: gen.provider ?? undefined,
        workingDirectory: repoDir,
        streaming: false,
        permissionMode: 'plan',
        availableTools: [],
        excludedTools: ['*'],
        maxTurns: 1,
        systemMessage: { mode: 'append', content: role },
      });
      const response = await this.deps.harness.sendPromptAndWait(
        conversationId,
        prompt,
        undefined,
        AbortSignal.timeout(GENERATION_TIMEOUT_MS),
      );
      return response?.content ?? '';
    } finally {
      try {
        await this.deps.harness.deleteConversation(conversationId);
      } catch {
        // The conversation is ephemeral; a failed cleanup must not fail the call.
      }
    }
  }
}
