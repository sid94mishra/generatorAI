// ────────────────────────────────────────────────────────────────
// ArtifactPreview — the Customization tab's 400px preview (board
// ProjectCustomization): name (mono) + source badge, path, the body (rendered
// Markdown or highlighted source), and a footer with Delete · View JSON · Edit
// (Delete and Edit for project-source artifacts only).
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import type { ArtifactWithSource } from '@generatorai/shared';
import { useArtifactContent, useUpdateArtifactContent } from '@/hooks/projectQueries.js';
import { CodeBlock } from '@/ui/patterns/CodeBlock/CodeBlock.js';
import { langFromPath } from '@/ui/patterns/CodeBlock/langFromPath.js';
import { Markdown } from '@/ui/patterns/Markdown/Markdown.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Card } from '@/ui/primitives/Card/Card.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { SkeletonRows } from '@/ui/primitives/Skeleton/Skeleton.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';

export interface ArtifactPreviewProps {
  projectId: string;
  artifact: ArtifactWithSource;
  onClose: () => void;
  onDelete: (artifact: ArtifactWithSource) => void;
}

export function ArtifactPreview({ projectId, artifact, onClose, onDelete }: ArtifactPreviewProps) {
  const { data: content, isLoading, error } = useArtifactContent(projectId, artifact.id, artifact.source);
  const update = useUpdateArtifactContent();
  const [mode, setMode] = useState<'view' | 'json' | 'edit'>('view');
  const [draft, setDraft] = useState('');
  const editable = artifact.source === 'project';

  useEffect(() => setMode('view'), [artifact.id]);

  const path = artifact.filePath || artifact.name;
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const isMarkdown = ext === 'md' || ext === 'mdx';

  const save = () =>
    update.mutate(
      { projectId, configId: artifact.id, content: draft },
      {
        onSuccess: () => setMode('view'),
        onError: (err) => toast.error("Couldn't save", { description: err instanceof Error ? err.message : String(err) }),
      },
    );

  let body;
  if (mode === 'json') {
    const json = JSON.stringify({ id: artifact.id, type: artifact.type, name: artifact.name, source: artifact.source, filePath: artifact.filePath, metadata: artifact.metadata }, null, 2);
    body = (
      <CodeBlock lang="json" copy={json} wrap>
        {json}
      </CodeBlock>
    );
  } else if (mode === 'edit') {
    body = (
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autosize={{ minRows: 12, maxRows: 30 }}
        spellCheck={false}
        textareaClassName="font-mono text-small"
        aria-label={`Edit ${artifact.name}`}
      />
    );
  } else if (isLoading) {
    body = <SkeletonRows rows={6} label="Loading content" />;
  } else if (error) {
    body = <EmptyState tone="error" icon="warning" title="Couldn't load the file" description={String(error)} />;
  } else if (content !== undefined) {
    body = isMarkdown ? (
      <Markdown>{content}</Markdown>
    ) : (
      <CodeBlock lang={langFromPath(path)} copy={content} wrap>
        {content}
      </CodeBlock>
    );
  }

  return (
    <Card className="flex w-inspector shrink-0 flex-col self-start" data-testid="artifact-preview">
      <Card.Header
        action={<IconButton size="sm" icon="x" label="Close preview" onClick={onClose} />}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-mono text-ui font-semibold">{artifact.name}</span>
          <Badge tone={editable ? 'ok' : 'neutral'} className="capitalize">
            {artifact.source}
          </Badge>
        </div>
      </Card.Header>
      <Card.Body className="gap-3">
        <p className="truncate font-mono text-micro text-fg-3" title={path}>
          {path}
        </p>
        {artifact.description ? <p className="text-small text-fg-2">{artifact.description}</p> : null}
        <div className="min-w-0">{body}</div>
      </Card.Body>
      <div className="flex h-footer shrink-0 items-center gap-2 border-t border-line-soft px-3.5">
        {editable ? (
          <Button size="sm" variant="danger-ghost" icon="trash" onClick={() => onDelete(artifact)}>
            Delete
          </Button>
        ) : null}
        <span className="flex-1" />
        {mode === 'edit' ? (
          <>
            <Button size="sm" onClick={() => setMode('view')}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" icon="save" loading={update.isPending} onClick={save}>
              Save
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" pressed={mode === 'json'} onClick={() => setMode(mode === 'json' ? 'view' : 'json')}>
              View JSON
            </Button>
            {editable ? (
              <Button
                size="sm"
                icon="edit"
                disabled={content === undefined}
                onClick={() => {
                  setDraft(content ?? '');
                  setMode('edit');
                }}
              >
                Edit
              </Button>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}
