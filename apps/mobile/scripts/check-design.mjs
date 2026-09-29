#!/usr/bin/env node
import { ESLint } from 'eslint';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { relative, resolve, sep } from 'node:path';
import { mobileDir } from './design-rules.mjs';

export const guardedRule = (id) => /^(mobile-design\/|react-hooks\/|boundaries\/|better-tailwindcss\/)/.test(id ?? '');
export function countsFor(results, directory = mobileDir) {
  const files = {};
  for (const result of results) {
    const path = relative(directory, result.filePath).split(sep).join('/');
    const counts = {};
    for (const message of result.messages) {
      if (!guardedRule(message.ruleId)) continue;
      const key = `${message.ruleId}/${message.messageId ?? 'diagnostic'}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    if (Object.keys(counts).length) files[path] = counts;
  }
  return files;
}
export function compareCounts(current, baseline, strict = false) {
  const failures = [];
  for (const path of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
    for (const rule of new Set([...Object.keys(current[path] ?? {}), ...Object.keys(baseline[path] ?? {})])) {
      const now = current[path]?.[rule] ?? 0;
      const before = baseline[path]?.[rule] ?? 0;
      if (now > before) failures.push(`${path}: ${rule} rose ${before} → ${now}`);
      else if (strict && now < before) failures.push(`${path}: ${rule} fell ${before} → ${now}; run check:design --update`);
    }
  }
  return failures;
}
export async function checkDesign(args = process.argv.slice(2)) {
  const baselinePath = resolve(mobileDir, 'design-baseline.json');
  if (!existsSync(baselinePath)) throw new Error('Missing committed design baseline; do not silently initialize one.');
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../../', import.meta.url)) });
  const results = await eslint.lintFiles([resolve(mobileDir, 'src'), resolve(mobileDir, 'app')]);
  const files = countsFor(results);
  const errors = results.flatMap((r) => r.messages.filter((m) => m.severity === 2).map((m) => `${relative(mobileDir, r.filePath)}:${m.line}: ${m.message}`));
  const failures = [...errors, ...compareCounts(files, baseline.files, args.includes('--strict') && !args.includes('--update'))];
  if (!failures.length && args.includes('--update')) {
    // Check rises BEFORE writing. Newly clean legacy routes become hard zero.
    const legacyRoutes = baseline.legacyRoutes.filter((p) => files[p]);
    writeFileSync(baselinePath, JSON.stringify({ legacyRoutes, files }, null, 2) + '\n');
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    return 1;
  }
  console.log(`Mobile design checks passed (${Object.keys(files).length} legacy files ratcheted; new layers hard zero).`);
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await checkDesign();
