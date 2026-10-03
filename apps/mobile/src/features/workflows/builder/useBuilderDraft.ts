// Every builder route reads the same draft (MD-85): the builder list, and the sheets a link can open directly
// (validate, versions, add stage, loop settings) — each loads the workflow and opens its draft when none is open.
import { useEffect, useState } from 'react';
import type { ValidationIssue } from '@generatorai/workflow-spec';

import { errorText } from '../../../ui/lib/format';
import { useBuilderWrites, useWorkflow } from '../queries';
import { useBuilderStore, type BuilderDraft } from './builderStore';

export function useBuilderDraft(id: string): { draft: BuilderDraft | undefined; query: ReturnType<typeof useWorkflow> } {
  const query = useWorkflow(id);
  const open = useBuilderStore((s) => s.open);
  const draft = useBuilderStore((s) => s.drafts[id]);
  useEffect(() => {
    if (query.data) open(query.data);
  }, [query.data, open]);
  return { draft, query };
}

/** Validate the draft's current graph against the server (stateless); the result is kept on the draft. */
export function useValidateDraft(id: string): { validate: () => Promise<ValidationIssue[] | null>; loading: boolean; error: string | null } {
  const writes = useBuilderWrites(id);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validate = async (): Promise<ValidationIssue[] | null> => {
    const graph = useBuilderStore.getState().drafts[id]?.graph;
    if (!graph) return null;
    setLoading(true);
    setError(null);
    try {
      const r = await writes.validate(graph);
      useBuilderStore.getState().setValidation(id, r.issues);
      return r.issues;
    } catch (e) {
      setError(errorText(e));
      return null;
    } finally {
      setLoading(false);
    }
  };
  return { validate, loading, error };
}
