// ────────────────────────────────────────────────────────────────
// useShipFlow — the commit / push / pull-request dialog's data and form
// state (D-163).
//
// Readiness (`GET /scm/readiness`) decides what is offered; the PR parts load
// only while a pull request is being written: the remote's branches (the base
// picker), "Comparing changes" for the chosen base, and the sidebar's people /
// labels / issues. One primary action runs the whole flow (`POST /scm/flow`)
// and keeps the server's own step list, so what the user watches is what ran.
// Errors surface as kit toasts (D-30); outcomes stay in the dialog.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RepoReadiness, ScmFlowResult } from '@generatorai/shared';
import {
  useGenerateScmText,
  useRunScmFlow,
  useScmBranches,
  useScmCompare,
  useScmPullRequestOptions,
  useFetchedReadiness,
  useWorkspaceChangeSummary,
  useWorkspaceReadiness,
} from '@/hooks/queries.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import {
  composeFlowRequest,
  pickDefaultAlias,
  scmAvailability,
  shipAllRequest,
  shipAllTargets,
  splitCommitMessage,
  type ScmAvailability,
  type ShipAllResult,
  type ShipMode,
} from './scmFlow.js';

export type ScmTextKind = 'commit' | 'pull_request';

export interface UseShipFlowOptions {
  workspaceId: string | undefined;
  /** Seeds generated commit/PR text (the chat name or the run's task). */
  hint?: string;
  /** Only load the PR parts while the dialog is open. */
  open: boolean;
  /** The mode the dialog opens in (the toolbar button's verb). */
  initialMode: ShipMode;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useShipFlow({ workspaceId, hint, open, initialMode }: UseShipFlowOptions) {
  const readiness = useWorkspaceReadiness(workspaceId);
  // Each opening asks the remote first, so ahead/behind are current.
  const fetched = useFetchedReadiness(workspaceId, open);
  const flow = useRunScmFlow(workspaceId);
  const generateText = useGenerateScmText(workspaceId);

  // A plain folder among the sources has nothing to commit; it is offered only when no source is a repository
  // (so the dialog can say why nothing can run).
  const repos = useMemo<RepoReadiness[]>(() => {
    const all = readiness.data?.repos ?? [];
    const git = all.filter((r) => r.isRepo);
    return git.length > 0 ? git : all;
  }, [readiness.data]);
  const [alias, setAlias] = useState<string | undefined>(undefined);
  const selected = repos.find((r) => r.alias === alias) ?? repos.find((r) => r.alias === pickDefaultAlias(repos));

  const [mode, setMode] = useState<ShipMode>(initialMode);
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [base, setBaseState] = useState('');
  const [baseTouched, setBaseTouched] = useState(false);
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [closesIssues, setClosesIssues] = useState<number[]>([]);
  const [generating, setGenerating] = useState<ScmTextKind | null>(null);
  const [result, setResult] = useState<ScmFlowResult | null>(null);
  const [resultId, setResultId] = useState(0);

  // Each opening starts from the toolbar's verb and a clean outcome.
  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setResult(null);
    }
  }, [open, initialMode]);

  // Follow the selected repo's default branch until the user picks one.
  useEffect(() => {
    if (!baseTouched) setBaseState(selected?.defaultBranch ?? '');
  }, [selected?.defaultBranch, baseTouched]);

  // A different mount is a different commit, branch and PR.
  useEffect(() => {
    setResult(null);
    setBaseTouched(false);
  }, [alias]);

  const setBase = useCallback((value: string) => {
    setBaseState(value);
    setBaseTouched(true);
  }, []);

  const writingPr = open && mode === 'pr' && !!selected?.can.pullRequest && !selected.openPullRequest;
  const branches = useScmBranches(workspaceId, selected?.alias, writingPr);
  const compare = useScmCompare(workspaceId, selected?.alias, base, writingPr);
  const prOptions = useScmPullRequestOptions(workspaceId, selected?.alias, writingPr);
  // The files a commit would take: the working tree against the last commit — the same
  // query the Changes panel's default view runs, so it is usually already cached.
  const uncommitted = useWorkspaceChangeSummary(workspaceId, { base: 'head', head: 'working' }, open && !!selected?.dirty);
  const commitFiles = useMemo(() => {
    const repo = uncommitted.data?.repos.find((r) => r.alias === selected?.alias) ?? uncommitted.data?.repos[0];
    return repo?.files ?? [];
  }, [uncommitted.data, selected?.alias]);

  const generate = useCallback(
    async (kind: ScmTextKind) => {
      if (!selected) return;
      setGenerating(kind);
      try {
        const text = await generateText.mutateAsync({
          alias: selected.alias,
          kind,
          ...(hint ? { hint } : {}),
          ...(kind === 'pull_request' && base ? { base } : {}),
        });
        if (kind === 'commit') {
          const parts = splitCommitMessage(text.message ?? '');
          setSummary(parts.summary);
          setDescription(parts.description);
        } else {
          if (text.title) setPrTitle(text.title);
          if (text.body) setPrBody(text.body);
        }
      } catch (e) {
        toast.error('Could not generate the text', { description: errorText(e) });
      } finally {
        setGenerating(null);
      }
    },
    [generateText, selected, hint, base],
  );

  // A run that stops at a conflict is finished by Continue, which runs it again: as a draft if it was one.
  const [lastDraft, setLastDraft] = useState(false);
  const run = useCallback(
    async (draft: boolean) => {
      setLastDraft(draft);
      try {
        const res = await flow.mutateAsync(
          composeFlowRequest(
            selected,
            { mode, summary, description, prTitle, prBody, base, draft, reviewers, assignees, labels, closesIssues },
            hint,
          ),
        );
        setResult(res);
        setResultId((n) => n + 1);
        if (res.status === 'ok') {
          setSummary('');
          setDescription('');
          setPrTitle('');
          setPrBody('');
          setReviewers([]);
          setAssignees([]);
          setLabels([]);
          setClosesIssues([]);
        }
      } catch (e) {
        toast.error('Source control failed', { description: errorText(e) });
      }
    },
    [flow, selected, mode, summary, description, prTitle, prBody, base, reviewers, assignees, labels, closesIssues, hint],
  );

  const availability: ScmAvailability = scmAvailability(selected, result);

  // "… all": the same flow once per repository, one after another (two flows must never share an index), with
  // generated text — the after-turn steps, run now. Each repo's outcome is kept, in order.
  const allTargets = useMemo(() => shipAllTargets(repos, mode), [repos, mode]);
  const [allResults, setAllResults] = useState<ShipAllResult[] | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  useEffect(() => {
    if (open) setAllResults(null);
  }, [open]);
  const runAll = useCallback(
    async (draft: boolean) => {
      setRunningAll(true);
      const out: ShipAllResult[] = [];
      setAllResults(out);
      for (const repo of allTargets) {
        try {
          out.push({ alias: repo.alias, result: await flow.mutateAsync(shipAllRequest(repo, mode, draft, hint)) });
        } catch (e) {
          out.push({ alias: repo.alias, error: errorText(e) });
        }
        setAllResults([...out]);
      }
      setRunningAll(false);
    },
    [allTargets, flow, mode, hint],
  );

  return {
    loading: readiness.isLoading,
    checkingRemote: fetched.isFetching,
    repos,
    selected,
    selectAlias: setAlias,
    availability,
    mode,
    setMode,
    summary,
    setSummary,
    description,
    setDescription,
    commitFiles,
    prTitle,
    setPrTitle,
    prBody,
    setPrBody,
    base,
    setBase,
    branches: branches.data,
    branchesLoading: branches.isLoading,
    compare: compare.data,
    compareLoading: compare.isFetching,
    prOptions: prOptions.data,
    prOptionsLoading: prOptions.isLoading,
    reviewers,
    setReviewers,
    assignees,
    setAssignees,
    labels,
    setLabels,
    closesIssues,
    setClosesIssues,
    generating,
    generate,
    running: flow.isPending,
    result,
    resultId,
    clearResult: useCallback(() => setResult(null), []),
    run,
    rerun: useCallback(() => run(lastDraft), [run, lastDraft]),
    allTargets,
    allResults,
    runningAll,
    runAll,
    clearAllResults: useCallback(() => setAllResults(null), []),
  };
}

export type ShipFlowModel = ReturnType<typeof useShipFlow>;
