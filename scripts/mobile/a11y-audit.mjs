#!/usr/bin/env node
// Route accessibility audit on both platforms (08 §4.8, M10-04, MD-195): opens every route of
// apps/mobile/e2e/a11y-routes.json on the paired simulator / emulator, waits for its ready id, snapshots it with
// agent-device and runs the snapshot checker (e2e/a11y-check.mjs: labels, roles, 44 pt / 48 dp frames, status glyph +
// word). `--text-size=ax` repeats it at the largest accessibility size (iOS AX5, Android font scale 2.0 — the Dynamic
// Type sweep). On Android this is the automated accessibility check; Accessibility Scanner stays a manual pass.
//
//   node scripts/mobile/a11y-audit.mjs --platform=ios|android [--udid=…|--serial=…] [--text-size=default|ax] [--batch=F]
//
// Writes docs/redesign/mobile/reviews/<batch>/a11y-<platform>[-ax].md; exit 1 on any error finding or unreachable route.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT } from './lib/sandbox-session.mjs';
import { ADB, agent, findTargets, run } from './lib/sandbox-devices.mjs';
import { a11yMarkdown, auditVerdict } from './lib/a11y-report.mjs';
import { auditSnapshot } from '../../apps/mobile/e2e/a11y-check.mjs';

const TEXT_SIZES = { default: 'large', ax: 'accessibility-extra-extra-extra-large' };

async function androidDensity(serial) {
  const output = await run(ADB, ['-s', serial, 'shell', 'wm', 'density']);
  const matches = [...output.matchAll(/(?:Physical|Override) density:\s*(\d+)/g)];
  if (!matches.length) throw new Error('Cannot read the Android display density');
  return Number(matches.at(-1)[1]) / 160;
}

async function main() {
  const { values } = parseArgs({ options: {
    platform: { type: 'string' }, udid: { type: 'string' }, serial: { type: 'string' },
    'text-size': { type: 'string', default: 'default' }, batch: { type: 'string', default: 'F' }, help: { type: 'boolean' },
  } });
  if (values.help || !values.platform || !TEXT_SIZES[values['text-size']]) {
    console.log('Usage: node scripts/mobile/a11y-audit.mjs --platform=ios|android [--udid=…|--serial=…] [--text-size=default|ax] [--batch=F]');
    return;
  }
  const routes = JSON.parse(await fs.readFile(path.join(ROOT, 'apps/mobile/e2e/a11y-routes.json'), 'utf8'));
  const allow = JSON.parse(await fs.readFile(path.join(ROOT, 'apps/mobile/e2e/a11y-allow.json'), 'utf8'));
  const [target] = await findTargets({ platform: values.platform, udid: values.udid, serial: values.serial });
  const density = target.platform === 'android' ? await androidDensity(target.serial) : 1;
  const textSize = values['text-size'];
  await agent(target, ['settings', 'text-size', TEXT_SIZES[textSize]]);
  if (target.platform === 'android') await agent(target, ['open', 'dev.generatorai.app', '--relaunch']);
  const results = [];
  try {
    for (const route of routes) {
      try {
        await agent(target, ['open', `generatorai:///${route.route}`]);
        await agent(target, ['wait', route.ready ? `id="${route.ready}"` : `label="${route.readyLabel}"`, '30000']);
        const document = JSON.parse(await agent(target, ['snapshot', ...(target.platform === 'ios' ? ['--raw'] : []), '--json']));
        results.push({ name: route.name, issues: auditSnapshot(document, { platform: target.platform, density, allow }) });
      } catch (error) {
        results.push({ name: route.name, failure: error.message });
      }
      const last = results.at(-1);
      console.log(`a11y: ${route.name} — ${last.failure ? `not audited (${last.failure})` : `${last.issues.filter((i) => i.level === 'error').length} errors, ${last.issues.length} findings`}`);
    }
  } finally {
    if (textSize !== 'default') await agent(target, ['settings', 'text-size', TEXT_SIZES.default]).catch(() => undefined);
  }
  const commit = (await run('git', ['rev-parse', '--short', 'HEAD'])).trim();
  const file = path.join(ROOT, 'docs/redesign/mobile/reviews', values.batch, `a11y-${target.platform}${textSize === 'ax' ? '-ax' : ''}.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, a11yMarkdown({ platform: target.platform, device: target.name, textSize: TEXT_SIZES[textSize], commit, recordedAt: new Date().toISOString() }, results));
  const { levels, exitCode } = auditVerdict(results);
  console.log(`a11y: ${JSON.stringify(levels)} → ${path.relative(ROOT, file)}`);
  process.exitCode = exitCode;
}

main().catch((error) => { console.error(`a11y-audit: ${error.message}`); process.exitCode = 1; });
