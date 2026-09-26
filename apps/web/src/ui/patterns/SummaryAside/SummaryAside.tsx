// ────────────────────────────────────────────────────────────────
// C-15 SummaryAside (03 §3 C-15; D-36): ChatCreate, ChatCreateModel,
// ChatCreateOrchestrator, AgentEditor.
//
// 320 wide (`w-aside`), `sticky top-0`, a P-48 card: header 40h ("Summary" +
// `hint`), each `section` pad 12 14 with a caption (`label`, `text-small
// text-fg-3`) above its `content`. Must show only real computed values (no
// placeholder numbers) — the caller decides what to render, this is a slot.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Card } from '../../primitives/Card/Card.js';

export interface SummaryAsideSection {
  label: ReactNode;
  content: ReactNode;
}

export interface SummaryAsideProps {
  title?: ReactNode;
  hint?: ReactNode;
  sections: readonly SummaryAsideSection[];
  className?: string;
}

/** A sticky 320px summary card beside a long form. */
export function SummaryAside({ title = 'Summary', hint, sections, className }: SummaryAsideProps) {
  return (
    <Card className={cn('sticky top-0 w-aside shrink-0', className)}>
      <Card.Header title={title} meta={hint} />
      {sections.map((section, index) => (
        <Card.Section key={index} padding="sm" className={cn(index === 0 && 'border-t-0')}>
          <div className="text-small text-fg-3">{section.label}</div>
          <div className="text-ui text-fg">{section.content}</div>
        </Card.Section>
      ))}
    </Card>
  );
}
