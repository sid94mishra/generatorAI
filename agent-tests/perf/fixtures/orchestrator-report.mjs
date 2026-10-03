#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Transcript performance fixture (desktop orchestrator test, D-88): one chat,
// "Perf — Orchestrator report", whose turn is a dozen tool steps (file edits,
// a failed command) followed by a ~3,700-word markdown report — 12 sections,
// two tables, four code blocks, nested lists — streamed word by word.
//
//   node agent-tests/perf/fixtures/orchestrator-report.mjs [--delay=8]
//     → writes orchestrator-report.faux.json next to this file, for
//       GENERATORAI_TEST_FAUX_HARNESS=true GENERATORAI_TEST_FAUX_SCRIPT=<it>.
//
// `reportMarkdown()` is also imported by the perf spec, so the streamed and
// the persisted transcript are the same text.
// ────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PERF_CHAT_NAME = 'Perf — Orchestrator report';

const FILES = ['slugify', 'greet', 'farewell', 'format', 'parse', 'router', 'cache', 'queue'];

function paragraph(topic, n) {
  const sentences = [
    `The ${topic} change keeps the public surface small: one exported function, no default export, and no side effects at import time.`,
    `Every branch of ${topic} is covered by a table-driven test, so a regression shows up as one failing row instead of a cascade.`,
    `Edge cases were chosen from real inputs: empty strings, whitespace-only values, mixed scripts, and values that already look normalised.`,
    `The worker reported its result as a digest; I read the files themselves before accepting it, because digests summarise intent, not behaviour.`,
    `Nothing here depends on a bundler: imports carry explicit extensions, which is what Node's type stripping needs to resolve them.`,
    `If this module grows, split parsing from formatting first — they change for different reasons and are tested differently.`,
  ];
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(sentences[(i + topic.length) % sentences.length]);
  return out.join(' ');
}

function codeBlock(name) {
  return [
    '```ts',
    `export function ${name}(input: string, options: { strict?: boolean } = {}): string {`,
    `  const value = input.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');`,
    `  if (options.strict && value.trim() === '') throw new Error('${name}: empty input');`,
    `  return value`,
    `    .toLowerCase()`,
    `    .replace(/[^a-z0-9]+/g, '-')`,
    `    .replace(/^-+|-+$/g, '');`,
    `}`,
    '```',
  ].join('\n');
}

function table(rows) {
  const lines = ['| Case | Input | Expected | Why |', '|---|---|---|---|'];
  for (let i = 0; i < rows; i += 1) {
    lines.push(`| ${i + 1} | \`input-${i} ${FILES[i % FILES.length]}\` | \`expected-${i}\` | ${['diacritics', 'punctuation run', 'leading separators', 'digits kept', 'empty result', 'mixed case'][i % 6]} |`);
  }
  return lines.join('\n');
}

/** The ~3,700-word report body. */
export function reportMarkdown() {
  const parts = ['# Final report: two waves, eight modules, one test runner\n'];
  const sections = [
    'Summary', 'Objective and what done meant', 'Worker-by-worker results', 'File-by-file changes',
    'Test cases', 'Verification', 'Module resolution', 'Documentation', 'Risks', 'Decisions taken',
    'What I did not do', 'Follow-ups',
  ];
  sections.forEach((title, s) => {
    parts.push(`## ${s + 1}. ${title}\n`);
    parts.push(paragraph(title.toLowerCase(), 5) + '\n');
    parts.push(paragraph(FILES[s % FILES.length], 4) + '\n');
    if (s % 3 === 0) parts.push(codeBlock(FILES[s % FILES.length]) + '\n');
    if (s === 4 || s === 8) parts.push(table(s === 4 ? 14 : 8) + '\n');
    parts.push(
      [
        `- **${FILES[s % FILES.length]}**: ${paragraph('list item', 1)}`,
        `  - nested: ${paragraph('nested item', 1)}`,
        `- **${FILES[(s + 1) % FILES.length]}**: ${paragraph('second item', 1)}`,
        `1. ${paragraph('numbered', 1)}`,
        `2. ${paragraph('numbered two', 1)}`,
      ].join('\n') + '\n',
    );
  });
  return parts.join('\n');
}

/** The scripted turn: steps, a short note, then the report streamed word by word. */
export function perfScript(delayMs = 8) {
  const steps = [];
  for (const [i, name] of FILES.entries()) {
    steps.push({ type: 'file_edit', path: `src/${name}.ts`, content: `export const ${name} = ${i};\n`.repeat(6), toolName: i % 2 ? 'Edit' : 'Write' });
  }
  steps.push({ type: 'tool_error', name: 'Bash', error: 'npm test exited 1: ERR_MODULE_NOT_FOUND ./util' });
  steps.push({ type: 'file_edit', path: 'package.json', content: '{ "type": "module" }\n', toolName: 'Write' });
  steps.push({ type: 'file_edit', path: 'tsconfig.json', content: '{ "compilerOptions": { "strict": true } }\n', toolName: 'Write' });
  steps.push({ type: 'file_edit', path: 'CHANGELOG.md', content: '# Changelog\n\n- slugify\n', toolName: 'Write' });
  return {
    [PERF_CHAT_NAME]: [
      [
        { type: 'text', content: 'Both waves are done; checking their output before the report.' },
        ...steps,
        { type: 'text', content: reportMarkdown(), delayMs },
        { type: 'complete', usage: { inputTokens: 48211, outputTokens: 5120 } },
      ],
    ],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const delay = Number(process.argv.find((a) => a.startsWith('--delay='))?.slice(8) ?? 8);
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'orchestrator-report.faux.json');
  fs.writeFileSync(out, JSON.stringify(perfScript(delay), null, 2));
  const words = reportMarkdown().split(/\s+/).length;
  console.log(`wrote ${out} (${words} words)`);
}
