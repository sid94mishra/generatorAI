// ────────────────────────────────────────────────────────────────
// SourceControlOptionsFields — what the agent does with its changes after
// each turn of a live chat ("Edit sources…", D-167). One four-step choice,
// because each step includes the one before it: Keep local · Commit ·
// Commit & push · Open a PR (an impossible plan such as "push without
// committing" cannot be described). A PR adds its base and Draft; a sentence
// under the choice says exactly what will happen, with the real branch names.
// ────────────────────────────────────────────────────────────────

import type { ChatSourceControlOptions } from '@generatorai/shared';
import { Checkbox } from '@/ui/primitives/Checkbox/Checkbox.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';

export const DEFAULT_SOURCE_CONTROL_OPTIONS: ChatSourceControlOptions = {
  autoCommit: false,
  autoPush: false,
  autoPullRequest: false,
};

type Step = 'local' | 'commit' | 'push' | 'pr';

function stepOf(v: ChatSourceControlOptions): Step {
  if (v.autoPullRequest) return 'pr';
  if (v.autoPush) return 'push';
  if (v.autoCommit) return 'commit';
  return 'local';
}

function withStep(v: ChatSourceControlOptions, step: Step): ChatSourceControlOptions {
  return { ...v, autoCommit: step !== 'local', autoPush: step === 'push' || step === 'pr', autoPullRequest: step === 'pr' };
}

export interface SourceControlOptionsFieldsProps {
  value: ChatSourceControlOptions;
  onChange: (next: ChatSourceControlOptions) => void;
  /** The agent's branch when the chat has one git source; otherwise each source's own branch is meant. */
  branch?: string | null;
  disabled?: boolean;
}

const Mono = ({ children }: { children: string }) => <span className="font-mono text-fg-2">{children}</span>;

export function SourceControlOptionsFields({ value, onChange, branch, disabled = false }: SourceControlOptionsFieldsProps) {
  const step = stepOf(value);
  const base = value.base?.trim();
  const theBranch = branch ? <Mono>{branch}</Mono> : <>each codebase’s branch</>;
  const flow =
    step === 'local' ? (
      <>Changes stay uncommitted in the agent’s checkout until you commit them.</>
    ) : step === 'commit' ? (
      <>Commits to {theBranch} after each turn. Nothing is pushed.</>
    ) : step === 'push' ? (
      <>
        Commits to {theBranch} and pushes it. Never pushes to {base ? <Mono>{base}</Mono> : 'the default branch'}.
      </>
    ) : (
      <>
        Commits and pushes {theBranch}, then opens one {value.draft ? 'draft ' : ''}pull request into{' '}
        {base ? <Mono>{base}</Mono> : 'the default branch'}. Later turns add to it.
      </>
    );

  return (
    <div className="flex flex-col gap-2.5" data-testid="source-control-options">
      <SegmentedControl<Step>
        label="After each turn"
        size="md"
        fullWidth
        value={step}
        onValueChange={(next) => onChange(withStep(value, next))}
        items={[
          { value: 'local', label: 'Keep local', disabled },
          { value: 'commit', label: 'Commit', icon: 'commit', disabled },
          { value: 'push', label: 'Commit & push', icon: 'upload', disabled },
          { value: 'pr', label: 'Open a PR', icon: 'pr', disabled },
        ]}
      />
      {step === 'pr' ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-small text-fg-3">Into</span>
          <Input
            size="sm"
            mono
            value={value.base ?? ''}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, base: e.target.value || undefined })}
            placeholder="default branch"
            aria-label="Pull request base"
            className="w-48"
            data-testid="scm-options-base"
          />
          <span className="flex-1" />
          <Checkbox
            checked={value.draft ?? false}
            disabled={disabled}
            onCheckedChange={(checked) => onChange({ ...value, draft: checked === true })}
            label="Open as draft"
          />
        </div>
      ) : null}
      <p className="flex items-start gap-2 text-small text-fg-3">
        <Icon concept="info" size={14} className="mt-0.5 shrink-0" />
        <span>{flow}</span>
      </p>
    </div>
  );
}
