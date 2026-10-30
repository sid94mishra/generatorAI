// The pull requests a run's post-processing opened (U-22): the run page links
// them instead of leaving them buried in the lifecycle journal.
import type { PullRequestSummary, RunSystemVars } from '@generatorai/shared';

export interface RunPullRequest {
  alias: string;
  pr: PullRequestSummary;
}

/** Every PR a post-processing step opened or found, once per URL, in step order. */
export function runPullRequests(systemVars: RunSystemVars | undefined): RunPullRequest[] {
  const seen = new Set<string>();
  const out: RunPullRequest[] = [];
  for (const step of systemVars?.postProcessing ?? []) {
    for (const flow of step.scm ?? []) {
      const pr = flow.pullRequest;
      if (!pr || seen.has(pr.url)) continue;
      seen.add(pr.url);
      out.push({ alias: flow.alias, pr });
    }
  }
  return out;
}
