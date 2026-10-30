// ────────────────────────────────────────────────────────────────
// NewIssueDialog — file a GitHub issue against one of the project's codebases
// (D-146): codebase (only when there is more than one reachable), title,
// Markdown description, comma-separated labels. On success the caller opens
// the new issue's page — the page is the confirmation, not a toast.
// ────────────────────────────────────────────────────────────────

import { useEffect, useState, type FormEvent } from 'react';
import type { ProjectCodebase } from '@generatorai/shared';
import { useCreateIssue } from '@/hooks/queries.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Dialog, DialogBody, DialogFooter } from '@/ui/primitives/Dialog/Dialog.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { parseLabels } from '../githubActions.js';

/** GitHub's title limit. */
const TITLE_MAX = 256;

export function NewIssueDialog({
  projectId,
  codebases,
  open,
  onOpenChange,
  onCreated,
}: {
  projectId: string;
  /** Codebases whose repository the issue list could reach. */
  codebases: readonly ProjectCodebase[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (codebaseId: string, number: number) => void;
}) {
  const create = useCreateIssue(projectId);
  const [codebaseId, setCodebaseId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [labels, setLabels] = useState('');

  useEffect(() => {
    if (open) return;
    setCodebaseId(null);
    setTitle('');
    setBody('');
    setLabels('');
  }, [open]);

  const target = codebaseId ?? (codebases.length === 1 ? codebases[0]!.id : null);
  const valid = Boolean(title.trim()) && title.trim().length <= TITLE_MAX && target !== null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !target) return;
    const parsed = parseLabels(labels);
    create.mutate(
      {
        codebaseId: target,
        title: title.trim(),
        ...(body.trim() ? { body } : {}),
        ...(parsed.length ? { labels: parsed } : {}),
      },
      {
        onSuccess: (issue) => {
          onOpenChange(false);
          onCreated(target, issue.number);
        },
        onError: (err) => toast.error("Couldn't create the issue", { description: err instanceof Error ? err.message : String(err) }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New issue" size="lg">
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" data-testid="issue-new-dialog">
        <DialogBody className="gap-4">
          {codebases.length > 1 ? (
            <Field label="Repository">
              <Select
                value={codebaseId}
                onValueChange={setCodebaseId}
                placeholder="Choose a codebase"
                items={codebases.map((cb) => ({ value: cb.id, label: cb.alias }))}
              />
            </Field>
          ) : null}
          <Field label="Title" error={title.trim().length > TITLE_MAX ? `At most ${TITLE_MAX} characters` : undefined}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's wrong, or what's needed"
              autoFocus
              data-testid="issue-new-title"
            />
          </Field>
          <Field label="Description" optional hint="Markdown. Steps to reproduce, what you expected, what happened.">
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} autosize={{ minRows: 6, maxRows: 16 }} data-testid="issue-new-body" />
          </Field>
          <Field label="Labels" optional hint="Comma-separated existing label names.">
            <Input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="bug, ui" data-testid="issue-new-labels" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!valid} loading={create.isPending} data-testid="issue-new-submit">
            Create issue
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
