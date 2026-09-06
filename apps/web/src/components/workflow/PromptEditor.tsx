// ────────────────────────────────────────────────────────────────
// PromptEditor — Editable prompt list with reordering
// Supports add/edit/delete, variable interpolation highlighting
// ────────────────────────────────────────────────────────────────

import React, { useState, useCallback } from 'react';
import { Plus, Trash2, Eye, Edit3, ChevronUp, ChevronDown } from 'lucide-react';
import type { PromptDefinition } from '@generatorai/shared';
import { cn } from '@/lib/utils.js';
import { Button, Input, Textarea } from '@/components/ui/index.js';

interface PromptEditorProps {
  prompts: PromptDefinition[];
  onChange: (prompts: PromptDefinition[]) => void;
  readonly?: boolean;
  contentLabel?: string;
}

/** Highlight {{variable}} patterns in prompt text */
function HighlightedText({ text }: { text: string }) {
  const parts = text.split(/({{[^}]+}})/g);
  return (
    <span>
      {parts.map((part, i) =>
        part.startsWith('{{') && part.endsWith('}}') ? (
          <span key={i} className="rounded bg-info-muted px-1 text-info">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}

export function PromptEditor({ prompts, onChange, readonly, contentLabel = 'Prompt' }: PromptEditorProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const addPrompt = useCallback(() => {
    const newPrompt: PromptDefinition = {
      label: `${contentLabel} ${prompts.length + 1}`,
      text: '',
      waitForCompletion: true,
    };
    onChange([...prompts, newPrompt]);
    setEditingIndex(prompts.length);
  }, [prompts, onChange]);

  const updatePrompt = useCallback(
    (index: number, updates: Partial<PromptDefinition>) => {
      const updated = prompts.map((p, i) => (i === index ? { ...p, ...updates } : p));
      onChange(updated);
    },
    [prompts, onChange],
  );

  const removePrompt = useCallback(
    (index: number) => {
      onChange(prompts.filter((_, i) => i !== index));
      if (editingIndex === index) setEditingIndex(null);
      if (previewIndex === index) setPreviewIndex(null);
    },
    [prompts, onChange, editingIndex, previewIndex],
  );

  const movePrompt = useCallback(
    (index: number, direction: 'up' | 'down') => {
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= prompts.length) return;
      const updated = [...prompts];
      [updated[index], updated[newIndex]] = [updated[newIndex]!, updated[index]!];
      onChange(updated);
      if (editingIndex === index) setEditingIndex(newIndex);
      else if (editingIndex === newIndex) setEditingIndex(index);
    },
    [prompts, onChange, editingIndex],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">
          {contentLabel}s ({prompts.length})
        </label>
        {!readonly && (
          <Button
            onClick={addPrompt}
            variant="ghost"
            size="sm"
            className="h-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-subtle"
          >
            <Plus className="h-3.5 w-3.5" />
            Add {contentLabel}
          </Button>
        )}
      </div>

      {prompts.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No {contentLabel.toLowerCase()}s configured. Add {/^[aeiou]/i.test(contentLabel) ? 'an' : 'a'} {contentLabel.toLowerCase()} to define what this stage does.
        </div>
      )}

      <div className="space-y-2">
        {prompts.map((prompt, index) => (
          <div
            key={index}
            className={cn(
              'rounded-lg border border-border transition-all',
              editingIndex === index && 'ring-2 ring-ring/20',
            )}
          >
            {/* Prompt header */}
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">

              {/* Label */}
              {editingIndex === index ? (
                <Input
                  type="text"
                  value={prompt.label}
                  onChange={(e) => updatePrompt(index, { label: e.target.value })}
                  className="flex-1 h-auto rounded px-2 py-0.5 text-sm"
                  placeholder={`${contentLabel} label`}
                />
              ) : (
                <span className="flex-1 truncate text-sm font-medium text-foreground">
                  {prompt.label || `${contentLabel} ${index + 1}`}
                </span>
              )}

              {/* Wait for completion toggle */}
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={prompt.waitForCompletion}
                  onChange={(e) => updatePrompt(index, { waitForCompletion: e.target.checked })}
                  disabled={readonly}
                  className="h-3 w-3 rounded border-border"
                />
                Wait
              </label>

              {/* Action buttons */}
              {!readonly && (
                <div className="flex items-center gap-0.5">
                  <Button
                    onClick={() => movePrompt(index, 'up')}
                    disabled={index === 0}
                    variant="ghost"
                    size="icon-sm"
                    className="h-auto w-auto rounded p-1 text-muted-foreground hover:bg-subtle disabled:opacity-30"
                    title="Move up"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    onClick={() => movePrompt(index, 'down')}
                    disabled={index === prompts.length - 1}
                    variant="ghost"
                    size="icon-sm"
                    className="h-auto w-auto rounded p-1 text-muted-foreground hover:bg-subtle disabled:opacity-30"
                    title="Move down"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    onClick={() =>
                      setEditingIndex(editingIndex === index ? null : index)
                    }
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                      'h-auto w-auto rounded p-1 transition-colors',
                      editingIndex === index
                        ? 'bg-primary text-primary-foreground hover:bg-primary'
                        : 'text-muted-foreground hover:bg-subtle',
                    )}
                    title="Edit prompt"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    onClick={() =>
                      setPreviewIndex(previewIndex === index ? null : index)
                    }
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                      'h-auto w-auto rounded p-1 transition-colors',
                      previewIndex === index
                        ? 'bg-subtle text-foreground'
                        : 'text-muted-foreground hover:bg-subtle',
                    )}
                    title="Preview prompt"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    onClick={() => removePrompt(index)}
                    variant="ghost"
                    size="icon-sm"
                    className="h-auto w-auto rounded p-1 text-muted-foreground hover:bg-danger-muted hover:text-danger"
                    title="Delete prompt"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>

            {/* Editing mode: textarea */}
            {editingIndex === index && (
              <div className="p-3">
                <Textarea
                  value={prompt.text}
                  onChange={(e) => updatePrompt(index, { text: e.target.value })}
                  rows={5}
                  className="p-3 font-mono"
                  placeholder="Enter prompt text... Use {{variableName}} for variable interpolation"
                />
              </div>
            )}

            {/* Preview mode: highlighted text */}
            {previewIndex === index && editingIndex !== index && (
              <div className="p-3">
                <div className="rounded-md bg-subtle p-3 text-sm leading-relaxed">
                  {prompt.text ? (
                    <HighlightedText text={prompt.text} />
                  ) : (
                    <span className="italic text-muted-foreground">
                      Empty prompt
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Collapsed: show first line */}
            {editingIndex !== index && previewIndex !== index && prompt.text && (
              <div className="px-3 py-2">
                <p className="truncate text-xs text-muted-foreground font-mono">
                  {prompt.text.split('\n')[0]}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
