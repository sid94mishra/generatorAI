// "Pull request #10 opened · feat: … → develop  [View pull request]" on a run
// whose post-processing opened one (U-22). Links to GeneratorAI's PR page (merge,
// review in chat) when the codebase resolves, else to the host.
import { Link as RouterLink } from 'react-router';
import type { RunSystemVars } from '@generatorai/shared';
import { useProjectCodebases } from '@/hooks/projectQueries.js';
import { Banner } from '@/ui/patterns/Banner/Banner.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { runPullRequests } from './runPullRequests.js';

export function RunPullRequestBanner({ projectId, systemVars }: { projectId: string | undefined; systemVars: RunSystemVars | undefined }) {
  const prs = runPullRequests(systemVars);
  const { data: codebases } = useProjectCodebases(prs.length > 0 ? projectId : undefined);
  if (prs.length === 0) return null;
  return (
    <>
      {prs.map(({ alias, pr }) => {
        const codebase = codebases?.find((c) => c.alias === alias);
        const inApp = projectId && codebase ? `/projects/${projectId}/codebases/${codebase.id}/pull-requests/${pr.number}` : null;
        return (
          <Banner
            key={pr.url}
            tone="ok"
            lead={`Pull request #${pr.number} opened`}
            detail={`${pr.title} · ${pr.head} → ${pr.base}`}
            action={
              <Button
                size="sm"
                variant="secondary"
                icon="external-link"
                data-testid="run-pull-request-link"
                render={inApp ? <RouterLink to={inApp} /> : <a href={pr.url} target="_blank" rel="noopener noreferrer" />}
              >
                View pull request
              </Button>
            }
          />
        );
      })}
    </>
  );
}
