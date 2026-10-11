// ────────────────────────────────────────────────────────────────
// SourceControlOptionsFields — the agent-native source-control switches of a
// live chat ("Edit sources…"): commit / push / open a PR after each turn,
// plus base branch and Draft. The implications are enforced here rather than
// explained in prose: pushing implies committing, and opening a PR implies
// pushing — a combination the server would refuse anyway, and the user
// should not be able to describe an impossible plan.
// ────────────────────────────────────────────────────────────────

import type { ChatSourceControlOptions } from '@generatorai/shared';
import { Field } from '@/ui/primitives/Field/Field.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { SettingRow } from '@/ui/patterns/SettingsSection/SettingsSection.js';

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

/**
 * Label + hint + switch rows (the New chat dialog's Behaviour idiom, D-133),
 * rule-separated with `line` so they hold on the dialog's `overlay` surface.
 * The host section supplies the "After each turn" heading.
 */
export function SourceControlOptionsFields({ value, onChange, disabled = false }: SourceControlOptionsFieldsProps) {
  const patch = (delta: Partial<ChatSourceControlOptions>) => onChange({ ...value, ...delta });

  return (
    <div className="flex flex-col" data-testid="source-control-options" role="group" aria-label="After each turn">
      <SettingRow
        className="border-line"
        label="Commit changes"
        hint="Commit the files the agent changed to its branch."
        control={
          <Switch
            aria-label="Commit changes"
            checked={value.autoCommit}
            disabled={disabled}
            onCheckedChange={(checked) =>
              patch(
                checked
                  ? { autoCommit: true }
                  : // Dropping commit drops everything downstream of it.
                    { autoCommit: false, autoPush: false, autoPullRequest: false },
              )
            }
          />
        }
      />
      <SettingRow
        className="border-line"
        label="Push the branch"
        hint="Push the agent's branch to the remote. Never pushes to the default branch."
        control={
          <Switch
            aria-label="Push the branch"
            checked={value.autoPush}
            disabled={disabled || !value.autoCommit}
            onCheckedChange={(checked) =>
              patch(checked ? { autoCommit: true, autoPush: true } : { autoPush: false, autoPullRequest: false })
            }
          />
        }
      />
      <SettingRow
        className="border-line"
        label="Open a pull request"
        hint="Open one pull request for the agent's branch."
        control={
          <Switch
            aria-label="Open a pull request"
            checked={value.autoPullRequest}
            disabled={disabled || !value.autoCommit}
            onCheckedChange={(checked) =>
              patch(checked ? { autoCommit: true, autoPush: true, autoPullRequest: true } : { autoPullRequest: false })
            }
          />
        }
        stacked={
          value.autoPullRequest ? (
            <div className="flex flex-wrap items-end gap-4 pt-1">
              <Field label="Base branch" className="min-w-48 flex-1">
                <Input
                  value={value.base ?? ''}
                  disabled={disabled}
                  onChange={(e) => patch({ base: e.target.value || undefined })}
                  placeholder="Repository default"
                  data-testid="scm-options-base"
                />
              </Field>
              <Switch
                checked={value.draft ?? false}
                disabled={disabled}
                label="Open as draft"
                onCheckedChange={(checked) => patch({ draft: checked })}
                className="pb-1.5"
              />
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
