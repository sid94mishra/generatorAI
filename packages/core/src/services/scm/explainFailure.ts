// ────────────────────────────────────────────────────────────────
// explainScmFailure — git's stderr, turned into the sentence the ship dialog
// shows when a flow step fails.
//
// Raw push output carries the remote's path or URL, `! [remote rejected]`,
// `error: failed to push some refs …` and `hint:` paragraphs; a refused commit
// carries the checkout's absolute path. The user needs what the hook or the
// remote said, and what to do next. The raw text still goes to the log.
// ────────────────────────────────────────────────────────────────

import type { ScmFlowStepId } from '@generatorai/shared';

/** `Failed to commit in <dir>: …` / `Failed to push <branch> to <remote>: …` → the part after the prefix. */
function stripPrefix(raw: string): string {
  return raw.replace(/^Failed to (commit in .+?|push(?: \S+ to \S+)?): /s, '');
}

/** Lines worth showing: no `To <remote>`, `error: failed to push some refs`, `hint:` or ref-update rows. */
function meaningfulLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !/^To \S/.test(line) &&
        !/^error: failed to push some refs/.test(line) &&
        !/^hint:/.test(line) &&
        !/^!\s*\[/.test(line),
    );
}

function remoteSaid(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => /^remote:/.test(line.trim()))
    .map((line) => line.trim().replace(/^remote:\s*/, ''))
    .filter((line) => line.length > 0 && !/^-+$/.test(line))
    .join(' ');
}

export function explainScmFailure(step: ScmFlowStepId, raw: string): string {
  const text = stripPrefix(raw).trim();

  if (step === 'commit') {
    if (/Author identity unknown|Please tell me who you are|empty ident/i.test(text)) {
      return 'Git does not know who is committing. Set user.name and user.email for this repository, then commit again.';
    }
    const said = meaningfulLines(text).join(' ');
    return said ? `The commit was refused: ${said}` : 'The commit was refused.';
  }

  if (step === 'push') {
    if (/\[remote rejected\]|pre-receive hook declined|protected branch/i.test(text)) {
      const said = remoteSaid(text);
      return said ? `The remote refused the push: ${said}` : 'The remote refused the push.';
    }
    if (/\[rejected\]|non-fast-forward|fetch first/i.test(text)) {
      return 'The remote branch has commits this checkout does not. Push again: they are merged in first.';
    }
    if (/Authentication failed|could not read Username|Permission denied|403|access denied/i.test(text)) {
      return `The remote did not accept your credentials. ${meaningfulLines(text)[0] ?? ''}`.trim();
    }
    if (/Could not resolve host|Connection (refused|timed out)|unable to access/i.test(text)) {
      return 'Could not reach the remote. Check the connection and push again.';
    }
  }

  return meaningfulLines(text).join(' ') || text || 'Something went wrong.';
}
