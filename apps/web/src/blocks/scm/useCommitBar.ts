// ────────────────────────────────────────────────────────────────
// useCommitBar — the CommitBar's data and form state.
//
// Readiness (`GET /scm/readiness`) drives what is offered; one primary action
// runs the whole flow (`POST /scm/flow`) and keeps the server's own step list,
// so what the user watches is what actually ran. Errors surface as kit toasts
// (D-30); outcomes stay inline (the result summary).
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RepoReadiness, ScmFlowResult } from '@generatorai/shared';
import { useGenerateScmText, useRunScmFlow, useWorkspaceReadiness } from '@/hooks/queries.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { composeFlowRequest, scmAvailability, type ScmAvailability } from './scmFlow.js';

export type ScmTextKind = 'commit' | 'pull_request';

export interface UseCommitBarOptions {
  workspaceId: string | undefined;
  /** Seeds generated commit/PR text (the chat name or the run's task). */
  hint?: string;
}

export interface CommitBarModel {
  loading: boolean;
  repos: RepoReadiness[];
  selected: RepoReadiness | undefined;
  selectAlias: (alias: string) => void;
  availability: ScmAvailability;

  message: string;
  setMessage: (value: string) => void;
  push: boolean;
  setPush: (value: boolean) => void;
  openPr: boolean;
  /** Opening a PR forces Push on: a PR needs a pushed branch. */
  setOpenPr: (value: boolean) => void;
  prTitle: string;
  setPrTitle: (value: string) => void;
  prBody: string;
  setPrBody: (value: string) => void;
  base: string;
  /** A typed base branch stops following the repo's default branch. */
  setBase: (value: string) => void;
  draft: boolean;
  setDraft: (value: boolean) => void;

  generating: ScmTextKind | null;
  generate: (kind: ScmTextKind) => Promise<void>;
  running: boolean;
  result: ScmFlowResult | null;
  /** Bumps with every flow outcome, so per-outcome UI (the conflict card) starts fresh. */
  resultId: number;
  clearResult: () => void;
  runFlow: () => Promise<void>;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useCommitBar({ workspaceId, hint }: UseCommitBarOptions): CommitBarModel {
  const readiness = useWorkspaceReadiness(workspaceId);
  const flow = useRunScmFlow(workspaceId);
  const generateText = useGenerateScmText(workspaceId);

  const repos = useMemo(() => readiness.data?.repos ?? [], [readiness.data]);
  const [alias, setAlias] = useState<string | undefined>(undefined);
  const selected = repos.find((r) => r.alias === alias) ?? repos[0];

  const [message, setMessage] = useState('');
  const [push, setPush] = useState(true);
  const [openPr, setOpenPrState] = useState(false);
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [base, setBaseState] = useState('');
  const [draft, setDraft] = useState(false);
  const [result, setResult] = useState<ScmFlowResult | null>(null);
  const [resultId, setResultId] = useState(0);
  const [generating, setGenerating] = useState<ScmTextKind | null>(null);

  // Follow the selected repo's own default branch unless the user typed one.
  const [baseTouched, setBaseTouched] = useState(false);
  useEffect(() => {
    if (!baseTouched) setBaseState(selected?.defaultBranch ?? '');
  }, [selected?.defaultBranch, baseTouched]);

  // A different mount is a different commit, branch and PR: the old outcome
  // does not describe it.
  useEffect(() => {
    setResult(null);
  }, [alias]);

  const setOpenPr = useCallback((value: boolean) => {
    setOpenPrState(value);
    if (value) setPush(true);
  }, []);

  const setBase = useCallback((value: string) => {
    setBaseState(value);
    setBaseTouched(true);
  }, []);

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
        if (kind === 'commit') setMessage(text.message ?? '');
        else {
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

  const runFlow = useCallback(async () => {
    try {
      const res = await flow.mutateAsync(
        composeFlowRequest(selected, { message, push, openPr, prTitle, prBody, base, draft }, hint),
      );
      setResult(res);
      setResultId((n) => n + 1);
      if (res.status === 'ok') setMessage('');
    } catch (e) {
      toast.error('Source control failed', { description: errorText(e) });
    }
  }, [flow, selected, message, push, openPr, prTitle, prBody, base, draft, hint]);

  const clearResult = useCallback(() => setResult(null), []);

  return {
    loading: readiness.isLoading,
    repos,
    selected,
    selectAlias: setAlias,
    availability: scmAvailability(selected, result),
    message,
    setMessage,
    push,
    setPush,
    openPr,
    setOpenPr,
    prTitle,
    setPrTitle,
    prBody,
    setPrBody,
    base,
    setBase,
    draft,
    setDraft,
    generating,
    generate,
    running: flow.isPending,
    result,
    resultId,
    clearResult,
    runFlow,
  };
}
