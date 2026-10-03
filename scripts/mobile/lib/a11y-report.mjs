// The markdown summary of an accessibility route audit (scripts/mobile/a11y-audit.mjs, M10-04). Pure; Node test.

/** Counts by level and the exit code: any error (not allowed by a11y-allow.json) fails. */
export function auditVerdict(results) {
  const levels = { error: 0, warning: 0, allowed: 0 };
  for (const result of results) {
    if (result.failure) levels.error += 1;
    for (const issue of result.issues ?? []) levels[issue.level] = (levels[issue.level] ?? 0) + 1;
  }
  return { levels, exitCode: levels.error ? 1 : 0 };
}

const cell = (text) => String(text ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');

export function a11yMarkdown({ platform, device, textSize, commit, recordedAt }, results) {
  const { levels } = auditVerdict(results);
  const lines = [
    `# Accessibility audit — ${platform} (${device}), text size ${textSize}`,
    '',
    `${recordedAt} · ${commit} · \`node scripts/mobile/a11y-audit.mjs\` (agent-device snapshot → \`e2e/a11y-check.mjs\`).`,
    `Errors ${levels.error} · warnings ${levels.warning} · allowed ${levels.allowed}.`,
    '',
    '| Route | Result | Rule | Selector | Finding |',
    '|---|---|---|---|---|',
  ];
  for (const result of results) {
    if (result.failure) { lines.push(`| ${cell(result.name)} | not audited | — | — | ${cell(result.failure)} |`); continue; }
    if (!result.issues.length) { lines.push(`| ${cell(result.name)} | clean | | | |`); continue; }
    for (const issue of result.issues) {
      lines.push(`| ${cell(result.name)} | ${issue.level} | ${cell(issue.rule)} | ${cell(issue.selector)} | ${cell(issue.message)}${issue.decision ? ` (${cell(issue.decision)})` : ''} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}
