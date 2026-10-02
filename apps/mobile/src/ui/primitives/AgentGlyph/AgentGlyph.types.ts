// MP-37 AgentGlyph contract (03 MP-37): never initials (principle 8).
export interface AgentGlyphProps {
  kind: 'agent' | 'model' | 'team' | 'you';
  /** Agent name, model name (kind 'model'), or the team's orchestrator. */
  name: string;
  /** Shown after the agent name in fg-3. */
  model?: string;
  /** Team members ("Bug Fixer, Code Reviewer, Test Writer"). */
  members?: string[];
  /** Icon size; the text role follows it. Default 14. */
  size?: 12 | 14 | 16 | 20;
  /** Agent locked for the chat (composer chip). */
  locked?: boolean;
  testID?: string;
}
