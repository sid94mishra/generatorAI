// ────────────────────────────────────────────────────────────────
// Entry of the skill's offline validator (`scripts/validate.mjs`, P06
// WP-6.6). `scripts/generate-workflow-skill.ts` bundles it with esbuild
// together with `@generatorai/workflow-spec`, so the validator runs the
// server's exact rules with nothing installed. Agents call it, so it never
// prompts: JSON on stdout, diagnostics on stderr, distinct exit codes.
// ────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { importGraph } from '../../packages/workflow-spec/src/document.ts';

declare const __SCHEMA_VERSION__: number;
declare const __SCHEMA_HASH__: string;

const HELP = `Validate a GeneratorAI workflow document (WorkflowGraph JSON) offline.

Usage:
  node scripts/validate.mjs <file.json>
  node scripts/validate.mjs -            read the document from stdin
  node scripts/validate.mjs --help

Prints {"valid": boolean, "issues": [{code, severity, path, stageKey?, message, hint?}]}
on stdout. "path" is a JSON pointer into the document. Fix every issue whose
severity is "error", then run it again; warnings do not block.

Exit codes:
  0  valid (warnings allowed)
  1  invalid: at least one error
  2  usage error: no file, an unreadable file or an unknown option

The same rules as the server's validate_workflow, for engine v2, except the
checks that need the server: sub-workflow references, agents and models, and
the operator's extra commands. Validate again with validate_workflow (or
"generatorai workflow validate <file>") before you submit a draft.
Schema: format version ${__SCHEMA_VERSION__}, hash ${__SCHEMA_HASH__}.
`;

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  const unknown = args.filter((a) => a.startsWith('-') && a !== '-');
  if (unknown.length > 0) {
    process.stderr.write(`Unknown option ${unknown[0]}. Run with --help.\n`);
    return 2;
  }
  if (args.length !== 1) {
    process.stderr.write('Pass exactly one file (or - for stdin). Run with --help.\n');
    return 2;
  }
  const source = args[0]!;
  let text: string;
  try {
    text = readFileSync(source === '-' ? 0 : source, 'utf8');
  } catch (err) {
    process.stderr.write(`Cannot read ${source === '-' ? 'stdin' : source}: ${(err as Error).message}\n`);
    return 2;
  }
  const result = importGraph(text.replace(/^﻿/, ''));
  process.stdout.write(`${JSON.stringify({ valid: result.valid, issues: result.issues }, null, 2)}\n`);
  return result.valid ? 0 : 1;
}

process.exitCode = main(process.argv);
