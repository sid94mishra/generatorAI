#!/usr/bin/env node
// Mobile design gate (02 §9.8). Hard zero since M10-01 deleted the legacy layer: any error, and any warning of a
// guarded rule (mobile-design, react-hooks, boundaries, better-tailwindcss), in src/ or app/ fails. There is no
// baseline any more; a new allowance would need a decision, not a file.
import { ESLint } from 'eslint';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { relative, resolve, sep } from 'node:path';
import { mobileDir } from './design-rules.mjs';

export const guardedRule = (id) => /^(mobile-design\/|react-hooks\/|boundaries\/|better-tailwindcss\/)/.test(id ?? '');

/** One line per error or guarded warning, `path:line: rule message`. */
export function hardZeroFailures(results, directory = mobileDir) {
  const failures = [];
  for (const result of results) {
    const path = relative(directory, result.filePath).split(sep).join('/');
    for (const message of result.messages) {
      if (message.severity === 2 || guardedRule(message.ruleId)) failures.push(`${path}:${message.line}: ${message.ruleId ?? 'parse'} ${message.message.split('\n')[0]}`);
    }
  }
  return failures;
}

export async function checkDesign() {
  const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../..', import.meta.url)) });
  const results = await eslint.lintFiles([resolve(mobileDir, 'src'), resolve(mobileDir, 'app')]);
  const failures = hardZeroFailures(results);
  if (failures.length) {
    console.error(failures.join('\n'));
    return 1;
  }
  console.log('Mobile design checks passed (hard zero in src/ and app/).');
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await checkDesign();
