// ────────────────────────────────────────────────────────────────
// SourceControlOptionsFields — the agent-native source-control switches.
//
// The same three switches (commit / push / open a PR) plus base branch and
// Draft, shared between "New chat" and a chat's own settings so the two
// can never drift. The implications are enforced here rather than
// explained in prose: pushing implies committing, and opening a PR implies
// pushing — a combination the server would refuse anyway, and the user
// should not be able to describe an impossible plan.
// ────────────────────────────────────────────────────────────────

import React, { useCallback } from 'react';
import { GitPullRequest } from 'lucide-react';
import { Input, ToggleSwitch } from '@/components/ui/index.js';
import { cn } from '@/lib/utils.js';
import type { ChatSourceControlOptions } from '@generatorai/shared';

export const DEFAULT_SOURCE_CONTROL_OPTIONS: ChatSourceControlOptions = {
  autoCommit: false,
  autoPush: false,
  autoPullRequest: false,
};

export interface SourceControlOptionsFieldsProps {
  value: ChatSourceControlOptions;
  onChange: (next: ChatSourceControlOptions) => void;
  disabled?: boolean;
  className?: string;
}

export function SourceControlOptionsFields({
  value,
  onChange,
  disabled = false,
  className,
}: SourceControlOptionsFieldsProps) {
  const patch = useCallback(
    (delta: Partial<ChatSourceControlOptions>) => onChange({ ...value, ...delta }),
    [onChange, value],
  );

  return (
    <div className={cn('space-y-2', className)} data-testid="source-control-options">
      <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <GitPullRequest className="h-4 w-4 text-primary" />
        Source control
      </label>

      <div className="space-y-1.5 rounded-lg border border-border p-3">
        <ToggleSwitch
          checked={value.autoCommit}
          disabled={disabled}
          label="Auto-commit after each turn"
          description="Commit the change set to git whenever a turn finishes with changes."
          onChange={(checked) =>
            patch(
              checked
                ? { autoCommit: true }
                : // Dropping commit drops everything downstream of it.
                  { autoCommit: false, autoPush: false, autoPullRequest: false },
            )
          }
        />
        <ToggleSwitch
          checked={value.autoPush}
          disabled={disabled || !value.autoCommit}
          label="Push"
          description="Push the work branch after committing. Never to the default branch."
          onChange={(checked) =>
            patch(checked ? { autoCommit: true, autoPush: true } : { autoPush: false, autoPullRequest: false })
          }
        />
        <ToggleSwitch
          checked={value.autoPullRequest}
          disabled={disabled || !value.autoCommit}
          label="Open pull request"
          description="Open one pull request for the work branch, once."
          onChange={(checked) =>
            patch(
              checked
                ? { autoCommit: true, autoPush: true, autoPullRequest: true }
                : { autoPullRequest: false },
            )
          }
        />

        {value.autoPullRequest && (
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-2.5">
            <div className="min-w-[12rem] flex-1">
              <label
                htmlFor="scm-options-base"
                className="mb-1 block text-xs font-medium text-foreground"
              >
                Base branch
              </label>
              <Input
                id="scm-options-base"
                value={value.base ?? ''}
                disabled={disabled}
                onChange={(e) => patch({ base: e.target.value || undefined })}
                placeholder="repo default"
                data-testid="scm-options-base"
              />
            </div>
            <ToggleSwitch
              checked={value.draft ?? false}
              disabled={disabled}
              label="Draft"
              onChange={(checked) => patch({ draft: checked })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
