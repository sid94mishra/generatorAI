// ────────────────────────────────────────────────────────────────
// Tags tab: the workflow's tags (`workflow.tags`), typed and added with
// Enter; they organise and filter the workflow list.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { FieldIssues } from '../fields/FieldIssues.js';
import { InspectorNote, InspectorSection } from '../fields/InspectorLayout.js';

export function TagsTab() {
  const tags = useWorkflowBuilderStore((s) => s.workflow.tags);
  const issues = useWorkflowBuilderStore((s) => s.issues);
  const updateWorkflow = useWorkflowBuilderStore((s) => s.updateWorkflow);
  const [draft, setDraft] = useState('');
  const [duplicate, setDuplicate] = useState(false);

  const addTag = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (tags.includes(trimmed)) setDuplicate(true);
    else {
      updateWorkflow({ tags: [...tags, trimmed] });
      setDuplicate(false);
    }
    setDraft('');
  };

  return (
    <InspectorSection title="Tags" count={tags.length || undefined}>
      <div className="flex items-center gap-1.5">
        <Input
          id="tag-input"
          size="sm"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setDuplicate(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder="Type a tag and press Enter…"
          aria-label="New tag"
          className="flex-1"
        />
        <Button size="sm" onClick={addTag} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
      {duplicate ? <InspectorNote tone="warn">Tag already exists.</InspectorNote> : null}
      {tags.length === 0 ? (
        <InspectorNote>No tags added. Tags help organise and filter workflows.</InspectorNote>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Chip key={tag} onRemove={() => updateWorkflow({ tags: tags.filter((t) => t !== tag) })} removeLabel={`Remove tag ${tag}`}>
              {tag}
            </Chip>
          ))}
        </div>
      )}
      <FieldIssues issues={issues.filter((i) => i.path.startsWith('/workflow/tags'))} />
    </InspectorSection>
  );
}
