// ────────────────────────────────────────────────────────────────
// WF-09 ReviewCard — a stage's COMPLETION REVIEW (its `approval` gate) on the
// C-30 GateCardFrame (board WorkflowRun: "Review Apply upgrades · round 1 of
// 3", feedback box, Reject · Request changes · Approve ⌃↵). In-turn gates
// (tool permission, question, plan) render as the chat's cards inside the
// stage transcript instead.
//
//   Approve         → outcome 'approved': the stage completes and the graph
//                     advances. No approve-with-follow-up (PD-9): talk to a
//                     completed stage through its composer.
//   Request changes → outcome 'changes_requested' with the (required)
//                     feedback: a revision turn runs, then the stage re-parks
//                     for another round.
//   Reject          → outcome 'rejected'. TERMINAL: the stage fails, which
//                     blocks every downstream stage and stops the run —
//                     confirmed first because it cannot be undone.
// ────────────────────────────────────────────────────────────────

import { useState, type KeyboardEvent } from 'react';
import { GateCardFrame } from '@/ui/patterns/GateCardFrame/GateCardFrame.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { Markdown } from '@/ui/patterns/Markdown/Markdown.js';
import { jsonAnswerMarkdown } from '@/blocks/transcript/index.js';
import { hasStructuredOutput, structuredOutputMarkdown } from '../model/structuredOutput.js';

/** The output under review: a structured one readable field by field (D-159), else as it came. */
function reviewMarkdown(output: string): string {
  const trimmed = output.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data: unknown = JSON.parse(trimmed);
      if (hasStructuredOutput(data)) return structuredOutputMarkdown(data);
    } catch {
      /* not JSON after all */
    }
  }
  return jsonAnswerMarkdown(output);
}

export interface ReviewCardProps {
  stageName: string;
  /** Why the stage parked (the server's review reason / summary). */
  reason: string;
  tool?: string | undefined;
  args?: Record<string, unknown> | undefined;
  /** Who reads the feedback ("Bug Fixer"); the placeholder names them. */
  agentName?: string | undefined;
  /** The stage output being approved, shown in full (U-19). */
  output?: string | undefined;
  /** What approving starts ("run_tests"), when the stage has successors. */
  approveStarts?: string | undefined;
  onApprove: () => void;
  onRequestChanges: (feedback: string) => void;
  /** Terminal rejection. Omit to hide the action. */
  onReject?: ((reason?: string) => void) | undefined;
  /** A verdict is in flight: every action is disabled until it settles (D-13). */
  busy?: boolean;
}

export function ReviewCard({
  stageName,
  reason,
  tool,
  args,
  agentName,
  output,
  approveStarts,
  onApprove,
  onRequestChanges,
  onReject,
  busy = false,
}: ReviewCardProps) {
  const [feedback, setFeedback] = useState('');
  const confirmer = useConfirm();
  const trimmed = feedback.trim();

  const reject = async () => {
    if (!onReject) return;
    const ok = await confirmer.confirm({
      title: `Reject ${stageName}?`,
      description: 'The stage fails and the run stops. Downstream stages will not execute.',
      confirmLabel: 'Reject stage',
      cancelLabel: 'Keep reviewing',
      tone: 'danger',
    });
    if (ok) onReject(trimmed.length > 0 ? trimmed : undefined);
  };

  // Ctrl/⌘ ↵ approves from anywhere in the card (the Kbd on Approve says so).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !busy) {
      event.preventDefault();
      onApprove();
    }
  };

  return (
    <>
      <GateCardFrame
        tone="warn"
        icon="status-needs-you"
        title={`Review ${stageName}`}
        meta={tool ? <InlineCode>{tool}</InlineCode> : undefined}
        explanation={approveStarts ? `Approve starts ${approveStarts}` : 'Approve completes the stage'}
        onKeyDown={onKeyDown}
        data-testid="stage-review-card"
        actions={[
          ...(onReject
            ? [{ label: 'Reject', variant: 'danger' as const, onClick: () => void reject(), disabled: busy, 'data-testid': 'stage-review-reject' }]
            : []),
          {
            label: 'Request changes',
            onClick: () => onRequestChanges(trimmed),
            disabled: busy || trimmed.length === 0,
            'data-testid': 'stage-review-changes',
          },
          {
            label: 'Approve',
            variant: 'primary' as const,
            shortcut: ['Ctrl', '↵'],
            onClick: onApprove,
            disabled: busy,
            loading: busy,
            'data-testid': 'stage-review-approve',
          },
        ]}
      >
        <p className="text-ui whitespace-pre-wrap text-fg">{reason}</p>
        {args && Object.keys(args).length > 0 ? (
          <pre className="max-h-32 overflow-auto rounded-card border border-line-soft bg-sunken px-3 py-2 font-mono text-small text-fg-2">
            {JSON.stringify(args, null, 2)}
          </pre>
        ) : null}
        {output ? (
          <section aria-label="Output to approve" className="max-h-96 overflow-auto rounded-card border border-line-soft bg-sunken px-3 py-2" data-testid="stage-review-output">
            <Markdown>{reviewMarkdown(output)}</Markdown>
          </section>
        ) : null}
        <Textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={2}
          aria-label="Review feedback"
          placeholder={`Feedback for ${agentName ?? 'the stage'} (sent with Request changes)…`}
          data-testid="stage-review-feedback"
        />
      </GateCardFrame>
      {confirmer.dialog}
    </>
  );
}
