// ────────────────────────────────────────────────────────────────
// TagsMetadataTab — Tag management with chip input
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { Button, Input } from '@/components/ui/index.js';

export function TagsMetadataTab() {
  const tags = useWorkflowBuilderStore((s) => s.workflow.tags);
  const updateWorkflow = useWorkflowBuilderStore((s) => s.updateWorkflow);
  const setTags = useCallback((next: string[]) => updateWorkflow({ tags: next }), [updateWorkflow]);
  const [tagInput, setTagInput] = useState('');
  const [duplicateHint, setDuplicateHint] = useState(false);

  const addTag = useCallback(() => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setDuplicateHint(false);
    } else if (trimmed && tags.includes(trimmed)) {
      setDuplicateHint(true);
    }
    setTagInput('');
  }, [tagInput, tags, setTags]);

  const removeTag = useCallback(
    (tag: string) => {
      setTags(tags.filter((t) => t !== tag));
    },
    [tags, setTags],
  );

  return (
    <div className="space-y-6">
      {/* Tags */}
      <div>
        <label htmlFor="tag-input" className="mb-2 block text-sm font-medium text-foreground">
          Tags ({tags.length})
        </label>

        {/* Tag input */}
        <div className="flex gap-2 mb-3">
          <Input
            id="tag-input"
            type="text"
            value={tagInput}
            onChange={(e) => { setTagInput(e.target.value); setDuplicateHint(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              }
            }}
            className="flex-1"
            placeholder="Type a tag and press Enter..."
          />
          <Button
            variant="primary"
            onClick={addTag}
            disabled={!tagInput.trim()}
          >
            Add
          </Button>
        </div>
        {duplicateHint && (
          <p className="text-[10px] text-warning">Tag already exists.</p>
        )}

        {/* Tag pills */}
        {tags.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No tags added. Tags help organize and filter workflows.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-subtle px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-emphasis"
              >
                {tag}
                <Button
                  onClick={() => removeTag(tag)}
                  aria-label={`Remove tag ${tag}`}
                  variant="ghost"
                  size="icon-sm"
                  className="h-auto w-auto rounded-full p-0.5 hover:bg-background"
                >
                  <X className="h-3 w-3" />
                </Button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
