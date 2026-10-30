// ────────────────────────────────────────────────────────────────
// Workflow stage prompts as a person reads them.
//
// The engine (core StageExecutor) sends a stage's first prompt with its
// predecessors' results fenced in front of it as untrusted context
// (`<generatorai:stage-context trust="untrusted">`, one `## Completed stage
// "<name>"` block each, joined by `---`), the output contract after it
// (`---` then "**Expected output:**" / the submit_output or json-block
// instruction), and — on a resend after an interruption — a resume notice
// before everything. The run page showed all of it verbatim, XML included.
// Both clients render the instruction, with the context and the contract
// folded away.
//
// Dependency-free (the Electron main bundle loads `@generatorai/shared/ui-contract`).
// ────────────────────────────────────────────────────────────────

export interface StagePromptContext {
  /** The predecessor stage's name, or null for a context block that is not a stage result (a hook's). */
  stage: string | null;
  body: string;
}

export interface ParsedStagePrompt {
  /** What the stage was asked to do. */
  instruction: string;
  context: StagePromptContext[];
  /** The output contract the engine appended (expected output, schema), if any. */
  outputContract?: string;
  /** The prompt was resent after an interruption. */
  resumed: boolean;
}

const OPEN = '<generatorai:stage-context';
const CLOSE = '</generatorai:stage-context>';
const RESUME = /^The previous request for this step was interrupted before it finished\.[^\n]*\n\n/;
const CONTRACT = /\n\n---\n(?=\*\*Expected output:\*\*|When you are done, call `submit_output`|End your answer with the structured output)/;
const STAGE_BLOCK = /^## Completed stage "([^"\n]*)"\n?/;

/** The parts of a stage prompt, or null when the text carries none of the engine's framing. */
export function parseStagePrompt(text: string): ParsedStagePrompt | null {
  let rest = text;
  const resumed = RESUME.test(rest);
  if (resumed) rest = rest.replace(RESUME, '');

  const context: StagePromptContext[] = [];
  if (rest.startsWith(OPEN)) {
    const end = rest.indexOf(CLOSE);
    const bodyStart = rest.indexOf('>') + 1;
    if (end !== -1 && bodyStart > 0 && bodyStart <= end) {
      for (const block of rest.slice(bodyStart, end).trim().split(/\n\n---\n\n/)) {
        const m = STAGE_BLOCK.exec(block);
        const body = (m ? block.slice(m[0].length) : block).trim();
        if (body || m) context.push({ stage: m ? m[1]! : null, body });
      }
      rest = rest.slice(end + CLOSE.length).replace(/^\s+/, '');
    }
  }

  let outputContract: string | undefined;
  const contract = CONTRACT.exec(rest);
  if (contract) {
    outputContract = rest.slice(contract.index + contract[0].length).trim();
    rest = rest.slice(0, contract.index);
  }

  if (!resumed && context.length === 0 && outputContract === undefined) return null;
  return { instruction: rest.trim(), context, ...(outputContract ? { outputContract } : {}), resumed };
}
