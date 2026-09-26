// ────────────────────────────────────────────────────────────────
// SourceControlOptionsFields — the agent-native source-control switches of a
// live chat ("Edit sources…"): commit / push / open a PR after each turn,
// plus base branch and Draft. The implications are enforced here rather than
// explained in prose: pushing implies committing, and opening a PR implies
// pushing — a combination the server would refuse anyway, and the user
// should not be able to describe an impossible plan.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import type { ChatSourceControlOptions } from '@generatorai/shared';
import { Icon } from '@/ui/icons/Icon.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';

export const DEFAULT_SOURCE_CONTROL_OPTIONS: ChatSourceControlOptions = {
  autoCommit: false,
  autoPush: false,
  autoPullRequest: false,
};

export interface SourceControlOptionsFieldsProps {
  value: ChatSourceControlOptions;
  onChange: (next: ChatSourceControlOptions) => void;
  disabled?: boolean;
}

/** One switch with its one-sentence explanation underneath. */
function SwitchRow({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} label={label} />
      {description ? <p className="pl-9 text-small text-fg-3">{description}</p> : null}
    </div>
  );
}

export function SourceControlOptionsFields({ value, onChange, disabled = false }: SourceControlOptionsFieldsProps) {
  const patch = (delta: Partial<ChatSourceControlOptions>) => onChange({ ...value, ...delta });

  return (
    <section className="flex flex-col gap-2" data-testid="source-control-options" aria-label="Source control">
      <h3 className="flex items-center gap-1.5 text-small font-medium text-fg-2">
        <Icon concept="pr" size={14} className="text-fg-3" />
        Source control
      </h3>
      <div className="flex flex-col gap-2.5 rounded-card border border-line-soft p-3">
        <SwitchRow
          checked={value.autoCommit}
          disabled={disabled}
          label="Auto-commit after each turn"
          description="Commit the change set to git whenever a turn finishes with changes."
          onCheckedChange={(checked) =>
            patch(
              checked
                ? { autoCommit: true }
                : // Dropping commit drops everything downstream of it.
                  { autoCommit: false, autoPush: false, autoPullRequest: false },
            )
          }
        />
        <SwitchRow
          checked={value.autoPush}
          disabled={disabled || !value.autoCommit}
          label="Push"
          description="Push the work branch after committing. Never to the default branch."
          onCheckedChange={(checked) =>
            patch(checked ? { autoCommit: true, autoPush: true } : { autoPush: false, autoPullRequest: false })
          }
        />
        <SwitchRow
          checked={value.autoPullRequest}
          disabled={disabled || !value.autoCommit}
          label="Open pull request"
          description="Open one pull request for the work branch, once."
          onCheckedChange={(checked) =>
            patch(checked ? { autoCommit: true, autoPush: true, autoPullRequest: true } : { autoPullRequest: false })
          }
        />

        {value.autoPullRequest ? (
          <div className="flex flex-wrap items-end gap-3 border-t border-line-soft pt-2.5">
            <Field label="Base branch" className="min-w-48 flex-1">
              <Input
                value={value.base ?? ''}
                disabled={disabled}
                onChange={(e) => patch({ base: e.target.value || undefined })}
                placeholder="repo default"
                data-testid="scm-options-base"
              />
            </Field>
            <Switch
              checked={value.draft ?? false}
              disabled={disabled}
              label="Draft"
              onCheckedChange={(checked) => patch({ draft: checked })}
              className="pb-1.5"
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
